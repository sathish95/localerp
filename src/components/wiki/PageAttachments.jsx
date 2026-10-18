import { useEffect, useState } from 'react'
import { listAttachments, uploadAttachment, deleteAttachment, attachmentUrl } from '../../lib/wikiAttachments'
import { Paperclip, Trash2, Upload } from 'lucide-react'

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Non-image files live here as a plain list; images inserted inline in
// the editor body (see PageEditor's paste/drop/toolbar handlers) also get
// a wiki_page_attachments row, but are meant to be viewed in the page
// body, not repeated in this list.
export default function PageAttachments({ pageId, profile }) {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  useEffect(() => { load() }, [pageId])
  async function load() {
    const all = await listAttachments(pageId)
    setFiles(all.filter(f => !f.mime_type?.startsWith('image/')))
  }

  async function handleUpload(file) {
    if (!file) return
    setUploading(true)
    try {
      await uploadAttachment(pageId, file, profile.id, profile.organization_id)
      await load()
    } catch (err) { alert(err.message) } finally { setUploading(false) }
  }

  async function handleDelete(f) {
    await deleteAttachment(f.id, f.storage_path)
    await load()
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Paperclip size={12} /> Files {files.length > 0 && `(${files.length})`}
        </div>
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
          <Upload size={12} /> {uploading ? 'Uploading…' : 'Attach file'}
          <input type="file" style={{ display: 'none' }} disabled={uploading} onChange={e => { handleUpload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 8, background: 'var(--surface-2)', fontSize: 12.5 }}>
              <a href={attachmentUrl(f.storage_path)} target="_blank" rel="noreferrer" style={{ color: 'var(--c1)', fontWeight: 600, textDecoration: 'none' }}>
                {f.file_name}
              </a>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}>{formatSize(f.size_bytes)}</span>
                <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => handleDelete(f)}><Trash2 size={11} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
