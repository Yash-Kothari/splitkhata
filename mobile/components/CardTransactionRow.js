import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import CardStrategyFields from './CardStrategyFields';
import DateField from './DateField';
import { updateCardTransaction } from '../lib/firebase';
import { formatCurrency, CARD_REWARD_STRATEGIES, previewTransactionReward, isStatementOnlyCard, parseAmountInput, isValidISODate, defaultCardTxnFields } from '../lib/utils';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';

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
  const draftFromTxn = () => ({
    ...defaultCardTxnFields(card),
    ...(txn.category != null ? { category: txn.category } : {}),
    ...(txn.channel != null ? { channel: txn.channel } : {}),
    ...(txn.isBonusEligible != null ? { isBonusEligible: Boolean(txn.isBonusEligible) } : {}),
    travelMultiplier: txn.travelMultiplier ?? null,
    pointsRedeemed: txn.pointsRedeemed ?? null,
  });
  const [draftAmount, setDraftAmount] = useState(String(txn.amount));
  const [draftDate, setDraftDate] = useState(txn.date);
  const [draftDescription, setDraftDescription] = useState(txn.description || txn.note || '');
  const [draft, setDraft] = useState(draftFromTxn);
  const [draftRewardOverride, setDraftRewardOverride] = useState(txn.rewardOverride != null ? String(txn.rewardOverride) : '');
  const [saving, setSaving] = useState(false);
  const statementOnly = isStatementOnlyCard(card);

  // The row stays mounted while the transaction changes elsewhere (its linked
  // household entry edited, say) - refresh the draft whenever it isn't being
  // edited, so saving here can't write an old amount back.
  useEffect(() => {
    if (editing) return;
    setDraftAmount(String(txn.amount));
    setDraftDate(txn.date);
    setDraftDescription(txn.description || txn.note || '');
    setDraft(draftFromTxn());
    setDraftRewardOverride(txn.rewardOverride != null ? String(txn.rewardOverride) : '');
  }, [txn, editing]);

  function updateDraft(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  const perTxn = cycleReward?.perTransaction?.find((p) => p.id === txn.id);
  const isAggregate = card.rewardStrategy === 'hsbc_tiered_cashback_aggregate';

  const editPreview = editing
    ? previewTransactionReward(card, cardTxns, {
        id: txn.id,
        date: isValidISODate(draftDate) ? draftDate : null,
        amount: parseAmountInput(draftAmount, { allowNegative: true }),
        category: draft.category,
        channel: draft.channel,
        isBonusEligible: Boolean(draft.isBonusEligible),
        travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
      })
    : null;
  const editCalculatedReward = editPreview ? (editPreview.earned ?? editPreview.estimated ?? 0) : null;
  const editRewardUnit = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy)?.unit || 'inr';

  const hasTravelFields = draft.category === 'smartbuy_hotel' || draft.category === 'travel_bonus';

  async function handleSave() {
    const amountValue = parseAmountInput(draftAmount, { allowNegative: true });
    if (!amountValue) {
      notify('Check the amount', 'Enter an amount like 1200 or 1,200.50.');
      return;
    }
    if (!isValidISODate(draftDate)) {
      notify('Check the date', 'Use the format YYYY-MM-DD.');
      return;
    }
    const overrideValue = draftRewardOverride === '' ? null : parseAmountInput(draftRewardOverride, { allowNegative: true });
    if (draftRewardOverride !== '' && overrideValue == null) {
      notify('Check the override', 'Enter a number like 250, or leave it empty to use the calculated reward.');
      return;
    }
    setSaving(true);
    try {
      await updateCardTransaction(txn.id, {
        amount: amountValue,
        date: draftDate,
        description: draftDescription.trim(),
        category: draft.category ?? null,
        channel: draft.channel ?? null,
        isBonusEligible: Boolean(draft.isBonusEligible),
        travelMultiplier: hasTravelFields && draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
        pointsRedeemed: hasTravelFields && draft.pointsRedeemed ? Number(draft.pointsRedeemed) : null,
        rewardOverride: statementOnly ? null : overrideValue,
      });
      setEditing(false);
    } catch (err) {
      reportError(err, 'Could not save transaction');
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
              keyboardType="numbers-and-punctuation"
              className="font-mono-bold text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper"
            />
          </View>
          <View className="w-full sm:w-[calc(50%-6px)]">
            <Text className={label}>Date</Text>
            <DateField value={draftDate} onChange={setDraftDate} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
          </View>
        </View>

        <View className="mt-3.5">
          <Text className={label}>Description (optional)</Text>
          <TextInput value={draftDescription} onChangeText={setDraftDescription} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
        </View>

        <View className="flex-row flex-wrap mt-3.5" style={{ gap: 12 }}>
          <CardStrategyFields card={card} draft={draft} onChange={updateDraft} gap={12} />
        </View>

        {!statementOnly && (
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
        )}

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
            <Text className={`font-mono-bold text-base ${txn.amount < 0 ? 'text-ledger-green' : 'text-ink'}`}>{formatCurrency(txn.amount)}</Text>
            {txn.amount < 0 && !isStatementOnlyCard(card) && (
              <Text className="font-body-semibold text-2xs px-1.5 py-0.5 rounded bg-ledger-green/15 text-ledger-green">Refund</Text>
            )}
            {perTxn && perTxn.overridden && (
              <Text className="font-mono text-xs px-1.5 py-0.5 rounded bg-ledger-green/15 text-ledger-green">
                💳 {formatReward(perTxn.earned, cycleReward.unit)} (edited)
              </Text>
            )}
            {perTxn && !perTxn.overridden && !isAggregate && (
              <Text className="font-mono text-xs px-1.5 py-0.5 rounded bg-ledger-green/15 text-ledger-green">
                💳 {perTxn.earned >= 0 ? '+' : ''}{formatReward(perTxn.earned, cycleReward.unit)}
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
          {txn.description || txn.note || 'No description'}
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
