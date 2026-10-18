import { useState, useEffect } from 'react'
import { Modal, Alert } from '../ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function MyProfileModal({ open, onClose }) {
  const { profile, refreshProfile } = useAuth()

  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)
  const [infoMsg, setInfoMsg] = useState(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)
  const [pwdMsg, setPwdMsg] = useState(null)

  useEffect(() => {
    if (open) {
      setName(profile?.full_name || '')
      setPhone(profile?.phone || '')
      setInfoMsg(null)
      setNewPassword('')
      setConfirmPassword('')
      setPwdMsg(null)
    }
  }, [open, profile])

  async function saveInfo() {
    if (!name.trim()) { setInfoMsg({ type: 'error', message: 'Name is required.' }); return }
    setSavingInfo(true); setInfoMsg(null)
    try {
      const { error } = await supabase.from('profiles')
        .update({ full_name: name.trim(), phone: phone.trim() || null })
        .eq('id', profile.id)
      if (error) throw error
      await refreshProfile()
      setInfoMsg({ type: 'success', message: 'Profile updated.' })
    } catch (e) {
      setInfoMsg({ type: 'error', message: e.message })
    } finally {
      setSavingInfo(false)
    }
  }

  async function updatePassword() {
    if (newPassword.length < 6) { setPwdMsg({ type: 'error', message: 'Password must be at least 6 characters.' }); return }
    if (newPassword !== confirmPassword) { setPwdMsg({ type: 'error', message: 'Passwords do not match.' }); return }
    setSavingPwd(true); setPwdMsg(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword(''); setConfirmPassword('')
      setPwdMsg({ type: 'success', message: 'Password updated.' })
    } catch (e) {
      setPwdMsg({ type: 'error', message: e.message })
    } finally {
      setSavingPwd(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="My Profile">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--ink-soft)' }}>Profile Details</div>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" value={profile?.email || ''} readOnly disabled />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional" />
          </div>
          {infoMsg && <Alert type={infoMsg.type} message={infoMsg.message} />}
          <button className="btn btn-primary" onClick={saveInfo} disabled={savingInfo} style={{ marginTop: 6 }}>
            {savingInfo ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--ink-soft)' }}>Change Password</div>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input type="password" className="form-input" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input type="password" className="form-input" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          {pwdMsg && <Alert type={pwdMsg.type} message={pwdMsg.message} />}
          <button className="btn btn-primary" onClick={updatePassword} disabled={savingPwd} style={{ marginTop: 6 }}>
            {savingPwd ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
