import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Search, Check, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { Stepper } from '../components/ui'
import { updateOrgProfile } from '../lib/onboarding'
import {
  listIndustryProfiles, listBusinessTypes, listOperatingModels,
  updateWorkspaceProfile, setWorkspaceOperatingModels,
} from '../lib/workspace'
import { MODULES } from '../config/modules'
import { recommendModuleKeys } from '../lib/workspaceRecommendation'

const STEPS = ['Organization', 'Industry', 'Business Type', 'How You Work', 'Recommended Workspace', 'Customize']

const COUNTRIES = ['India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Singapore', 'Australia', 'Canada', 'Other']
const CURRENCIES = ['INR', 'USD', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'EUR']
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+']

// Renders a lucide-react icon by its string name (industry_profiles.icon,
// business_types have none). Falls back to Sparkles for anything
// unmapped, e.g. an admin-added industry with no icon set yet.
function DynamicIcon({ name, ...props }) {
  const Cmp = (name && Icons[name]) || Sparkles
  return <Cmp {...props} />
}

export default function WorkspaceOnboardingPage() {
  const { profile, refreshProfile } = useAuth()
  const { workspace, refresh: refreshWorkspace } = useWorkspace()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1 — org profile (company name already captured at signup)
  const [country, setCountry] = useState('')
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || '')
  const [currency, setCurrency] = useState('INR')
  const [companySize, setCompanySize] = useState('')

  // Step 2/3 — industry + business type
  const [industries, setIndustries] = useState([])
  const [industrySearch, setIndustrySearch] = useState('')
  const [industryId, setIndustryId] = useState(null)
  const [businessTypes, setBusinessTypes] = useState([])
  const [businessTypeId, setBusinessTypeId] = useState(null)
  const [otherBusinessType, setOtherBusinessType] = useState('')

  // Step 4 — operating models (multi-select)
  const [operatingModels, setOperatingModels] = useState([])
  const [selectedModelIds, setSelectedModelIds] = useState([])

  // Step 5/6 — module selection
  const [enabledKeys, setEnabledKeys] = useState(new Set())

  useEffect(() => {
    listIndustryProfiles().then(setIndustries).catch(() => setIndustries([]))
    listOperatingModels().then(setOperatingModels).catch(() => setOperatingModels([]))
  }, [])

  useEffect(() => {
    if (!industryId) { setBusinessTypes([]); return }
    listBusinessTypes(industryId).then(setBusinessTypes).catch(() => setBusinessTypes([]))
    setBusinessTypeId(null)
  }, [industryId])

  // Compute the recommended set the moment we reach step 4 (or whenever
  // the underlying selections change before the admin has hand-edited it).
  const industryKey = industries.find(i => i.id === industryId)?.key
  const selectedModelKeys = operatingModels.filter(m => selectedModelIds.includes(m.id)).map(m => m.key)
  const recommended = useMemo(() => recommendModuleKeys(industryKey, selectedModelKeys), [industryKey, selectedModelKeys])

  function goToRecommendation() {
    setEnabledKeys(new Set(recommended))
    setStep(4)
  }

  function toggleModel(id) {
    setSelectedModelIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  function toggleModule(key) {
    setEnabledKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  async function handleSkip() {
    // Skipping still must leave the org fully functional — same
    // behavior as any legacy org: no module override at all (defer
    // entirely to the existing modules/module_role_visibility system),
    // just marked as onboarded so this wizard never shows again.
    setSaving(true)
    try {
      await updateWorkspaceProfile(workspace.id, {
        enabled_module_keys: null,
        needs_onboarding: false,
        onboarding_completed_at: new Date().toISOString(),
      })
      await refreshWorkspace()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleLaunch() {
    setSaving(true)
    setError('')
    try {
      const industry = industries.find(i => i.id === industryId)
      await updateOrgProfile({
        country: country || null,
        timezone: timezone || null,
        currency: currency || null,
        companySize: companySize || null,
        // Keeps the pre-existing org-setup checklist (src/lib/onboarding.js,
        // /onboarding route) coherent — its "Organization Profile" step
        // already checks org.industry && org.country.
        industry: industry?.name || null,
      })
      await updateWorkspaceProfile(workspace.id, {
        industry_profile_id: industryId || null,
        business_type_id: businessTypeId || null,
        enabled_module_keys: Array.from(enabledKeys),
        known_module_keys: MODULES.map(m => m.key),
        is_legacy_default: false,
        needs_onboarding: false,
        onboarding_completed_at: new Date().toISOString(),
      })
      await setWorkspaceOperatingModels(workspace.id, selectedModelIds)
      await Promise.all([refreshWorkspace(), refreshProfile?.()])
      navigate('/', { replace: true })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const filteredIndustries = industrySearch.trim()
    ? industries.filter(i => i.name.toLowerCase().includes(industrySearch.trim().toLowerCase()))
    : industries

  const modulesBySection = useMemo(() => {
    const map = new Map()
    for (const m of MODULES) {
      if (!map.has(m.section)) map.set(m.section, [])
      map.get(m.section).push(m)
    }
    return map
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f8fafc)', padding: '40px 20px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 800, marginBottom: 6 }}>
            Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''} 👋
          </div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 14 }}>Let's set up a workspace that fits how {profile?.org?.name || 'your company'} actually works.</div>
        </div>

        <div className="card" style={{ padding: 28 }}>
          <Stepper steps={STEPS} activeIndex={step} />

          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

          {/* Step 0 — Organization */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4, display: 'block' }}>Country</label>
                <select className="form-select" value={country} onChange={e => setCountry(e.target.value)}>
                  <option value="">Select country</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4, display: 'block' }}>Timezone</label>
                <input className="form-input" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="e.g. Asia/Kolkata" />
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4, display: 'block' }}>Currency</label>
                <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4, display: 'block' }}>Company Size</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {COMPANY_SIZES.map(s => (
                    <button key={s} type="button" className={`btn btn-sm ${companySize === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCompanySize(s)}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 1 — Industry */}
          {step === 1 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 18 }}>
                <Search size={15} style={{ color: 'var(--ink-muted)' }} />
                <input value={industrySearch} onChange={e => setIndustrySearch(e.target.value)} placeholder="Search industries…"
                  style={{ border: 'none', outline: 'none', flex: 1, font: 'inherit', fontSize: 13.5 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {filteredIndustries.map(ind => {
                  const selected = industryId === ind.id
                  return (
                    <button key={ind.id} type="button" onClick={() => setIndustryId(ind.id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 12px',
                        borderRadius: 12, border: selected ? '2px solid var(--c1)' : '1.5px solid var(--border)',
                        background: selected ? 'var(--c1)11' : 'var(--surface)', cursor: 'pointer',
                      }}>
                      <DynamicIcon name={ind.icon} size={26} color={selected ? 'var(--c1)' : 'var(--ink-muted)'} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, textAlign: 'center' }}>{ind.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 2 — Business Type */}
          {step === 2 && (
            <div>
              {businessTypes.length === 0 ? (
                <div>
                  <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 10 }}>
                    No preset business types yet for this industry — describe yours:
                  </div>
                  <input className="form-input" value={otherBusinessType} onChange={e => setOtherBusinessType(e.target.value)} placeholder="e.g. Boutique consulting firm" />
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                  {businessTypes.map(bt => {
                    const selected = businessTypeId === bt.id
                    return (
                      <button key={bt.id} type="button" onClick={() => setBusinessTypeId(bt.id)}
                        style={{
                          padding: '14px 12px', borderRadius: 10, textAlign: 'left',
                          border: selected ? '2px solid var(--c1)' : '1.5px solid var(--border)',
                          background: selected ? 'var(--c1)11' : 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        }}>
                        {bt.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step 3 — Operating Model (multi-select) */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 14 }}>How does your organization primarily work? Select all that apply.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {operatingModels.map(m => {
                  const selected = selectedModelIds.includes(m.id)
                  return (
                    <button key={m.id} type="button" onClick={() => toggleModel(m.id)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 12px', borderRadius: 10, textAlign: 'left',
                        border: selected ? '2px solid var(--c1)' : '1.5px solid var(--border)',
                        background: selected ? 'var(--c1)11' : 'var(--surface)', cursor: 'pointer',
                      }}>
                      <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1, border: selected ? 'none' : '1.5px solid var(--border)', background: selected ? 'var(--c1)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {selected && <Check size={12} color="#fff" />}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>{m.description}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 4 — Recommended Workspace preview */}
          {step === 4 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 14 }}>
                Based on your selections, here's what we recommend. You can fine-tune everything on the next step.
              </div>
              {[...modulesBySection.entries()].map(([section, mods]) => {
                const visible = mods.filter(m => enabledKeys.has(m.key))
                if (!visible.length) return null
                return (
                  <div key={section} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 6 }}>{section}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {visible.map(m => (
                        <span key={m.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '5px 10px', borderRadius: 999 }}>
                          <Check size={11} /> {m.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Step 5 — Customize (all modules, toggle any) */}
          {step === 5 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 14 }}>
                Toggle anything on or off — you can always change this later from Settings → Roles & Modules.
              </div>
              {[...modulesBySection.entries()].map(([section, mods]) => (
                <div key={section} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 8 }}>{section}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                    {mods.map(m => {
                      const on = enabledKeys.has(m.key)
                      return (
                        <button key={m.key} type="button" onClick={() => toggleModule(m.key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 9, textAlign: 'left',
                            border: on ? '1.5px solid var(--c1)' : '1.5px solid var(--border)',
                            background: on ? 'var(--c1)0d' : 'var(--surface)', cursor: 'pointer', fontSize: 12.5,
                          }}>
                          <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: on ? 'none' : '1.5px solid var(--border)', background: on ? 'var(--c1)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {on && <Check size={10} color="#fff" />}
                          </div>
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div>
              {step > 0 && (
                <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)} disabled={saving}>
                  <ArrowLeft size={14} /> Back
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {step > 0 && step < 5 && (
                <button className="btn btn-ghost" onClick={handleSkip} disabled={saving}>Skip for now</button>
              )}
              {step < 3 && (
                <button className="btn btn-primary" onClick={() => setStep(s => s + 1)} disabled={step === 1 && !industryId}>
                  Next <ArrowRight size={14} />
                </button>
              )}
              {step === 3 && (
                <button className="btn btn-primary" onClick={goToRecommendation}>
                  See Recommendation <ArrowRight size={14} />
                </button>
              )}
              {step === 4 && (
                <button className="btn btn-primary" onClick={() => setStep(5)}>
                  Customize <ArrowRight size={14} />
                </button>
              )}
              {step === 5 && (
                <button className="btn btn-primary" onClick={handleLaunch} disabled={saving}>
                  {saving ? 'Launching…' : 'Launch Workspace'} <Sparkles size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
