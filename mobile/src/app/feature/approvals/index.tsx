import { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Redirect, type Href } from 'expo-router';
import { CheckCircle2, Inbox, Plane, Receipt, X } from 'lucide-react-native';

import { Button, Card, EmptyState, PageHeader, Screen, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApplyApproval, useApprovalItems } from '@/hooks/approvals';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt, rupee } from '@/lib/supabase';
import type { ApprovalItem } from '@/lib/approvals';
import { isManager } from '@/lib/roles';
import { Fonts, Radius, Spacing } from '@/constants/theme';

type Tab = 'mine' | 'flight' | 'decided';
const TABS: { v: Tab; label: string }[] = [
  { v: 'mine', label: 'Waiting on me' },
  { v: 'flight', label: 'In flight' },
  { v: 'decided', label: 'Decided' },
];

const STATUS_COLOR: Record<string, string> = {
  submitted: '#b45309', manager_review: '#1d4ed8', ceo_review: '#dc2626', finance_review: '#065f46',
  approved: '#15803d', rejected: '#dc2626', closed: '#475569', cancelled: '#475569', draft: '#475569',
};

export default function ApprovalsHub() {
  const { blocked } = useFeatureGuard('approvals');
  const { profile } = useAuth();
  const t = useTheme();
  const itemsQ = useApprovalItems();
  const [tab, setTab] = useState<Tab>('mine');
  const [active, setActive] = useState<ApprovalItem | null>(null);

  const all = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);
  const buckets = useMemo(() => ({
    mine: all.filter((i) => i.canAct && !i.decided),
    flight: all.filter((i) => !i.canAct && !i.decided),
    decided: all.filter((i) => i.decided),
  }), [all]);

  if (blocked || !isManager(profile?.role)) return <Redirect href={'/discover' as Href} />;

  const shown = buckets[tab];

  return (
    <Screen onRefresh={itemsQ.refetch} refreshing={itemsQ.isRefetching}>
      <PageHeader
        title="Approvals"
        subtitle="Expense & travel requests"
        right={<Inbox color={t.accent} size={22} />}
      />

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {TABS.map((x) => {
          const on = tab === x.v;
          const count = buckets[x.v].length;
          return (
            <Pressable
              key={x.v}
              onPress={() => setTab(x.v)}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Radius.md, backgroundColor: on ? t.accent : t.surfaceSoft, borderWidth: 1, borderColor: on ? t.accent : t.border }}
            >
              <Text style={{ color: on ? '#fff' : t.textSoft, fontFamily: Fonts.bodyBold, fontSize: 11.5 }}>{x.label}</Text>
              <Text style={{ color: on ? 'rgba(255,255,255,0.85)' : t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 10, marginTop: 1 }}>{count}</Text>
            </Pressable>
          );
        })}
      </View>

      {itemsQ.isLoading ? (
        <View style={{ gap: Spacing.md }}>
          {[80, 80, 80].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
        </View>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 color={t.success} size={22} />}
            title={tab === 'mine' ? 'Nothing waiting on you' : tab === 'flight' ? 'Nothing in flight' : 'No decisions yet'}
            desc={tab === 'mine' ? "You're all caught up." : undefined}
          />
        </Card>
      ) : (
        <View style={{ gap: Spacing.md }}>
          {shown.map((it) => (
            <Pressable key={`${it.type}-${it.id}`} onPress={() => setActive(it)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  {it.type === 'expense' ? <Receipt size={16} color={t.textMuted} /> : <Plane size={16} color={t.textMuted} />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }} numberOfLines={1}>{it.title}</Text>
                    <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
                      {it.requesterName}{it.department ? ` · ${it.department}` : ''} · {it.subtitle}
                    </Text>
                  </View>
                  {it.amount != null ? <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 14 }}>{rupee(it.amount)}</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <View style={{ backgroundColor: `${STATUS_COLOR[it.status] ?? '#475569'}22`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: STATUS_COLOR[it.status] ?? '#475569', fontFamily: Fonts.bodyBold, fontSize: 10.5 }}>{it.statusLabel}</Text>
                  </View>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11 }}>{dateFmt(it.date)}</Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      <ReviewSheet item={active} onClose={() => setActive(null)} />
    </Screen>
  );
}

function ReviewSheet({ item, onClose }: { item: ApprovalItem | null; onClose: () => void }) {
  const t = useTheme();
  const apply = useApplyApproval();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'approve' | 'reject') {
    if (!item) return;
    if (action === 'reject' && !note.trim()) { setError('Add a reason before rejecting.'); return; }
    setError(null);
    try {
      await apply.mutateAsync({ item, action, note: note.trim() });
      setNote('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: Spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16, flex: 1 }} numberOfLines={1}>{item?.title}</Text>
            <Pressable onPress={onClose}><X size={20} color={t.textMuted} /></Pressable>
          </View>

          {item ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>
                {item.requesterName}{item.department ? ` · ${item.department}` : ''}
              </Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>{item.subtitle} · {dateFmt(item.date)}</Text>
              {item.amount != null ? (
                <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 20, marginTop: 4 }}>{rupee(item.amount)}</Text>
              ) : null}
              <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12, marginTop: 4 }}>Currently: {item.statusLabel}</Text>
            </View>
          ) : null}

          <TextField
            label="Note"
            placeholder="Optional for approve, required for reject"
            value={note}
            onChangeText={setNote}
            multiline
            style={{ minHeight: 56 }}
          />

          {error ? <Text style={{ color: t.danger, fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Reject" variant="danger" onPress={() => act('reject')} loading={apply.isPending} disabled={apply.isPending} style={{ flex: 1 }} />
            <Button title="Approve" onPress={() => act('approve')} loading={apply.isPending} disabled={apply.isPending} style={{ flex: 1 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
