import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus, Ticket } from 'lucide-react-native';

import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { ithk, useItCategories, useItStats, useItTickets } from '@/hooks/it-helpdesk';
import { ensureSeed } from '@/lib/itHelpdesk';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';
import {
  IT_PRIORITY_COLOR, IT_STATUS_COLOR, IT_STATUS_LABEL, isOverdue,
  type ItStats, type ItTicket, type TicketScope,
} from '@/lib/itHelpdesk';
import { isItAgent } from '@/lib/roles';
import { Fonts, Radius, Spacing } from '@/constants/theme';

const AGENT_SCOPES: { v: TicketScope; label: string }[] = [
  { v: 'all', label: 'All' },
  { v: 'unassigned', label: 'Unassigned' },
  { v: 'assigned', label: 'Mine to work' },
  { v: 'mine', label: 'My requests' },
];

export default function ItHelpdeskHub() {
  const { blocked } = useFeatureGuard('it-helpdesk');
  const { profile } = useAuth();
  const t = useTheme();
  const router = useRouter();
  const agent = isItAgent(profile?.role);

  const [scope, setScope] = useState<TicketScope>(agent ? 'all' : 'mine');
  const ticketsQ = useItTickets(scope);
  const catsQ = useItCategories();
  const statsQ = useItStats();
  const qc = useQueryClient();

  // Self-heal per-org defaults (categories + SLA) — the RPC is a silent
  // no-op for non-admins, so it's safe to fire on every hub open.
  useEffect(() => {
    ensureSeed()
      .then(() => qc.invalidateQueries({ queryKey: ithk.categories() }))
      .catch(() => {});
  }, [qc]);

  if (blocked) return <Redirect href={'/discover' as Href} />;

  const catLabel = (k: string) => catsQ.data?.find((c) => c.key === k)?.label ?? k;
  const tickets = ticketsQ.data ?? [];

  return (
    <Screen onRefresh={ticketsQ.refetch} refreshing={ticketsQ.isRefetching}>
      <PageHeader
        title="IT Helpdesk"
        subtitle={agent ? 'Raise and work IT requests' : 'Hardware, software, access and network help'}
        right={
          <Pressable
            onPress={() => router.push('/feature/it-helpdesk/new' as Href)}
            style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Plus size={20} color="#fff" />
          </Pressable>
        }
      />

      {agent && statsQ.data ? <StatsStrip s={statsQ.data} /> : null}

      {agent ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {AGENT_SCOPES.map((s) => {
            const active = scope === s.v;
            return (
              <Pressable
                key={s.v}
                onPress={() => setScope(s.v)}
                style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: Radius.pill, backgroundColor: active ? t.accent : t.surfaceSoft, borderWidth: 1, borderColor: active ? t.accent : t.border }}
              >
                <Text style={{ color: active ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {ticketsQ.isLoading ? (
        <View style={{ gap: Spacing.md }}>
          {[76, 76, 76].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
        </View>
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Ticket color={t.accent} size={22} />}
            title="No tickets here"
            desc={agent ? 'Nothing matches this view yet.' : 'Raise a ticket when you need help from IT.'}
          />
        </Card>
      ) : (
        <View style={{ gap: Spacing.md }}>
          {tickets.map((tk) => (
            <TicketCard
              key={tk.id}
              tk={tk}
              agent={agent}
              category={catLabel(tk.category)}
              onPress={() => router.push(`/feature/it-helpdesk/${tk.id}` as Href)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function StatsStrip({ s }: { s: ItStats }) {
  const t = useTheme();
  const items: { label: string; value: string | number; color: string }[] = [
    { label: 'Open', value: s.open_count, color: '#0ea5e9' },
    { label: 'Unassigned', value: s.unassigned_count, color: t.warning },
    { label: 'SLA overdue', value: s.overdue_response + s.overdue_resolution, color: t.danger },
    { label: 'Resolved 7d', value: s.resolved_7d, color: t.success },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
      {items.map((it) => (
        <Card key={it.label} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 10 }}>
          <Text style={{ color: it.color, fontFamily: Fonts.bodyExtraBold, fontSize: 18 }}>{it.value}</Text>
          <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 }} numberOfLines={1}>{it.label}</Text>
        </Card>
      ))}
    </View>
  );
}

function TicketCard({ tk, agent, category, onPress }: { tk: ItTicket; agent: boolean; category: string; onPress: () => void }) {
  const t = useTheme();
  const closedOut = tk.status === 'resolved' || tk.status === 'closed';
  const overdue = !closedOut && (isOverdue(tk.first_response_due_at, !!tk.first_response_at) || isOverdue(tk.resolution_due_at, false));

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: IT_PRIORITY_COLOR[tk.priority] }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }} numberOfLines={1}>{tk.subject}</Text>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
              {tk.ticket_number} · {category}
              {agent ? ` · ${tk.requester?.full_name ?? 'Unknown'}` : ''}
              {tk.assignee?.full_name ? ` · ${tk.assignee.full_name}` : ' · Unassigned'}
            </Text>
          </View>
          {overdue ? <AlertTriangle size={15} color={t.danger} /> : null}
          <View style={{ backgroundColor: `${IT_STATUS_COLOR[tk.status]}22`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: IT_STATUS_COLOR[tk.status], fontFamily: Fonts.bodyBold, fontSize: 10.5 }}>{IT_STATUS_LABEL[tk.status]}</Text>
          </View>
          <ChevronRight size={16} color={t.textMuted} />
        </View>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5, marginTop: 8 }}>{dateFmt(tk.created_at)}</Text>
      </Card>
    </Pressable>
  );
}
