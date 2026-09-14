import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import CardStrategyFields from './CardStrategyFields';
import { updateCardTransaction } from '../lib/firebase';
import { formatCurrency, CARD_REWARD_STRATEGIES, previewTransactionReward } from '../lib/utils';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

function formatReward(amount, unit) {
  return unit === 'points' ? `${Math.round(amount).toLocaleString('en-IN')} pts` : formatCurrency(amount);
}

function formatShortDate(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

function nextMonthFirst(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return `${nextY}-${String(nextM).padStart(2, '0')}-01`;
}

// RN port of web's TransactionRow (inside CardsManager.jsx).
export default function CardTransactionRow({ txn, card, cardTxns, cycleReward, onDelete, isLast }) {
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(String(txn.amount));
  const [draftDate, setDraftDate] = useState(txn.date);
  const [draftDescription, setDraftDescription] = useState(txn.description || '');
  const [draft, setDraft] = useState({
    category: txn.category ?? null,
    channel: txn.channel ?? null,
    isBonusEligible: Boolean(txn.isBonusEligible),
    travelMultiplier: txn.travelMultiplier ?? null,
    pointsRedeemed: txn.pointsRedeemed ?? null,
  });
  const [draftRewardOverride, setDraftRewardOverride] = useState(txn.rewardOverride != null ? String(txn.rewardOverride) : '');
  const [saving, setSaving] = useState(false);

  function updateDraft(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  const perTxn = cycleReward?.perTransaction?.find((p) => p.id === txn.id);
  const isAggregate = card.rewardStrategy === 'hsbc_tiered_cashback_aggregate';

  const editPreview = editing
    ? previewTransactionReward(card, cardTxns, {
        id: txn.id,
        date: draftDate,
        amount: parseFloat(draftAmount),
        category: draft.category,
        channel: draft.channel,
        isBonusEligible: Boolean(draft.isBonusEligible),
        travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
      })
    : null;
  const editCalculatedReward = editPreview ? (editPreview.earned ?? editPreview.estimated ?? 0) : null;
  const editRewardUnit = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy)?.unit || 'inr';

  async function handleSave() {
    setSaving(true);
    try {
      await updateCardTransaction(txn.id, {
        amount: parseFloat(draftAmount) || txn.amount,
        date: draftDate,
        description: draftDescription.trim(),
        category: draft.category ?? null,
        channel: draft.channel ?? null,
        isBonusEligible: Boolean(draft.isBonusEligible),
        travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
        pointsRedeemed: draft.pointsRedeemed ? Number(draft.pointsRedeemed) : null,
        rewardOverride: draftRewardOverride === '' ? null : parseFloat(draftRewardOverride),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const rowBorder = isLast ? '' : 'border-b border-ink/10';

  if (editing) {
    return (
      <View className={`py-3 ${rowBorder}`}>
        <View className="flex-row flex-wrap" style={{ gap: 12 }}>
          <View className="w-full sm:w-[calc(50%-6px)]">
            <Text className={label}>Amount (₹)</Text>
            <TextInput
              value={draftAmount}
              onChangeText={setDraftAmount}
              keyboardType="decimal-pad"
              className="font-mono-bold text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper"
            />
          </View>
          <View className="w-full sm:w-[calc(50%-6px)]">
            <Text className={label}>Date</Text>
            <TextInput value={draftDate} onChangeText={setDraftDate} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
          </View>
        </View>

        <View className="mt-3.5">
          <Text className={label}>Description (optional)</Text>
          <TextInput value={draftDescription} onChangeText={setDraftDescription} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
        </View>

        <View className="flex-row flex-wrap mt-3.5" style={{ gap: 12 }}>
          <CardStrategyFields card={card} draft={draft} onChange={updateDraft} gap={12} />
        </View>

        <View className="flex-row flex-wrap mt-3.5" style={{ gap: 12 }}>
          <View className="w-full sm:w-[calc(50%-6px)]">
            <Text className={label}>Calculated Reward</Text>
            <View className="rounded-xl px-3 py-2.5 bg-paper-card border border-ink/15 shadow-2xs">
              <Text className="font-mono text-base text-muted-text">
                {editCalculatedReward != null ? formatReward(editCalculatedReward, editRewardUnit) : '-'}
              </Text>
            </View>
          </View>
          <View className="w-full sm:w-[calc(50%-6px)]">
            <Text className={label}>Override (optional)</Text>
            <TextInput
              value={draftRewardOverride}
              onChangeText={setDraftRewardOverride}
              keyboardType="decimal-pad"
              placeholder={editCalculatedReward != null ? String(editCalculatedReward) : 'auto'}
              className={input}
            />
          </View>
        </View>

        <View className="flex-row gap-2 mt-3.5">
          <Pressable onPress={handleSave} disabled={saving} className="px-3 py-2 rounded-lg bg-ledger-green disabled:opacity-50">
            {saving ? <ActivityIndicator color="white" size="small" /> : <Text className="font-body-semibold text-xs text-white">Save</Text>}
          </Pressable>
          <Pressable onPress={() => setEditing(false)} className="px-3 py-2 rounded-lg border border-ink/15">
            <Text className="font-body-semibold text-xs text-muted-text">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isGroceryPosting = card.rewardStrategy === 'hdfc_diners_slab_milestone' && txn.category === 'grocery';

  return (
    <View className={`py-3 flex-row items-center justify-between gap-3 ${rowBorder}`}>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-baseline justify-between gap-2">
          <View className="flex-row items-baseline flex-wrap gap-1.5 flex-1">
            <Text className="font-mono-bold text-base text-ink">{formatCurrency(txn.amount)}</Text>
            {perTxn && perTxn.overridden && (
              <Text className="font-mono text-xs px-1.5 py-0.5 rounded bg-ledger-green/15 text-ledger-green">
                💳 {formatReward(perTxn.earned, cycleReward.unit)} (edited)
              </Text>
            )}
            {perTxn && !perTxn.overridden && !isAggregate && (
              <Text className="font-mono text-xs px-1.5 py-0.5 rounded bg-ledger-green/15 text-ledger-green">
                💳 +{formatReward(perTxn.earned, cycleReward.unit)}
              </Text>
            )}
            {perTxn && !perTxn.overridden && isAggregate && perTxn.estimated > 0 && (
              <Text className="font-mono text-xs px-1.5 py-0.5 rounded bg-ledger-green/10 text-ledger-green/80">
                💳 ~{formatReward(perTxn.estimated, 'inr')}
              </Text>
            )}
            {txn.pointsRedeemed > 0 && (
              <Text className="font-mono text-xs px-1.5 py-0.5 rounded bg-mustard/20 text-mustard">
                🎟 -{txn.pointsRedeemed.toLocaleString('en-IN')} pts
              </Text>
            )}
          </View>
          <Text className="font-body-medium text-xs text-muted-text bg-paper border border-ink/10 rounded px-2 py-0.5">
            {formatShortDate(txn.date)}
          </Text>
        </View>
        <Text numberOfLines={1} className="mt-1 font-body text-xs text-muted-text">
          {txn.description || 'No description'}
          {isGroceryPosting ? ` · posts ${formatShortDate(nextMonthFirst(txn.date))}` : ''}
        </Text>
      </View>
      <View className="flex-row items-center gap-1 shrink-0">
        <Pressable onPress={() => setEditing(true)} hitSlop={8} className="min-w-8 min-h-8 items-center justify-center">
          <Text className="text-base text-muted-text">✎</Text>
        </Pressable>
        <Pressable onPress={() => onDelete(txn)} hitSlop={8} className="min-w-8 min-h-8 items-center justify-center">
          <Text className="text-base text-stamp-red/70">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
