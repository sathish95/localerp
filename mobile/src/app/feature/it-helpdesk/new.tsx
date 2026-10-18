import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, PageHeader, Screen, TextField } from '@/components/ui';
import { useCreateItTicket, useItCategories } from '@/hooks/it-helpdesk';
import { useTheme } from '@/hooks/use-theme';
import { IT_PRIORITIES, IT_PRIORITY_COLOR, type ItPriority } from '@/lib/itHelpdesk';
import { Fonts, Radius } from '@/constants/theme';

export default function NewItTicket() {
  const t = useTheme();
  const router = useRouter();
  const catsQ = useItCategories();
  const create = useCreateItTicket();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState<ItPriority>('medium');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!category && catsQ.data?.length) setCategory(catsQ.data[0].key);
  }, [catsQ.data, category]);

  async function submit() {
    if (!subject.trim() || !description.trim() || !category) {
      setError('Subject, description and a category are required.');
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ subject: subject.trim(), description: description.trim(), category, priority });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Screen>
      <PageHeader title="New IT Ticket" subtitle="Tell IT what you need" />

      <Card style={{ gap: 16 }}>
        <TextField label="Subject" value={subject} onChangeText={setSubject} placeholder="Short summary of the issue" />
        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What's happening, what you expected, anything you tried"
          multiline
          style={{ minHeight: 90 }}
        />

        <View style={{ gap: 8 }}>
          <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(catsQ.data ?? []).map((c) => {
              const active = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: Radius.pill, backgroundColor: active ? t.accent : t.surfaceSoft, borderWidth: 1, borderColor: active ? t.accent : t.border }}
                >
                  <Text style={{ color: active ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Priority</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {IT_PRIORITIES.map((p) => {
              const active = priority === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Radius.md, backgroundColor: active ? `${IT_PRIORITY_COLOR[p]}22` : t.surfaceSoft, borderWidth: 1.5, borderColor: active ? IT_PRIORITY_COLOR[p] : t.border }}
                >
                  <Text style={{ color: active ? IT_PRIORITY_COLOR[p] : t.textSoft, fontFamily: Fonts.bodyBold, fontSize: 11.5, textTransform: 'capitalize' }}>{p}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? <Text style={{ color: t.danger, fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
      </Card>

      <Button title="Submit Ticket" onPress={submit} loading={create.isPending} disabled={create.isPending} />
    </Screen>
  );
}
