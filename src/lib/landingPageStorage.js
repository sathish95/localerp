import { supabase } from './supabase'

// Mirrors src/pages/InvoicesPage.jsx's exact upload pattern (bucket
// 'invoices' there) against the new 'landing-assets' bucket instead
// (STEP80) — public=true, since these images render on the
// unauthenticated /l/:slug page.
export async function uploadLandingAsset(file) {
  const path = `landing-assets/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const { error } = await supabase.storage.from('landing-assets').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('landing-assets').getPublicUrl(path)
  return data?.publicUrl
}
