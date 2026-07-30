import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getUsageLogs, estimateCost } from '../lib/llmUsage'
import { Empty } from '../components/ui'
import {
  RefreshCw, Activity, Coins, Timer, AlertTriangle, DollarSign, MessageSquare,
} from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'

const RANGES = { today: 1, '7d': 7, '30d': 30 }
const MODEL_COLORS = { 'deepseek-chat': '#6366f1', 'gemini-2.5-pro': '#0284c7', 'claude-opus-5': '#d97757', 'qwen2.5-coder:7b': '#10b981' }
const SOURCE_LABELS = { data_assistant: 'Data Assistant', neo_task_ai: 'Neo Task AI' }

function Kpi({ label, value, icon, color = '#6366f1', sub }) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff', borderRadius: 16, padding: '16px 18px', border: `1.5px solid ${color}18`, borderTop: `4px solid ${color}`,
        boxShadow: hover ? '0 10px 24px rgba(0,0,0,.09)' : '0 1px 6px rgba(0,0,0,.05)', height: '100%', minWidth: 0,
        transform: hover ? 'translateY(-3px)' : 'none', transition: 'transform .18s, box-shadow .18s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 'clamp(16px,3vw,24px)', fontWeight: 800, color, lineHeight: 1.2, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ChartCard({ title, sub, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

