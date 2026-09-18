import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import DateField from './DateField';
import CardStrategyFields from './CardStrategyFields';
import { addCardTransaction } from '../lib/firebase';
import { todayISO, CARD_REWARD_STRATEGIES, previewTransactionReward, formatCurrency } from '../lib/utils';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

function formatReward(amount, unit) {
  return unit === 'points' ? `${Math.round(amount).toLocaleString('en-IN')} pts` : formatCurrency(amount);
}

// RN port of web's AddCardTransactionForm (inside CardsManager.jsx).
export default function CardTransactionForm({ card, cardTxns, onSaveError }) {
  const [expanded, setExpanded] = useState(true);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState({});
  const [rewardOverride, setRewardOverride] = useState('');
  const [saving, setSaving] = useState(false);

  function updateDraft(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  // Matches the axis_supermoney_dual_pool default in CardStrategyFields -
  // an untouched draft should preview/save the same channel the picker is
  // showing.
  const bonusEligibleDefault = card.rewardStrategy === 'axis_supermoney_dual_pool';
  const isBonusEligible = draft.isBonusEligible ?? bonusEligibleDefault;

  const parsedAmount = parseFloat(amount);
  const preview = previewTransactionReward(card, cardTxns, {
    date,
    amount: parsedAmount,
    category: draft.category ?? null,
    channel: draft.channel ?? null,
    isBonusEligible,
    travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
  });
  const calculatedReward = preview ? (preview.earned ?? preview.estimated ?? 0) : null;
  const rewardUnit = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy)?.unit || 'inr';

  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      await addCardTransaction({
        cardId: card.id,
        amount: parsed,
        description: description.trim(),
        date,
        category: draft.category ?? null,
        channel: draft.channel ?? null,
        isBonusEligible,
        travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
        pointsRedeemed: draft.pointsRedeemed ? Number(draft.pointsRedeemed) : null,
        rewardOverride: rewardOverride === '' ? null : parseFloat(rewardOverride),
      });
      setAmount('');
      setDescription('');
      setDate(todayISO());
      setDraft({});
      setRewardOverride('');
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 mb-4">
      <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-center justify-between">
        <Text className="font-display text-lg text-ink">Add Transaction</Text>
        <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          <Text className="font-body-semibold text-xs text-muted-text">{expanded ? 'Collapse' : 'Expand'}</Text>
        </View>
      </Pressable>

      {expanded && (
        <View className="mt-3">
          <View className="flex-row flex-wrap" style={{ gap: 14 }}>
            <View className="w-full sm:w-[calc(50%-7px)]">
              <Text className={label}>Amount (₹)</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                className="font-mono-bold text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper"
              />
            </View>
            <View className="w-full sm:w-[calc(50%-7px)]">
              <Text className={label}>Date</Text>
              <DateField value={date} onChange={setDate} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
            </View>
          </View>

          <View className="mt-3.5">
            <Text className={label}>Description (optional)</Text>
            <TextInput value={description} onChangeText={setDescription} placeholder="e.g. Zepto" className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
          </View>

          <View className="flex-row flex-wrap mt-3.5" style={{ gap: 14 }}>
            <CardStrategyFields card={card} draft={draft} onChange={updateDraft} gap={14} />
          </View>

          <View className="flex-row flex-wrap mt-3.5" style={{ gap: 14 }}>
            <View className="w-full sm:w-[calc(50%-7px)]">
              <Text className={label}>Calculated Reward</Text>
              <View className="rounded-xl px-3 py-2.5 bg-paper-card border border-ink/15 shadow-2xs">
                <Text className="font-mono text-base text-muted-text">
                  {calculatedReward != null ? formatReward(calculatedReward, rewardUnit) : '-'}
                </Text>
              </View>
            </View>
            <View className="w-full sm:w-[calc(50%-7px)]">
              <Text className={label}>Override (optional)</Text>
              <TextInput
                value={rewardOverride}
                onChangeText={setRewardOverride}
                keyboardType="decimal-pad"
                placeholder={calculatedReward != null ? String(calculatedReward) : 'auto'}
                className={input}
              />
            </View>
          </View>

          <Pressable onPress={handleSubmit} disabled={saving || !amount} className="mt-3.5 min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
            {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-white">Add Transaction</Text>}
          </Pressable>
        </View>
      )}
    </Card>
  );
}
