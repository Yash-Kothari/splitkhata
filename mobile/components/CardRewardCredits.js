import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { parseAmountInput } from '../lib/utils';

const VISIBLE_ROWS = 6;

function shortDate(dateStr, withYear = false) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

// Sits inside the card's summary: how much it earned this card year, and a
// collapsed "Credit history" with one short line per credit. A row starts as
// the calculated amount; tap the pencil only when the bank credited something
// different and the card's totals follow your figure. `format(amount)` renders
// rupees or points.
export default function CardRewardCredits({ rewards, yearRewards, format, onSave, onReset }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const credited = rewards.credits.filter((c) => c.credited).sort((a, b) => b.date.localeCompare(a.date));
  const rows = showAll ? credited : credited.slice(0, VISIBLE_ROWS);
  const rowKey = (c) => `${c.kind}|${c.cycleStart || ''}|${c.date}`;
  const rowName = (c) => (c.kind === 'statement' ? 'Statement' : c.label);

  async function run(action) {
    setSaving(true);
    try {
      await action();
      setEditingKey(null);
    } finally {
      setSaving(false);
    }
  }

  const typed = parseAmountInput(draft, { allowNegative: true });

  return (
    <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5 mb-3">
      <Text className="font-body-semibold text-2xs text-muted-text uppercase tracking-wider">
        {yearRewards.anchored ? 'This card year' : 'This year'} · {shortDate(yearRewards.periodStart)} – {shortDate(yearRewards.periodLastDay, true)}
      </Text>
      <Text className="font-mono-bold text-ink text-lg">{format(yearRewards.earned)}</Text>
      <Text className="font-body text-2xs text-muted-text">
        {format(yearRewards.credited)} credited
        {yearRewards.pending !== 0 ? ` · ${format(yearRewards.pending)} still to come` : ''}
      </Text>

      {credited.length > 0 ? (
        <Pressable onPress={() => setOpen((v) => !v)} className="mt-1.5 self-start">
          <Text className="font-body-semibold text-xs text-muted-text underline">
            {open ? 'Hide credit history' : `Credit history (${credited.length})`}
          </Text>
        </Pressable>
      ) : null}

      {open
        ? rows.map((c) => {
            const key = rowKey(c);
            const isEditing = editingKey === key;
            return (
              <View key={key} className="border-t border-ink/10 mt-2 pt-1.5">
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Text className="font-body text-xs text-muted-text w-14">{shortDate(c.date)}</Text>
                  <Text className="font-body text-xs text-ink flex-1" numberOfLines={1}>
                    {rowName(c)}
                    {c.edited ? <Text className="text-mustard"> · edited</Text> : c.confirmed ? <Text className="text-ledger-green"> · ✓</Text> : null}
                  </Text>
                  <Text className="font-mono-bold text-xs text-ink">{format(c.amount)}</Text>
                  {c.kind === 'statement' && !isEditing ? (
                    <Pressable
                      onPress={() => {
                        setEditingKey(key);
                        setDraft(String(c.amount));
                      }}
                      hitSlop={8}
                      className="min-w-6 items-center"
                      accessibilityLabel="Edit the credited amount"
                    >
                      <Text className="text-sm text-muted-text">✎</Text>
                    </Pressable>
                  ) : (
                    <View className="min-w-6" />
                  )}
                </View>

                {isEditing ? (
                  <View className="mt-1.5">
                    <View className="flex-row" style={{ gap: 8 }}>
                      <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        keyboardType="numbers-and-punctuation"
                        placeholder="Amount the bank credited"
                        className="flex-1 font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper"
                      />
                      <Pressable onPress={() => setEditingKey(null)} className="px-3 min-h-10 rounded-xl border border-ink/15 items-center justify-center">
                        <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => run(() => onSave(c, typed))}
                        disabled={saving || typed == null}
                        className="px-3 min-h-10 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
                      >
                        <Text className="font-body-semibold text-xs text-white">{saving ? 'Saving...' : 'Save'}</Text>
                      </Pressable>
                    </View>
                    {c.confirmed ? (
                      <Pressable onPress={() => run(() => onReset(c))} disabled={saving} className="mt-1 self-start">
                        <Text className="font-body text-2xs text-muted-text underline">Use the calculated {format(c.expected)} again</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        : null}

      {open && credited.length > VISIBLE_ROWS ? (
        <Pressable onPress={() => setShowAll((v) => !v)} className="mt-2 self-start">
          <Text className="font-body-semibold text-xs text-muted-text underline">{showAll ? 'Show fewer' : `Show all (${credited.length})`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
