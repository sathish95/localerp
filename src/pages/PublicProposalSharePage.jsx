import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicProposal, submitProposalChangeRequest } from '../lib/proposalShare'
import { rupee, dateFmt } from '../lib/supabase'
import { useAppName } from '../context/BrandingContext'

const TYPE_LABEL = { resource: 'Resource / Effort', hardware: 'Hardware', software: 'Software / SaaS', misc: 'Miscellaneous' }
// The Rate column's basis differs by line type — a bare number here was
// ambiguous (per person-week? per unit? per license for the whole term?).
// Matches how each amount is actually derived below in lineAmount().
const RATE_UNIT_LABEL = { resource: '/ person-week', hardware: '/ unit', software: '/ license (full term)' }

function lineAmount(line, edited) {
  if (line.type === 'misc') return line.amount
  const qty = Number(edited.qty ?? line.qty) || 0
  const weeks = line.type === 'resource' ? (Number(edited.duration_weeks ?? line.duration_weeks) || 0) : 1
  return Math.round(line.unit_rate * qty * weeks * 100) / 100
}

/**
 * Public, unauthenticated proposal share view — reached via a durable
 * secret link (proposal_share_links), same standalone-page pattern as
 * PublicROIViewPage.jsx. The client can adjust quantities/timeline only;
 * every number on this page is already the marked-up customer amount
 * from get_proposal_public() — no rate, margin or internal cost is ever
 * sent here, so there is nothing to derive either. Submitting posts a
 * pending change request (submit_proposal_change_request) — nothing here
 * writes to the real proposal directly; a person on the vendor side
 * reviews and applies it.
 */
