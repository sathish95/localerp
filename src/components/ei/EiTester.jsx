import { useState, Fragment } from 'react'
import { Toggle } from '../ui'
import { dryRun, fileToBase64, exceptionLabel } from '../../lib/emailIntelligence'
import { FlaskConical, Paperclip, X } from 'lucide-react'

const pct = v => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`)
const SAMPLE = {
  from_email: 'accounts@vendor-example.com', from_name: 'Vendor Accounts',
  subject: 'Tax invoice INV-2026/0412 against PO-0042',
  body: 'Dear team,\n\nPlease find the invoice attached for the material delivered last week.\n\nRegards,\nAccounts',
}

// Settings → Email Intelligence → Test: sample email + real files through the
// DRAFT configuration (or the live one). Read-only: nothing is stored, no
// invoice, exception, notification or email is created.
export default function EiTester({ canRun, cfg }) {
  const [f, setF] = useState(SAMPLE)
  const [files, setFiles] = useState([])
  const [usePublished, setUsePublished] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const cats = Object.fromEntries(cfg.categories.map(c => [c.code, c]))
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  async function run() {
    setBusy(true); setErr(''); setRes(null)
    try {
      const attachments = await Promise.all(files.map(async x => ({ name: x.name, content_type: x.type || 'application/octet-stream', base64: await fileToBase64(x) })))
      setRes(await dryRun({ email: f, attachments, usePublished }))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const r = res?.report
  return (
    <div className="eic-test">
      <div className="card eic-test-in">
        <div className="eic-card-h">Sample email</div>
        <div className="olk-hint" style={{ marginTop: 0 }}>Runs the real classification, extraction and PO / GRN / duplicate checks against your live records, but <b>writes nothing</b> — no invoice, exception, notification or email. AI calls are made if a provider is configured.</div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">From (email)</label><input className="form-input" value={f.from_email} onChange={e => set('from_email', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">From (name)</label><input className="form-input" value={f.from_name} onChange={e => set('from_name', e.target.value)} /></div>
        </div>
        <div className="form-group"><label className="form-label">Subject</label><input className="form-input" value={f.subject} onChange={e => set('subject', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Body</label><textarea className="form-textarea" rows={5} value={f.body} onChange={e => set('body', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Test documents (PDF, images, spreadsheets — up to 5, 10 MB each)</label>
          <div className="olk-chips">
            {files.map((x, i) => <span key={i} className="chip-toggle on"><Paperclip size={11} /> {x.name} <X size={11} style={{ cursor: 'pointer' }} onClick={() => setFiles(files.filter((_, j) => j !== i))} /></span>)}
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}><Paperclip size={12} /> Add files
              <input type="file" multiple hidden onChange={e => { setFiles([...files, ...Array.from(e.target.files || []).filter(x => x.size <= 10485760)].slice(0, 5)); e.target.value = '' }} /></label>
          </div></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="olk-switch" style={{ margin: 0 }}><Toggle checked={usePublished} onChange={setUsePublished} label="Use live version" /> <span>Test the live version instead of the draft</span></label>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={!canRun || busy || !f.subject.trim()} onClick={run}><FlaskConical size={14} /> {busy ? 'Running…' : 'Run test'}</button>
        </div>
        {!canRun && <div className="olk-hint">Only admin, CEO or finance can run tests.</div>}
      </div>
      <div className="eic-test-out">
      {err && <div className="olk-msg error">{err}</div>}
      {!r && !err && <div className="card eic-test-empty"><FlaskConical size={26} /><div><b>No test run yet</b></div><div className="gl-meta">Results show the predicted intent, the rules that fired, each document's type and extracted fields, vendor / PO / GRN matches and what would go to review.</div></div>}

      {r && (
        <>
          <div className="card ei-result">
            <div className="ei-result-head">
              <div><div className="olk-stat-label">Primary intent</div><div className="ei-big">{r.intents.primary_name || 'Unclassified'}</div>
                <div className="gl-meta">{pct(r.intents.confidence)} · {r.intents.source}{res.draft ? ' · draft config' : ` · live v${res.version}`}</div></div>
              <div><div className="olk-stat-label">Secondary</div>{r.intents.secondary.length ? r.intents.secondary.map(c => <span key={c} className="gl-tag" style={{ marginRight: 4 }}>{cats[c]?.name || c}</span>) : <span className="gl-meta">none</span>}</div>
              <div><div className="olk-stat-label">Outcome</div><div className="ei-big" style={{ fontSize: 15 }}>{r.summary}</div>
                {r.status === 'DELEGATE' && <div className="gl-meta">Goes on to the customer project-issue flow</div>}</div>
            </div>
            {r.intents.review && <div className="olk-msg error" style={{ marginTop: 10 }}>Review: {r.intents.review_reason}</div>}
            {r.intents.injection_suspected && <div className="olk-msg error" style={{ marginTop: 10 }}>The email contains instructions aimed at the automation — nothing would be done automatically.</div>}
            <div className="gl-st-h" style={{ marginTop: 12 }}>Rules that fired</div>
            {r.intents.matched_rules.length ? <ul className="ei-list">{r.intents.matched_rules.map((m, i) => <li key={i}><b>{cats[m.category]?.name || m.category}</b> ← {m.rule}: {m.hits.map(h => `"${h.term}" in ${h.location.toLowerCase().replace('_', ' ')}`).join(', ')}{m.action ? ` → ${m.action}` : ''}</li>)}</ul> : <div className="gl-meta">No keyword rule matched.</div>}
            {r.intents.vetoed.length > 0 && <div className="gl-meta">Excluded by rules: {r.intents.vetoed.map(c => cats[c]?.name || c).join(', ')}</div>}
          </div>

          {r.attachments.map(a => (
            <div key={a.id} className="card ei-result">
              <div className="ei-result-head">
                <div><div className="olk-stat-label">File</div><div className="ei-big" style={{ fontSize: 14 }}>{a.file_name}</div><div className="gl-meta">text: {a.text_method || '—'}</div></div>
                <div><div className="olk-stat-label">Document type</div><div>{a.doc_type_name || a.doc_type_code || '—'}</div><div className="gl-meta">{pct(a.doc_confidence)} · {a.doc_source}</div></div>
                <div><div className="olk-stat-label">Outcome</div><span className={`gl-pill ${a.outcome === 'WOULD_CREATE_INVOICE' ? 'green' : a.outcome === 'EXCEPTION' ? 'amber' : 'gray'}`}>{({ WOULD_CREATE_INVOICE: 'Would create invoice', EXCEPTION: 'Goes to review', RECORDED: 'Recorded', SKIPPED: 'Skipped' })[a.outcome] || a.outcome}</span>
                  {a.outcome_reason && <div className="gl-meta" style={{ marginTop: 4 }}>{a.outcome_reason}</div>}</div>
              </div>
              {a.extraction && Object.keys(a.extraction).length > 0 && <>
                <div className="gl-st-h" style={{ marginTop: 12 }}>Extracted fields</div>
                <dl className="olk-dl">{Object.entries(a.extraction).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{String(v.value)} <span className="gl-meta">({pct(v.confidence)}, {v.source}{v.conflict != null ? `, document says ${v.conflict}` : ''})</span></dd></Fragment>)}</dl>
              </>}
              {a.vendor_status && <dl className="olk-dl" style={{ marginTop: 8 }}>
                <dt>Vendor</dt><dd>{a.vendor_name ? `${a.vendor_name} (${a.vendor_method}, ${pct(a.vendor_confidence)})` : a.vendor_status}</dd>
                <dt>PO</dt><dd>{a.po_number ? `${a.po_number} (${a.po_status})` : a.po_status}</dd>
                <dt>Receipt</dt><dd>{a.receipt_status ? `${a.receipt_status}${a.received_value ? ` · received ${a.received_value}` : ''}` : '—'}</dd>
                {a.variance_percent != null && <><dt>Variance</dt><dd>{a.variance_percent}%</dd></>}
              </dl>}
              {[...(a.validations || []), ...(a.amount_checks || [])].filter(v => !v.ok).length > 0 && <ul className="ei-list ei-bad">{[...(a.validations || []), ...(a.amount_checks || [])].filter(v => !v.ok).map((v, i) => <li key={i}>{v.detail}</li>)}</ul>}
            </div>
          ))}

          {r.exceptions.length > 0 && <div className="card ei-result"><div className="gl-st-h">Would go to review</div>
            <ul className="ei-list">{r.exceptions.map((e, i) => <li key={i}><span className={`gl-pill ${e.priority === 'critical' || e.priority === 'high' ? 'red' : 'amber'}`}>{exceptionLabel(e.kind, cats)}</span> {e.summary} <span className="gl-meta">→ {e.role || 'finance'}</span></li>)}</ul></div>}
          {r.notes.length > 0 && <div className="gl-meta">{r.notes.join(' · ')}</div>}
        </>
      )}
      </div>
    </div>
  )
}
