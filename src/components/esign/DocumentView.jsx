import { useEffect, useState } from 'react'
import { parseBody, STATUS_META, SIGNER_STATUS_META } from '../../lib/esignTemplates'

export function StatusPill({ status, signer }) {
  const [label, tone] = (signer ? SIGNER_STATUS_META : STATUS_META)[status] || [status, 'gray']
  return <span className={`gl-pill ${tone}`}>{label}</span>
}

// Template text rendered as a page. [Missing field] markers are highlighted.
export function DocumentText({ content }) {
  const mark = t => String(t).split(/(\[[^\]\n]{1,60}\])/g).map((part, i) => (/^\[[^\]]+\]$/.test(part) ? <mark key={i} className="esg-missing">{part}</mark> : part))
  return (
    <div className="esg-paper">
      {parseBody(content).map((b, i) => {
        if (b.kind === 'h1') return <h1 key={i}>{mark(b.text)}</h1>
        if (b.kind === 'h2') return <h2 key={i}>{mark(b.text)}</h2>
        if (b.kind === 'li') return <div key={i} className="esg-li">{mark(b.text)}</div>
        if (b.kind === 'table') return (
          <div key={i} className="esg-table-wrap"><table className="esg-table">
            <thead><tr>{b.head.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
          </table></div>
        )
        return <p key={i}>{mark(b.text)}</p>
      })}
    </div>
  )
}

// An uploaded PDF shown inline (with a fallback link for phones that can't).
export function PdfFrame({ bytes, name }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!bytes) return undefined
    const u = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [bytes])
  if (!url) return <div className="esg-paper esg-muted">Loading the PDF…</div>
  return (
    <div className="esg-pdf">
      <iframe title={name || 'Document'} src={url} />
      <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">Open {name || 'PDF'} in a new tab</a>
    </div>
  )
}
