import { useState, useEffect } from 'react'
import { rupee, dateFmt } from '../lib/supabase'
import { getSalesTimeline } from '../lib/salesTimeline'
import { listRegions, DOMAINS } from '../lib/salesAdmin'
import { StatusBadge, Loader, Empty } from '../components/ui'
import { History } from 'lucide-react'

const KIND_LABEL = { delivered: 'Delivered', pipeline: 'Pipeline', lost: 'Lost' }
const KIND_STATUS = { delivered: 'approved', pipeline: 'draft', lost: 'rejected' }

export default function SalesTimelinePage() {
  const [rows, setRows] = useState([])
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [regionId, setRegionId] = useState('')
  const [domain, setDomain] = useState('')
  const [status, setStatus] = useState('both')

  useEffect(() => { load() }, [regionId, domain, status])
  async function load() {
    setLoading(true)
    const [t, r] = await Promise.all([getSalesTimeline({ regionId, domain, status }), regions.length ? Promise.resolve(regions) : listRegions()])
    setRows(t); if (!regions.length) setRegions(r)
    setLoading(false)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sales Timeline</div>
          <div className="page-subtitle">Delivered performance and upcoming pipeline in one place — no switching screens or mental models</div>
        </div>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-select" style={{ fontSize: 12, width: 160 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="both">Historical + Pipeline</option>
          <option value="historical">Historical Only</option>
          <option value="pipeline">Pipeline Only</option>
        </select>
        <select className="form-select" style={{ fontSize: 12, width: 160 }} value={domain} onChange={e => setDomain(e.target.value)}>
          <option value="">All Domains</option>
          {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="form-select" style={{ fontSize: 12, width: 160 }} value={regionId} onChange={e => setRegionId(e.target.value)}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
        </select>
      </div>

      {loading ? <Loader /> : rows.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="🕒" title="No records match" desc="Adjust filters" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th></th><th>Opp #</th><th>Region</th><th>Domain</th><th>Rep</th><th>Close Date</th><th>Expected Value</th><th>Stage / Result</th><th>Actual Profit</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><StatusBadge status={KIND_STATUS[r.kind]} /></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.opportunity_number}</td>
                  <td>{r.region || '—'}</td>
                  <td>{r.domain}</td>
                  <td>{r.rep || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.expected_close_date ? dateFmt(r.expected_close_date) : '—'}</td>
                  <td className="td-bold">{rupee(r.expected_value)}</td>
                  <td style={{ fontSize: 12 }}>{r.kind === 'pipeline' ? `${r.pipeline_stage} (${r.probability_percent}%)` : KIND_LABEL[r.kind]}</td>
                  <td>{r.actual_profit != null ? `${rupee(r.actual_profit)} (${r.actual_margin_percent}%)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
