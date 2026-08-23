import { useAuth } from '../context/AuthContext'
import { UserX, LogOut } from 'lucide-react'

// Rendered by App.jsx's AppRoutes instead of <Layout> when the caller's own
// profile has been deactivated (profiles.is_active === false) — a platform
// super admin is never routed here, mirroring OrgSuspendedPage.
export default function AccountDeactivatedPage() {
  const { profile, signOut } = useAuth()

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(239,68,68,.12)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
          <UserX size={26} />
        </div>
        <h2 style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: 8 }}>Your account has been deactivated</h2>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', marginBottom: 22 }}>
          {profile?.full_name || 'Your'} access to {profile?.org?.name || 'this organization'} has been disabled.
          Contact your organization admin to restore access.
        </p>
        <button className="btn btn-primary" onClick={signOut} style={{ margin: '0 auto' }}>
          <LogOut size={15} /> Sign Out
        </button>
      </div>
    </div>
  )
}
