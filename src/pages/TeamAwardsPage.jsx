import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTabVisibility } from '../context/TabVisibilityContext'
import {
  listTeamAwardParticipation, getManagerFeedbackContext, upsertManagerFeedback, getPeerNominationsForNominee,
  getApprovalQueue, decideAward,
} from '../lib/awards'
import { getCertificateForAward, downloadCertificatePdf } from '../lib/certificates'
import { Loader, Empty, Modal, Tabs, StatCard } from '../components/ui'
import { QuestionInput, readFileAsDataUrl } from '../components/AwardQuestionInput'
import { Star, MessageSquare, Send, Save, CheckCircle2, XCircle, RotateCcw, Gavel, Download } from 'lucide-react'

const FEEDBACK_STATUS = {
  not_required: { label: 'Not Required', bg: '#f1f5f9', color: '#64748b' },
  pending:      { label: 'Pending',       bg: '#fef3c7', color: '#b45309' },
  draft:        { label: 'Draft',         bg: '#e0e7ff', color: '#4338ca' },
  submitted:    { label: 'Submitted',     bg: '#dcfce7', color: '#15803d' },
}
const Pill = ({ status }) => {
  const c = FEEDBACK_STATUS[status] || FEEDBACK_STATUS.pending
  return <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{c.label}</span>
}

