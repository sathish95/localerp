import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicDailyStatusReport } from '../lib/dailyStatusShare'
import { dateFmt } from '../lib/supabase'
import { useAppName } from '../context/BrandingContext'
import DailyStatusReportView from '../components/DailyStatusReportView'

const PERIODS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
]

/**
 * Public, unauthenticated Daily Status view — reached via a durable secret
 * link (daily_status_share_links), same standalone-page pattern as
 * PublicROIViewPage / PublicProposalSharePage. Per explicit confirmation,
 * this renders the EXACT same DailyStatusReportView the authenticated page
 * uses — same employee names, hours, department efficiency — the RPC
 * (get_daily_status_public_raw) hands back the full raw dataset, not a
 * reduced one. There is deliberately no separate "anonymized" rendering
 * path here to keep in sync with; it's the same component either way.
 */
export default function PublicDailyStatusPage() {
  const { token } = useParams()
  const appName = useAppName()
  const [period, setPeriod] = useState('daily')
  const [report, setReport] = useState(undefined) // undefined = loading, null = not found
  const [err, setErr] = useState('')

  useEffect(() => {
    setReport(undefined)
    getPublicDailyStatusReport(token, period).then(setReport).catch(e => { setErr(e.message); setReport(null) })
  }, [token, period])

  if (report === undefined) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}><div className="spinner" /></div>
  }
  if (report === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>{err || "This link isn't available. It may have expired or been revoked."}</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif", padding: '32px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 800 }}>{appName}</div>
          <div style={{ color: '#64748b', fontSize: 12.5 }}>Daily Status</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 10, padding: 3 }}>
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)} style={{
                padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
                fontWeight: period === p.id ? 700 : 500, background: period === p.id ? '#fff' : 'transparent', color: period === p.id ? '#6366f1' : '#64748b',
                boxShadow: period === p.id ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
              }}>{p.label}</button>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginBottom: 20 }}>
          {period === 'daily' ? dateFmt(report.start) : `${dateFmt(report.start)} – ${dateFmt(report.end)}`}
        </div>

        <DailyStatusReportView report={report} />
      </div>
    </div>
  )
}
