import { useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TiptapImage from '@tiptap/extension-image'
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Image as ImageIcon, Paperclip } from 'lucide-react'
import DOMPurify from 'dompurify'

// Shared by both the live editor and the read-only view below, so a page
// rendering only RichTextView (no RichTextEditor mounted) still gets
// correctly-sized images/lists rather than browser-default styling.
const RTE_CSS = `
  .rte-content{padding:10px 12px;outline:none;font-size:13px;line-height:1.5}
  .rte-content p{margin:0 0 6px}
  .rte-content p:last-child{margin-bottom:0}
  .rte-content ul,.rte-content ol{margin:0 0 6px;padding-left:20px}
  .rte-content img{max-width:100%;border-radius:6px;margin:4px 0}
  .rte-content a{color:var(--c1)}
  .rte-content p.is-editor-empty:first-child::before{content:attr(data-placeholder);float:left;color:var(--text-muted);pointer-events:none;height:0}
`

// Read-only render for a value that may be either rich-text HTML (new rows,
// written by RichTextEditor above) or plain text (rows saved before this
// existed) — sanitized either way. Distinguishing by a cheap "looks like a
// tag" sniff means old plain-text descriptions/comments keep displaying
// correctly (as plain text, newlines preserved) without a data migration.
export function RichTextView({ html, style }) {
  if (!html) return null
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(html)
  if (!looksLikeHtml) return <div style={{ whiteSpace: 'pre-wrap', ...style }}>{html}</div>
  return <>
    <style>{RTE_CSS}</style>
    <div className="rte-content rte-view" style={style} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}/>
  </>
}

// Lightweight (non-collaborative) Tiptap editor for a single form field —
// Task descriptions and Daily Update comments, both of which need inline
// screenshot support (paste, drag-drop, or the toolbar button) but none of
// PageEditor.jsx's Yjs/multiplayer machinery, which is specific to Wiki
// pages. `value` seeds content once at mount only (uncontrolled after
// that, like PageEditor) — callers that need a hard reset (e.g. clearing
// the box after posting a comment) should change `resetKey` to remount.
export default function RichTextEditor({ value, onChange, onUploadImage, placeholder = 'Write something…', minHeight = 90 }) {
  const fileRef = useRef()
  const docFileRef = useRef()

  function insertImageFile(view, file, coords) {
    if (!onUploadImage || !file) return
    onUploadImage(file).then(url => {
      if (!url) return
      const pos = coords ? view.posAtCoords(coords)?.pos : view.state.selection.from
      const node = view.state.schema.nodes.image.create({ src: url })
      view.dispatch(view.state.tr.insert(pos ?? view.state.selection.from, node))
    }).catch(err => alert(err.message))
  }

  // Any non-image file (PDF, doc, zip, ...) — uploads to the same bucket
  // as screenshots (onUploadImage doesn't actually care about file type,
  // despite the name) and inserts a clickable file-name link instead of
  // an inline image.
  function insertFileLink(view, file, coords) {
    if (!onUploadImage || !file) return
    onUploadImage(file).then(url => {
      if (!url) return
      const pos = coords ? view.posAtCoords(coords)?.pos : view.state.selection.from
      const insertPos = pos ?? view.state.selection.from
      const linkMark = view.state.schema.marks.link.create({ href: url })
      const textNode = view.state.schema.text(`📎 ${file.name}`, [linkMark])
      const tr = view.state.tr.insert(insertPos, textNode).insertText(' ', insertPos + textNode.nodeSize)
      view.dispatch(tr)
    }).catch(err => alert(err.message))
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      // target/rel apply to every link in this editor — both manually
      // typed URLs and attached files below — so anything clicked opens
      // in a new tab instead of navigating away from the task.
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      TiptapImage,
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange && onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: 'rte-content' },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const file = [...(event.dataTransfer?.files || [])][0]
        if (!file) return false
        event.preventDefault()
        const coords = { left: event.clientX, top: event.clientY }
        if (file.type.startsWith('image/')) insertImageFile(view, file, coords)
        else insertFileLink(view, file, coords)
        return true
      },
      handlePaste: (view, event) => {
        const file = [...(event.clipboardData?.items || [])].find(i => i.kind === 'file')?.getAsFile()
        if (!file) return false
        event.preventDefault()
        if (file.type.startsWith('image/')) insertImageFile(view, file)
        else insertFileLink(view, file)
        return true
      },
    },
  })

  if (!editor) return null

  const Btn = ({ active, onClick, title, children }) => (
    <button type="button" title={title} onMouseDown={e => { e.preventDefault(); onClick() }}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: 'none', borderRadius: 5,
        background: active ? 'var(--c1)' : 'transparent', color: active ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}>
      {children}
    </button>
  )

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <style>{RTE_CSS}{`.rte-content{min-height:${minHeight}px}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap:2, padding:'5px 6px', borderBottom:'1px solid var(--border)', background:'var(--surface-2)' }}>
        <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={13}/></Btn>
        <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={13}/></Btn>
        <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={13}/></Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={13}/></Btn>
        <Btn title="Link" active={editor.isActive('link')} onClick={() => {
          const url = window.prompt('Link URL', editor.getAttributes('link').href || 'https://')
          if (url === null) return
          if (!url) editor.chain().focus().unsetLink().run()
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }}><LinkIcon size={13}/></Btn>
        {onUploadImage && <>
          <Btn title="Attach screenshot / image" onClick={() => fileRef.current?.click()}><ImageIcon size={13}/></Btn>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) insertImageFile(editor.view, f) }}/>
          <Btn title="Attach file" onClick={() => docFileRef.current?.click()}><Paperclip size={13}/></Btn>
          <input ref={docFileRef} type="file" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) insertFileLink(editor.view, f) }}/>
        </>}
      </div>
      <EditorContent editor={editor}/>
    </div>
  )
}
