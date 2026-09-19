import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import PickerField from './PickerField';
import DateField from './DateField';
import { cardShadow } from './Card';
import { updateExpense, addCardTransaction, updateCardTransaction, deleteCardTransaction } from '../lib/firebase';
import { reportError } from '../lib/errorReporting';
import {
  buildPaymentInstruments,
  computeFifoCashAmount,
  formatFifoBreakdownSummary,
  inferCardRewardFields,
  resolveInstrument,
  resolveStrategyParamsForDate,
} from '../lib/utils';

const SPLIT_TYPE_OPTIONS = [
  { value: 'shared', label: 'Split' },
  { value: 'owed', label: 'Owed' },
  { value: 'personal', label: 'Personal' },
];

function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-2 rounded-xl border mr-2 mb-2 ${
        selected ? 'bg-ledger-green border-ledger-green' : 'bg-paper border-ink/15'
      }`}
    >
      <Text className={`font-body-semibold text-xs ${selected ? 'text-white' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}

// RN port of web's EditEntryRow.jsx - shared by Household and Travel.
export default function EditEntryRow({
  entry,
  categories,
  members,
  instruments: instrumentsProp,
  creditCards = [],
  ledger = 'household',
  currentCurrency = 'INR',
  tripEntries = [],
  onCancel,
  onSaved,
  onSaveError,
}) {
  const isTravel = ledger === 'travel';
  const isSettlement = entry.splitType === 'settlement';
  const instruments = useMemo(
    () => (instrumentsProp && instrumentsProp.length ? instrumentsProp : buildPaymentInstruments([{ name: 'Cash' }], creditCards)),
    [instrumentsProp, creditCards],
  );
  const paymentMethodOptions = instruments.map((i) => i.label);

  const [amount, setAmount] = useState(String(entry.amount ?? ''));
  const [localAmount, setLocalAmount] = useState(entry.localAmount != null ? String(entry.localAmount) : '');
  const [rewardPoints, setRewardPoints] = useState(entry.rewardPoints != null ? String(entry.rewardPoints) : '');
  const [isWithdrawal, setIsWithdrawal] = useState(Boolean(entry.isWithdrawal));
  const [payer, setPayer] = useState(entry.payer);
  const [category, setCategory] = useState(entry.category);
  const [splitType, setSplitType] = useState(entry.splitType || (entry.split ? 'shared' : 'personal'));
  const [owedBy, setOwedBy] = useState(entry.owedBy || members.find((m) => m !== payer) || '');
  const [splitAmong, setSplitAmong] = useState(entry.splitAmong || members);
  // Legacy household entries may have no payment method at all - keep that
  // as-is unless it's changed, rather than silently stamping "Cash" on save.
  const [paymentMethod, setPaymentMethod] = useState(resolveInstrument(instruments, entry)?.label || entry.paymentMethod || '');
  const selectedInstrument = instruments.find((i) => i.label === paymentMethod) || null;
  const [date, setDate] = useState(entry.date);
  const [note, setNote] = useState(entry.note || '');
  const [saving, setSaving] = useState(false);
  const [slowSave, setSlowSave] = useState(false);

  const tripWithdrawals = useMemo(() => tripEntries.filter((e) => e.isWithdrawal), [tripEntries]);
  const otherCashEntries = useMemo(
    () => tripEntries.filter((e) => !e.isWithdrawal && e.paymentMethod === 'Cash'),
    [tripEntries],
  );
  const fifoResult = useMemo(() => {
    const parsedLocal = parseFloat(localAmount);
    if (!parsedLocal || parsedLocal <= 0) return null;
    return computeFifoCashAmount(tripWithdrawals, otherCashEntries, {
      id: entry.id,
      date,
      createdAt: entry.createdAt,
      localAmount: parsedLocal,
    });
  }, [tripWithdrawals, otherCashEntries, date, localAmount, entry.id, entry.createdAt]);
  const amountLocked = isTravel && paymentMethod === 'Cash' && fifoResult != null;
  const fifoBreakdownText = useMemo(
    () => (fifoResult ? formatFifoBreakdownSummary(fifoResult.breakdown, currentCurrency) : ''),
    [fifoResult, currentCurrency],
  );

  useEffect(() => {
    if (!isTravel || paymentMethod !== 'Cash' || fifoResult == null) return;
    setAmount(fifoResult.amount.toString());
  }, [fifoResult, paymentMethod, isTravel]);

  function toggleSplitAmong(name) {
    setSplitAmong((prev) => {
      if (prev.includes(name)) {
        const next = prev.filter((p) => p !== name);
        return next.length > 0 ? next : prev;
      }
      return [...prev, name];
    });
  }

  // Keeps the card transaction an entry created in step with the entry:
  // unchanged card -> update its amount/date/note; different or no card ->
  // drop the old one and, if the new instrument is a card, create its own.
  // Best-effort like AddEntryForm's link - a failure keeps the previous
  // link instead of blocking the entry save.
  async function syncCardLink(parsedAmount) {
    const oldTxnId = entry.cardTransactionId || null;
    const oldCardId = resolveInstrument(instruments, entry)?.cardId || null;
    const newCardId = selectedInstrument?.cardId || null;
    try {
      if (oldTxnId && newCardId && oldCardId === newCardId) {
        const updates = { amount: parsedAmount, date, note: note.trim() };
        if (category !== entry.category) {
          const card = creditCards.find((c) => c.id === newCardId);
          Object.assign(updates, inferCardRewardFields(card, category, resolveStrategyParamsForDate(card?.strategyParamsHistory, date)));
        }
        await updateCardTransaction(oldTxnId, updates);
        return oldTxnId;
      }
      if (oldTxnId) await deleteCardTransaction(oldTxnId);
      if (!newCardId) return null;
      const card = creditCards.find((c) => c.id === newCardId);
      return await addCardTransaction({
        cardId: newCardId,
        amount: parsedAmount,
        date,
        note: note.trim(),
        linkedEntryId: entry.id,
        ...inferCardRewardFields(card, category, resolveStrategyParamsForDate(card?.strategyParamsHistory, date)),
      });
    } catch (err) {
      reportError(err, 'Saved the entry, but could not update its linked card transaction');
      return oldTxnId;
    }
  }

  async function handleSave() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    const slowTimer = setTimeout(() => setSlowSave(true), 2500);
    try {
      if (isSettlement) {
        await updateExpense(entry.id, { amount: parsed, note: note.trim(), date });
      } else {
        const effectiveSplitAmong =
          splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < members.length ? splitAmong : null;
        const cardTransactionId = await syncCardLink(parsed);
        await updateExpense(entry.id, {
          amount: parsed,
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          splitAmong: effectiveSplitAmong,
          note: note.trim(),
          date,
          paymentMethod: paymentMethod || null,
          paymentInstrumentId: selectedInstrument?.id || null,
          cardTransactionId,
          localAmount: isTravel && localAmount ? parseFloat(localAmount) : null,
          rewardPoints: isTravel && rewardPoints ? parseFloat(rewardPoints) : null,
          isWithdrawal: isTravel ? isWithdrawal : false,
        });
      }
      onSaved?.();
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not save', err?.message || String(err));
    } finally {
      clearTimeout(slowTimer);
      setSaving(false);
      setSlowSave(false);
    }
  }

  if (isSettlement) {
    return (
      <View style={cardShadow} className="mx-4 mb-4 p-4 rounded-2xl bg-paper-card border border-ledger-green/40">
        <Text className="font-body text-sm text-ink mb-3">
          <Text className="font-body-semibold text-stamp-red">{entry.payer}</Text>
          <Text> paid </Text>
          <Text className="font-body-semibold text-ledger-green">{entry.owedBy}</Text>
        </Text>

        <View className="flex-row flex-wrap" style={{ gap: 12 }}>
          <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
              Amount ({isTravel ? currentCurrency : '₹'})
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              className="font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
            />
          </View>

          <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
            <DateField
              value={date}
              onChange={setDate}
              className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
            />
          </View>

          <View className="w-full sm:w-[calc(33.333%-8px)]">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
            />
          </View>
        </View>

        <View className="flex-row gap-2 mt-3">
          <Pressable onPress={onCancel} className="flex-1 min-h-11 rounded-xl border border-ink/15 items-center justify-center">
            <Text className="font-body-semibold text-sm text-ink">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving || !amount}
            className="flex-1 min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
          >
            {saving ? (
              <Text className="font-body-semibold text-sm text-white">{slowSave ? 'Still saving…' : 'Saving...'}</Text>
            ) : (
              <Text className="font-body-semibold text-sm text-white">Save</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={cardShadow} className="mx-4 mb-4 p-4 rounded-2xl bg-paper-card border border-ledger-green/40">
      <View className="flex-row flex-wrap" style={{ gap: 12 }}>
        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
            Amount (₹){isTravel ? ' - real cost' : ''}
          </Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            editable={!amountLocked}
            className={`font-mono-bold text-sm border border-ink/15 rounded-xl px-3 py-2.5 ${
              amountLocked ? 'bg-paper/60 text-muted-text' : 'bg-paper text-ink'
            }`}
          />
          {amountLocked && fifoBreakdownText ? (
            <Text className="font-body text-2xs text-muted-text mt-1">{fifoBreakdownText}</Text>
          ) : null}
        </View>

        {isTravel && (
          <>
            <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
                Local Amount ({currentCurrency})
              </Text>
              <TextInput
                value={localAmount}
                onChangeText={setLocalAmount}
                keyboardType="decimal-pad"
                placeholder="Optional"
                className="font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
              />
            </View>

            <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
                Reward Points (+ spent / − earned)
              </Text>
              <TextInput
                value={rewardPoints}
                onChangeText={setRewardPoints}
                keyboardType="numbers-and-punctuation"
                placeholder="Optional"
                className="font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
              />
            </View>
          </>
        )}

        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
          <PickerField label="Split Type" value={splitType} options={SPLIT_TYPE_OPTIONS} onChange={setSplitType} />
        </View>

        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
          <PickerField label="Who Paid" value={payer} options={members} onChange={setPayer} />
        </View>

        {splitType === 'owed' && (
          <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
            <PickerField
              label="Who Owes the Full Amount"
              value={owedBy}
              options={members.filter((m) => m !== payer)}
              onChange={setOwedBy}
            />
          </View>
        )}

        {splitType === 'shared' && members.length > 2 && (
          <View className="w-full">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Split Among</Text>
            <View className="flex-row flex-wrap">
              {members.map((m) => (
                <Chip key={m} label={m} selected={splitAmong.includes(m)} onPress={() => toggleSplitAmong(m)} />
              ))}
            </View>
          </View>
        )}

        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)] order-last lg:order-none">
          <PickerField label="Category" value={category} options={categories} onChange={setCategory} />
        </View>

        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
          <PickerField label="Payment Method" value={paymentMethod || 'Not set'} options={paymentMethodOptions} onChange={setPaymentMethod} />
        </View>

        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
          <DateField
            value={date}
            onChange={setDate}
            className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
          />
        </View>

        {isTravel && (
          <View className="w-full">
            <Pressable onPress={() => setIsWithdrawal((v) => !v)} className="flex-row items-center gap-2.5">
              <View
                className={`w-4 h-4 rounded border items-center justify-center ${
                  isWithdrawal ? 'bg-ledger-green border-ledger-green' : 'border-ink/30 bg-paper'
                }`}
              >
                {isWithdrawal && <Text className="text-white text-xs">✓</Text>}
              </View>
              <Text className="font-body-semibold text-sm text-ink flex-1">Cash withdrawal (exclude from spend totals)</Text>
            </Pressable>
          </View>
        )}

        <View className="w-full">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What was this for?"
            className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
          />
        </View>
      </View>

      <View className="flex-row gap-2 mt-3">
        <Pressable onPress={onCancel} className="flex-1 min-h-11 rounded-xl border border-ink/15 items-center justify-center">
          <Text className="font-body-semibold text-sm text-ink">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving || !amount}
          className="flex-1 min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
        >
          {saving ? (
            <Text className="font-body-semibold text-sm text-white">{slowSave ? 'Still saving…' : 'Saving...'}</Text>
          ) : (
            <Text className="font-body-semibold text-sm text-white">Save</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
