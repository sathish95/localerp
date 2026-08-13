import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ShieldCheck, ShieldX } from 'lucide-react'

// Public, unauthenticated — reachable via the QR code embedded in a
// generated certificate. Deliberately shows ONLY certificate number,
// award name, award date and status (see STEP121's get_certificate_public()
// RPC) — never the recipient's name, score, or any other profile detail,
// matching the spec's verification-page example exactly.
export default function CertificateVerifyPage() {
  const { certificateNumber } = useParams()
  const [result, setResult] = useState(undefined)

  useEffect(() => {
    supabase.rpc('get_certificate_public', { p_certificate_number: certificateNumber })
      .then(({ data }) => setResult(data?.[0] || null))
  }, [certificateNumber])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 36, maxWidth: 420, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,.08)', textAlign: 'center' }}>
        {result === undefined ? (
          <div style={{ color: '#64748b' }}>Checking certificate…</div>
        ) : result ? (
          <>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <ShieldCheck size={28} />
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Certificate Number</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18 }}>{result.certificate_number}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Award</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18 }}>{result.award_name}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Award Date</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18 }}>{result.award_date}</div>
            <div style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: result.status === 'valid' ? '#dcfce7' : '#fee2e2', color: result.status === 'valid' ? '#15803d' : '#dc2626', textTransform: 'capitalize' }}>
              {result.status}
            </div>
          </>
        ) : (
          <>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <ShieldX size={28} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Certificate Not Found</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>No certificate matches this number.</div>
          </>
        )}
      </div>
    </div>
  )
}
