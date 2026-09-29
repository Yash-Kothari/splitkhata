import { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { isValidISODate } from '../lib/utils';

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISODate(value) {
  return value && isValidISODate(value) ? new Date(`${value}T00:00:00`) : new Date();
}

// The old web app used a real <input type="date"> - this rewrite shipped a
// raw text field with a "2026-08-24" placeholder everywhere instead, which
// on the website (this app's production build) reads as a regression:
// no calendar picker, no format validation, easy to mistype. React Native's
// TextInput has no way to become a native date input, so on web this drops
// down to a literal DOM <input> - valid here because react-native-web's
// renderer is plain react-dom, and this branch never runs on native.
// The value format ('YYYY-MM-DD') already matches <input type="date"> input
// exactly, so no conversion is needed either way.
//
// Native (P2-5) uses @react-native-community/datetimepicker instead of the
// old typed TextInput. A native picker can't represent "no date" (it always
// shows some date), but several callers rely on '' meaning "unset"
// (recurring rule end date, card renewal date, search filters) - so onChange
// only ever fires when the user actually picks a date, and a small clear
// button appears whenever a value is set, letting them unset it again.
export default function DateField({ value, onChange, className, placeholder }) {
  const [showPicker, setShowPicker] = useState(false);

  if (Platform.OS === 'web') {
    // iPhone Safari sizes a date input from its content and ignores width:100%,
    // so it runs past its container - pin the box model explicitly.
    return (
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        style={{ display: 'block', width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', minHeight: 44, WebkitAppearance: 'none', appearance: 'none' }}
      />
    );
  }

  function handlePick(event, selectedDate) {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'dismissed' || !selectedDate) return;
    onChange(toISODate(selectedDate));
  }

  return (
    <View className="flex-row items-center" style={{ gap: 6 }}>
      <View className="flex-1">
        {Platform.OS === 'ios' ? (
          <DateTimePicker value={parseISODate(value)} mode="date" display="compact" onChange={handlePick} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <>
            <Pressable onPress={() => setShowPicker(true)} className={className}>
              <Text className={`font-body-medium text-sm ${value ? 'text-ink' : 'text-muted-text'}`}>
                {value || placeholder || 'YYYY-MM-DD'}
              </Text>
            </Pressable>
            {showPicker && <DateTimePicker value={parseISODate(value)} mode="date" display="default" onChange={handlePick} />}
          </>
        )}
      </View>
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={8}
          className="w-6 h-6 rounded-full border border-ink/15 bg-paper items-center justify-center shrink-0"
        >
          <Text className="font-body-semibold text-2xs text-muted-text">✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
