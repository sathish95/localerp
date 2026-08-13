import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import {
  listMyParticipation, getMyPendingSelfFeedback, getSelfFeedbackContext, upsertSelfFeedback,
  getMyNominationAwards, getNominationContext, submitNomination, getMyApprovals,
} from '../lib/awards'
import { getMyCertificates, downloadCertificatePdf, verifyUrlFor } from '../lib/certificates'
import { Loader, Empty, Tabs, Modal, StatusBadge } from '../components/ui'
import { QuestionInput, readFileAsDataUrl } from '../components/AwardQuestionInput'
import {
  Medal, MessageSquare, Send, Save, UserPlus2, Download, Share2, Linkedin, Twitter, Facebook,
  MessageCircle, Link2, Check,
} from 'lucide-react'

const PARTICIPANT_STATUS_LABEL = {
  nominated: 'In Progress', in_review: 'In Progress', evaluated: 'Under Evaluation',
  recommended: 'Recommended', review_requested: 'Under Review', granted: 'Awarded', not_selected: 'Not Selected',
}

export default function MyAwardsPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('pending')
  const [pending, setPending] = useState([])
  const [all, setAll] = useState([])
  const [approvalsByAward, setApprovalsByAward] = useState(new Map())
  const [certsByAward, setCertsByAward] = useState(new Map())
  const [nominationAwards, setNominationAwards] = useState([])
  const [loading, setLoading] = useState(true)
  const [feedbackFor, setFeedbackFor] = useState(null)
  const [nominateFor, setNominateFor] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)
  const [shareFor, setShareFor] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [p, a, n, approvals, certs] = await Promise.all([
      getMyPendingSelfFeedback(profile.id), listMyParticipation(profile.id), getMyNominationAwards(profile.id),
      getMyApprovals(profile.id), getMyCertificates(profile.id),
    ])
    setPending(p); setAll(a); setNominationAwards(n)
    setApprovalsByAward(new Map(approvals.map(ap => [ap.award_id, ap])))
    setCertsByAward(new Map(certs.map(c => [c.award_id, c])))
    setLoading(false)
  }

  async function handleDownload(cert) {
    setDownloadingId(cert.id)
    try { await downloadCertificatePdf(cert) }
    finally { setDownloadingId(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Medal size={19} />
            </span>
            My Awards
          </div>
          <div className="page-subtitle">Pending feedback, nominations and award status</div>
        </div>
      </div>

      <Tabs tabs={[
        { id: 'pending', label: 'Pending Feedback', count: pending.length },
        { id: 'nominate', label: 'Nominations', count: nominationAwards.length },
        { id: 'all', label: 'All My Awards', count: all.length },
      ]} active={tab} onChange={setTab} />

      {tab === 'nominate' ? (
        nominationAwards.length === 0 ? (
          <Empty icon={<UserPlus2 size={40} />} title="No open nominations" desc="Nothing is currently open for peer nomination" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Award</th><th>Category</th><th>Nomination Window</th><th></th></tr></thead>
              <tbody>
                {nominationAwards.map(p => (
                  <tr key={p.id}>
                    <td className="td-bold">{p.award.name}</td>
                    <td>{p.award.category?.name ? <span className="badge">{p.award.category.name}</span> : '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.award.nomination_start_date ? `${dateFmt(p.award.nomination_start_date)} – ${dateFmt(p.award.nomination_end_date)}` : 'Open'}</td>
                    <td><button className="btn btn-primary btn-sm" onClick={() => setNominateFor(p.award_id)}><UserPlus2 size={13} /> Nominate</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'pending' ? (
        pending.length === 0 ? (
          <Empty icon={<MessageSquare size={40} />} title="No pending feedback" desc="You're all caught up — nothing needs your self feedback right now" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Award</th><th>Category</th><th>Period</th><th>Deadline</th><th></th></tr></thead>
              <tbody>
                {pending.map(p => {
                  const deadline = p.award.evaluation_end_date || p.award.nomination_end_date || p.award.end_date
                  return (
                    <tr key={p.id}>
                      <td className="td-bold">{p.award.name}</td>
                      <td>{p.award.category?.name ? <span className="badge">{p.award.category.name}</span> : '—'}</td>
                      <td style={{ fontSize: 12 }}>{p.award.start_date ? `${dateFmt(p.award.start_date)} – ${dateFmt(p.award.end_date)}` : '—'}</td>
                      <td style={{ fontSize: 12 }}>{deadline ? dateFmt(deadline) : '—'}</td>
                      <td><button className="btn btn-primary btn-sm" onClick={() => setFeedbackFor(p.award_id)}><MessageSquare size={13} /> Give Feedback</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        all.length === 0 ? (
          <Empty icon={<Medal size={40} />} title="No awards yet" desc="You'll show up here once HR publishes an award you're eligible for" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Award</th><th>Category</th><th>Period</th><th>Status</th><th>Awarded By</th><th>Award Date</th><th>Certificate</th></tr></thead>
              <tbody>
                {all.map(p => {
                  const approval = approvalsByAward.get(p.award_id)
                  const cert = certsByAward.get(p.award_id)
                  return (
                    <tr key={p.id}>
                      <td className="td-bold">{p.award?.name || '—'}</td>
                      <td>{p.award?.category?.name ? <span className="badge">{p.award.category.name}</span> : '—'}</td>
                      <td style={{ fontSize: 12 }}>{p.award?.start_date ? `${dateFmt(p.award.start_date)} – ${dateFmt(p.award.end_date)}` : '—'}</td>
                      <td><StatusBadge status={p.status === 'granted' ? 'approved' : p.status === 'not_selected' ? 'rejected' : 'processing'} />
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-muted)' }}>{PARTICIPANT_STATUS_LABEL[p.status]}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>{p.status === 'granted' ? (approval?.decided_by_profile?.full_name || '—') : '—'}</td>
                      <td style={{ fontSize: 12 }}>{p.status === 'granted' && approval?.award_date ? dateFmt(approval.award_date) : '—'}</td>
                      <td>
                        {cert ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-outline btn-sm" onClick={() => handleDownload(cert)} disabled={downloadingId === cert.id}>
                              <Download size={13} /> {downloadingId === cert.id ? 'Preparing…' : cert.certificate_number}
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={() => setShareFor({ cert, awardName: p.award?.name })} title="Share to social media">
                              <Share2 size={13} />
                            </button>
                          </div>
                        ) : p.status === 'granted' ? (
                          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Not yet available</span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {feedbackFor && (
        <SelfFeedbackModal awardId={feedbackFor} employeeId={profile.id}
          onClose={() => setFeedbackFor(null)}
          onSaved={async () => { setFeedbackFor(null); await load() }} />
      )}
      {nominateFor && (
        <NominationModal awardId={nominateFor} employeeId={profile.id}
          onClose={() => setNominateFor(null)}
          onSaved={async () => { setNominateFor(null); await load() }} />
      )}
      {shareFor && <ShareCertificateModal cert={shareFor.cert} awardName={shareFor.awardName} onClose={() => setShareFor(null)} />}
    </div>
  )
}

function ShareCertificateModal({ cert, awardName, onClose }) {
  const verifyUrl = verifyUrlFor(cert.certificate_number)
  const [text, setText] = useState(`I'm proud to share that I've received the "${awardName}" award! 🏆`)
  const [copied, setCopied] = useState(false)
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  function openShare(url) { window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500') }

  const encodedUrl = encodeURIComponent(verifyUrl)
  const encodedText = encodeURIComponent(text)
  const links = {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${verifyUrl}`)}`,
  }

  async function handleNativeShare() {
    try { await navigator.share({ title: awardName, text, url: verifyUrl }) }
    catch { /* user cancelled the share sheet — nothing to do */ }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(`${text} ${verifyUrl}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal open onClose={onClose} title="Share Your Achievement" footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <div className="form-group">
        <label className="form-label">Your message</label>
        <textarea className="form-input" rows={3} value={text} onChange={e => setText(e.target.value)} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 16, wordBreak: 'break-all' }}>{verifyUrl}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button className="btn btn-outline" onClick={() => openShare(links.linkedin)} style={{ color: '#0a66c2' }}><Linkedin size={16} /> LinkedIn</button>
        <button className="btn btn-outline" onClick={() => openShare(links.twitter)} style={{ color: '#0f1419' }}><Twitter size={16} /> X / Twitter</button>
        <button className="btn btn-outline" onClick={() => openShare(links.facebook)} style={{ color: '#1877f2' }}><Facebook size={16} /> Facebook</button>
        <button className="btn btn-outline" onClick={() => openShare(links.whatsapp)} style={{ color: '#25d366' }}><MessageCircle size={16} /> WhatsApp</button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={handleCopy}>
          {copied ? <><Check size={15} /> Copied!</> : <><Link2 size={15} /> Copy Link</>}
        </button>
        {canNativeShare && (
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={handleNativeShare}>
            <Share2 size={15} /> More Options…
          </button>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 14 }}>
        The shared link opens a public verification page showing only the award name, date and validity — no personal or score details.
      </div>
    </Modal>
  )
}

function NominationModal({ awardId, employeeId, onClose, onSaved }) {
  const [ctx, setCtx] = useState(null)
  const [nomineeId, setNomineeId] = useState('')
  const [reason, setReason] = useState('')
  const [comments, setComments] = useState('')
  const [evidence, setEvidence] = useState('')
  const [answers, setAnswers] = useState({})
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { getNominationContext(awardId, employeeId).then(setCtx) }, [awardId])

  function setAnswer(questionId, value) { setAnswers(a => ({ ...a, [questionId]: value })) }

  const nomineeOptions = ctx ? ctx.peers.filter(p => ctx.config.allow_self_nomination || p.id !== employeeId) : []
  const maxReached = ctx?.config?.max_nominations_per_employee && ctx.myNominations.length >= ctx.config.max_nominations_per_employee

  async function handleSubmit() {
    if (!nomineeId || !reason.trim()) { setErr('Please choose a colleague and give a reason.'); return }
    setSaving(true); setErr('')
    try {
      await submitNomination(awardId, employeeId, { nomineeId, reason, comments, evidence, answers, isAnonymous })
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={ctx ? `Nominate a Colleague — ${ctx.award.name}` : 'Nominate a Colleague'} size="lg"
      footer={ctx ? (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || maxReached}><Send size={14} /> Submit Nomination</button>
        </>
      ) : null}>
      {!ctx ? <Loader /> : (
        <div>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          {maxReached && <div className="alert alert-warning" style={{ marginBottom: 12 }}>You've reached the maximum of {ctx.config.max_nominations_per_employee} nomination(s) for this award.</div>}

          {ctx.myNominations.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 16 }}>
              Already nominated: {ctx.myNominations.map(n => n.nominee?.full_name).join(', ')}
            </div>
          )}

          <div className="form-group"><label className="form-label">Colleague to Nominate *</label>
            <select className="form-select" value={nomineeId} onChange={e => setNomineeId(e.target.value)}>
              <option value="">Select…</option>
              {nomineeOptions.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.id === employeeId ? ' (Myself)' : ''}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="form-label">Reason *</label><textarea className="form-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Comments</label><textarea className="form-input" rows={2} value={comments} onChange={e => setComments(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Evidence</label><textarea className="form-input" rows={2} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Links, notes, or specific examples" /></div>
          {ctx.config.allow_anonymous_nomination && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} /> Submit anonymously
            </label>
          )}

          {ctx.questions.map(q => (
            <div className="form-group" key={q.id}>
              <label className="form-label">{q.question_text}{q.is_required && ' *'}</label>
              <QuestionInput question={q} value={answers[q.id]} onChange={v => setAnswer(q.id, v)}
                onFile={f => readFileAsDataUrl(f).then(v => setAnswer(q.id, v))} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function SelfFeedbackModal({ awardId, employeeId, onClose, onSaved }) {
  const [ctx, setCtx] = useState(null)
  const [answers, setAnswers] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getSelfFeedbackContext(awardId, employeeId).then(c => { setCtx(c); setAnswers(c.feedback?.answers || {}) })
  }, [awardId])

  const locked = ctx?.feedback?.status === 'submitted'

  function setAnswer(questionId, value) { setAnswers(a => ({ ...a, [questionId]: value })) }

  async function handleSave(submit) {
    if (submit) {
      const missing = ctx.questions.find(q => q.is_required && !answers[q.id])
      if (missing) { setErr(`Please answer: ${missing.question_text}`); return }
    }
    setSaving(true); setErr('')
    try {
      await upsertSelfFeedback(awardId, employeeId, answers, submit)
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={ctx ? `Self Feedback — ${ctx.award.name}` : 'Self Feedback'} size="lg"
      footer={ctx && !locked ? (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-outline" onClick={() => handleSave(false)} disabled={saving}><Save size={14} /> Save Draft</button>
          <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving}><Send size={14} /> Submit</button>
        </>
      ) : <button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      {!ctx ? <Loader /> : (
        <div>
          {locked && <div className="alert alert-info" style={{ marginBottom: 14 }}>Submitted — your feedback is locked and can no longer be edited.</div>}
          {ctx.award.objective && <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>{ctx.award.objective}</div>}
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          {ctx.questions.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No questions have been configured for this award yet.</div>
          ) : ctx.questions.map(q => (
            <div className="form-group" key={q.id}>
              <label className="form-label">{q.question_text}{q.is_required && ' *'}</label>
              <QuestionInput question={q} value={answers[q.id]} disabled={locked}
                onChange={v => setAnswer(q.id, v)} onFile={f => readFileAsDataUrl(f).then(v => setAnswer(q.id, v))} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
