import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Lock, Plus, X } from 'lucide-react-native';

import { Button } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useWikiRestrictionActions, useWikiRestrictions } from '@/hooks/wiki';

const ROLES = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'hr', 'employee'];

export function PageRestrictionsSection({ pageId }: { pageId: string }) {
  const t = useTheme();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const restrictionsQ = useWikiRestrictions(pageId);
  const { add, remove } = useWikiRestrictionActions(pageId);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);

  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [subjectType, setSubjectType] = useState<'user' | 'role'>('user');
  const [subjectId, setSubjectId] = useState('');

  useEffect(() => {
    if (open) supabase.from('profiles').select('id,full_name').order('full_name').then(({ data }) => setUsers(data ?? []));
  }, [open]);

  const rows = restrictionsQ.data ?? [];

  function nameFor(row: { subject_type: string; subject_id: string }) {
    if (row.subject_type === 'role') return row.subject_id.replace(/_/g, ' ');
    return users.find(u => u.id === row.subject_id)?.full_name ?? 'Unknown user';
  }

  async function handleAdd() {
    if (!subjectId || !profile) return;
    await add.mutateAsync({ subjectType, subjectId, permission });
    setSubjectId('');
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)}><Lock size={16} color={t.textMuted} /></Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 60 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, marginBottom: Spacing.md }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 20 }}>Restrict Access</Text>
            <Pressable onPress={() => setOpen(false)}><X size={22} color={t.textMuted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.xl, gap: 14 }}>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18 }}>
              With no restrictions, this page follows the space's normal access. Add a restriction to limit who can view or edit it — admins/CEO and the page's creator always keep access.
            </Text>

            {rows.map(r => (
              <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.surfaceSoft, borderRadius: Radius.md, padding: 10 }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 12.5, flex: 1 }}>
                  <Text style={{ fontFamily: Fonts.bodyBold, textTransform: 'capitalize' }}>{r.permission}</Text> — {nameFor(r)} ({r.subject_type})
                </Text>
                <Pressable onPress={() => remove.mutate(r.id)}><X size={14} color={t.danger} /></Pressable>
              </View>
            ))}

            <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>Permission</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['view', 'edit'] as const).map(p => (
                <Pressable key={p} onPress={() => setPermission(p)} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: permission === p ? t.accent : t.surfaceSoft }}>
                  <Text style={{ color: permission === p ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12, textTransform: 'capitalize' }}>{p}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>Restrict to</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['user', 'role'] as const).map(s => (
                <Pressable key={s} onPress={() => { setSubjectType(s); setSubjectId(''); }} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: subjectType === s ? t.accent : t.surfaceSoft }}>
                  <Text style={{ color: subjectType === s ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12, textTransform: 'capitalize' }}>{s}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(subjectType === 'user' ? users : ROLES.map(r => ({ id: r, full_name: r.replace(/_/g, ' ') }))).map(opt => (
                <Pressable key={opt.id} onPress={() => setSubjectId(opt.id)}
                  style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill, borderWidth: 1.5, borderColor: subjectId === opt.id ? t.accent : t.border, backgroundColor: subjectId === opt.id ? `${t.accent}22` : 'transparent' }}>
                  <Text style={{ color: subjectId === opt.id ? t.accent : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12, textTransform: 'capitalize' }}>{opt.full_name}</Text>
                </Pressable>
              ))}
            </View>

            <Button title="Add Restriction" icon={<Plus size={14} color="#fff" />} onPress={handleAdd} loading={add.isPending} disabled={!subjectId} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
