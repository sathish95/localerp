import { useState, useEffect } from 'react'
import { dateFmt } from '../lib/supabase'
import { getMarketingCalendar } from '../lib/marketingCampaigns'
import { listRegions, DOMAINS } from '../lib/salesAdmin'
import { Loader, Empty, StatusBadge } from '../components/ui'
import { Megaphone, Sparkles } from 'lucide-react'

export default function MarketingCalendarPage() {
  const [events, setEvents] = useState([])
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [domain, setDomain] = useState('')
  const [regionId, setRegionId] = useState('')

  useEffect(() => { load() }, [domain, regionId])
  async function load() {
    setLoading(true)
    const [e, r] = await Promise.all([getMarketingCalendar({ domain, region: regionId }), regions.length ? Promise.resolve(regions) : listRegions()])
    setEvents(e); if (!regions.length) setRegions(r)
    setLoading(false)
  }

  const grouped = events.reduce((acc, e) => {
    const month = e.start.slice(0, 7)
    ;(acc[month] ||= []).push(e)
    return acc
  }, {})

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Marketing Calendar</div>
          <div className="page-subtitle">Campaign windows and product launches, at a glance</div>
        </div>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ fontSize: 12, width: 180 }} value={domain} onChange={e => setDomain(e.target.value)}>
          <option value="">All Domains</option>{DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="form-select" style={{ fontSize: 12, width: 180 }} value={regionId} onChange={e => setRegionId(e.target.value)}>
          <option value="">All Regions</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
        </select>
      </div>

      {loading ? <Loader /> : events.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="📅" title="Nothing scheduled" desc="Campaigns and product launches with dates will appear here" /></div>
      ) : (
        Object.entries(grouped).map(([month, monthEvents]) => (
          <div key={month} className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 }}>
              {new Date(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {monthEvents.map(e => (
                <div key={`${e.kind}-${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: e.kind === 'campaign' ? '#fdf2f8' : '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: e.kind === 'campaign' ? '#db2777' : '#6366f1', flexShrink: 0 }}>
                    {e.kind === 'campaign' ? <Megaphone size={13} /> : <Sparkles size={13} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{e.title}</div>
                    <div style={{ fontSize: 11.5, color: '#64748b' }}>{e.subtitle}</div>
                  </div>
                  <StatusBadge status={e.status === 'Active' || e.status === 'Launched' ? 'active' : 'draft'} />
                  <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{dateFmt(e.start)}{e.end !== e.start ? ` – ${dateFmt(e.end)}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
