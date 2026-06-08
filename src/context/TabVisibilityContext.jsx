// Admin-controlled tab visibility per role
// Stored in Supabase app_settings table OR localStorage as fallback
import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const SETTING_KEY = 'tab_visibility_config'

export const DEFAULT_TABS = {
  admin:    { timesheet:true, content:true,  leave:true, resources:true, dashboard:true, expenses:true, travel:true, approvals:true, vendors:true, projects:true, tasks:true, budget:true, assets:true, procurement:true, invoices:true, fundflow:true, pos:true, grn:true, users:true, reports:true, settings:true },
  ceo:      { leave:true, resources:true, dashboard:true, expenses:true, travel:true, approvals:true, vendors:true, projects:true, tasks:true, budget:true, assets:true, procurement:true, invoices:true, fundflow:true, pos:true, grn:true, users:true, reports:true, settings:true },
  manager:  { leave:true, resources:true, dashboard:true, expenses:true, travel:true, approvals:true, vendors:true, projects:true, tasks:true, budget:true, assets:true, procurement:true, invoices:true, fundflow:false, pos:true, grn:true, users:true, reports:true, settings:false },
  finance:  { leave:true, resources:true, dashboard:true, expenses:true, travel:true, approvals:false, vendors:true, projects:true, tasks:true, budget:true, assets:true, procurement:false, invoices:true, fundflow:true, pos:true, grn:true, users:true, reports:true, settings:false },
  hr:       { leave:true, resources:true, dashboard:true, expenses:true, travel:true, approvals:true, vendors:false, projects:true, tasks:true, budget:true, assets:true, procurement:false, invoices:false, fundflow:false, pos:false, grn:false, users:true, reports:true, settings:false },
  employee: { leave:true, resources:true, dashboard:true, expenses:true, travel:true, approvals:false, vendors:false, projects:true, tasks:true, budget:false, assets:true, procurement:false, invoices:false, fundflow:false, pos:false, grn:false, users:false, reports:true, settings:false },
}

const Ctx = createContext(null)

export function TabVisibilityProvider({ children }) {
  const { profile } = useAuth()
  const [config, setConfig] = useState(DEFAULT_TABS)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadConfig() }, [profile?.id])

  async function loadConfig() {
    // Try to load from localStorage first (fast)
    try {
      const local = localStorage.getItem(SETTING_KEY)
      if (local) { setConfig(JSON.parse(local)); setLoading(false); return }
    } catch {}
    setConfig(DEFAULT_TABS)
    setLoading(false)
  }

  function saveConfig(newConfig) {
    setConfig(newConfig)
    try { localStorage.setItem(SETTING_KEY, JSON.stringify(newConfig)) } catch {}
  }

  function isTabVisible(tab) {
    const role = profile?.role || 'employee'
    // Admin/CEO always see everything
    if (role === 'admin' || role === 'ceo') return true
    return config[role]?.[tab] !== false
  }

  return (
    <Ctx.Provider value={{ config, saveConfig, isTabVisible, loading }}>
      {children}
    </Ctx.Provider>
  )
}

export const useTabVisibility = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTabVisibility outside provider')
  return c
}
