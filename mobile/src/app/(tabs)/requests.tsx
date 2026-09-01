import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { Calendar, Camera, Image as ImageIcon, Plane, Plus, Receipt, X } from 'lucide-react-native';

import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt, rupee } from '@/lib/supabase';
import {
  createExpense, createTravel, EXPENSE_CATEGORIES, listMyExpenses, listMyTravel, listProjects, STATUS_COLOR, STATUS_LABEL,
  TRAVEL_MODES, type ExpenseRequest, type Project, type TravelRequest,
} from '@/lib/requests';

type RequestType = 'expense' | 'travel';

export default function RequestsScreen() {
  const { profile } = useAuth();
  const t = useTheme();
  const [type, setType] = useState<RequestType>('expense');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseRequest[]>([]);
  const [travel, setTravel] = useState<TravelRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showTravelForm, setShowTravelForm] = useState(false);

  async function load() {
    if (!profile?.id) return;
    try {
      const [e, tr, p] = await Promise.all([listMyExpenses(profile.id), listMyTravel(profile.id), listProjects()]);
      setExpenses(e); setTravel(tr); setProjects(p);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the user changes
  useEffect(() => { load(); }, [profile?.id]);

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  if (loading) return <Screen scroll={false}><View /></Screen>;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ScreenHeader
        title="Requests"
        subtitle="Expenses & travel"
        right={
          <Pressable onPress={() => (type === 'expense' ? setShowExpenseForm(true) : setShowTravelForm(true))}
            style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={20} color="#fff" />
          </Pressable>
        }
      />

      <View style={{ flexDirection: 'row', gap: 2, backgroundColor: t.surfaceSoft, borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 4 }}>
        {(['expense', 'travel'] as const).map((k) => {
          const active = type === k;
          return (
            <Pressable key={k} onPress={() => setType(k)}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: active ? t.surface : 'transparent', ...(active ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 } : {}) }}>
              <Text style={{ color: active ? t.accent : t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{k === 'expense' ? 'Expenses' : 'Travel'}</Text>
            </Pressable>
          );
        })}
      </View>

      {type === 'expense' ? (
        expenses.length === 0 ? (
          <Card><EmptyState icon={<Receipt color={t.accent} size={22} />} title="No expenses yet" desc="Submit your first expense request." /></Card>
        ) : (
          <View style={{ gap: Spacing.md }}>
            {expenses.map((e) => (
              <Card key={e.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }} numberOfLines={1}>{e.title}</Text>
                    <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }}>{e.category} · {e.expense_number}</Text>
                  </View>
                  <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 15 }}>{rupee(e.total_amount)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <Badge label={STATUS_LABEL[e.status]} color={STATUS_COLOR[e.status]} />
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>{dateFmt(e.expense_date)}</Text>
                </View>
              </Card>
            ))}
          </View>
        )
      ) : travel.length === 0 ? (
        <Card><EmptyState icon={<Plane color={t.accent} size={22} />} title="No travel requests yet" desc="Submit your first travel request." /></Card>
      ) : (
        <View style={{ gap: Spacing.md }}>
          {travel.map((tr) => (
            <Card key={tr.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }} numberOfLines={1}>{tr.from_location} → {tr.to_location}</Text>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }}>{tr.travel_mode} · {tr.request_number}</Text>
                </View>
                {tr.estimated_cost != null && <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 15 }}>{rupee(tr.estimated_cost)}</Text>}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <Badge label={STATUS_LABEL[tr.status]} color={STATUS_COLOR[tr.status]} />
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>{dateFmt(tr.travel_date)}</Text>
              </View>
            </Card>
          ))}
        </View>
      )}

      <ExpenseFormModal visible={showExpenseForm} onClose={() => setShowExpenseForm(false)} projects={projects} onSaved={load} />
      <TravelFormModal visible={showTravelForm} onClose={() => setShowTravelForm(false)} projects={projects} onSaved={load} />
    </Screen>
  );
}

/* ── shared bits ── */

function ChipPicker<T extends string>({ options, value, onChange, getLabel }: { options: readonly T[]; value: T | null; onChange: (v: T) => void; getLabel?: (v: T) => string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const isSel = value === opt;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)}
            style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: Radius.pill, backgroundColor: isSel ? t.accent : t.surfaceSoft, borderWidth: 1, borderColor: isSel ? t.accent : t.border }}>
            <Text style={{ color: isSel ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{getLabel ? getLabel(opt) : opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DateField({ label, value, onChange, minimumDate }: { label: string; value: string; onChange: (v: string) => void; minimumDate?: Date }) {
  const t = useTheme();
  const [show, setShow] = useState(false);
  const dateVal = value ? new Date(value) : new Date();

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>{label}</Text>
      <Pressable onPress={() => setShow(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surfaceSoft, borderWidth: 1.5, borderColor: t.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 13 }}>
        <Calendar size={16} color={t.textMuted} />
        <Text style={{ color: value ? t.text : t.textMuted, fontFamily: Fonts.body, fontSize: 15 }}>{value ? dateFmt(value) : 'Select date'}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={dateVal}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={minimumDate}
          onChange={(_, d) => { setShow(false); if (d) onChange(d.toISOString().split('T')[0]); }}
        />
      )}
    </View>
  );
}

