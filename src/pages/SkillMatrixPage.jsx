import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { Modal, Loader, Empty, SearchBox } from '../components/ui'
import ExcelImport from '../components/ui/ExcelImport'
import { GraduationCap, Plus, Edit2, CheckCircle2, BadgeCheck, ShieldCheck, Upload } from 'lucide-react'

const PROFICIENCY_LEVELS = ['Beginner', 'Intermediate', 'Expert', 'Master']
const PL_COLOR = { Beginner: '#64748b', Intermediate: '#1d4ed8', Expert: '#7c3aed', Master: '#059669' }

const initForm = () => ({ skill_id: '', proficiency_level: 'Beginner', years_experience: '', certified: false })

export default function SkillMatrixPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canBulkImport = ['admin', 'ceo', 'hr'].includes(role)
  const [tab, setTab] = useState('my')
  const [skills, setSkills] = useState([])
  const [mySkills, setMySkills] = useState([])
  const [subordinates, setSubordinates] = useState([])
  const [pending, setPending] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)

  const hasDirectReports = subordinates.length > 0

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    setLoading(true)
    const [skR, myR, subR] = await Promise.all([
      supabase.from('skills').select('*').order('category').order('skill_name'),
      supabase.from('employee_skills').select('*,skill:skills(skill_name,category),endorser:profiles!endorsed_by(full_name)').eq('employee_id', profile.id).order('last_updated', { ascending: false }),
      supabase.from('profiles').select('id,full_name').eq('reporting_manager_id', profile.id),
    ])
    setSkills(skR.data || [])
    setMySkills(myR.data || [])
    const subs = subR.data || []
    setSubordinates(subs)
    if (subs.length > 0) {
      const { data: pend } = await supabase.from('employee_skills')
        .select('*,skill:skills(skill_name,category),employee:profiles!employee_id(full_name)')
        .in('employee_id', subs.map(s => s.id)).is('endorsed_by', null)
      setPending(pend || [])
    } else setPending([])
    if (canBulkImport) {
      const { data: u } = await supabase.from('profiles').select('id,email,full_name')
      setAllUsers(u || [])
    }
    setLoading(false)
  }

  async function saveSkill(e) {
    e.preventDefault()
    if (!form.skill_id || !form.proficiency_level) return
    setSubmitting(true)
    try {
      const payload = {
        employee_id: profile.id, skill_id: form.skill_id, proficiency_level: form.proficiency_level,
        years_experience: parseFloat(form.years_experience) || 0, certified: form.certified,
        last_updated: new Date().toISOString(), endorsed_by: null, endorsed_at: null,
      }
      const { error } = await supabase.from('employee_skills').upsert(payload, { onConflict: 'employee_id,skill_id' })
      if (error) throw error
      setShowModal(false); setForm(initForm()); setEditing(null); load()
    } catch (e) { alert(e.message) } finally { setSubmitting(false) }
  }

  async function endorse(row, adjustedLevel) {
    await supabase.from('employee_skills').update({
      endorsed_by: profile.id, endorsed_at: new Date().toISOString(),
      proficiency_level: adjustedLevel || row.proficiency_level,
    }).eq('id', row.id)
    load()
  }

  const categories = [...new Set(skills.map(s => s.category).filter(Boolean))]
  const filteredSkills = skills.filter(s => !search || s.skill_name.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Skill Matrix</div>
          <div className="page-subtitle">Self-service skill profile & manager endorsements</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canBulkImport && (
            <button className="btn btn-outline" onClick={() => setShowImport(true)}>
              <Upload size={14} /> Import Skills
            </button>
          )}
          {tab === 'my' && (
            <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(initForm()); setShowModal(true) }}>
              <Plus size={15} /> Add Skill
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'my', label: 'My Skills' },
          ...(hasDirectReports ? [{ id: 'endorsements', label: `Endorsements (${pending.length})` }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '10px 16px', border: 'none', borderBottom: `2px solid ${tab === t.id ? 'var(--c1)' : 'transparent'}`, background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: tab === t.id ? 'var(--c1)' : 'var(--text-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'my' && (
        mySkills.length === 0 ? (
          <Empty icon={<GraduationCap size={44} />} title="No skills added yet" desc="Add your first skill to build your profile" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            {mySkills.map(row => {
              const c = PL_COLOR[row.proficiency_level] || '#6366f1'
              return (
                <div key={row.id} style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderTop: `3px solid ${c}`, borderRadius: 14, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{row.skill?.skill_name}</div>
                      {row.skill?.category && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{row.skill.category}</div>}
                    </div>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setEditing(row); setForm({ skill_id: row.skill_id, proficiency_level: row.proficiency_level, years_experience: row.years_experience || '', certified: row.certified }); setShowModal(true) }}><Edit2 size={12} /></button>
                  </div>
                  <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${c}15`, color: c, marginBottom: 8 }}>{row.proficiency_level}</span>
                  <div style={{ fontSize: 11.5, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {row.years_experience > 0 && <span>{row.years_experience} yrs experience</span>}
                    {row.certified && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#059669', fontWeight: 600 }}><BadgeCheck size={13} /> Certified</span>}
                    {row.endorsed_by ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#15803d', fontWeight: 600 }}><ShieldCheck size={13} /> Endorsed by {row.endorser?.full_name || 'manager'}</span>
                    ) : (
                      <span style={{ color: '#b45309', fontWeight: 600 }}>Pending endorsement</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'endorsements' && (
        pending.length === 0 ? (
          <Empty icon={<ShieldCheck size={44} />} title="Nothing to endorse" desc="No pending skill claims from your direct reports" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
            {pending.map(row => <PendingSkillCard key={row.id} row={row} onEndorse={endorse} />)}
          </div>
        )
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Skill' : 'Add Skill'} size="md"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveSkill} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button></>}>
        {!editing && (
          <div className="form-group">
            <label className="form-label">Search Skill</label>
            <SearchBox value={search} onChange={setSearch} placeholder="Filter skills…" />
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Skill *</label>
          <select className="form-select" value={form.skill_id} onChange={e => setForm(f => ({ ...f, skill_id: e.target.value }))} disabled={!!editing}>
            <option value="">Select a skill…</option>
            {categories.map(cat => (
              <optgroup key={cat} label={cat}>
                {filteredSkills.filter(s => s.category === cat).map(s => <option key={s.id} value={s.id}>{s.skill_name}</option>)}
              </optgroup>
            ))}
            {filteredSkills.filter(s => !s.category).map(s => <option key={s.id} value={s.id}>{s.skill_name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Proficiency *</label>
            <select className="form-select" value={form.proficiency_level} onChange={e => setForm(f => ({ ...f, proficiency_level: e.target.value }))}>
              {PROFICIENCY_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Years of Experience</label>
            <input className="form-input" type="number" min={0} step={0.5} value={form.years_experience} onChange={e => setForm(f => ({ ...f, years_experience: e.target.value }))} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={form.certified} onChange={e => setForm(f => ({ ...f, certified: e.target.checked }))} />
          Certified in this skill
        </label>
        {editing?.endorsed_by && <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 10 }}>Saving changes will reset this skill's endorsement — it will need manager re-approval.</div>}
      </Modal>

      {canBulkImport && (
        <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Employee Skills" size="xl">
          <ExcelImport type="employee_skills" lookups={{ users: allUsers, skills }}
            onSuccess={() => { load() }} onClose={() => setShowImport(false)} />
        </Modal>
      )}
    </div>
  )
}

function PendingSkillCard({ row, onEndorse }) {
  const [level, setLevel] = useState(row.proficiency_level)
  return (
    <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{row.employee?.full_name}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{row.skill?.skill_name} {row.skill?.category && <span style={{ color: '#94a3b8' }}>· {row.skill.category}</span>}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
        Claimed: <strong style={{ color: PL_COLOR[row.proficiency_level] }}>{row.proficiency_level}</strong>
        {row.years_experience > 0 && ` · ${row.years_experience} yrs`}
        {row.certified && ' · Certified'}
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Confirm / Adjust Proficiency</label>
        <select className="form-select" value={level} onChange={e => setLevel(e.target.value)}>
          {PROFICIENCY_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <button className="btn btn-primary btn-sm" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }} onClick={() => onEndorse(row, level)}>
        <CheckCircle2 size={13} /> Endorse
      </button>
    </div>
  )
}
