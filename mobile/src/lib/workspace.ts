import { supabase } from '@/lib/supabase';

// Industry-Adaptive Platform — mobile read-only port of src/lib/workspace.js's
// getWorkspaceProfile(). Mobile never writes a workspace_profiles row —
// configuring industry/business type/modules stays a web-only admin
// action (Settings → Workspace tab). No auto-create-on-missing fallback
// either: that's a defensive edge case the web lib guards (an org created
// between STEP180 running and the next org-seeding migration), and
// mobile doesn't need to duplicate a write path just for that.

export type WorkspaceProfile = {
  id: string;
  organization_id: string;
  industry_profile_id: string | null;
  business_type_id: string | null;
  is_legacy_default: boolean;
  enabled_module_keys: string[] | null;
  known_module_keys?: string[] | null;
  terminology_overrides: Record<string, string>;
  dashboard_widget_keys: string[] | null;
  industry_profile: { id: string; key: string; name: string; icon: string | null } | null;
  business_type: { id: string; key: string; name: string } | null;
};

// Mirror of src/lib/workspace.js isModuleInWorkspace(): a module the admin
// saw and unticked stays hidden; one added after the list was saved shows.
const ADDED_AFTER_LEGACY_LISTS = ['golive-support'];

export function isModuleInWorkspace(workspace: WorkspaceProfile | null | undefined, key: string): boolean {
  const enabled = workspace?.enabled_module_keys;
  if (!Array.isArray(enabled) || enabled.includes(key)) return true;
  const known = workspace?.known_module_keys;
  if (Array.isArray(known)) return !known.includes(key);
  return ADDED_AFTER_LEGACY_LISTS.includes(key);
}

export async function getWorkspaceProfile(organizationId: string | null | undefined): Promise<WorkspaceProfile | null> {
  if (!organizationId) return null;
  const { data, error } = await supabase
    .from('workspace_profiles')
    .select('*, industry_profile:industry_profiles(id,key,name,icon), business_type:business_types(id,key,name)')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as WorkspaceProfile) ?? null;
}