export default function PublicProposalSharePage() {
  const { token } = useParams()
  const appName = useAppName()
  const [data, setData] = useState(undefined) // undefined = loading, null = not found
  const [edits, setEdits] = useState({}) // lineId -> { qty?, duration_weeks? }
  const [timelineEdits, setTimelineEdits] = useState({}) // phaseId -> { start_offset_weeks?, duration_weeks? }
  const [clientName, setClientName] = useState('')
  const [clientNote, setClientNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => { fetchPublicProposal(token).then(setData).catch(() => setData(null)) }, [token])

  const changes = useMemo(() => {
    const out = []
    for (const [id, e] of Object.entries(edits)) {
      const line = data?.lines.find(l => l.id === id)
      if (!line) continue
      const qtyChanged = e.qty != null && Number(e.qty) !== Number(line.qty)
      const weeksChanged = line.type === 'resource' && e.duration_weeks != null && Number(e.duration_weeks) !== Number(line.duration_weeks)
      if (!qtyChanged && !weeksChanged) continue
      out.push({ id, type: line.type, ...(qtyChanged ? { qty: Number(e.qty) } : {}), ...(weeksChanged ? { duration_weeks: Number(e.duration_weeks) } : {}) })
    }
    for (const [id, e] of Object.entries(timelineEdits)) {
      const phase = data?.timeline.find(t => t.id === id)
      if (!phase) continue
      const startChanged = e.start_offset_weeks != null && Number(e.start_offset_weeks) !== Number(phase.start_offset_weeks)
      const durChanged = e.duration_weeks != null && Number(e.duration_weeks) !== Number(phase.duration_weeks)
      if (!startChanged && !durChanged) continue
      out.push({ id, type: 'timeline', ...(startChanged ? { start_offset_weeks: Number(e.start_offset_weeks) } : {}), ...(durChanged ? { duration_weeks: Number(e.duration_weeks) } : {}) })
    }
    return out
  }, [edits, timelineEdits, data])

  if (data === undefined) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}><div className="spinner" /></div>
  }
  if (data === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>This link isn't available. It may have expired or been revoked — please ask for a new one.</div>
      </div>
    )
  }

  const { proposal, lines, timeline } = data
  const grouped = lines.reduce((acc, l) => { (acc[l.category] = acc[l.category] || []).push(l); return acc }, {})
  const total = lines.reduce((s, l) => s + lineAmount(l, edits[l.id] || {}), 0)

  async function submit() {
    setErr('')
    setBusy(true)
    try {
      await submitProposalChangeRequest(token, { clientName, clientNote, changes })
      setSubmitted(true)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif", padding: '32px 16px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 800 }}>{appName}</div>
          <div style={{ color: '#64748b', fontSize: 12.5 }}>Proposal Review</div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,.06)', padding: 28, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
            <div style={{ fontWeight: 800, fontSize: 20 }}>{proposal.proposal_name}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{proposal.proposal_number}</div>
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>Prepared for {proposal.customer_name}</div>
          {proposal.validity_until_date && <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 20 }}>Valid until {dateFmt(proposal.validity_until_date)}</div>}

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#1e40af', marginBottom: 20 }}>
            You can adjust quantities and timeline below (e.g. headcount, hardware/license quantities, phase duration).
            Rates are fixed. Submitted changes are reviewed before they affect the final quotation.
          </div>

          {Object.entries(grouped).map(([category, catLines]) => (
            <div key={category} style={{ marginBottom: 22 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8, color: '#334155' }}>{category}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      {['Item', 'Type', 'Qty', 'Weeks', 'Rate', 'Amount'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {catLines.map(l => {
                      const e = edits[l.id] || {}
                      const editable = l.type !== 'misc'
                      return (
                        <tr key={l.id}>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{l.name}</td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', color: '#94a3b8' }}>{TYPE_LABEL[l.type]}</td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                            {editable && l.type !== 'misc' && l.qty != null ? (
                              <input type="number" min="0" step="any" disabled={submitted}
                                value={e.qty ?? l.qty}
                                onChange={ev => setEdits(prev => ({ ...prev, [l.id]: { ...prev[l.id], qty: ev.target.value } }))}
                                style={{ width: 70, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6 }} />
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                            {l.type === 'resource' ? (
                              <input type="number" min="0" step="any" disabled={submitted}
                                value={e.duration_weeks ?? l.duration_weeks}
                                onChange={ev => setEdits(prev => ({ ...prev, [l.id]: { ...prev[l.id], duration_weeks: ev.target.value } }))}
                                style={{ width: 70, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6 }} />
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>
                            {l.unit_rate != null ? (
                              <>{rupee(l.unit_rate)}<div style={{ fontSize: 9.5, color: '#94a3b8' }}>{RATE_UNIT_LABEL[l.type]}</div></>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', fontWeight: 700 }}>{rupee(lineAmount(l, e))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '2px solid #e2e8f0', paddingTop: 12, marginBottom: 24 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Total: {rupee(total)}</div>
          </div>

          {timeline.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8, color: '#334155' }}>Delivery Timeline</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>{['Phase', 'Starts (week)', 'Duration (weeks)'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {timeline.map(t => {
                      const e = timelineEdits[t.id] || {}
                      return (
                        <tr key={t.id}>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{t.phase_name}</td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                            <input type="number" min="0" step="any" disabled={submitted}
                              value={e.start_offset_weeks ?? t.start_offset_weeks}
                              onChange={ev => setTimelineEdits(prev => ({ ...prev, [t.id]: { ...prev[t.id], start_offset_weeks: ev.target.value } }))}
                              style={{ width: 80, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6 }} />
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                            <input type="number" min="0" step="any" disabled={submitted}
                              value={e.duration_weeks ?? t.duration_weeks}
                              onChange={ev => setTimelineEdits(prev => ({ ...prev, [t.id]: { ...prev[t.id], duration_weeks: ev.target.value } }))}
                              style={{ width: 80, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6 }} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {submitted ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', color: '#15803d', fontSize: 13, fontWeight: 600 }}>
              Thanks — your requested changes have been sent for review. You'll hear back once they've been checked.
            </div>
          ) : (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Submit Requested Changes</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginBottom: 10 }}>
                <input placeholder="Your name" value={clientName} onChange={e => setClientName(e.target.value)}
                  style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'inherit' }} />
                <input placeholder="Note (optional)" value={clientNote} onChange={e => setClientNote(e.target.value)}
                  style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'inherit' }} />
              </div>
              {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{err}</div>}
              <button onClick={submit} disabled={busy || changes.length === 0 || !clientName.trim()}
                className="btn btn-primary btn-sm" style={{ opacity: (changes.length === 0 || !clientName.trim()) ? 0.5 : 1 }}>
                {busy ? 'Submitting…' : changes.length === 0 ? 'Change a quantity or timeline value to submit' : `Submit ${changes.length} Change${changes.length > 1 ? 's' : ''} for Review`}
              </button>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
          Figures shown are the quoted customer price — rates and margins are not shown or editable.
        </div>
      </div>
    </div>
  )
}
