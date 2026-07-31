import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { rupee, dateFmt } from '../lib/supabase'
import { getCFODashboard, getCMODashboard, getCTODashboard, getSalesHeadDashboard } from '../lib/salesDashboards'
import { Tabs, Loader, Empty, StatCard } from '../components/ui'
import { DollarSign, Megaphone, Cpu, Users } from 'lucide-react'

const PERSONA_BY_ROLE = { finance: 'cfo', ceo: 'cfo', admin: 'cfo', cmo: 'cmo', cto: 'cto', sales_head: 'saleshead', regional_sales_head: 'saleshead' }

export default function SalesDashboardPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const availableTabs = [
    ['cfo', 'CFO', DollarSign, ['admin', 'ceo', 'finance']],
    ['cmo', 'CMO', Megaphone, ['admin', 'ceo', 'cmo']],
    ['cto', 'CTO', Cpu, ['admin', 'ceo', 'cto']],
    ['saleshead', 'Sales Head', Users, ['admin', 'ceo', 'sales_head', 'regional_sales_head']],
  ].filter(([, , , roles]) => roles.includes(role))

  const [tab, setTab] = useState(PERSONA_BY_ROLE[role] && availableTabs.some(t => t[0] === PERSONA_BY_ROLE[role]) ? PERSONA_BY_ROLE[role] : availableTabs[0]?.[0])

  if (availableTabs.length === 0) return <div className="card" style={{ padding: '20px 24px' }}><Empty icon="🔒" title="No dashboard view for your role" desc="Ask an admin for access" /></div>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sales Dashboard</div>
          <div className="page-subtitle">Perspective-driven views over the same underlying pipeline and finance data</div>
        </div>
      </div>

      <Tabs tabs={availableTabs.map(([id, label, Icon]) => ({ id, label }))} active={tab} onChange={setTab} />

      {tab === 'cfo' && <CFOView role={role} profileId={profile.id} />}
      {tab === 'cmo' && <CMOView />}
      {tab === 'cto' && <CTOView />}
      {tab === 'saleshead' && <SalesHeadView />}
    </div>
  )
}

