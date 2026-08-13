import { supabase } from './supabase'

// In-app payment gateway credential management (STEP132) — write-only,
// same posture as the Turnstile secret (STEP75): a value can be SET via
// set_payment_gateway_secret() but there is no way to read it back
// through this client or any query path. getStatus() only ever reports
// WHETHER a key is set and when, never the value itself.

export async function getSecretStatus() {
  const { data, error } = await supabase.rpc('payment_gateway_secret_status')
  if (error) throw error
  return data || [] // [{ provider, key_name, updated_at }]
}

export async function setSecret(provider, keyName, value) {
  const { error } = await supabase.rpc('set_payment_gateway_secret', { p_provider: provider, p_key_name: keyName, p_value: value })
  if (error) throw error
}
