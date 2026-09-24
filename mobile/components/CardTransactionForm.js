import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import DateField from './DateField';
import CardStrategyFields from './CardStrategyFields';
import { addCardTransaction } from '../lib/firebase';
import { todayISO, CARD_REWARD_STRATEGIES, previewTransactionReward, formatCurrency, isStatementOnlyCard, parseAmountInput, isValidISODate, defaultCardTxnFields, statementDateToCycleDate } from '../lib/utils';
import { notify } from '../lib/dialogs';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

function formatReward(amount, unit) {
  return unit === 'points' ? `${Math.round(amount).toLocaleString('en-IN')} pts` : formatCurrency(amount);
}

// RN port of web's AddCardTransactionForm (inside CardsManager.jsx).
export default function CardTransactionForm({ card, cardTxns, onSaveError }) {
  const [expanded, setExpanded] = useState(true);
  const [amount, setAmount] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const statementOnly = isStatementOnlyCard(card);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState({});
  const [rewardOverride, setRewardOverride] = useState('');
  const [saving, setSaving] = useState(false);

  function updateDraft(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  // An untouched draft previews and saves exactly what the pickers show as
  // their defaults (see defaultCardTxnFields).
  const effective = { ...defaultCardTxnFields(card), ...draft };
  const isBonusEligible = Boolean(effective.isBonusEligible);
  // SmartBuy / Premier travel bookings are the only ones with their own
  // multiplier and redeemed points; anything else never saves them.
  const hasTravelFields = effective.category === 'smartbuy_hotel' || effective.category === 'travel_bonus';
  const travelMultiplier = hasTravelFields && draft.travelMultiplier ? Number(draft.travelMultiplier) : null;

  // A refund is a negative amount: typed with a minus, or with the Refund
  // toggle (phone keypads often have no minus key).
  const typedAmount = parseAmountInput(amount, { allowNegative: true });
  const parsedAmount = isRefund && Number.isFinite(typedAmount) ? -Math.abs(typedAmount) : typedAmount;
  const preview = previewTransactionReward(card, cardTxns, {
    date: isValidISODate(date) ? date : null,
    amount: parsedAmount,
    category: effective.category ?? null,
    channel: effective.channel ?? null,
    isBonusEligible,
    travelMultiplier,
  });
  const calculatedReward = preview ? (preview.earned ?? preview.estimated ?? 0) : null;
  const rewardUnit = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy)?.unit || 'inr';

  async function handleSubmit() {
    const parsed = parsedAmount;
    if (!parsed) {
      notify('Check the amount', 'Enter an amount like 1200 or 1,200.50.');
      return;
    }
    if (!isValidISODate(date)) {
      notify('Check the date', 'Use the format YYYY-MM-DD.');
      return;
    }
    const overrideValue = rewardOverride === '' ? null : parseAmountInput(rewardOverride, { allowNegative: true });
    if (rewardOverride !== '' && overrideValue == null) {
      notify('Check the override', 'Enter a number like 250, or leave it empty to use the calculated reward.');
      return;
    }
    setSaving(true);
    try {
      await addCardTransaction({
        cardId: card.id,
        amount: parsed,
        description: description.trim() || (statementOnly ? 'Statement' : ''),
        date: statementOnly ? statementDateToCycleDate(date, card.billingCycleDay ?? 1) : date,
        category: effective.category ?? null,
        channel: effective.channel ?? null,
        isBonusEligible,
        travelMultiplier,
        pointsRedeemed: hasTravelFields && draft.pointsRedeemed ? Number(draft.pointsRedeemed) : null,
        rewardOverride: overrideValue,
      });
      setAmount('');
      setIsRefund(false);
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
        <Text className="font-display text-lg text-ink">{statementOnly ? 'Add Statement Amount' : 'Add Transaction'}</Text>
        <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          <Text className="font-body-semibold text-xs text-muted-text">{expanded ? 'Collapse' : 'Expand'}</Text>
        </View>
      </Pressable>

      {expanded && (
        <View className="mt-3">
          <View className="flex-row flex-wrap" style={{ gap: 14 }}>
            <View className="w-full sm:w-[calc(50%-7px)]">
              <Text className={label}>{statementOnly ? 'Statement amount (₹)' : 'Amount (₹)'}</Text>
              <TextInput
                value={amount}
                onChangeText={(v) => {
                  // Typing (or pasting) a minus means a refund: tick the box and
                  // let it carry the sign, so the two never disagree.
                  if (!statementOnly && /^\s*-/.test(v)) {
                    setIsRefund(true);
                    setAmount(v.replace(/^\s*-+\s*/, ''));
                  } else {
                    setAmount(v);
                  }
                }}
                keyboardType="numbers-and-punctuation"
                placeholder="0.00"
                className="font-mono-bold text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper"
              />
              {!statementOnly && (
                <Pressable onPress={() => setIsRefund((v) => !v)} hitSlop={6} className="self-start flex-row items-center mt-1.5" style={{ gap: 6 }}>
                  <View className={`w-4 h-4 rounded border items-center justify-center ${isRefund ? 'bg-ledger-green border-ledger-green' : 'border-ink/25 bg-paper'}`}>
                    {isRefund ? <Text className="text-white text-2xs">✓</Text> : null}
                  </View>
                  <Text className="font-body text-xs text-muted-text">Refund / reversal (enters it as a minus)</Text>
                </Pressable>
              )}
            </View>
            <View className="w-full sm:w-[calc(50%-7px)]">
              <Text className={label}>{statementOnly ? 'Statement date' : 'Date'}</Text>
              <DateField value={date} onChange={setDate} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
              {statementOnly ? (
                <Text className="font-body text-2xs text-muted-text mt-1">Counted in the statement that closes on this date.</Text>
              ) : null}
            </View>
          </View>

          {!statementOnly && (
          <View className="mt-3.5">
            <Text className={label}>Description (optional)</Text>
            <TextInput value={description} onChangeText={setDescription} placeholder="e.g. Zepto" className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs" />
          </View>
          )}

          {!statementOnly && (<>
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
          </>)}

          <Pressable onPress={handleSubmit} disabled={saving || !parsedAmount} className={`mt-3.5 min-h-11 rounded-xl bg-ledger-green items-center justify-center ${!saving && !parsedAmount ? 'opacity-40' : ''}`}>
            {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-white">{statementOnly ? 'Add Statement' : isRefund || parsedAmount < 0 ? 'Add Refund' : 'Add Transaction'}</Text>}
          </Pressable>
        </View>
      )}
    </Card>
  );
}
