import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Download, XCircle } from 'lucide-react'
import { publicGet, publicFile } from '../../lib/esign'
import { signedPdf, contentPdf, downloadBytes, fileBase, istTime } from '../../lib/esignPdf'
import { DOC_TYPE_LABEL, fmtDate, fmtMoney } from '../../lib/esignTemplates'
import SignPanel from './SignPanel'
import { DocumentText, PdfFrame, StatusPill } from './DocumentView'

// The signing screen for one signer token: document, signers, sign / decline,
// downloads. Rendered by the public page /sign/:token and inside the
// Agreements & e-Sign tab (STEP274). All calls are the esign_public_* RPCs.
export default function SigningView({ token, onChanged }) {
  const [data, setData] = useState(null)
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await publicGet(token)
      setData(d)
      if (d.document.source === 'UPLOAD') setFile(await publicFile(token))
    } catch (e) { setError(e.message) }
  }, [token])
  useEffect(() => { load() }, [load])

  if (error) return <div className="esg-public-card esg-center"><XCircle size={30} color="#dc2626" /><h2>{error}</h2><p className="esg-muted">Ask the sender for a new link if you still need to sign.</p></div>
  if (!data) return <div className="esg-public-card esg-center"><div className="spinner" /></div>

  const { document: doc, me, signers, org_name: orgName } = data
  const done = doc.status === 'COMPLETED'
  const download = async signed => {
    setBusy(true)
    try {
      const bytes = signed ? await signedPdf({ doc, signers, events: data.events || [], orgName, originalBytes: file }) : (file || contentPdf(doc, orgName))
      downloadBytes(bytes, `${fileBase(doc)}${signed ? '-signed' : ''}.pdf`)
    } catch (e) { setMsg({ ok: false, text: `Could not build the PDF: ${e.message}` }) }
    setBusy(false)
  }

  return (
    <>
      <div className="esg-public-head">
        <div>
          <div className="esg-muted esg-small">{orgName} · {DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type} · {doc.doc_number}</div>
          <h1 className="esg-public-title">{doc.title}</h1>
          <div className="esg-public-meta">
            <StatusPill status={doc.status} />
            {doc.counterparty_name && <span>With {doc.counterparty_name}</span>}
            {doc.contract_value != null && <span>{fmtMoney(doc.contract_value, doc.currency)}</span>}
            {doc.sign_by && !done && <span>Sign by {fmtDate(doc.sign_by)}</span>}
          </div>
        </div>
        <div className="esg-public-actions">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => download(false)}><Download size={13} /> Download copy</button>
          {done && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => download(true)}><Download size={13} /> Signed PDF</button>}
        </div>
      </div>
      {doc.message && <div className="esg-note">{doc.message}</div>}

      <div className="esg-public-grid">
        <div>{doc.source === 'UPLOAD' ? <PdfFrame bytes={file} name={doc.file_name} /> : <DocumentText content={doc.content} />}</div>
        <aside className="esg-side">
          <div className="esg-public-card">
            <h3>Signers</h3>
            {signers.map(s => (
              <div key={s.id} className={`esg-signer${s.id === me.id ? ' me' : ''}`}>
                <span className="esg-seq">{doc.signing_order === 'PARALLEL' ? '•' : s.seq}</span>
                <div className="esg-signer-main"><b>{s.name}{s.id === me.id && ' (you)'}</b><span>{s.role_label || ''}{s.signed_at ? ` · ${istTime(s.signed_at)}` : ''}</span></div>
                <StatusPill status={s.status} signer />
              </div>
            ))}
          </div>
          {msg && <div className={`olk-msg ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
          {me.status === 'SIGNED' && <div className="esg-public-card esg-ok"><CheckCircle2 size={18} /> You signed on {istTime(me.signed_at)}.{!done && ' You will get an email when everyone has signed.'}</div>}
          {me.status === 'DECLINED' && <div className="esg-public-card esg-bad"><XCircle size={18} /> You declined: {me.decline_reason}</div>}
          {['DECLINED', 'EXPIRED'].includes(doc.status) && me.status !== 'DECLINED' && (
            <div className="esg-public-card esg-bad"><XCircle size={18} /> This document is {doc.status === 'EXPIRED' ? 'past its sign-by date' : 'declined by a signer'} and can't be signed.</div>
          )}
          {!me.can_sign && ['SENT', 'IN_PROGRESS'].includes(doc.status) && !['SIGNED', 'DECLINED'].includes(me.status) && (
            <div className="esg-public-card">It's not your turn yet. You'll get an email once the earlier signers have signed.</div>
          )}
          {me.can_sign && <SignPanel token={token} doc={doc} me={me} onDone={async text => { setMsg({ ok: true, text }); await load(); onChanged?.() }} />}
          <p className="esg-muted esg-small">Your IP address, browser and the time of each step are recorded in the signature certificate attached to the signed PDF.</p>
        </aside>
      </div>
    </>
  )
}