function FormModal({ visible, title, onClose, children, onSubmit, submitting, submitLabel }: {
  visible: boolean; title: string; onClose: () => void; children: React.ReactNode;
  onSubmit: () => void; submitting: boolean; submitLabel: string;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, marginBottom: Spacing.md }}>
          <Text style={{ color: t.text, fontFamily: Fonts.display, fontSize: 22 }}>{title}</Text>
          <Pressable onPress={onClose}><X size={22} color={t.textMuted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.lg }}>
          {children}
        </ScrollView>
        <View style={{ padding: Spacing.lg, borderTopWidth: 1, borderTopColor: t.border }}>
          <Button title={submitLabel} onPress={onSubmit} loading={submitting} disabled={submitting} />
        </View>
      </View>
    </Modal>
  );
}

/* ── Expense form ── */

function ExpenseFormModal({ visible, onClose, projects, onSaved }: { visible: boolean; onClose: () => void; projects: Project[]; onSaved: () => void }) {
  const { profile } = useAuth();
  const t = useTheme();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<(typeof EXPENSE_CATEGORIES)[number] | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle(''); setCategory(null); setDescription(''); setAmount('');
    setDate(new Date().toISOString().split('T')[0]); setProjectId(null); setReceiptUri(null); setError(null);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled) setReceiptUri(result.assets[0].uri);
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!result.canceled) setReceiptUri(result.assets[0].uri);
  }

  async function submit() {
    if (!profile) return;
    if (!title.trim() || !category || !amount || Number(amount) <= 0) { setError('Title, category and a valid amount are required.'); return; }
    setSubmitting(true); setError(null);
    try {
      await createExpense(profile.id, { title: title.trim(), category, description, date, amount, projectId }, receiptUri, projects);
      reset(); onClose(); onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormModal visible={visible} title="New Expense" onClose={() => { onClose(); }} onSubmit={submit} submitting={submitting} submitLabel="Submit Expense">
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Client dinner" />
      <View style={{ gap: 6 }}>
        <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Category</Text>
        <ChipPicker options={EXPENSE_CATEGORIES} value={category} onChange={setCategory} />
      </View>
      <TextField label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      <DateField label="Expense date" value={date} onChange={setDate} />
      {projects.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Project (optional)</Text>
          <ChipPicker options={projects.map((p) => p.id)} value={projectId} onChange={(id) => setProjectId(id === projectId ? null : id)} getLabel={(id) => projects.find((p) => p.id === id)?.name ?? id} />
        </View>
      )}
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} multiline style={{ minHeight: 60 }} />

      <View style={{ gap: 8 }}>
        <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Receipt (optional)</Text>
        {receiptUri ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surfaceTint, borderRadius: Radius.md, padding: 10 }}>
            <Receipt size={16} color={t.accent} />
            <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 12.5, flex: 1 }}>Receipt attached</Text>
            <Pressable onPress={() => setReceiptUri(null)}><X size={16} color={t.textMuted} /></Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={takePhoto} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surfaceSoft }}>
              <Camera size={15} color={t.textSoft} /><Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Camera</Text>
            </Pressable>
            <Pressable onPress={pickPhoto} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surfaceSoft }}>
              <ImageIcon size={15} color={t.textSoft} /><Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Gallery</Text>
            </Pressable>
          </View>
        )}
      </View>

      {error ? <Text style={{ color: '#dc2626', fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
    </FormModal>
  );
}

/* ── Travel form ── */

function TravelFormModal({ visible, onClose, projects, onSaved }: { visible: boolean; onClose: () => void; projects: Project[]; onSaved: () => void }) {
  const { profile } = useAuth();
  const t = useTheme();
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [travelDate, setTravelDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [mode, setMode] = useState<(typeof TRAVEL_MODES)[number]>('Flight');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFromLocation(''); setToLocation(''); setTravelDate(''); setReturnDate(''); setPurpose('');
    setMode('Flight'); setEstimatedCost(''); setProjectId(null); setError(null);
  }

  async function submit() {
    if (!profile) return;
    if (!fromLocation.trim() || !toLocation.trim() || !travelDate || !purpose.trim()) { setError('From, To, travel date and purpose are required.'); return; }
    setSubmitting(true); setError(null);
    try {
      await createTravel(profile.id, { fromLocation: fromLocation.trim(), toLocation: toLocation.trim(), travelDate, returnDate, purpose: purpose.trim(), mode, estimatedCost, projectId }, projects);
      reset(); onClose(); onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormModal visible={visible} title="New Travel Request" onClose={() => { onClose(); }} onSubmit={submit} submitting={submitting} submitLabel="Submit Travel Request">
      <TextField label="From" value={fromLocation} onChangeText={setFromLocation} placeholder="Chennai" />
      <TextField label="To" value={toLocation} onChangeText={setToLocation} placeholder="Bengaluru" />
      <DateField label="Travel date" value={travelDate} onChange={setTravelDate} minimumDate={new Date()} />
      <DateField label="Return date (optional)" value={returnDate} onChange={setReturnDate} minimumDate={travelDate ? new Date(travelDate) : new Date()} />
      <View style={{ gap: 6 }}>
        <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Mode</Text>
        <ChipPicker options={TRAVEL_MODES} value={mode} onChange={setMode} />
      </View>
      <TextField label="Purpose" value={purpose} onChangeText={setPurpose} placeholder="Client meeting" multiline style={{ minHeight: 50 }} />
      <TextField label="Estimated cost (₹, optional)" value={estimatedCost} onChangeText={setEstimatedCost} keyboardType="decimal-pad" placeholder="0" />
      {projects.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Project (optional)</Text>
          <ChipPicker options={projects.map((p) => p.id)} value={projectId} onChange={(id) => setProjectId(id === projectId ? null : id)} getLabel={(id) => projects.find((p) => p.id === id)?.name ?? id} />
        </View>
      )}
      {error ? <Text style={{ color: '#dc2626', fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
    </FormModal>
  );
}