function CFOView({ role, profileId }) {
  const [data, setData] = useState(null)
  useEffect(() => { getCFODashboard({ role, profileId }).then(setData) }, [role, profileId])
  if (!data) return <Loader />
  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Pipeline Value" value={rupee(data.forecast.pipeline_value)} icon={<DollarSign size={17} />} accent="#0ea5e9" />
        <StatCard label="Weighted Forecast" value={rupee(data.forecast.weighted_forecast)} icon={<DollarSign size={17} />} accent="#4338ca" />
        <StatCard label="Closed Won" value={rupee(data.forecast.closed_won_value)} icon={<DollarSign size={17} />} accent="#15803d" />
        <StatCard label="Closed Lost" value={rupee(data.forecast.closed_lost_value)} icon={<DollarSign size={17} />} accent="#dc2626" />
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Bootstrap Program: Planned vs. Actual</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Marketing/brand spend — kept separate from normal sales cost-of-acquisition</div>
        <div style={{ display: 'flex', gap: 20 }}>
          <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Planned</div><div style={{ fontSize: 18, fontWeight: 800 }}>{rupee(data.bootstrapPlanned)}</div></div>
          <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Actual</div><div style={{ fontSize: 18, fontWeight: 800 }}>{rupee(data.bootstrapActual)}</div></div>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Profit Attribution — Won deals by actual delivered margin</div>
        {data.profitAttribution.length === 0 ? <Empty icon="💹" title="No attribution data" desc="Populates once Won opportunities' linked projects have a computed profit margin" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Rep</th><th>Region</th><th>Domain</th><th>Gross Margin</th><th>Margin %</th></tr></thead>
              <tbody>{data.profitAttribution.map(a => (
                <tr key={a.id}><td>{a.rep?.full_name || '—'}</td><td>{a.region?.region_name || '—'}</td><td>{a.domain}</td><td className="td-bold">{rupee(a.gross_margin)}</td><td>{a.margin_percent}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function CMOView() {
  const [data, setData] = useState(null)
  useEffect(() => { getCMODashboard().then(setData) }, [])
  if (!data) return <Loader />
  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Planned Marketing Spend" value={rupee(data.plannedVsActualSpend.planned)} icon={<DollarSign size={17} />} accent="#0ea5e9" />
        <StatCard label="Actual Marketing Spend" value={rupee(data.plannedVsActualSpend.actual)} icon={<DollarSign size={17} />} accent="#f59e0b" />
        <StatCard label="Active Campaigns" value={data.campaignPerformance.filter(c => c.campaign?.status === 'Active').length} icon={<Megaphone size={17} />} accent="#db2777" />
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Campaign Performance</div>
        {data.campaignPerformance.length === 0 ? <Empty icon="📣" title="No campaign results yet" desc="Populates once a Campaign has leads, cost entries or won deals" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Campaign</th><th>Type</th><th>Leads</th><th>Won</th><th>Cost/Lead</th><th>Cost/Won Deal</th><th>ROI % (Projected)</th><th>ROI % (Realized)</th></tr></thead>
              <tbody>{data.campaignPerformance.map(r => (
                <tr key={r.id}>
                  <td className="td-bold">{r.campaign?.campaign_name}</td>
                  <td style={{ fontSize: 12 }}>{r.campaign?.campaign_type}</td>
                  <td>{r.leads_generated}</td>
                  <td>{r.deals_won}</td>
                  <td>{rupee(r.cost_per_lead)}</td>
                  <td>{rupee(r.cost_per_won_deal)}</td>
                  <td style={{ color: r.roi_percent_projected >= 0 ? '#15803d' : '#dc2626', fontWeight: 700 }}>{r.roi_percent_projected}%</td>
                  <td style={{ color: r.roi_percent_realized >= 0 ? '#15803d' : '#dc2626', fontWeight: 700 }}>{r.roi_percent_realized}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Channel Effectiveness</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          {data.channelEffectiveness.map(c => (
            <div key={c.channel_type} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>{c.channel_type}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{c.conversion_rate}%</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.converted} converted of {c.total}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Upcoming Marketing Calendar</div>
        {data.upcomingCalendar.length === 0 ? <Empty icon="📅" title="Nothing scheduled" desc="Campaigns and product launches with a date will appear here" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.upcomingCalendar.map(e => (
              <div key={`${e.kind}-${e.id}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2,#f8fafc)' }}>
                <span><strong>{e.title}</strong> — {e.subtitle}</span>
                <span style={{ color: '#94a3b8' }}>{dateFmt(e.start)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Lead Source Effectiveness</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Leads</th><th>Converted</th><th>Conversion Rate</th></tr></thead>
            <tbody>{data.leadSourceEffectiveness.map(s => (
              <tr key={s.source}><td className="td-bold">{s.source}</td><td>{s.leads}</td><td>{s.converted}</td><td>{s.leads ? Math.round((s.converted / s.leads) * 100) : 0}%</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Regional Market Penetration</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Region</th><th>Won</th><th>Pipeline Count</th><th>Pipeline Value</th></tr></thead>
            <tbody>{data.regionalPenetration.map(r => (
              <tr key={r.region}><td className="td-bold">{r.region}</td><td>{r.won}</td><td>{r.pipeline}</td><td>{rupee(r.pipelineValue)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Product Interest Heatmap</div>
        {data.productInterestHeatmap.length === 0 ? <Empty icon="🔥" title="No interest logged yet" desc="Populates as reps log ProductLaunch interest against leads/opportunities" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.productInterestHeatmap.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={p.byCampaign.map(c => `${c.campaign}: ${c.count}`).join(', ') || undefined}>
                <div style={{ width: 180, fontSize: 12.5, fontWeight: 600 }}>{p.product_name}</div>
                <div style={{ flex: 1, height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, p.interest_count * 10)}%`, height: '100%', background: '#db2777' }} />
                </div>
                <div style={{ width: 30, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{p.interest_count}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CTOView() {
  const [data, setData] = useState(null)
  useEffect(() => { getCTODashboard().then(setData) }, [])
  if (!data) return <Loader />
  return (
    <div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Product Launch Interest Signals</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Stage</th><th>Interest Signals</th></tr></thead>
            <tbody>{data.productLaunches.map(l => (
              <tr key={l.id}><td className="td-bold">{l.product_name}</td><td>{l.development_stage}</td><td>{l.interest_signals.length}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pilot Non-Conversion Feedback</div>
        {data.pilotFeedback.length === 0 ? <Empty icon="🧪" title="No feedback logged" desc="Populates from Pilot Projects marked Not Converted with a reason" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.pilotFeedback.map(p => (
              <div key={p.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12.5 }}>
                <div className="td-bold">{p.prospect_name}</div>
                <div style={{ color: '#64748b', marginTop: 2 }}>{p.conversion_reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Warranty Cost by Product</div>
        {data.warrantyByProductType.length === 0 ? <Empty icon="🛠" title="No warranty cost data" desc="Cross-referenced from the Warranty module" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Total Warranty Cost</th></tr></thead>
              <tbody>{data.warrantyByProductType.map(w => (
                <tr key={w.product}><td className="td-bold">{w.product}</td><td>{rupee(w.total_cost)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SalesHeadView({ regionId }) {
  const [data, setData] = useState(null)
  useEffect(() => { getSalesHeadDashboard({ regionId }).then(setData) }, [regionId])
  if (!data) return <Loader />
  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Win Rate" value={`${data.winRate}%`} icon={<Users size={17} />} accent="#15803d" />
        <StatCard label="Total Activities" value={data.totalActivities} icon={<Users size={17} />} accent="#0ea5e9" />
        <StatCard label="Overdue Tasks" value={data.overdueTasks} icon={<Users size={17} />} accent="#dc2626" />
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Rep Performance</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rep</th><th>Open</th><th>Won</th><th>Lost</th><th>Pipeline Value</th></tr></thead>
            <tbody>{data.repPerformance.map(r => (
              <tr key={r.rep}><td className="td-bold">{r.rep}</td><td>{r.open}</td><td>{r.won}</td><td>{r.lost}</td><td>{rupee(r.pipelineValue)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pipeline by Stage</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.pipelineByStage.map(s => (
            <div key={s.stage} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2,#f8fafc)' }}>
              <span>{s.stage}</span><span className="td-bold">{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
