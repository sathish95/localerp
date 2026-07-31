import { supabase } from './supabase'

export const ASSET_TYPES = ['Brochure', 'Case Study', 'Product One-Pager', 'Video', 'Presentation Template']

export async function listContentAssets({ assetType, tag } = {}) {
  let q = supabase.from('marketing_content_assets').select('*').order('updated_at', { ascending: false })
  if (assetType) q = q.eq('asset_type', assetType)
  if (tag) q = q.contains('tags', [tag])
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createContentAsset(form, userId) {
  const { data, error } = await supabase.from('marketing_content_assets').insert({
    asset_name: form.asset_name, asset_type: form.asset_type, file_reference: form.file_reference || null,
    linked_product_id: form.linked_product_id || null, tags: form.tags || [], created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateContentAsset(id, patch) {
  const { error } = await supabase.from('marketing_content_assets').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteContentAsset(id) {
  const { error } = await supabase.from('marketing_content_assets').delete().eq('id', id)
  if (error) throw error
}
