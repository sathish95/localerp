import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  slugify, listLandingLinks, getLandingLinkLeadCounts, createLandingLink, updateLandingLink, deleteLandingLink,
  getTurnstileStatus, setTurnstileSecret,
} from '../lib/salesLandingLinks'
import { listRegions, DOMAINS } from '../lib/salesAdmin'
import { listLandingPages } from '../lib/landingPageBuilder'
import { Modal, Loader, Empty } from '../components/ui'
import { Plus, Eye, EyeOff, Trash2, Link2, LayoutTemplate } from 'lucide-react'

// Own page (not buried in Settings, which is admin/ceo-only) — Sales
// Head, Sales Ops, CMO and Campaign Manager all need to create/manage
// these links day-to-day (RLS write access: STEP75 + STEP78).
const CAN_MANAGE_LINKS = ['admin', 'ceo', 'sales_head', 'sales_ops', 'cmo', 'campaign_manager']
const CAN_SET_SECRET = ['admin', 'ceo']  // set_turnstile_secret() RPC is admin/ceo-only, per STEP75

// Every new link now requires a published Landing Page (STEP79's builder)
// rather than the old plain-fixed-form-only path — links created before
// the builder existed keep rendering the plain form unchanged, this just
// isn't offered as a choice for new ones anymore.
const initLinkForm = () => ({ campaign_name: '', domain: 'B2B', region_id: '', source: 'Campaign', landing_page_id: '' })

export default function LandingLinksPage() {
  const { profile } = useAuth()
  const canManage = CAN_MANAGE_LINKS.includes(profile?.role)
  const canSetSecret = CAN_SET_SECRET.includes(profile?.role)

  const [links, setLinks] = useState([])
  const [counts, setCounts] = useState({})
  const [regions, setRegions] = useState([])
  const [landingPages, setLandingPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(initLinkForm())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [copiedId, setCopiedId] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [l, c, r, lp] = await Promise.all([listLandingLinks('form'), getLandingLinkLeadCounts(), listRegions(), listLandingPages()])
    setLinks(l); setCounts(c); setRegions(r); setLandingPages(lp)
    setLoading(false)
  }

  const publishedPagesForDomain = landingPages.filter(p => p.status === 'Published' && p.domain === form.domain)

  async function save() {
    if (!form.campaign_name.trim()) { setErr('Campaign name is required'); return }
    if (!form.landing_page_id) { setErr('Select a Landing Page — create one first if you don\'t have one yet for this domain'); return }
    setSaving(true); setErr('')
    try { await createLandingLink(form, profile.id); setShowModal(false); setForm(initLinkForm()); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  function urlFor(link) { return `${window.location.origin}/l/${link.slug}` }
  async function copyLink(link) {
    try { await navigator.clipboard.writeText(urlFor(link)); setCopiedId(link.id); setTimeout(() => setCopiedId(''), 1500) } catch {}
  }
  async function toggleActive(link) { await updateLandingLink(link.id, { is_active: !link.is_active }); await load() }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#0ea5e9,#0369a1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Link2 size={19} />
            </span>
            Landing Links
          </div>
          <div className="page-subtitle">Shareable public URLs for external marketing — every submission auto-tags with domain/region/source, and rolls up into a Campaign once channel-linked</div>
        </div>
        {canManage && <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> New Link</button></div>}
      </div>

      <TurnstileSecretPanel profile={profile} canSetSecret={canSetSecret} />

      <div style={{ marginTop: 20 }}>
        {links.length === 0 ? (
          <div className="card" style={{ padding: '20px 24px' }}><Empty icon="🔗" title="No landing links yet" desc="Create one to get a shareable URL for external marketing" /></div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Campaign</th><th>Domain</th><th>Region</th><th>Leads</th><th>Link</th><th>Active</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {links.map(l => (
                <tr key={l.id}>
                  <td className="td-bold">{l.campaign_name}</td>
                  <td>{l.domain}</td>
                  <td>{l.region?.region_name || 'All'}</td>
                  <td>{counts[l.id] || 0}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => copyLink(l)}>{copiedId === l.id ? 'Copied!' : `/l/${l.slug}`}</button>
                  </td>
                  <td>{canManage ? <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(l)}>{l.is_active ? <Eye size={13} /> : <EyeOff size={13} />}</button> : (l.is_active ? <Eye size={13} /> : <EyeOff size={13} />)}</td>
                  {canManage && <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteLandingLink(l.id); load() }}><Trash2 size={12} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Campaign Link" size="lg"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Campaign Name *</label>
          <input className="form-input" value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} placeholder="e.g. LinkedIn B2B Push — North" /></div>
        <div style={{ fontSize: 11, color: '#94a3b8', margin: '-8px 0 12px' }}>URL will be: {window.location.origin}/l/{slugify(form.campaign_name) || '…'}</div>
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
        <div className="form-group">
          <label className="form-label">Landing Page *</label>
          <select className="form-select" value={form.landing_page_id} onChange={e => setForm(f => ({ ...f, landing_page_id: e.target.value }))}>
            <option value="">Select a published page for {form.domain}…</option>
            {publishedPagesForDomain.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {publishedPagesForDomain.length === 0 && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <LayoutTemplate size={12} /> No published pages for {form.domain} yet — build and publish one from the Landing Pages screen first.
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function TurnstileSecretPanel({ profile, canSetSecret }) {
  const [status, setStatus] = useState(null)
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  useEffect(() => { getTurnstileStatus().then(setStatus) }, [])
  async function save() {
    if (!secret.trim()) { setErr('Enter the Turnstile secret key'); return }
    setSaving(true); setErr(''); setOk(false)
    try { await setTurnstileSecret(secret.trim(), profile.id); setSecret(''); setOk(true); setStatus(true) }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Public Form Security (Cloudflare Turnstile)</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        Landing links are reachable by anyone on the internet. Submissions are verified server-side against Cloudflare Turnstile before a Lead is created.
        {canSetSecret && <> Create a widget at <span style={{ fontFamily: 'monospace' }}>dash.cloudflare.com → Turnstile</span> — put the <strong>Site Key</strong> in this app's <span style={{ fontFamily: 'monospace' }}>.env</span> as <span style={{ fontFamily: 'monospace' }}>VITE_TURNSTILE_SITE_KEY</span>, and paste the <strong>Secret Key</strong> below (write-only — it can't be read back once saved, even by an admin).</>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: canSetSecret ? 10 : 0, fontSize: 12 }}>
        Status: {status === null ? '…' : status ? <span style={{ color: '#15803d', fontWeight: 700 }}>Configured</span> : <span style={{ color: '#dc2626', fontWeight: 700 }}>Not set — public forms will reject submissions</span>}
      </div>
      {canSetSecret && (
        <>
          {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
          {ok && <div className="alert alert-success" style={{ marginBottom: 10 }}>Secret key saved.</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" type="password" style={{ maxWidth: 360 }} placeholder="Turnstile Secret Key" value={secret} onChange={e => setSecret(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </div>
  )
}
