import { supabase } from './supabase'

// Invite codes an org's admin/ceo generates from Settings -> Organization
// so a teammate can join their specific org at signup (STEP105). RLS scopes
// everything to the caller's own org (or lets a platform super admin read
// across orgs) — no organization_id filter needed client-side.

export async function listInvites() {
  const { data, error } = await supabase.from('organization_invites').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createInvite({ role = 'employee', maxUses = 1, expiresDays = 7, organizationId, createdBy }) {
  const payload = {
    role,
    max_uses: maxUses || null,
    expires_at: expiresDays ? new Date(Date.now() + expiresDays * 86400000).toISOString() : null,
    organization_id: organizationId,
    created_by: createdBy,
  }
  const { data, error } = await supabase.from('organization_invites').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function revokeInvite(id) {
  const { error } = await supabase.from('organization_invites').update({ revoked: true }).eq('id', id)
  if (error) throw error
}

// Anonymous, pre-signup check — shows "You're joining <Org Name>" or a
// clear reason it won't work, before auth.signUp() ever creates a user.
export async function previewInviteCode(code) {
  const { data, error } = await supabase.rpc('preview_invite_code', { p_code: code })
  if (error) throw error
  return data?.[0] || { valid: false, reason: 'Invite code not found' }
}
