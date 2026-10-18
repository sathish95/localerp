import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ActionItemView from './ActionItemView'

// Wiki "action items" (STEP205) — type `/task <description>` as the whole
// content of a line (optionally @mentioning someone for the assignee) and
// press Enter: that line becomes an inert "chip" node and a linked task is
// created in the background via options.onCreateTask. Modeled as an atom
// Node (not an input rule) because the trigger needs the FULL line's
// content — including any already-resolved `mention` node — which only a
// keyboard-shortcut handler inspecting the current paragraph gives us
// cleanly; an input rule only sees trailing plain text.
//
// Registered with LOWER priority in PageEditor's extensions array than it
// needs to intercept Enter BEFORE StarterKit's own paragraph/list Enter
// handling — Tiptap runs keyboard shortcuts in extension order and stops
// at the first handler that returns true, so this must come after
// StarterKit in the array (later == tried first) and fall through
// (`return false`) whenever the current line isn't a `/task` line.
export const ActionItem = Node.create({
  name: 'actionItem',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      // (label, mentionId) => Promise<{ id, task_id }>
      onCreateTask: null,
    }
  },

  addAttributes() {
    return {
      localId: { default: null },
      status: { default: 'creating' }, // 'creating' | 'created' | 'error'
      label: { default: '' },
      taskId: { default: null },
      taskCode: { default: null },
      error: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-action-item]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-action-item': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ActionItemView)
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { editor } = this
        const { state, view } = editor
        const { $from, empty } = state.selection
        if (!empty) return false
        const parent = $from.parent
        if (parent.type.name !== 'paragraph') return false
        // Only a plain top-level paragraph (directly in the document) —
        // not inside a list item or blockquote, where swapping it for a
        // non-paragraph block node could violate that parent's own
        // content schema (e.g. a list item requires its first child to
        // literally be a paragraph).
        if ($from.depth !== 1) return false
        // Only trigger once the whole line has been typed and the cursor
        // is at its end — never mid-line, never on a paragraph the user
        // is still editing above/below the cursor.
        if ($from.parentOffset !== parent.content.size) return false

        const text = parent.textContent || ''
        const match = /^\/task\s+(.+)$/i.exec(text.trim())
        if (!match) return false
        const label = match[1].trim()
        if (!label) return false

        let mentionId = null
        parent.forEach(child => { if (!mentionId && child.type.name === 'mention') mentionId = child.attrs.id })

        const localId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const start = $from.before()
        const end = $from.after()
        const chip = this.type.create({ localId, status: 'creating', label })
        const paragraph = state.schema.nodes.paragraph.create()

        let tr = state.tr.replaceRangeWith(start, end, chip)
        const afterPos = start + chip.nodeSize
        tr = tr.insert(afterPos, paragraph)
        tr = tr.setSelection(TextSelection.create(tr.doc, afterPos + 1))
        view.dispatch(tr)

        const updateChip = patch => {
          const cur = editor.state
          let pos = null
          cur.doc.descendants((n, p) => {
            if (pos == null && n.type.name === 'actionItem' && n.attrs.localId === localId) pos = p
          })
          if (pos == null) return // node was deleted/undone before creation resolved — nothing to update
          editor.view.dispatch(cur.tr.setNodeMarkup(pos, undefined, { ...cur.doc.nodeAt(pos).attrs, ...patch }))
        }

        this.options.onCreateTask?.(label, mentionId)
          .then(({ id, task_id }) => updateChip({ status: 'created', taskId: id, taskCode: task_id }))
          .catch(err => updateChip({ status: 'error', error: err.message || 'Failed to create task' }))

        return true
      },
    }
  },
})
