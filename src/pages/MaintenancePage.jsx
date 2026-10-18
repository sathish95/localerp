import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMaintenance } from '../context/MaintenanceContext'
import { Wrench, LogOut, RefreshCw } from 'lucide-react'

// Rendered by App.jsx's AppRoutes instead of <Layout> whenever platform-wide
// maintenance mode is on (STEP204) — admin/ceo and platform super admins are
// exempt (checked in App.jsx before this ever renders), everyone else gets
// this full-page block, no dismiss, until an exempt user turns it back off.
export default function MaintenancePage() {
  const { signOut } = useAuth()
  const { maintenanceMessage, maintenanceGifUrl, refresh } = useMaintenance()
  const [checking, setChecking] = useState(false)
  const [gifFailed, setGifFailed] = useState(false)

  async function handleCheckAgain() {
    setChecking(true)
    await refresh()
    setChecking(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        {maintenanceGifUrl && !gifFailed ? (
          <img src={maintenanceGifUrl} alt="" onError={() => setGifFailed(true)}
            style={{ maxWidth: 220, maxHeight: 220, borderRadius: 14, margin: '0 auto 18px', display: 'block' }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(99,102,241,.12)', color: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <Wrench size={26} />
          </div>
        )}
        <h2 style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: 8 }}>Down for maintenance</h2>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', marginBottom: 22 }}>
          {maintenanceMessage || 'This app is temporarily unavailable while we perform scheduled maintenance. Please check back shortly.'}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-outline" onClick={handleCheckAgain} disabled={checking}>
            <RefreshCw size={15} style={{ animation: checking ? 'spin .8s linear infinite' : 'none' }} /> {checking ? 'Checking…' : 'Check Again'}
          </button>
          <button className="btn btn-primary" onClick={signOut}>
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
