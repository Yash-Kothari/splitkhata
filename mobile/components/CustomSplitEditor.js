import { View, Text, TextInput, Pressable } from 'react-native';
import { checkCustomSharesTotal, formatCurrency } from '../lib/utils';

// Per-person amounts for a custom split ("out of 15: Yash 5, Priya 10").
// `shares` holds the raw text of each input so typing "5." works; a blank
// person simply isn't part of the split.
export default function CustomSplitEditor({ members, total, shares, onChange }) {
  const { sum, diff, ok } = checkCustomSharesTotal(shares, total);
  const hasTotal = Number(total) > 0;

  function splitEqually() {
    if (!hasTotal) return;
    const each = Math.floor((Number(total) * 100) / members.length) / 100;
    const next = Object.fromEntries(members.map((m) => [m, String(each)]));
    const remainder = Math.round((Number(total) - each * members.length) * 100) / 100;
    if (remainder > 0) next[members[0]] = String(Math.round((each + remainder) * 100) / 100);
    onChange(next);
  }

  return (
    <View className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 mt-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">Each person's share</Text>
        <Pressable onPress={splitEqually} disabled={!hasTotal} hitSlop={6} className="disabled:opacity-50">
          <Text className="font-body-semibold text-xs text-ledger-green">Split equally</Text>
        </Pressable>
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {members.map((m) => (
          <View key={m} className="w-full flex-row items-center" style={{ gap: 8 }}>
            <Text className="font-body-medium text-sm text-ink w-24" numberOfLines={1}>{m}</Text>
            <TextInput
              value={shares[m] ?? ''}
              onChangeText={(v) => onChange({ ...shares, [m]: v })}
              keyboardType="decimal-pad"
              placeholder="0.00"
              className="flex-1 font-mono text-sm text-ink border border-ink/15 rounded-lg px-3 py-2 bg-paper"
            />
          </View>
        ))}
      </View>
      <Text className={`font-body text-2xs mt-2 ${ok ? 'text-ledger-green' : 'text-stamp-red'}`}>
        {!hasTotal
          ? 'Enter the amount above first.'
          : ok
            ? `Adds up: ${formatCurrency(sum)} of ${formatCurrency(Number(total))}`
            : diff > 0
              ? `${formatCurrency(diff)} still to assign (${formatCurrency(sum)} of ${formatCurrency(Number(total))})`
              : `${formatCurrency(Math.abs(diff))} over the total`}
      </Text>
    </View>
  );
}
