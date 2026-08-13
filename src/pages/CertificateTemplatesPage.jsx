import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import {
  listTemplates, getTemplate, createTemplate, updateTemplate, duplicateTemplate,
  publishTemplate, archiveTemplate, deleteTemplate,
} from '../lib/certificateTemplates'
import { listCategories } from '../lib/awards'
import { renderCertificatePdf } from '../lib/certificatePdf'
import { SAMPLE_CERTIFICATE_DATA } from '../lib/certificateVariables'
import CertificateBuilder from '../components/CertificateBuilder'
import { Modal, Loader, Empty, StatusBadge, Confirm } from '../components/ui'
import { FileBadge2, Plus, Pencil, Copy, Eye, Rocket, Archive, Trash2, ArrowLeft, Save } from 'lucide-react'

export default function CertificateTemplatesPage() {
  const { profile } = useAuth()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setTemplates(await listTemplates()); setLoading(false) }

  async function handlePreview(id) {
    const template = await getTemplate(id)
    const doc = await renderCertificatePdf(template, SAMPLE_CERTIFICATE_DATA, null)
    doc.output('dataurlnewwindow')
  }
  async function handleDuplicate(id) { await duplicateTemplate(id, profile.id); await load() }
  async function handlePublish(id) { await publishTemplate(id, profile.id); await load() }
  async function handleArchive(id) { await archiveTemplate(id); await load() }
  async function handleDelete() {
    try { await deleteTemplate(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (e) { alert(e.message); setConfirmDelete(null) }
  }

  if (editingId) {
    return <TemplateEditor templateId={editingId} onBack={async () => { setEditingId(null); await load() }} />
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <FileBadge2 size={19} />
            </span>
            Certificate Templates
          </div>
          <div className="page-subtitle">Visually design the certificate awarded employees receive</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Create Template</button>
        </div>
      </div>

      {templates.length === 0 ? (
        <Empty icon={<FileBadge2 size={40} />} title="No certificate templates yet" desc="Create one so granted awards can generate a certificate" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Template</th><th>Category</th><th>Version</th><th>Status</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id}>
                  <td className="td-bold">{t.name}</td>
                  <td>{t.category?.name ? <span className="badge">{t.category.name}</span> : <span style={{ color: 'var(--ink-muted)' }}>Any category</span>}</td>
                  <td>{t.version || 0}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td style={{ fontSize: 12 }}>{dateFmt(t.updated_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-outline btn-sm" onClick={() => setEditingId(t.id)}><Pencil size={13} /> Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => handlePreview(t.id)}><Eye size={13} /></button>
                      <button className="btn btn-outline btn-sm" onClick={() => handleDuplicate(t.id)}><Copy size={13} /></button>
                      {t.status !== 'archived' && (
                        <button className="btn btn-outline btn-sm" onClick={() => handleArchive(t.id)}><Archive size={13} /></button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(t)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateTemplateModal profileId={profile.id} onClose={() => setShowCreate(false)}
          onCreated={async id => { setShowCreate(false); await load(); setEditingId(id) }} />
      )}
      <Confirm open={!!confirmDelete} danger message={`Delete template "${confirmDelete?.name}"?`} onConfirm={handleDelete} onCancel={() => setConfirmDelete(null)} />
    </div>
  )
}

function CreateTemplateModal({ profileId, onClose, onCreated }) {
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({ name: '', award_category_id: '', page_size: 'A4', orientation: 'landscape' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { listCategories({ includeInactive: false }).then(setCategories) }, [])

  async function handleCreate() {
    if (!form.name.trim()) { setErr('Template name is required'); return }
    setSaving(true); setErr('')
    try {
      const template = await createTemplate({ ...form, award_category_id: form.award_category_id || null }, profileId)
      onCreated(template.id)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Create Certificate Template"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create & Open Builder'}</button>
      </>}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form-group"><label className="form-label">Template Name *</label>
        <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Best Performer Certificate" /></div>
      <div className="form-group"><label className="form-label">Award Category</label>
        <select className="form-select" value={form.award_category_id} onChange={e => setForm(f => ({ ...f, award_category_id: e.target.value }))}>
          <option value="">Any category (default/fallback)</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Page Size</label>
          <select className="form-select" value={form.page_size} onChange={e => setForm(f => ({ ...f, page_size: e.target.value }))}>
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </select>
        </div>
        <div className="form-group"><label className="form-label">Orientation</label>
          <select className="form-select" value={form.orientation} onChange={e => setForm(f => ({ ...f, orientation: e.target.value }))}>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </div>
      </div>
    </Modal>
  )
}

function TemplateEditor({ templateId, onBack }) {
  const { profile } = useAuth()
  const [template, setTemplate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => { getTemplate(templateId).then(setTemplate) }, [templateId])

  async function handleSave() {
    setSaving(true)
    try {
      await updateTemplate(templateId, {
        elements: template.elements, background_color: template.background_color, background_image: template.background_image,
      }, profile.id)
    } finally { setSaving(false) }
  }

  async function handlePublish() {
    await handleSave()
    setPublishing(true)
    try { await publishTemplate(templateId, profile.id); const fresh = await getTemplate(templateId); setTemplate(fresh) }
    finally { setPublishing(false) }
  }

  async function handlePreview() {
    const doc = await renderCertificatePdf(template, SAMPLE_CERTIFICATE_DATA, null)
    doc.output('dataurlnewwindow')
  }

  if (!template) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={onBack}><ArrowLeft size={13} /> Back to Templates</button>
          <div className="page-title">{template.name} <StatusBadge status={template.status} /></div>
          <div className="page-subtitle">Version {template.version || 0} published · editing the live draft</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={handlePreview}><Eye size={15} /> Preview</button>
          <button className="btn btn-outline" onClick={handleSave} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save Draft'}</button>
          <button className="btn btn-primary" onClick={handlePublish} disabled={publishing}><Rocket size={15} /> {publishing ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>

      <CertificateBuilder
        elements={template.elements}
        onElementsChange={els => setTemplate(t => ({ ...t, elements: els }))}
        canvasWidth={template.canvas_width} canvasHeight={template.canvas_height}
        backgroundColor={template.background_color}
        onBackgroundColorChange={c => setTemplate(t => ({ ...t, background_color: c }))}
        backgroundImage={template.background_image}
        onBackgroundImageChange={img => setTemplate(t => ({ ...t, background_image: img }))}
      />
    </div>
  )
}
