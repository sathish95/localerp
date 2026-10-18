import { supabase } from './supabase'

// Industry-Adaptive Platform — Phase 9 (Resource Modules, reframed).
// Links project_tasks to the ALREADY-EXISTING assets/products modules —
// see sql/STEP186_resource_linking.sql's header for why no new
// equipment/materials domain tables were created.

export async function listTaskEquipment(taskId) {
  const { data, error } = await supabase
    .from('task_equipment')
    .select('*, asset:assets(id,asset_code,name,category,status)')
    .eq('task_id', taskId)
    .order('assigned_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function linkTaskEquipment(taskId, assetId, assignedBy) {
  const { error } = await supabase.from('task_equipment').insert({
    task_id: taskId, asset_id: assetId, assigned_by: assignedBy || null,
  })
  if (error) throw error
}

export async function returnTaskEquipment(id) {
  const { error } = await supabase.from('task_equipment').update({ returned_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function unlinkTaskEquipment(id) {
  const { error } = await supabase.from('task_equipment').delete().eq('id', id)
  if (error) throw error
}

export async function listTaskMaterials(taskId) {
  const { data, error } = await supabase
    .from('task_materials')
    .select('*, product:products(id,part_number,name,device_type)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function linkTaskMaterial(taskId, productId, quantityRequired, addedBy) {
  const { error } = await supabase.from('task_materials').insert({
    task_id: taskId, product_id: productId,
    quantity_required: quantityRequired || null, added_by: addedBy || null,
  })
  if (error) throw error
}

export async function updateTaskMaterialUsage(id, quantityUsed) {
  const { error } = await supabase.from('task_materials').update({
    quantity_used: quantityUsed, updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}

export async function unlinkTaskMaterial(id) {
  const { error } = await supabase.from('task_materials').delete().eq('id', id)
  if (error) throw error
}
