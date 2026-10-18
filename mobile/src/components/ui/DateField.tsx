import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar } from 'lucide-react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';

// value / onChange work in ISO date form (YYYY-MM-DD), matching the DB.
export function DateField({ label, value, onChange, minimumDate, maximumDate }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  const t = useTheme();
  const [show, setShow] = useState(false);
  const current = value ? new Date(value) : new Date();

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>{label}</Text> : null}
      <Pressable
        onPress={() => setShow(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surfaceSoft, borderWidth: 1.5, borderColor: t.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 13 }}
      >
        <Calendar size={16} color={t.textMuted} />
        <Text style={{ color: value ? t.text : t.textMuted, fontFamily: Fonts.body, fontSize: 15 }}>
          {value ? dateFmt(value) : 'Select date'}
        </Text>
      </Pressable>
      {show ? (
        <DateTimePicker
          value={current}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(_, d) => {
            setShow(false);
            if (d) onChange(d.toISOString().split('T')[0]);
          }}
        />
      ) : null}
    </View>
  );
}
