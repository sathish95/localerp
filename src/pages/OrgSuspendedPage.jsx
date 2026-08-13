import { useAuth } from '../context/AuthContext'
import { ShieldOff, LogOut } from 'lucide-react'

// Rendered by App.jsx's AppRoutes instead of <Layout> when the caller's
// own organization is suspended or soft-deleted (STEP108) — a platform
// super admin is never routed here (they need access regardless of any
// org's state to fix it from /super-admin).
export default function OrgSuspendedPage() {
  const { profile, signOut } = useAuth()
  const deleted = !!profile?.org?.deleted_at

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(239,68,68,.12)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
          <ShieldOff size={26} />
        </div>
        <h2 style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: 8 }}>
          {deleted ? 'This organization has been removed' : 'This organization is suspended'}
        </h2>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', marginBottom: 22 }}>
          {profile?.org?.name || 'Your organization'} no longer has access to this platform.
          {deleted ? ' If you believe this is a mistake, contact your platform administrator.' : ' Contact your platform administrator to restore access.'}
        </p>
        <button className="btn btn-primary" onClick={signOut} style={{ margin: '0 auto' }}>
          <LogOut size={15} /> Sign Out
        </button>
      </div>
    </div>
  )
}
