import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  slugify, listMeetingPages, getMeetingPageLeadCounts, createMeetingPage, updateMeetingPage, deleteMeetingPage,
} from '../lib/meetingBookingPages'
import { getTurnstileStatus } from '../lib/salesLandingLinks'
import { listRegions, DOMAINS } from '../lib/salesAdmin'
import { Modal, Loader, Empty } from '../components/ui'
import { Plus, Eye, EyeOff, Trash2, CalendarClock } from 'lucide-react'

// Own admin surface from Landing Links (same write-role/RLS discipline —
// STEP75/78) even though both share the sales_landing_links table under
// the hood (STEP81's page_type='meeting'), per the "two distinct pages"
// request — this one's public URL is /book/:slug, not /l/:slug.
const CAN_MANAGE = ['admin', 'ceo', 'sales_head', 'sales_ops', 'cmo', 'campaign_manager']
const initForm = () => ({ campaign_name: '', domain: 'B2B', region_id: '', source: 'Meeting Request', display_headline: '', display_subheadline: '', scheduler_embed_url: '' })

export default function MeetingBookingPagesPage() {
  const { profile } = useAuth()
  const canManage = CAN_MANAGE.includes(profile?.role)

  const [pages, setPages] = useState([])
  const [counts, setCounts] = useState({})
  const [regions, setRegions] = useState([])
  const [turnstileOk, setTurnstileOk] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(initForm())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [copiedId, setCopiedId] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [p, c, r, t] = await Promise.all([listMeetingPages(), getMeetingPageLeadCounts(), listRegions(), getTurnstileStatus()])
    setPages(p); setCounts(c); setRegions(r); setTurnstileOk(t)
    setLoading(false)
  }

  async function save() {
    if (!form.campaign_name.trim()) { setErr('Page name is required'); return }
    if (!form.scheduler_embed_url.trim()) { setErr('Paste your scheduler link (Calendly, Cal.com, etc.)'); return }
    setSaving(true); setErr('')
    try { await createMeetingPage(form, profile.id); setShowModal(false); setForm(initForm()); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  function urlFor(p) { return `${window.location.origin}/book/${p.slug}` }
  async function copyLink(p) {
    try { await navigator.clipboard.writeText(urlFor(p)); setCopiedId(p.id); setTimeout(() => setCopiedId(''), 1500) } catch {}
  }
  async function toggleActive(p) { await updateMeetingPage(p.id, { is_active: !p.is_active }); await load() }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#15803d,#166534)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <CalendarClock size={19} />
            </span>
            Meeting Booking Pages
          </div>
          <div className="page-subtitle">Pairs the same lead-capture form with an embedded scheduler (Calendly, Cal.com, etc.) — public URL is /book/:slug</div>
        </div>
        {canManage && <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> New Booking Page</button></div>}
      </div>

      {turnstileOk === false && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          Turnstile isn't configured yet — booking pages will reject submissions until it's set. Configure it from Sales → Landing Links (shared across both page types).
        </div>
      )}

      {pages.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="📅" title="No booking pages yet" desc="Create one to let prospects book a call directly" /></div>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th>Page</th><th>Domain</th><th>Region</th><th>Leads</th><th>Link</th><th>Active</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {pages.map(p => (
              <tr key={p.id}>
                <td className="td-bold">{p.campaign_name}</td>
                <td>{p.domain}</td>
                <td>{p.region?.region_name || 'All'}</td>
                <td>{counts[p.id] || 0}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyLink(p)}>{copiedId === p.id ? 'Copied!' : `/book/${p.slug}`}</button>
                </td>
                <td>{canManage ? <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(p)}>{p.is_active ? <Eye size={13} /> : <EyeOff size={13} />}</button> : (p.is_active ? <Eye size={13} /> : <EyeOff size={13} />)}</td>
                {canManage && <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteMeetingPage(p.id); load() }}><Trash2 size={12} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Meeting Booking Page" size="lg"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Page Name *</label>
          <input className="form-input" value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} placeholder="e.g. Book a Demo — Enterprise" /></div>
        <div style={{ fontSize: 11, color: '#94a3b8', margin: '-8px 0 12px' }}>URL will be: {window.location.origin}/book/{slugify(form.campaign_name) || '…'}</div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Domain</label>
            <select className="form-select" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}>
              {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Region</label>
            <select className="form-select" value={form.region_id} onChange={e => setForm(f => ({ ...f, region_id: e.target.value }))}>
              <option value="">All Regions</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
            </select></div>
        </div>
        <div className="form-group"><label className="form-label">Lead Source Tag</label><input className="form-input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Headline</label><input className="form-input" value={form.display_headline} onChange={e => setForm(f => ({ ...f, display_headline: e.target.value }))} placeholder="Shown above the form" /></div>
        <div className="form-group"><label className="form-label">Subheadline</label><textarea className="form-textarea" value={form.display_subheadline} onChange={e => setForm(f => ({ ...f, display_subheadline: e.target.value }))} /></div>
        <div className="form-group">
          <label className="form-label">Scheduler Link *</label>
          <input className="form-input" value={form.scheduler_embed_url} onChange={e => setForm(f => ({ ...f, scheduler_embed_url: e.target.value }))} placeholder="https://calendly.com/your-team/demo" />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Paste your Calendly, Cal.com, or similar booking link — it's embedded directly, nothing else to configure.</div>
        </div>
      </Modal>
    </div>
  )
}
