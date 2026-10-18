import { useState, useEffect } from 'react'
import { listReportLinks, createReportLink, revokeReportLink, reportUrl, REPORT_SECTIONS, DEFAULT_SECTIONS } from '../../lib/goLiveHours'
import { istToday, addDays, istDateTime } from '../../lib/goLiveRules'
import { Modal, Loader, Empty, Badge } from '../ui'
import { Field, ErrorLine, errText } from './shared'
import { Link2, Copy, ExternalLink, Ban, Plus, Check } from 'lucide-react'
import ReportEmailPanel from './ReportEmailPanel'

export default function ShareTab({ ctx }) {
  const { engagement, perms, profile } = ctx
  const [links, setLinks] = useState(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const load = () => listReportLinks(engagement.id).then(setLinks).catch(e => setError(errText(e)))
  useEffect(() => { load() }, [engagement.id])

  async function copy(l) {
    try { await navigator.clipboard.writeText(reportUrl(l.token)); setCopied(l.id); setTimeout(() => setCopied(''), 2000) } catch { window.prompt('Copy this link', reportUrl(l.token)) }
  }
  const state = l => l.revoked_at ? ['Revoked', 'gray'] : l.expires_at && new Date(l.expires_at) < new Date() ? ['Expired', 'gray'] : ['Active', 'success']

  return (
    <div>
      <ErrorLine error={error} />
      <ReportEmailPanel ctx={ctx} />
      <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260, fontSize: 13, color: 'var(--ink-soft)' }}>
          Share a live hypercare report by URL — no login needed. <strong>Customer</strong> view shows health, uptime, manual vs IoT hours and improvement actions without internal names. <strong>Management</strong> view adds owners, incidents, SLAs and exit readiness.
        </div>
        {perms.canManage && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New share link</button>}
      </div>

      {!links ? <Loader /> : !links.length ? <Empty icon={<Link2 size={26} />} title="No share links yet" desc="Create one for the customer or for management." /> : (
        <div className="table-wrap">
          <table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
            <thead><tr><th>Report</th><th>Audience</th><th>Period</th><th>Sections</th><th>Views</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody>{links.map(l => {
              const [label, badge] = state(l)
              const live = label === 'Active'
              return (
                <tr key={l.id} style={{ opacity: live ? 1 : 0.6 }}>
                  <td style={{ fontWeight: 600 }}>{l.title || `${engagement.name} — hypercare report`}<div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 400 }}>Created {istDateTime(l.created_at)}</div></td>
                  <td>{l.audience === 'MANAGEMENT' ? 'Management' : 'Customer'}</td>
                  <td>{l.period_days ? `Last ${l.period_days} days` : `${l.period_from} → ${l.period_to}`}</td>
                  <td style={{ fontSize: 11.5 }}>{(l.sections || []).map(k => REPORT_SECTIONS.find(s => s.key === k)?.label || k).join(', ')}</td>
                  <td>{l.view_count}{l.last_viewed_at && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{istDateTime(l.last_viewed_at)}</div>}</td>
                  <td>{l.expires_at ? istDateTime(l.expires_at) : 'Never'}</td>
                  <td><Badge type={badge}>{label}</Badge></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {live && <>
                      <button className="btn btn-ghost btn-sm" title="Copy link" onClick={() => copy(l)}>{copied === l.id ? <Check size={12} /> : <Copy size={12} />}</button>
                      <a className="btn btn-ghost btn-sm" title="Open" href={reportUrl(l.token)} target="_blank" rel="noreferrer"><ExternalLink size={12} /></a>
                      {perms.canManage && <button className="btn btn-ghost btn-sm" title="Revoke" style={{ color: 'var(--danger)' }} onClick={async () => { if (window.confirm('Revoke this link? Anyone with it loses access.')) { try { await revokeReportLink(l.id); load() } catch (e) { setError(errText(e)) } } }}><Ban size={12} /></button>}
                    </>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
      {creating && <CreateLinkModal engagement={engagement} profile={profile} onClose={() => setCreating(false)} onDone={async l => { setCreating(false); await load(); copy(l) }} />}
    </div>
  )
}

function CreateLinkModal({ engagement, profile, onClose, onDone }) {
  const [form, setForm] = useState({
    audience: 'CUSTOMER', title: `${engagement.name} — hypercare report`, sections: DEFAULT_SECTIONS.CUSTOMER,
    mode: 'rolling', periodDays: 30, periodFrom: engagement.hypercare_start || addDays(istToday(), -29), periodTo: istToday(), expiresOn: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggle = k => set('sections', form.sections.includes(k) ? form.sections.filter(x => x !== k) : [...form.sections, k])
  async function save() {
    setBusy(true); setError('')
    try {
      const l = await createReportLink(engagement, {
        audience: form.audience, title: form.title, sections: REPORT_SECTIONS.map(s => s.key).filter(k => form.sections.includes(k)),
        periodDays: form.mode === 'rolling' ? form.periodDays : null,
        periodFrom: form.mode === 'fixed' ? form.periodFrom : null, periodTo: form.mode === 'fixed' ? form.periodTo : null, expiresOn: form.expiresOn,
      }, profile)
      await onDone(l)
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  return (
    <Modal open title="New share link" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !form.sections.length} onClick={save}>Create & copy link</button></>}>
      <ErrorLine error={error} />
      <Field label="Audience">
        <div style={{ display: 'flex', gap: 8 }}>
          {[['CUSTOMER', 'Customer'], ['MANAGEMENT', 'Management']].map(([k, l]) => (
            <button key={k} type="button" className={`chip-toggle ${form.audience === k ? 'on' : ''}`} onClick={() => setForm(f => ({ ...f, audience: k, sections: DEFAULT_SECTIONS[k] }))}>{l}</button>
          ))}
        </div>
      </Field>
      <Field label="Report title"><input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} /></Field>
      <Field label="Sections">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {REPORT_SECTIONS.map(s => <button key={s.key} type="button" className={`chip-toggle ${form.sections.includes(s.key) ? 'on' : ''}`} onClick={() => toggle(s.key)}>{s.label}</button>)}
        </div>
        {form.audience === 'CUSTOMER' && form.sections.includes('incidents') && <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Customers only see incidents marked “Customer visible”.</div>}
      </Field>
      <Field label="Period">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}><input type="radio" checked={form.mode === 'rolling'} onChange={() => set('mode', 'rolling')} /> Rolling last</label>
          <input type="number" min={1} max={366} className="form-input" style={{ width: 80 }} disabled={form.mode !== 'rolling'} value={form.periodDays} onChange={e => set('periodDays', e.target.value)} /> <span style={{ fontSize: 13 }}>days</span>
          <label style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center', marginLeft: 10 }}><input type="radio" checked={form.mode === 'fixed'} onChange={() => set('mode', 'fixed')} /> Fixed</label>
          <input type="date" className="form-input" style={{ width: 150 }} disabled={form.mode !== 'fixed'} value={form.periodFrom} onChange={e => set('periodFrom', e.target.value)} />
          <input type="date" className="form-input" style={{ width: 150 }} disabled={form.mode !== 'fixed'} value={form.periodTo} onChange={e => set('periodTo', e.target.value)} />
        </div>
      </Field>
      <Field label="Expires on" hint="Leave blank for no expiry — you can revoke any time"><input type="date" className="form-input" style={{ width: 170 }} min={istToday()} value={form.expiresOn} onChange={e => set('expiresOn', e.target.value)} /></Field>
    </Modal>
  )
}