function bucketKey(iso, range) {
  const d = new Date(iso)
  if (range === 'today') return `${String(d.getHours()).padStart(2, '0')}:00`
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function LLMMonitorPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canView = ['admin', 'ceo'].includes(role)
  const [range, setRange] = useState('7d')
  const [logs, setLogs] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!canView) return
    load()
  }, [range, canView])

  async function load() {
    setLoading(true)
    try {
      const since = new Date(Date.now() - RANGES[range] * 86400000).toISOString()
      const [rows, userR] = await Promise.all([
        getUsageLogs({ since, limit: 3000 }),
        supabase.from('profiles').select('id,full_name'),
      ])
      setLogs(rows)
      setUsers(Object.fromEntries((userR.data || []).map(u => [u.id, u.full_name])))
    } finally {
      setLoading(false)
    }
  }

  const stats = useMemo(() => {
    const total = logs.length
    const errors = logs.filter(l => l.success === false).length
    const totalTokens = logs.reduce((s, l) => s + (l.total_tokens || (l.prompt_tokens || 0) + (l.completion_tokens || 0)), 0)
    const latencies = logs.filter(l => l.latency_ms != null).map(l => l.latency_ms)
    const avgLatency = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0
    const estCost = logs.reduce((s, l) => s + estimateCost(l.model, l.prompt_tokens, l.completion_tokens), 0)

    const byBucket = {}
    logs.forEach(l => {
      const k = bucketKey(l.created_at, range)
      byBucket[k] ||= { bucket: k, requests: 0, promptTokens: 0, completionTokens: 0, order: new Date(l.created_at).getTime() }
      byBucket[k].requests += 1
      byBucket[k].promptTokens += l.prompt_tokens || 0
      byBucket[k].completionTokens += l.completion_tokens || 0
    })
    const series = Object.values(byBucket).sort((a, b) => a.order - b.order)

    const byModel = {}
    logs.forEach(l => {
      const k = l.model || 'unknown'
      byModel[k] ||= { model: k, requests: 0, tokens: 0 }
      byModel[k].requests += 1
      byModel[k].tokens += l.total_tokens || (l.prompt_tokens || 0) + (l.completion_tokens || 0)
    })
    const modelRows = Object.values(byModel).sort((a, b) => b.tokens - a.tokens)

    const bySource = {}
    logs.forEach(l => {
      const k = l.source || 'unknown'
      bySource[k] ||= { source: SOURCE_LABELS[k] || k, requests: 0 }
      bySource[k].requests += 1
    })
    const sourceRows = Object.values(bySource)

    const byUser = {}
    logs.forEach(l => {
      if (!l.user_id) return
      byUser[l.user_id] ||= { name: users[l.user_id] || 'Unknown', requests: 0, tokens: 0 }
      byUser[l.user_id].requests += 1
      byUser[l.user_id].tokens += l.total_tokens || (l.prompt_tokens || 0) + (l.completion_tokens || 0)
    })
    const topUsers = Object.values(byUser).sort((a, b) => b.requests - a.requests).slice(0, 8)

    return { total, errors, totalTokens, avgLatency, estCost, series, modelRows, sourceRows, topUsers }
  }, [logs, users, range])

  if (!canView) {
    return (
      <div>
        <div className="page-header"><div><div className="page-title">LLM Usage Monitor</div><div className="page-subtitle">Restricted to Admin & CEO</div></div></div>
        <Empty icon={<Activity size={44} />} title="No access" desc="This page is limited to admin and CEO roles" />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">LLM Usage Monitor</div>
          <div className="page-subtitle">Every chatbot &amp; AI request — tokens consumed, latency, and failures</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Object.keys(RANGES).map(r => (
            <button key={r} className={`btn ${range === r ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRange(r)} style={{ padding: '7px 14px', fontSize: 12.5 }}>
              {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : '30 Days'}
            </button>
          ))}
          <button className="btn btn-outline" onClick={load} disabled={loading}>
            <RefreshCw size={14} style={{ marginRight: 6, animation: loading ? 'spin .7s linear infinite' : 'none' }} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading…</div>
      ) : logs.length === 0 ? (
        <Empty icon={<MessageSquare size={40} />} title="No AI requests yet" desc="Ask the chatbot or run Neo Task AI to start seeing usage here" />
      ) : (
        <>
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            <Kpi label="Total Requests" value={stats.total} color="#6366f1" icon={<MessageSquare size={18} />} />
            <Kpi label="Total Tokens" value={stats.totalTokens.toLocaleString('en-IN')} color="#0284c7" icon={<Coins size={18} />} />
            <Kpi label="Avg Latency" value={`${(stats.avgLatency / 1000).toFixed(1)}s`} color="#f59e0b" icon={<Timer size={18} />} />
            <Kpi label="Error Rate" value={stats.total ? `${Math.round((stats.errors / stats.total) * 100)}%` : '0%'} color={stats.errors ? '#ef4444' : '#10b981'} icon={<AlertTriangle size={18} />} sub={`${stats.errors} failed`} />
            <Kpi label="Est. Cost" value={`$${stats.estCost.toFixed(3)}`} color="#8b5cf6" icon={<DollarSign size={18} />} sub="Approximate, not billing-accurate" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))', gap: 20, marginBottom: 20 }}>
            <ChartCard title="📈 Requests Over Time">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={stats.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="requests" name="Requests" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="🪙 Tokens Consumed Over Time" sub="Prompt vs completion">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="promptTokens" name="Prompt" stackId="t" fill="#94a3b8" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="completionTokens" name="Completion" stackId="t" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 20, marginBottom: 20 }}>
            <ChartCard title="🤖 By Model">
              <ResponsiveContainer width="100%" height={Math.max(140, stats.modelRows.length * 42)}>
                <BarChart data={stats.modelRows} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="model" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [v.toLocaleString('en-IN'), n]} />
                  <Bar dataKey="tokens" name="Tokens" radius={[0, 6, 6, 0]}>
                    {stats.modelRows.map(r => <Cell key={r.model} fill={MODEL_COLORS[r.model] || '#94a3b8'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="📍 By Source">
              <ResponsiveContainer width="100%" height={Math.max(140, stats.sourceRows.length * 50)}>
                <BarChart data={stats.sourceRows} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="source" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="requests" name="Requests" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="👤 Top Users">
              {stats.topUsers.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No user-attributed requests</div> : (
                <ResponsiveContainer width="100%" height={Math.max(140, stats.topUsers.length * 32)}>
                  <BarChart data={stats.topUsers} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="requests" name="Requests" fill="#10b981" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="table-wrap hover-lift">
            <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>Recent Requests</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 760 }}>
                <thead><tr><th>Time</th><th>User</th><th>Source</th><th>Model</th><th>Tokens</th><th>Latency</th><th>Status</th><th>Question</th></tr></thead>
                <tbody>
                  {logs.slice(0, 200).map(l => (
                    <tr key={l.id} style={{ background: l.success === false ? 'rgba(239,68,68,.05)' : 'transparent' }}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>{new Date(l.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{users[l.user_id] || '—'}</td>
                      <td>{SOURCE_LABELS[l.source] || l.source || '—'}</td>
                      <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: `${MODEL_COLORS[l.model] || '#94a3b8'}18`, color: MODEL_COLORS[l.model] || '#64748b' }}>{l.model || '—'}</span></td>
                      <td>{(l.total_tokens || (l.prompt_tokens || 0) + (l.completion_tokens || 0)).toLocaleString('en-IN')}</td>
                      <td>{l.latency_ms != null ? `${(l.latency_ms / 1000).toFixed(1)}s` : '—'}</td>
                      <td>
                        {l.success === false
                          ? <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 11 }} title={l.error_message}>✕ Failed</span>
                          : <span style={{ color: '#10b981', fontWeight: 700, fontSize: 11 }}>✓ OK</span>}
                      </td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--ink-muted)' }} title={l.success === false ? l.error_message : l.question}>
                        {l.success === false ? l.error_message : l.question}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
