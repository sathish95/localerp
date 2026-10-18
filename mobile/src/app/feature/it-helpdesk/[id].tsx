import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { AlertTriangle, Check, Lock, Send, Ticket, X } from 'lucide-react-native';

import { Button, Card, EmptyState, PageHeader, Screen, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import {
  useItAgents, useItCategories, useItMessages, useItTicket, useItTicketActions, usePostItMessage,
} from '@/hooks/it-helpdesk';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';
import {
  IT_PRIORITIES, IT_PRIORITY_COLOR, IT_STATUS_COLOR, IT_STATUS_LABEL, IT_STATUSES, isOverdue,
  type ItPriority, type ItStatus,
} from '@/lib/itHelpdesk';
import { isItAgent } from '@/lib/roles';
import { Fonts, Radius, Spacing } from '@/constants/theme';

function msgTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ItTicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { blocked } = useFeatureGuard('it-helpdesk');
  const { profile } = useAuth();
  const t = useTheme();
  const agent = isItAgent(profile?.role);

  const ticketQ = useItTicket(id);
  const msgsQ = useItMessages(id);
  const catsQ = useItCategories();
  const agentsQ = useItAgents();
  const post = usePostItMessage(id);
  const actions = useItTicketActions(id);

  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  if (blocked) return <Redirect href={'/discover' as Href} />;

  const ticket = ticketQ.data;
  if (ticketQ.isLoading) return <Screen scroll={false}><View /></Screen>;
  if (!ticket) {
    return (
      <Screen scroll={false}>
        <PageHeader title="Ticket" />
        <EmptyState icon={<Ticket color={t.textMuted} size={22} />} title="Ticket not found" desc="It may have been removed, or you don't have access." />
      </Screen>
    );
  }

  const catLabel = catsQ.data?.find((c) => c.key === ticket.category)?.label ?? ticket.category;
  const closedOut = ticket.status === 'resolved' || ticket.status === 'closed';
  const responseOverdue = !closedOut && isOverdue(ticket.first_response_due_at, !!ticket.first_response_at);
  const resolutionOverdue = !closedOut && isOverdue(ticket.resolution_due_at, false);
  const messages = msgsQ.data ?? [];

  async function sendReply() {
    if (!reply.trim()) return;
    try {
      await post.mutateAsync({ body: reply.trim(), isInternal: internal });
      setReply('');
      setInternal(false);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <Screen onRefresh={() => { ticketQ.refetch(); msgsQ.refetch(); }} refreshing={ticketQ.isRefetching || msgsQ.isRefetching}>
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.ticket_number} · ${catLabel} · ${ticket.priority.toUpperCase()}`}
        right={
          <View style={{ backgroundColor: `${IT_STATUS_COLOR[ticket.status]}22`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: IT_STATUS_COLOR[ticket.status], fontFamily: Fonts.bodyBold, fontSize: 11 }}>{IT_STATUS_LABEL[ticket.status]}</Text>
          </View>
        }
      />

      {responseOverdue || resolutionOverdue ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fee2e2', borderRadius: Radius.md, padding: 12 }}>
          <AlertTriangle size={15} color="#dc2626" />
          <Text style={{ color: '#b91c1c', fontFamily: Fonts.bodySemiBold, fontSize: 12.5, flex: 1 }}>
            {resolutionOverdue ? 'Resolution' : 'First response'} SLA overdue — target was{' '}
            {dateFmt(resolutionOverdue ? ticket.resolution_due_at : ticket.first_response_due_at)}.
          </Text>
        </View>
      ) : null}

      <Card>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          Description · by {ticket.requester?.full_name ?? 'Unknown'}
        </Text>
        <Text style={{ color: t.text, fontFamily: Fonts.body, fontSize: 13.5, lineHeight: 20 }}>{ticket.description}</Text>
      </Card>

      {agent ? (
        <Card style={{ gap: 14 }}>
          <ChipRow<ItStatus>
            label="Status"
            options={IT_STATUSES}
            value={ticket.status}
            getLabel={(s) => IT_STATUS_LABEL[s]}
            getColor={(s) => IT_STATUS_COLOR[s]}
            onChange={(s) => actions.setStatus.mutate(s)}
          />
          <ChipRow<ItPriority>
            label="Priority"
            options={IT_PRIORITIES}
            value={ticket.priority}
            getLabel={(p) => p}
            getColor={(p) => IT_PRIORITY_COLOR[p]}
            onChange={(p) => actions.setPriority.mutate(p)}
          />
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>Assigned to</Text>
            <Pressable
              onPress={() => setAssignOpen(true)}
              style={{ borderWidth: 1.5, borderColor: t.border, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: t.surfaceSoft }}
            >
              <Text style={{ color: ticket.assignee ? t.text : t.textMuted, fontFamily: Fonts.bodyMedium, fontSize: 14 }}>
                {ticket.assignee?.full_name ?? 'Unassigned — tap to assign'}
              </Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: Spacing.sm }}>
        {messages.map((m) => (
          <Card key={m.id} style={m.is_internal ? { backgroundColor: '#fffbeb', borderColor: '#fde68a' } : undefined}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 12.5 }}>{m.author?.full_name ?? 'Unknown'}</Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5 }}>{msgTime(m.created_at)}</Text>
            </View>
            {m.is_internal ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 }}>
                <Lock size={9} color="#b45309" />
                <Text style={{ color: '#b45309', fontFamily: Fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.4 }}>INTERNAL NOTE</Text>
              </View>
            ) : null}
            <Text style={{ color: t.text, fontFamily: Fonts.body, fontSize: 13, lineHeight: 19 }}>{m.body}</Text>
          </Card>
        ))}
        {messages.length === 0 ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, textAlign: 'center' }}>No replies yet</Text> : null}
      </View>

      {!closedOut || agent ? (
        <Card>
          <TextField
            placeholder={internal ? 'Internal note — not shown to the requester' : 'Add a reply'}
            value={reply}
            onChangeText={setReply}
            multiline
            style={{ minHeight: 60 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            {agent ? (
              <Pressable onPress={() => setInternal((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: internal ? t.accent : t.border, backgroundColor: internal ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {internal ? <Check size={12} color="#fff" /> : null}
                </View>
                <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>Internal note</Text>
              </Pressable>
            ) : <View />}
            <Button title={internal ? 'Add Note' : 'Reply'} icon={<Send size={14} color="#fff" />} onPress={sendReply} loading={post.isPending} disabled={post.isPending || !reply.trim()} />
          </View>
        </Card>
      ) : null}

      {/* Assignee picker */}
      <Modal visible={assignOpen} transparent animationType="fade" onRequestClose={() => setAssignOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setAssignOpen(false)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>Assign ticket</Text>
              <Pressable onPress={() => setAssignOpen(false)}><X size={20} color={t.textMuted} /></Pressable>
            </View>
            <PickerRow label="Unassigned" active={!ticket.assigned_to} onPress={() => { actions.assign.mutate(null); setAssignOpen(false); }} />
            {(agentsQ.data ?? []).map((a) => (
              <PickerRow key={a.id} label={a.full_name} active={ticket.assigned_to === a.id} onPress={() => { actions.assign.mutate(a.id); setAssignOpen(false); }} />
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function ChipRow<T extends string>({ label, options, value, getLabel, getColor, onChange }: {
  label: string; options: readonly T[]; value: T; getLabel: (v: T) => string; getColor: (v: T) => string; onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => {
          const active = value === o;
          const c = getColor(o);
          return (
            <Pressable
              key={o}
              onPress={() => onChange(o)}
              style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: Radius.pill, backgroundColor: active ? c : t.surfaceSoft, borderWidth: 1, borderColor: active ? c : t.border }}
            >
              <Text style={{ color: active ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 11.5, textTransform: 'capitalize' }}>{getLabel(o)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PickerRow({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 14, borderRadius: Radius.md, backgroundColor: active ? t.surfaceTint : 'transparent' }}
    >
      <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 14.5 }}>{label}</Text>
      {active ? <Check size={16} color={t.accent} /> : null}
    </Pressable>
  );
}
