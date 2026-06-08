import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function useProjects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('projects')
      .select('id, name, code, budget, spent, status').order('name')
    setProjects(data || [])
    setLoading(false)
  }

  function getRemaining(projectId) {
    const p = projects.find(x => x.id === projectId)
    return p ? (p.budget || 0) - (p.spent || 0) : null
  }

  async function deductBudget(projectId, amount) {
    if (!projectId || !amount) return
    const p = projects.find(x => x.id === projectId)
    if (!p) return
    await supabase.from('projects').update({ spent: (p.spent || 0) + amount }).eq('id', projectId)
    await load()
  }

  return { projects, loading, getRemaining, deductBudget, reload: load }
}

// ProjectSelect — never shows budget/cost to anyone; clean name-only dropdown
export function ProjectSelect({ value, onChange, projects, required = false }) {
  return (
    <div>
      <select className="form-select" value={value} onChange={e => onChange(e.target.value)} required={required}
        style={{ borderColor: required && !value ? '#ef4444' : undefined }}>
        <option value="">— Select Project{required ? ' *' : ''}</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
        ))}
      </select>
      {required && !value && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Project selection is required</div>
      )}
    </div>
  )
}