export default function TeamAwardsPage() {
  const { profile } = useAuth()
  const isHRAdmin = ['admin', 'ceo', 'hr'].includes(profile?.role)
  const [tab, setTab] = useState('feedback')
  const [rows, setRows] = useState([])
  const [queue, setQueue] = useState([])
  const [certsByKey, setCertsByKey] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [feedbackFor, setFeedbackFor] = useState(null)
  const [decisionFor, setDecisionFor] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [r, q] = await Promise.all([
      listTeamAwardParticipation(profile.id, { allEmployees: isHRAdmin }),
      getApprovalQueue(profile.id, { allEmployees: isHRAdmin }),
    ])
    setRows(r); setQueue(q)
    const grantedRows = r.filter(x => x.status === 'granted')
    const certs = await Promise.all(grantedRows.map(x => getCertificateForAward(x.award_id, x.employee_id)))
    setCertsByKey(new Map(grantedRows.map((x, i) => [`${x.award_id}:${x.employee_id}`, certs[i]])))
    setLoading(false)
  }

  async function handleDownload(cert) {
    setDownloadingId(cert.id)
    try { await downloadCertificatePdf(cert) }
    finally { setDownloadingId(null) }
  }

  if (loading) return <Loader />

  const pendingFeedback = rows.filter(r => r.managerFeedbackRequired && r.managerFeedback?.status !== 'submitted').length
  const grantedRows = rows.filter(r => r.status === 'granted')
  const granted = grantedRows.length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#b45309)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Star size={19} />
            </span>
            Team Awards
          </div>
          <div className="page-subtitle">{isHRAdmin ? 'All employees' : 'Your direct reports'} — feedback and award decisions</div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Pending Feedback" value={pendingFeedback} icon={<MessageSquare size={17} />} accent="#b45309" />
        <StatCard label="Pending Decisions" value={queue.length} icon={<Gavel size={17} />} accent="#6366f1" />
        <StatCard label="Awards Granted" value={granted} icon={<CheckCircle2 size={17} />} accent="#15803d" />
      </div>

      <Tabs tabs={[
        { id: 'feedback', label: 'Feedback', count: rows.length },
        { id: 'decisions', label: 'Award Decisions', count: queue.length },
        { id: 'granted', label: 'Granted', count: granted },
      ]} active={tab} onChange={setTab} />

      {tab === 'granted' ? (
        grantedRows.length === 0 ? (
          <Empty icon={<CheckCircle2 size={40} />} title="No awards granted yet" desc="Granted awards and their certificates will show up here" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Award</th><th>Final Score</th><th>Certificate</th></tr></thead>
              <tbody>
                {grantedRows.map(r => {
                  const cert = certsByKey.get(`${r.award_id}:${r.employee_id}`)
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="td-bold">{r.employee?.full_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.employee?.designation || '—'} · {r.employee?.dept?.name || '—'}</div>
                      </td>
                      <td>{r.award?.name}</td>
                      <td className="td-bold">{r.final_score ?? '—'}</td>
                      <td>
                        {cert ? (
                          <button className="btn btn-outline btn-sm" onClick={() => handleDownload(cert)} disabled={downloadingId === cert.id}>
                            <Download size={13} /> {downloadingId === cert.id ? 'Preparing…' : cert.certificate_number}
                          </button>
                        ) : <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Not yet available</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'decisions' ? (
        queue.length === 0 ? (
          <Empty icon={<Gavel size={40} />} title="No decisions pending" desc="Recommendations will show up here once HR calculates scores" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Award</th><th>Final Score</th><th>Recommendation</th><th>Rank</th><th></th></tr></thead>
              <tbody>
                {queue.map(q => (
                  <tr key={q.id}>
                    <td>
                      <div className="td-bold">{q.employee?.full_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{q.employee?.designation || '—'} · {q.employee?.dept?.name || '—'}</div>
                    </td>
                    <td>{q.award?.name}</td>
                    <td className="td-bold">{q.final_score ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{q.recommendation_label || '—'}</td>
                    <td>{q.rank ? `#${q.rank}` : '—'}</td>
                    <td><button className="btn btn-primary btn-sm" onClick={() => setDecisionFor(q)}><Gavel size={13} /> Decide</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        rows.length === 0 ? (
          <Empty icon={<Star size={40} />} title="Nothing to review" desc="No direct reports are currently participating in an active award" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Award</th><th>Self Feedback</th><th>Manager Feedback</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="td-bold">{r.employee?.full_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.employee?.designation || '—'} · {r.employee?.dept?.name || '—'}</div>
                    </td>
                    <td>{r.award?.name}</td>
                    <td><Pill status={r.selfFeedbackStatus} /></td>
                    <td>
                      <Pill status={r.managerFeedbackRequired ? (r.managerFeedback?.status || 'pending') : 'not_required'} />
                      {r.managerFeedback?.rating != null && <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700 }}>{r.managerFeedback.rating}</span>}
                    </td>
                    <td>
                      {r.managerFeedbackRequired && (
                        <button className="btn btn-primary btn-sm" onClick={() => setFeedbackFor(r)}>
                          <MessageSquare size={13} /> {r.managerFeedback?.status === 'submitted' ? 'View' : 'Give Feedback'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {feedbackFor && (
        <ManagerFeedbackModal participant={feedbackFor} reviewerId={profile.id}
          onClose={() => setFeedbackFor(null)}
          onSaved={async () => { setFeedbackFor(null); await load() }} />
      )}
      {decisionFor && (
        <DecisionModal participant={decisionFor} managerId={profile.id}
          onClose={() => setDecisionFor(null)}
          onSaved={async () => { setDecisionFor(null); await load() }} />
      )}
    </div>
  )
}

function DecisionModal({ participant, managerId, onClose, onSaved }) {
  const { hasPermission } = useTabVisibility()
  const canApprove = hasPermission('AWARD_APPROVE')
  const canGrant = hasPermission('AWARD_GRANT')
  const [comments, setComments] = useState('')
  const [saving, setSaving] = useState('')
  const [err, setErr] = useState('')

  async function handleDecide(decision) {
    setSaving(decision); setErr('')
    try {
      await decideAward(participant.award_id, participant.employee_id, managerId, { decision, comments })
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving('') }
  }

  return (
    <Modal open onClose={onClose} title={`Award Decision — ${participant.employee?.full_name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {canApprove && <button className="btn btn-outline" onClick={() => handleDecide('review_requested')} disabled={!!saving}><RotateCcw size={14} /> Request Review</button>}
          {canApprove && <button className="btn btn-danger" onClick={() => handleDecide('rejected')} disabled={!!saving}><XCircle size={14} /> Reject</button>}
          {canGrant && <button className="btn btn-primary" onClick={() => handleDecide('granted')} disabled={!!saving}><CheckCircle2 size={14} /> Approve & Grant</button>}
        </>
      }>
      <div>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        {!canApprove && !canGrant && (
          <div className="alert alert-warning" style={{ marginBottom: 12 }}>
            Your role doesn't have permission to decide on awards. Ask an admin to grant AWARD_APPROVE / AWARD_GRANT in Settings → Permissions.
          </div>
        )}
        <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13 }}>
          <div><strong>Award:</strong> {participant.award?.name}</div>
          <div><strong>Final Score:</strong> {participant.final_score ?? '—'}</div>
          <div><strong>Recommendation:</strong> {participant.recommendation_label || '—'}</div>
          {participant.scoreDetail && (
            <div style={{ marginTop: 6, color: 'var(--ink-muted)' }}>
              Self {participant.scoreDetail.self_score} · Manager {participant.scoreDetail.manager_score} · Peer {participant.scoreDetail.peer_score} · Performance {participant.scoreDetail.performance_score}
            </div>
          )}
        </div>
        <div className="form-group"><label className="form-label">Comment</label>
          <textarea className="form-input" rows={3} value={comments} onChange={e => setComments(e.target.value)} placeholder="Optional note explaining this decision" /></div>
      </div>
    </Modal>
  )
}

function ManagerFeedbackModal({ participant, reviewerId, onClose, onSaved }) {
  const [ctx, setCtx] = useState(null)
  const [nominations, setNominations] = useState(null)
  const [answers, setAnswers] = useState({})
  const [rating, setRating] = useState('')
  const [comments, setComments] = useState('')
  const [evidence, setEvidence] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getManagerFeedbackContext(participant.award_id, participant.employee_id).then(c => {
      setCtx(c)
      setAnswers(c.feedback?.answers || {})
      setRating(c.feedback?.rating ?? '')
      setComments(c.feedback?.comments || '')
      setEvidence(c.feedback?.evidence || '')
      setRecommendation(c.feedback?.recommendation || '')
    })
    getPeerNominationsForNominee(participant.award_id, participant.employee_id).then(setNominations)
  }, [participant.award_id, participant.employee_id])

  const locked = ctx?.feedback?.status === 'submitted'

  function setAnswer(questionId, value) { setAnswers(a => ({ ...a, [questionId]: value })) }

  async function handleSave(submit) {
    if (submit && !rating) { setErr('Please give a rating before submitting.'); return }
    setSaving(true); setErr('')
    try {
      await upsertManagerFeedback(participant.award_id, participant.employee_id, reviewerId,
        { answers, rating: rating === '' ? null : Number(rating), comments, evidence, recommendation }, submit)
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={ctx ? `Manager Feedback — ${participant.employee?.full_name}` : 'Manager Feedback'} size="lg"
      footer={ctx && !locked ? (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-outline" onClick={() => handleSave(false)} disabled={saving}><Save size={14} /> Save Draft</button>
          <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving}><Send size={14} /> Submit</button>
        </>
      ) : <button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      {!ctx ? <Loader /> : (
        <div>
          {locked && <div className="alert alert-info" style={{ marginBottom: 14 }}>Submitted — this feedback is locked.</div>}
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Employee Self Feedback</div>
          {!ctx.selfFeedback ? (
            <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 20 }}>Not submitted yet.</div>
          ) : (
            <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 14, marginBottom: 20, fontSize: 13 }}>
              {ctx.selfQuestions.map(q => (
                <div key={q.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{q.question_text}</div>
                  <div style={{ color: 'var(--ink-muted)' }}>{String(ctx.selfFeedback.answers?.[q.id] ?? '—')}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Peer Nominations {nominations && `(${nominations.length})`}</div>
          {!nominations || nominations.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 20 }}>No peer nominations yet.</div>
          ) : (
            <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 14, marginBottom: 20, fontSize: 13 }}>
              {nominations.map(n => (
                <div key={n.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600 }}>{n.nominator_name || 'Anonymous'}</div>
                  <div style={{ color: 'var(--ink-muted)' }}>{n.reason}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Your Evaluation</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Rating *</label>
              <select className="form-select" value={rating} disabled={locked} onChange={e => setRating(e.target.value)}>
                <option value="">Select…</option>
                {ctx.ratingScale.map(r => <option key={r.value} value={r.value}>{r.value} — {r.label}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Recommendation</label>
              <input className="form-input" value={recommendation} disabled={locked} onChange={e => setRecommendation(e.target.value)} placeholder="e.g. Strongly recommend for this award" /></div>
          </div>
          <div className="form-group"><label className="form-label">Comments</label><textarea className="form-input" rows={3} value={comments} disabled={locked} onChange={e => setComments(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Evidence</label>
            <textarea className="form-input" rows={2} value={evidence} disabled={locked} onChange={e => setEvidence(e.target.value)} placeholder="Links, notes, or specific examples" /></div>

          {ctx.questions.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', margin: '18px 0 8px', textTransform: 'uppercase' }}>Additional Questions</div>
              {ctx.questions.map(q => (
                <div className="form-group" key={q.id}>
                  <label className="form-label">{q.question_text}{q.is_required && ' *'}</label>
                  <QuestionInput question={q} value={answers[q.id]} disabled={locked}
                    onChange={v => setAnswer(q.id, v)} onFile={f => readFileAsDataUrl(f).then(v => setAnswer(q.id, v))} />
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
