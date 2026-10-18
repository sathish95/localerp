import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, DateField, PageHeader, Screen, TextField } from '@/components/ui';
import { useCreateLeaveRequest, useLeaveData } from '@/hooks/leave';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius } from '@/constants/theme';

const TODAY = new Date().toISOString().split('T')[0];

export default function NewLeaveRequest() {
  const t = useTheme();
  const router = useRouter();
  const dataQ = useLeaveData();
  const create = useCreateLeaveRequest();

  const types = dataQ.data?.types ?? [];
  const [leaveType, setLeaveType] = useState<string>('');
  const [fromDate, setFromDate] = useState(TODAY);
  const [toDate, setToDate] = useState(TODAY);
  const [permissionDate, setPermissionDate] = useState(TODAY);
  const [permissionHours, setPermissionHours] = useState('1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const effectiveType = leaveType || types[0]?.code || 'casual';
  const isPermission = effectiveType === 'permission';

  async function submit() {
    if (!reason.trim()) { setError('A reason is required.'); return; }
    if (isPermission && (!permissionHours || Number(permissionHours) <= 0)) { setError('Enter the number of hours.'); return; }
    if (!isPermission && new Date(toDate) < new Date(fromDate)) { setError('End date must be on or after the start date.'); return; }
    setError(null);
    try {
      await create.mutateAsync({
        leaveType: effectiveType,
        fromDate,
        toDate,
        reason: reason.trim(),
        permissionDate,
        permissionHours: Number(permissionHours),
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Screen>
      <PageHeader title="Request Leave" subtitle="Your manager reviews it on approval" />

      <Card style={{ gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {types.map((x) => {
              const active = effectiveType === x.code;
              return (
                <Pressable
                  key={x.code}
                  onPress={() => setLeaveType(x.code)}
                  style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: Radius.pill, backgroundColor: active ? x.color : t.surfaceSoft, borderWidth: 1, borderColor: active ? x.color : t.border }}
                >
                  <Text style={{ color: active ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{x.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {isPermission ? (
          <>
            <DateField label="Date" value={permissionDate} onChange={setPermissionDate} />
            <TextField label="Hours" value={permissionHours} onChangeText={setPermissionHours} keyboardType="decimal-pad" placeholder="1" />
          </>
        ) : (
          <>
            <DateField label="From" value={fromDate} onChange={setFromDate} />
            <DateField label="To" value={toDate} onChange={setToDate} minimumDate={new Date(fromDate)} />
          </>
        )}

        <TextField label="Reason" value={reason} onChangeText={setReason} placeholder="Brief reason" multiline style={{ minHeight: 70 }} />

        {error ? <Text style={{ color: t.danger, fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
      </Card>

      <Button title="Submit Request" onPress={submit} loading={create.isPending} disabled={create.isPending} />
    </Screen>
  );
}
