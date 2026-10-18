import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { supabase } from './supabase'

// A minimal Yjs "provider" that syncs a Y.Doc over a Supabase Realtime
// Broadcast channel, instead of a dedicated y-websocket/y-webrtc server —
// this app has no backend of its own to run one, only Supabase. It
// implements the same two jobs any Yjs provider does:
//   1. Document sync — local `doc.on('update')` -> broadcast; incoming
//      broadcast -> `Y.applyUpdate`.
//   2. Awareness (cursors/presence) — a real y-protocols `Awareness`
//      instance is exposed as `.awareness`, which is exactly the contract
//      @tiptap/extension-collaboration-cursor expects (getStates/
//      setLocalStateField/on/off). Awareness diffs are broadcast the same
//      way as doc updates; Supabase's own Presence feature separately
//      handles "who left" so a stale cursor can be cleared instantly.
//
// Persistence: the full Yjs state (not a diff) is written back to
// `wiki_pages.ydoc_state` via `onPersist`, debounced while typing and
// flushed when the last editor leaves the page. Because it's the full
// CRDT state each time, concurrent/overlapping saves from different
// clients are still safe to merge on next load — there's no "last write
// wins" data loss the way there would be with a plain text column.

const CURSOR_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']
export function colorForUser(id) {
  let hash = 0
  for (let i = 0; i < String(id).length; i++) hash = (hash * 31 + String(id).charCodeAt(i)) >>> 0
  return CURSOR_COLORS[hash % CURSOR_COLORS.length]
}

function toBase64(bytes) {
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary)
}
function fromBase64(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const REMOTE = 'wiki-remote'
const PERSIST_DEBOUNCE_MS = 4000

export class SupabaseYjsProvider {
  // `awareness`, if supplied, must already be constructed against `doc` —
  // callers that need CollaborationCursor configured before this provider
  // exists (see PageEditor.jsx) create the Awareness instance themselves
  // up front (cheap, no network side effects) and pass it in here, rather
  // than this class creating its own after the fact.
  constructor({ pageId, doc, user, awareness, onSynced, onPersist, onLastLeave }) {
    this.doc = doc
    this.onPersist = onPersist
    this.onLastLeave = onLastLeave
    this.awareness = awareness || new Awareness(doc)
    this.awareness.setLocalStateField('user', { id: user.id, name: user.name, color: colorForUser(user.id) })
    this._persistTimer = null
    this._destroyed = false
    this._hasLocalEdits = false

    this.channel = supabase.channel(`wiki-doc-${pageId}`, { config: { broadcast: { self: false }, presence: { key: user.id } } })

    this.channel.on('broadcast', { event: 'yupdate' }, ({ payload }) => {
      if (!payload?.update) return
      Y.applyUpdate(this.doc, fromBase64(payload.update), REMOTE)
    })
    this.channel.on('broadcast', { event: 'awareness' }, ({ payload }) => {
      if (!payload?.update) return
      applyAwarenessUpdate(this.awareness, fromBase64(payload.update), REMOTE)
    })
    // Presence 'leave' is Supabase's own signal (fires even on an
    // unclean disconnect), independent of Yjs awareness — use it to
    // both drop that user's cursor and, if they were the last one here,
    // flush a final persist so nothing is lost between debounce ticks.
    this.channel.on('presence', { event: 'leave' }, ({ key }) => {
      const staleClientIds = []
      this.awareness.getStates().forEach((s, clientId) => { if (s.user?.id === key) staleClientIds.push(clientId) })
      if (staleClientIds.length) removeAwarenessStates(this.awareness, staleClientIds, REMOTE)
      if (Object.keys(this.channel.presenceState()).length === 0) {
        this.persist()
        // Last person to leave a page that actually changed snapshots a
        // version, so history captures "state after each editing
        // session" rather than every few-second autosave tick.
        if (this._hasLocalEdits) { this.onLastLeave?.(Y.encodeStateAsUpdate(this.doc)); this._hasLocalEdits = false }
      }
    })

    this._onDocUpdate = (update, origin) => {
      if (origin === REMOTE || this._destroyed) return
      this._hasLocalEdits = true
      this.channel.send({ type: 'broadcast', event: 'yupdate', payload: { update: toBase64(update) } })
      this._schedulePersist()
    }
    this.doc.on('update', this._onDocUpdate)

    this._onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === REMOTE || this._destroyed) return
      const changed = added.concat(updated, removed)
      const update = encodeAwarenessUpdate(this.awareness, changed)
      this.channel.send({ type: 'broadcast', event: 'awareness', payload: { update: toBase64(update) } })
    }
    this.awareness.on('update', this._onAwarenessUpdate)

    this.channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        this.channel.track({ id: user.id })
        onSynced?.()
      }
    })
  }

  _schedulePersist() {
    clearTimeout(this._persistTimer)
    this._persistTimer = setTimeout(() => this.persist(), PERSIST_DEBOUNCE_MS)
  }

  persist() {
    this.onPersist?.(Y.encodeStateAsUpdate(this.doc))
  }

  destroy() {
    this._destroyed = true
    clearTimeout(this._persistTimer)
    this.persist()
    this.doc.off('update', this._onDocUpdate)
    this.awareness.off('update', this._onAwarenessUpdate)
    this.awareness.destroy()
    supabase.removeChannel(this.channel)
  }
}
