import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { agreementFromAttachment } from '../../lib/esign'
import { attachmentUrl } from '../../lib/emailIntelligence'

// "Open file" for a document received by email: opens it in Agreements &
// e-Sign (creating the agreement draft from the PDF the first time, STEP275).
// Not a PDF, or the user can't create agreements → the file opens as before.
export default function OpenInAgreements({ att, projectId, className = 'btn btn-primary', label = 'Open file' }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      const id = await agreementFromAttachment(att, { projectId })
      navigate(`/agreements?id=${id}`)
    } catch (e) {
      if (e.code === 'NOT_PDF' || e.code === 'NOT_ALLOWED' || /esign_|schema cache/.test(e.message)) {
        try { window.open(await attachmentUrl(att.storage_path), '_blank', 'noopener') } catch (e2) { alert(e2.message) }
      } else alert(e.message)
    }
    setBusy(false)
  }
  return <button className={className} disabled={busy} onClick={open}><FileText size={13} /> {busy ? 'Opening…' : label}</button>
}
