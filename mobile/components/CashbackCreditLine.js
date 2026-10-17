import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { formatCurrency, parseAmountInput, cycleLastDay } from '../lib/utils';

function formatDate(dateStr, withYear = false) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

// The cashback credit a statement brings against the next bill, shown where the
// bank lists it - on its credit date, among that cycle's transactions. It is not
// a stored transaction (see computeCardRewardLedger's cashbackCredits): it follows
// the reward you confirm. Tap it to enter the bank's figure; "Use the expected
// amount" goes back to the calculated one.
export default function CashbackCreditLine({ credit, today, thisYear, onSave, onReset }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const sourceLastDay = cycleLastDay(credit.sourceCycleEnd);
  const withYear = credit.sourceCycleStart.slice(0, 4) !== thisYear || sourceLastDay.slice(0, 4) !== thisYear;
  const credited = credit.date <= today;
  const status = credit.confirmed
    ? "✓ the bank's figure"
    : credited
      ? "credited - tap to enter the bank's figure"
      : `expected - credits ${formatDate(credit.date)}`;
  const typed = parseAmountInput(draft, { allowNegative: true });

  async function run(action) {
    setSaving(true);
    try {
      await action();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="rounded-lg bg-ledger-green/10 px-3 py-2 my-1.5">
      <Pressable
        onPress={() => {
          setDraft(String(credit.amount));
          setEditing((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityLabel="Cashback credit - enter the bank's figure"
        className="flex-row items-center justify-between"
        style={{ gap: 8 }}
      >
        <View className="flex-1">
          <Text className="font-body-semibold text-xs text-ledger-green" numberOfLines={1}>
            Cashback credit · {formatDate(credit.date)}
          </Text>
          <Text className="font-body text-2xs text-muted-text" numberOfLines={2}>
            From the {formatDate(credit.sourceCycleStart, withYear)} – {formatDate(sourceLastDay, withYear)} statement · {status}
          </Text>
        </View>
        <Text className="font-mono-bold text-sm text-ledger-green">−{formatCurrency(credit.amount)}</Text>
      </Pressable>

      {editing ? (
        <View className="mt-2">
          <Text className="font-body-semibold text-2xs text-muted-text uppercase tracking-wider">Amount the Bank Credited</Text>
          <View className="flex-row mt-1" style={{ gap: 8 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              className="flex-1 font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper"
            />
            <Pressable onPress={() => setEditing(false)} className="px-3 min-h-10 rounded-xl border border-ink/15 items-center justify-center">
              <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => run(() => onSave(credit.sourceCycleStart, typed))}
              disabled={saving || typed == null}
              className="px-3 min-h-10 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
            >
              <Text className="font-body-semibold text-xs text-white">{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
          {credit.confirmed ? (
            <Pressable onPress={() => run(() => onReset(credit.sourceCycleStart))} disabled={saving} className="mt-1.5 self-start">
              <Text className="font-body text-2xs text-muted-text underline">Use the expected amount again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
