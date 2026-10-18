import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import {
  linkTaskEquipment, linkTaskMaterial, listAssetsForPicker, listProductsForPicker,
  listTaskEquipment, listTaskMaterials, unlinkTaskEquipment, unlinkTaskMaterial,
  updateTaskMaterialUsage,
} from '@/lib/resourceLinks';

export const rlhk = {
  equipment: (taskId: string) => ['resource-links', 'equipment', taskId] as const,
  materials: (taskId: string) => ['resource-links', 'materials', taskId] as const,
  assetPicker: () => ['resource-links', 'asset-picker'] as const,
  productPicker: () => ['resource-links', 'product-picker'] as const,
};

export function useTaskEquipment(taskId: string | undefined) {
  return useQuery({ queryKey: rlhk.equipment(taskId ?? ''), queryFn: () => listTaskEquipment(taskId!), enabled: !!taskId });
}

export function useTaskMaterials(taskId: string | undefined) {
  return useQuery({ queryKey: rlhk.materials(taskId ?? ''), queryFn: () => listTaskMaterials(taskId!), enabled: !!taskId });
}

export function useAssetsPicker() {
  return useQuery({ queryKey: rlhk.assetPicker(), queryFn: listAssetsForPicker, staleTime: 5 * 60_000 });
}

export function useProductsPicker() {
  return useQuery({ queryKey: rlhk.productPicker(), queryFn: listProductsForPicker, staleTime: 5 * 60_000 });
}

export function useLinkTaskEquipment(taskId: string) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => linkTaskEquipment(taskId, assetId, profile?.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: rlhk.equipment(taskId) }),
  });
}

export function useUnlinkTaskEquipment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlinkTaskEquipment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: rlhk.equipment(taskId) }),
  });
}

export function useLinkTaskMaterial(taskId: string) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, quantityRequired }: { productId: string; quantityRequired?: number | null }) =>
      linkTaskMaterial(taskId, productId, quantityRequired, profile?.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: rlhk.materials(taskId) }),
  });
}

export function useUpdateTaskMaterialUsage(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, quantityUsed }: { id: string; quantityUsed: number }) => updateTaskMaterialUsage(id, quantityUsed),
    onSuccess: () => qc.invalidateQueries({ queryKey: rlhk.materials(taskId) }),
  });
}

export function useUnlinkTaskMaterial(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlinkTaskMaterial(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: rlhk.materials(taskId) }),
  });
}
