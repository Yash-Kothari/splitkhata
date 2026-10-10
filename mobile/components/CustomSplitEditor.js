import { View, Text, TextInput, Pressable } from 'react-native';
import { checkCustomSharesTotal, customShareAmounts, reduceSharesToRatio, formatCurrency } from '../lib/utils';

// Per-person shares for a custom split. Two ways to enter them:
//  - Amounts: "out of 15: Yash 5, Priya 10" - must add up to the total.
//  - Ratio (only when the caller passes onModeChange): parts such as 2 and 3,
//    worked out against the total for you ("Yash 2, Priya 3" of 500 = 200 and 300).
// `shares` holds the raw text of each input so typing "5." works; a blank
// person simply isn't part of the split. Switching modes keeps the same split:
// amounts become parts as they are, and parts become the amounts they come to.
export default function CustomSplitEditor({ members, total, shares, onChange, mode = 'amount', onModeChange }) {
  const isRatio = mode === 'ratio';
  const { sum, diff, ok } = checkCustomSharesTotal(shares, total, mode);
  const hasTotal = Number(total) > 0;
  const preview = isRatio && hasTotal && ok ? customShareAmounts(total, shares, members) : null;

  function splitEqually() {
    if (isRatio) {
      onChange(Object.fromEntries(members.map((m) => [m, '1'])));
      return;
    }
    if (!hasTotal) return;
    const each = Math.floor((Number(total) * 100) / members.length) / 100;
    const next = Object.fromEntries(members.map((m) => [m, String(each)]));
    const remainder = Math.round((Number(total) - each * members.length) * 100) / 100;
    if (remainder > 0) next[members[0]] = String(Math.round((each + remainder) * 100) / 100);
    onChange(next);
  }

  function switchMode(next) {
    if (next === mode) return;
    if (next === 'amount' && hasTotal && ok) {
      const amounts = customShareAmounts(total, shares, members);
      onChange(Object.fromEntries(Object.entries(amounts).map(([m, v]) => [m, String(v)])));
    }
    if (next === 'ratio') onChange(reduceSharesToRatio(shares));
    onModeChange(next);
  }

  return (
    <View className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 mt-3">
      {onModeChange ? (
        <View className="flex-row self-start rounded-lg border border-ink/15 overflow-hidden mb-3">
          {[
            ['amount', 'Amounts'],
            ['ratio', 'Ratio'],
          ].map(([value, label]) => (
            <Pressable key={value} onPress={() => switchMode(value)} className={`px-3.5 py-1.5 ${mode === value ? 'bg-ledger-green' : 'bg-paper'}`}>
              <Text className={`font-body-semibold text-xs ${mode === value ? 'text-white' : 'text-ink'}`}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="flex-row items-center justify-between mb-2">
        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">
          {isRatio ? "Each person's parts" : "Each person's share"}
        </Text>
        <Pressable onPress={splitEqually} disabled={!isRatio && !hasTotal} hitSlop={6} className="disabled:opacity-50">
          <Text className="font-body-semibold text-xs text-ledger-green">{isRatio ? 'Equal parts' : 'Split equally'}</Text>
        </Pressable>
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {members.map((m) => (
          <View key={m} className="w-full flex-row items-center" style={{ gap: 8 }}>
            <Text className={`font-body-medium text-sm text-ink ${isRatio ? 'flex-1' : 'w-24'}`} numberOfLines={1}>{m}</Text>
            <TextInput
              value={shares[m] ?? ''}
              onChangeText={(v) => onChange({ ...shares, [m]: v })}
              keyboardType="decimal-pad"
              placeholder={isRatio ? 'e.g. 2' : '0.00'}
              className={`font-mono text-sm text-ink border border-ink/15 rounded-lg px-3 py-2 bg-paper ${isRatio ? 'w-20' : 'flex-1'}`}
            />
            {isRatio ? (
              <Text className="font-mono text-sm text-ink w-28 text-right" numberOfLines={1}>
                {preview?.[m] != null ? formatCurrency(preview[m]) : ''}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <Text className={`font-body text-2xs mt-2 ${ok ? 'text-ledger-green' : 'text-stamp-red'}`}>
        {isRatio
          ? !ok
            ? 'Enter each person\'s parts, like 2 and 3. Leave a person blank to leave them out.'
            : hasTotal
              ? `Split in the ratio ${members.filter((m) => Number(shares[m]) > 0).map((m) => Number(shares[m])).join(' : ')} of ${formatCurrency(Number(total))}`
              : 'Enter the amount above to see what each person pays.'
          : !hasTotal
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
