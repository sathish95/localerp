import { useState, useEffect } from 'react'
import { supabase, rupee } from '../../lib/supabase'
import { Stat, StatRow, BarRow, EmptyState, Loading } from './widgetUi'

export function ResourceUtilizationWidget({ projectId, periodStart, periodEnd }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: logs }, { data: rates }] = await Promise.all([
        supabase.from('time_logs').select('employee_id,hours_worked,work_date,employee:profiles!employee_id(full_name)')
          .eq('project_id', projectId).gte('work_date', periodStart).lte('work_date', periodEnd),
        supabase.from('resource_rates').select('employee_id,hourly_rate,monthly_salary'),
      ])
      if (cancelled) return
      const byEmp = {}
      ;(logs || []).forEach(l => {
        const key = l.employee_id
        byEmp[key] = byEmp[key] || { name: l.employee?.full_name || 'Unknown', hours: 0 }
        byEmp[key].hours += l.hours_worked || 0
      })
      const rateMap = {}
      ;(rates || []).forEach(r => { rateMap[r.employee_id] = r.hourly_rate || (r.monthly_salary ? r.monthly_salary / (22 * 8) : 0) })
      const list = Object.entries(byEmp).map(([id, v]) => ({ id, ...v, cost: v.hours * (rateMap[id] || 0) })).sort((a, b) => b.hours - a.hours)
      setRows(list)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [projectId, periodStart, periodEnd])

  if (loading) return <Loading />
  if (rows.length === 0) return <EmptyState icon="👥" text="No hours logged in this period" />

  const totalHours = rows.reduce((s, r) => s + r.hours, 0)
  const totalCost = rows.reduce((s, r) => s + r.cost, 0)
  const maxHrs = Math.max(...rows.map(r => r.hours), 1)

  return (
    <div>
      <StatRow>
        <Stat label="Total Hours" value={`${Math.round(totalHours)}h`} color="#0891b2" />
        <Stat label="Est. Cost" value={rupee(totalCost)} color="#e11d48" />
        <Stat label="Contributors" value={rows.length} color="#6366f1" />
      </StatRow>
      {rows.slice(0, 8).map(r => <BarRow key={r.id} label={r.name} value={Math.round(r.hours)} max={maxHrs} color="#0891b2" fmt={v => `${v}h`} />)}
    </div>
  )
}

export function TeamHoursSummaryWidget({ projectId, periodStart, periodEnd }) {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.from('time_logs').select('hours_worked,work_date').eq('project_id', projectId)
      .gte('work_date', periodStart).lte('work_date', periodEnd)
      .then(({ data }) => { if (!cancelled) { setLogs(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId, periodStart, periodEnd])

  if (loading) return <Loading />
  if (logs.length === 0) return <EmptyState icon="⏱" text="No hours logged in this period" />

  const total = logs.reduce((s, l) => s + (l.hours_worked || 0), 0)
  // Bucket into weeks within the period
  const start = new Date(periodStart)
  const weeks = []
  let cursor = new Date(start)
  while (cursor <= new Date(periodEnd)) {
    const weekStart = new Date(cursor)
    const weekEnd = new Date(cursor); weekEnd.setDate(weekEnd.getDate() + 6)
    const hrs = logs.filter(l => { const d = new Date(l.work_date); return d >= weekStart && d <= weekEnd }).reduce((s, l) => s + (l.hours_worked || 0), 0)
    weeks.push({ label: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`, hrs: Math.round(hrs) })
    cursor.setDate(cursor.getDate() + 7)
  }
  const maxHrs = Math.max(...weeks.map(w => w.hrs), 1)

  return (
    <div>
      <StatRow><Stat label="Total Hours" value={`${Math.round(total)}h`} color="#0891b2" /></StatRow>
      {weeks.map(w => <BarRow key={w.label} label={`Week of ${w.label}`} value={w.hrs} max={maxHrs} color="#0891b2" fmt={v => `${v}h`} />)}
    </div>
  )
}
