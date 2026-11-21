import { View, Text, Pressable } from 'react-native';

// Purchase vs redeem, only where a points card is involved (a cashback card has no points to spend).
// The Cards tab and the Travel entry form share this so the two read and behave the same.
const OPTIONS = [['purchase', 'Purchase'], ['redeem', 'Redeem points']];

export default function ModeToggle({ mode, onChange }) {
  return (
    <View className="flex-row self-start rounded-xl border border-ink/15 bg-paper p-0.5 mb-3.5" style={{ gap: 2 }}>
      {OPTIONS.map(([key, text]) => (
        <Pressable key={key} onPress={() => onChange(key)} className={`px-3 py-1.5 rounded-lg ${mode === key ? 'bg-ledger-green' : ''}`} accessibilityRole="button" accessibilityState={{ selected: mode === key }}>
          <Text className={`font-body-semibold text-xs ${mode === key ? 'text-white' : 'text-muted-text'}`}>{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}
