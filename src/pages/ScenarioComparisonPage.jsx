import { useState, useEffect } from 'react'
import { supabase, rupee } from '../lib/supabase'
import { compareVersions, saveComparison, listSavedComparisons, deleteSavedComparison } from '../lib/scenarioComparison'
import { Alert, StatusBadge, SearchBox, Badge } from '../components/ui'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { X, Trophy, Save, Trash2 } from 'lucide-react'

const COLORS = ['#6366f1', '#0ea5e9', '#f59e0b', '#ec4899', '#10b981']

export default function ScenarioComparisonPage() {
  const [q, setQ] = useState('')
  const [candidates, setCandidates] = useState([])
  const [selected, setSelected] = useState([])
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [saveName, setSaveName] = useState('')
  const [saved, setSaved] = useState([])

  useEffect(() => {
    listSavedComparisons().then(setSaved).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    supabase.from('scenario_versions')
      .select('id, version_number, status, scenario:scenarios(name, code)')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { if (alive) setCandidates(data || []) })
    return () => { alive = false }
  }, [])

  const filteredCandidates = candidates.filter(c =>
    !selected.some(s => s.id === c.id) &&
    (!q || c.scenario?.name?.toLowerCase().includes(q.toLowerCase()))
  )

  function addCandidate(c) {
    if (selected.length >= 5) return
    setSelected(s => [...s, c])
  }
  function removeCandidate(id) {
    setSelected(s => s.filter(c => c.id !== id))
    setRows(null)
  }

  async function handleCompare() {
    if (selected.length < 2) { setErr('Select at least 2 scenario versions to compare.'); return }
    setLoading(true); setErr('')
    try { setRows(await compareVersions(selected.map(s => s.id))) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function handleSave() {
    if (!saveName.trim()) return
    try { await saveComparison(saveName, selected.map(s => s.id)); setSaveName(''); setSaved(await listSavedComparisons()) }
    catch (e) { setErr(e.message) }
  }

  async function handleLoadSaved(c) {
    setErr('')
    try {
      const { data } = await supabase.from('scenario_versions').select('id, version_number, status, scenario:scenarios(name, code)').in('id', c.version_ids)
      setSelected(data || [])
      setRows(await compareVersions(c.version_ids))
    } catch (e) { setErr(e.message) }
  }

  const chartData = rows?.map(r => ({
    name: `${r.scenario_name} v${r.version_number}`,
    cost: r.projected_cost, revenue: r.projected_revenue, roi: r.projected_roi_percent, risk: r.risk_score,
  })) || []

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Scenario Comparison</div>
          <div className="page-subtitle">Compare 2–5 scenario versions side by side</div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {selected.map((s, i) => (
            <span key={s.id} className="badge" style={{ display: 'flex', alignItems: 'center', gap: 6, background: `${COLORS[i]}15`, color: COLORS[i] }}>
              {s.scenario?.name} v{s.version_number}
              <X size={12} style={{ cursor: 'pointer' }} onClick={() => removeCandidate(s.id)} />
            </span>
          ))}
          {selected.length === 0 && <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No versions selected yet</span>}
        </div>
        {selected.length < 5 && (
          <div style={{ maxWidth: 400, marginBottom: 10 }}>
            <SearchBox value={q} onChange={setQ} placeholder="Search scenarios to add…" />
          </div>
        )}
        {q && filteredCandidates.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', marginBottom: 10 }}>
            {filteredCandidates.slice(0, 10).map(c => (
              <button key={c.id} className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => { addCandidate(c); setQ('') }}>
                {c.scenario?.name} v{c.version_number} <StatusBadge status={c.status} />
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-primary" disabled={selected.length < 2 || loading} onClick={handleCompare}>{loading ? 'Comparing…' : 'Compare'}</button>
      </div>

      {rows && (
        <div>
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Scenario</th><th>Status</th><th>Cost</th><th>Revenue</th><th>Margin</th><th>ROI %</th><th>Headcount</th><th>Timeline</th><th>Risk</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.version_id} style={r.is_recommended ? { background: 'rgba(16,185,129,0.08)' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{r.scenario_name} v{r.version_number}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{rupee(r.projected_cost)}</td>
                    <td>{rupee(r.projected_revenue)}</td>
                    <td>{rupee(r.projected_margin)}</td>
                    <td>{Number(r.projected_roi_percent).toFixed(1)}%</td>
                    <td>{Number(r.capacity_headcount).toFixed(0)}</td>
                    <td>{Number(r.timeline_days).toFixed(0)}d</td>
                    <td>{Number(r.risk_score).toFixed(1)}</td>
                    <td>{r.is_recommended && <Badge type="success"><Trophy size={11} style={{ marginRight: 3, verticalAlign: -1 }} />Recommended</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ padding: 18, marginBottom: 24 }}>
            <h3 style={{ fontWeight: 800, marginBottom: 12 }}>Cost vs Revenue</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => rupee(v)} />
                <Legend />
                <Bar dataKey="cost" fill="#dc2626" name="Cost" />
                <Bar dataKey="revenue" fill="#10b981" name="Revenue" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="form-input" style={{ maxWidth: 260 }} value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Name this comparison to save it" />
            <button className="btn btn-ghost" disabled={!saveName.trim()} onClick={handleSave}><Save size={14} /> Save</button>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontWeight: 800, marginBottom: 10 }}>Saved Comparisons</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {saved.map(c => (
              <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                <span style={{ flex: 1, cursor: 'pointer', fontWeight: 600 }} onClick={() => handleLoadSaved(c)}>{c.name}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{c.version_ids.length} versions</span>
                <button className="btn btn-ghost btn-sm" onClick={async () => { await deleteSavedComparison(c.id); setSaved(await listSavedComparisons()) }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
