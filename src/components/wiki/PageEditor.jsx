import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import TiptapImage from '@tiptap/extension-image'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, List, ListOrdered, Quote,
  Link as LinkIcon, Undo2, Redo2, Users, History as HistoryIcon, Save, Image as ImageIcon,
} from 'lucide-react'
import { SupabaseYjsProvider, colorForUser } from '../../lib/wikiYjsProvider'
import { getPageYdoc, persistPageYdoc, extractMentionIds, syncPageMentions } from '../../lib/wikiPages'
import { saveWikiPageVersion } from '../../lib/wikiPageVersions'
import { wikiMentionSuggestion } from '../../lib/wikiMentionSuggestion'
import { uploadAttachment } from '../../lib/wikiAttachments'
import { ActionItem } from './actionItemExtension'
import { createTaskFromActionItem } from '../../lib/wikiActionItems'
import { Modal } from '../ui'
import PageHistory from './PageHistory'
import PageAttachments from './PageAttachments'

// One PageEditor instance == one open page. The parent renders this with
// `key={page.id}` so switching pages remounts it fresh rather than trying
// to swap the Yjs doc underneath a live editor.
export default function PageEditor({ pageId, pageTitle, profile, projectId }) {
  const [ydoc] = useState(() => new Y.Doc())
  // Constructed up front (pure, no network I/O) so CollaborationCursor can
  // bind to the real awareness object at editor-creation time — it only
  // reads `provider.awareness` once, when the editor is built, so handing
  // it a real instance from the start avoids a "connects to nothing"
  // ordering bug where the actual network provider isn't ready yet.
  const [awareness] = useState(() => new Awareness(ydoc))
  const providerRef = useRef(null)
  const editorRef = useRef(null)
  // useEditor()'s extensions are only (re)built when its [ydoc] dep
  // changes, not on every render — so onCreateTask below must read
  // projectId through a ref rather than closing over the prop directly,
  // or it'd keep using whatever project was linked when the editor was
  // first constructed even after switching this page to a different
  // project via the picker above (same page, no remount).
  const projectIdRef = useRef(projectId)
  useEffect(() => { projectIdRef.current = projectId }, [projectId])
  const [ready, setReady] = useState(false)
  const [collaborators, setCollaborators] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [savingVersion, setSavingVersion] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }), // Yjs's own UndoManager (bundled in Collaboration) replaces StarterKit's history
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Link.configure({ openOnClick: false, autolink: true }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider: { awareness },
        user: { name: profile.full_name || 'Someone', color: colorForUser(profile.id) },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'wiki-mention' },
        suggestion: wikiMentionSuggestion,
      }),
      TiptapImage,
      // Wiki action items (STEP205) — must come after every other
      // extension here so its Enter handler is tried first; see
      // actionItemExtension.js's header comment for why.
      ActionItem.configure({
        onCreateTask: (label, mentionId) => createTaskFromActionItem({
          pageId, projectId: projectIdRef.current, taskName: label, assignedTo: mentionId,
          organizationId: profile.organization_id, createdBy: profile.id,
        }),
      }),
    ],
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const file = [...(event.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'))
        if (!file) return false
        event.preventDefault()
        uploadAttachment(pageId, file, profile.id, profile.organization_id).then(url => {
          if (!url) return
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const node = view.state.schema.nodes.image.create({ src: url })
          view.dispatch(view.state.tr.insert(coords?.pos ?? view.state.selection.from, node))
        }).catch(err => alert(err.message))
        return true
      },
      handlePaste: (view, event) => {
        const file = [...(event.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile()
        if (!file) return false
        event.preventDefault()
        uploadAttachment(pageId, file, profile.id, profile.organization_id).then(url => {
          if (!url) return
          const node = view.state.schema.nodes.image.create({ src: url })
          view.dispatch(view.state.tr.replaceSelectionWith(node))
        }).catch(err => alert(err.message))
        return true
      },
    },
  }, [ydoc])

  editorRef.current = editor

  useEffect(() => {
    let cancelled = false
    setReady(false)

    getPageYdoc(pageId).then(existing => {
      if (cancelled) return
      if (existing) Y.applyUpdate(ydoc, existing)

      const provider = new SupabaseYjsProvider({
        pageId,
        doc: ydoc,
        awareness,
        user: { id: profile.id, name: profile.full_name || 'Someone' },
        onSynced: () => { if (!cancelled) setReady(true) },
        onPersist: (state) => {
          const json = editorRef.current?.getJSON()
          persistPageYdoc(pageId, state, editorRef.current?.getText() || '', profile.id)
            .then(() => syncPageMentions(pageId, extractMentionIds(json), { title: pageTitle, senderId: profile.id }))
            .catch(console.error)
        },
        onLastLeave: (state) => {
          saveWikiPageVersion(pageId, state, editorRef.current?.getText() || '', profile.id).catch(console.error)
        },
      })
      providerRef.current = provider

      const syncCollaborators = () => {
        if (cancelled) return
        const users = [...provider.awareness.getStates().values()].map(s => s.user).filter(Boolean)
        setCollaborators(users)
      }
      provider.awareness.on('change', syncCollaborators)
      syncCollaborators()
    })

    return () => {
      cancelled = true
      providerRef.current?.destroy()
      providerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one provider per mount (component is remounted via `key={page.id}` by the caller)
  }, [])

  useEffect(() => () => editor?.destroy(), [editor])

  async function handleSaveVersion() {
    setSavingVersion(true)
    try {
      await saveWikiPageVersion(pageId, Y.encodeStateAsUpdate(ydoc), editor.getText(), profile.id)
    } catch (err) { alert(err.message) } finally { setSavingVersion(false) }
  }

  function handleRestored() {
    setShowHistory(false)
    alert('Restored. Reloading this page to show the restored content.')
    window.location.reload()
  }

  async function handleInsertImage(file) {
    if (!file) return
    try {
      const url = await uploadAttachment(pageId, file, profile.id, profile.organization_id)
      if (url) editor.chain().focus().setImage({ src: url }).run()
    } catch (err) { alert(err.message) }
  }

  if (!editor) return null

  return (
    <div>
      <style>{`
        .wiki-prose { min-height: 240px; outline: none; font-size: 14.5px; line-height: 1.7; }
        .wiki-prose p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: var(--ink-muted); pointer-events: none; height: 0; }
        .wiki-prose h1 { font-family: var(--font-head); font-size: 1.6rem; font-weight: 800; margin: 18px 0 8px; }
        .wiki-prose h2 { font-family: var(--font-head); font-size: 1.25rem; font-weight: 800; margin: 16px 0 6px; }
        .wiki-prose ul, .wiki-prose ol { padding-left: 22px; margin: 8px 0; }
        .wiki-prose blockquote { border-left: 3px solid var(--c1); padding-left: 12px; color: var(--ink-muted); margin: 10px 0; }
        .wiki-prose a { color: var(--c1); text-decoration: underline; }
        .wiki-prose .wiki-mention { background: var(--c1-soft); color: var(--c1); border-radius: 4px; padding: 1px 5px; font-weight: 700; }
        .wiki-prose img { max-width: 100%; border-radius: 8px; margin: 8px 0; }
        .wiki-prose p { margin: 6px 0; }
        .collaboration-cursor__caret { position: relative; margin-left: -1px; margin-right: -1px; border-left: 2px solid; word-break: normal; pointer-events: none; }
        .collaboration-cursor__label { position: absolute; top: -1.3em; left: -1px; font-size: 11px; font-weight: 700; line-height: 1; padding: 2px 6px; border-radius: 4px; color: #fff; white-space: nowrap; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <Toolbar editor={editor} onInsertImage={handleInsertImage} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!ready && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Connecting…</span>}
          <button className="btn btn-ghost btn-sm" onClick={handleSaveVersion} disabled={savingVersion}>
            <Save size={13} /> {savingVersion ? 'Saving…' : 'Save version'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory(true)}>
            <HistoryIcon size={13} /> History
          </button>
          {collaborators.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={collaborators.map(c => c.name).join(', ')}>
              <Users size={13} style={{ color: 'var(--ink-muted)' }} />
              <div style={{ display: 'flex' }}>
                {collaborators.slice(0, 5).map((c, i) => (
                  <div key={i} style={{
                    width: 22, height: 22, borderRadius: '50%', background: c.color, color: '#fff', fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: i === 0 ? 0 : -6,
                    border: '2px solid var(--surface)',
                  }}>
                    {(c.name || '?')[0]?.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="wiki-prose" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
        <EditorContent editor={editor} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', marginTop: 6 }}>
        Tip: type <code>/task</code> followed by a description (optionally @mention someone) on its own line and press Enter — it becomes a linked task automatically.
      </div>

      <PageAttachments pageId={pageId} profile={profile} />

      <Modal open={showHistory} onClose={() => setShowHistory(false)} title="Version History" size="lg">
        <PageHistory pageId={pageId} profile={profile} onRestored={handleRestored} />
      </Modal>
    </div>
  )
}

function Toolbar({ editor, onInsertImage }) {
  const btn = (active, onClick, Icon, label) => (
    <button type="button" title={label} onClick={onClick}
      className="btn btn-ghost btn-sm btn-icon"
      style={{ background: active ? 'var(--c1-soft)' : 'transparent', color: active ? 'var(--c1)' : 'inherit' }}>
      <Icon size={14} />
    </button>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold, 'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic, 'Italic')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), Strikethrough, 'Strikethrough')}
      <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
      {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), Heading1, 'Heading 1')}
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2, 'Heading 2')}
      <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), List, 'Bullet list')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered, 'Numbered list')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), Quote, 'Quote')}
      {btn(editor.isActive('link'), () => {
        const url = window.prompt('Link URL')
        if (url) editor.chain().focus().setLink({ href: url }).run()
        else if (url === '') editor.chain().focus().unsetLink().run()
      }, LinkIcon, 'Link')}
      <label className="btn btn-ghost btn-sm btn-icon" title="Insert image" style={{ cursor: 'pointer' }}>
        <ImageIcon size={14} />
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { onInsertImage(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
      {btn(false, () => editor.chain().focus().undo().run(), Undo2, 'Undo')}
      {btn(false, () => editor.chain().focus().redo().run(), Redo2, 'Redo')}
    </div>
  )
}
