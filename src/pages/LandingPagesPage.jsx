import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { listTemplates, listLandingPages, createLandingPage, deleteLandingPage } from '../lib/landingPageBuilder'
import { DOMAINS } from '../lib/salesAdmin'
import { Modal, StatusBadge, Loader, Empty, Confirm } from '../components/ui'
import LandingPageBuilder from '../components/LandingPageBuilder'
import { Plus, LayoutTemplate, Trash2, ChevronDown, CalendarClock } from 'lucide-react'

const MARKETING_WRITE_ROLES = ['admin', 'ceo', 'cmo', 'campaign_manager']

export default function LandingPagesPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const canEdit = MARKETING_WRITE_ROLES.includes(profile?.role)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('id') || ''
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [wizard, setWizard] = useState(null) // { step: 'domain'|'template'|'details', ... }
  const [newMenuOpen, setNewMenuOpen] = useState(false)

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setPages(await listLandingPages()); setLoading(false) }

  function select(id) { setSearchParams(id ? { id } : {}) }
  async function handleDelete(id) { await deleteLandingPage(id); setDeleteConfirm(null); await load() }

  if (loading) return <Loader />
  if (selectedId) return <LandingPageBuilder pageId={selectedId} canEdit={canEdit} onBack={() => { select(''); load() }} />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <LayoutTemplate size={19} />
            </span>
            Landing Pages
          </div>
          <div className="page-subtitle">Full end-to-end pages, built from a template for your domain — drag, resize and edit every block</div>
        </div>
        {canEdit && (
          <div className="page-actions" style={{ position: 'relative' }}>
            <button className="btn btn-primary" onClick={() => setNewMenuOpen(o => !o)}>
              <Plus size={15} /> New Page <ChevronDown size={13} />
            </button>
            {newMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setNewMenuOpen(false)} />
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 9999, width: 250, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,.18)', overflow: 'hidden' }}>
                  <button onClick={() => { setNewMenuOpen(false); setWizard({ step: 'domain' }) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <LayoutTemplate size={16} color="#6366f1" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Landing Page</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Full block-based page from a template</div>
                    </div>
                  </button>
                  <button onClick={() => { setNewMenuOpen(false); navigate('/sales/meeting-pages') }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <CalendarClock size={16} color="#15803d" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Meeting Booking Page</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Lead form + embedded scheduler</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {pages.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="🧱" title="No landing pages yet" desc="Create one from a template to get started" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {pages.map(p => (
            <div key={p.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <button onClick={() => select(p.id)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>{p.name}</button>
                <StatusBadge status={p.status === 'Published' ? 'active' : 'draft'} />
              </div>
              <div style={{ fontSize: 11.5, color: '#64748b' }}>{p.domain} · {p.template?.name || 'Blank'}</div>
              {canEdit && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', color: '#ef4444' }} onClick={() => setDeleteConfirm(p.id)}><Trash2 size={12} /> Delete</button>}
            </div>
          ))}
        </div>
      )}

      {wizard && <NewLandingPageWizard wizard={wizard} setWizard={setWizard} profile={profile} onCreated={async (id) => { setWizard(null); await load(); select(id) }} />}
      <Confirm open={!!deleteConfirm} message="Delete this landing page? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}

function NewLandingPageWizard({ wizard, setWizard, profile, onCreated }) {
  const [domain, setDomain] = useState(wizard.domain || 'B2B')
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [name, setName] = useState('')
  const [products, setProducts] = useState([])
  const [linkedProductIds, setLinkedProductIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (wizard.step === 'template') listTemplates(domain).then(setTemplates) }, [wizard.step, domain])
  useEffect(() => { if (wizard.step === 'details') supabase.from('products').select('part_number,name').order('name').then(x => setProducts(x.data || [])) }, [wizard.step])

  async function create() {
    if (!name.trim()) { setErr('Page name is required'); return }
    setSaving(true); setErr('')
    try {
      const page = await createLandingPage({ name, domain, template_id: templateId, linked_product_ids: linkedProductIds }, profile.id)
      onCreated(page.id)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={() => setWizard(null)} title="New Landing Page" size="lg"
      footer={wizard.step === 'domain' ? (
        <><button className="btn btn-ghost" onClick={() => setWizard(null)}>Cancel</button><button className="btn btn-primary" onClick={() => setWizard({ ...wizard, step: 'template' })}>Next</button></>
      ) : wizard.step === 'template' ? (
        <><button className="btn btn-ghost" onClick={() => setWizard({ ...wizard, step: 'domain' })}>Back</button><button className="btn btn-primary" onClick={() => setWizard({ ...wizard, step: 'details' })} disabled={!templateId}>Next</button></>
      ) : (
        <><button className="btn btn-ghost" onClick={() => setWizard({ ...wizard, step: 'template' })}>Back</button><button className="btn btn-primary" onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create Page'}</button></>
      )}>
      {wizard.step === 'domain' && (
        <div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>Which domain is this page for?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
            {DOMAINS.map(d => (
              <button key={d} onClick={() => setDomain(d)} className="card" style={{ padding: 16, textAlign: 'center', cursor: 'pointer', border: domain === d ? '2px solid #6366f1' : '1px solid var(--border)', fontWeight: 700 }}>{d}</button>
            ))}
          </div>
        </div>
      )}
      {wizard.step === 'template' && (
        <div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>Pick a starting template for {domain}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            {templates.map(t => (
              <button key={t.id} onClick={() => setTemplateId(t.id)} className="card" style={{ padding: 16, textAlign: 'left', cursor: 'pointer', border: templateId === t.id ? '2px solid #6366f1' : '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>{t.name}</div>
                <div style={{ fontSize: 11.5, color: '#64748b' }}>{t.description}</div>
              </button>
            ))}
            {templates.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>No templates for this domain.</div>}
          </div>
        </div>
      )}
      {wizard.step === 'details' && (
        <div>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-group"><label className="form-label">Page Name *</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q3 Enterprise Push" required /></div>
          <div className="form-group">
            <label className="form-label">Products (optional — populates the page's Product Card/Grid blocks)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
              {products.map(p => {
                const checked = linkedProductIds.includes(p.part_number)
                return (
                  <label key={p.part_number} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, padding: '3px 8px', borderRadius: 999, background: checked ? '#eef2ff' : '#f8fafc', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={e => setLinkedProductIds(prev => e.target.checked ? [...prev, p.part_number] : prev.filter(x => x !== p.part_number))} />
                    {p.name}
                  </label>
                )
              })}
              {products.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>No products in catalog yet.</span>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
