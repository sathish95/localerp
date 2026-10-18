import { supabase } from '@/lib/supabase';

// Mobile port of the web src/lib/resourceLinks.js (Industry-Adaptive
// Platform Phase 9 — Resource Modules, reframed as linking tables, not
// new domain tables — see sql/STEP186_resource_linking.sql's header).
// Unlike work_items.ts's soft refs, task_equipment.asset_id and
// task_materials.product_id got REAL foreign keys added in
// sql/STEP188_workspace_resource_foreign_keys.sql specifically so
// PostgREST embed syntax works here — safe to use `select('*, x(y)')`,
// matching the web version exactly. RLS scopes both tables via their
// parent task's organization, so no manual org filter is needed here
// either (same trust-RLS convention this app's other lib files already
// follow — confirmed via requests.ts/tasks.ts, neither of which filters
// by organization_id manually).

export type TaskEquipmentLink = {
  id: string;
  task_id: string;
  asset_id: string;
  assigned_at: string;
  returned_at: string | null;
  asset: { id: string; asset_code: string; name: string; category: string | null; status: string | null } | null;
};

export type TaskMaterialLink = {
  id: string;
  task_id: string;
  product_id: string;
  quantity_required: number | null;
  quantity_used: number | null;
  product: { id: string; part_number: string; name: string; device_type: string | null } | null;
};

export type AssetPickerRow = { id: string; name: string; asset_code: string; status: string | null };
export type ProductPickerRow = { id: string; name: string; part_number: string };

export async function listTaskEquipment(taskId: string): Promise<TaskEquipmentLink[]> {
  const { data, error } = await supabase
    .from('task_equipment')
    .select('*, asset:assets(id,asset_code,name,category,status)')
    .eq('task_id', taskId)
    .order('assigned_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TaskEquipmentLink[];
}

export async function linkTaskEquipment(taskId: string, assetId: string, assignedBy?: string | null) {
  const { error } = await supabase.from('task_equipment').insert({
    task_id: taskId, asset_id: assetId, assigned_by: assignedBy || null,
  });
  if (error) throw error;
}

export async function unlinkTaskEquipment(id: string) {
  const { error } = await supabase.from('task_equipment').delete().eq('id', id);
  if (error) throw error;
}

export async function listTaskMaterials(taskId: string): Promise<TaskMaterialLink[]> {
  const { data, error } = await supabase
    .from('task_materials')
    .select('*, product:products(id,part_number,name,device_type)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TaskMaterialLink[];
}

export async function linkTaskMaterial(taskId: string, productId: string, quantityRequired?: number | null, addedBy?: string | null) {
  const { error } = await supabase.from('task_materials').insert({
    task_id: taskId, product_id: productId,
    quantity_required: quantityRequired ?? null, added_by: addedBy || null,
  });
  if (error) throw error;
}

export async function updateTaskMaterialUsage(id: string, quantityUsed: number) {
  const { error } = await supabase.from('task_materials').update({
    quantity_used: quantityUsed, updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

export async function unlinkTaskMaterial(id: string) {
  const { error } = await supabase.from('task_materials').delete().eq('id', id);
  if (error) throw error;
}

// Picker lookups — mobile has no Assets/Inventory screens to pick from
// (unlike web), so these are new, small, unfiltered-by-status lists.
export async function listAssetsForPicker(): Promise<AssetPickerRow[]> {
  const { data, error } = await supabase.from('assets').select('id,name,asset_code,status').order('name');
  if (error) throw error;
  return (data ?? []) as AssetPickerRow[];
}

export async function listProductsForPicker(): Promise<ProductPickerRow[]> {
  const { data, error } = await supabase.from('products').select('id,name,part_number').order('name');
  if (error) throw error;
  return (data ?? []) as ProductPickerRow[];
}
