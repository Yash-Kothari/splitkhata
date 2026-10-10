import { useState } from 'react';
import { View, Text, TextInput, Pressable, Keyboard } from 'react-native';
import { notify } from '../lib/dialogs';
import PickerField from './PickerField';
import DateField from './DateField';
import EntryFormFields from './EntryFormFields';
import { cardShadow } from './Card';
import { useEntryForm } from '../lib/useEntryForm';
import { updateExpense, updateExpenseWithCard } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { reportError } from '../lib/errorReporting';
import {
  parseCustomShares,
  inferCardRewardFields,
  isStatementOnlyCard,
  resolveInstrument,
  resolveStrategyParamsForDate,
  parseAmountInput,
  isValidISODate,
  isWithdrawalEntry,
  parseTagsInput,
} from '../lib/utils';

// Edit Entry. The fields, defaults and validation are the same ones Add Entry
// uses (useEntryForm + EntryFormFields); what lives here is only what belongs to
// changing an existing entry: keeping its card transaction in step, the save,
// and the small settlement form.
export default function EditEntryRow({
  entry,
  categories,
  members,
  instruments: instrumentsProp,
  creditCards = [],
  cardTransactions = [],
  ledger = 'household',
  currentCurrency = 'INR',
  tripEntries = [],
  onCancel,
  onSaved,
  onSaveError,
}) {
  const isTravel = ledger === 'travel';
  const isSettlement = entry.splitType === 'settlement';
  const f = useEntryForm({
    entry,
    ledger,
    categories,
    members,
    instruments: instrumentsProp,
    creditCards,
    cardTransactions,
    currentCurrency,
    tripEntries,
  });
  const { amount, payer, category, splitType, owedBy, splitAmong, customShares, date, note, paymentMethod, selectedInstrument } = f;
  const [saving, setSaving] = useState(false);

  // Keeps the card transaction an entry created in step with the entry:
  // unchanged card -> update its amount/date/note; different or no card ->
  // drop the old one and, if the new instrument is a card, create its own.
  // "Don't add to the card" (a closed statement) means no card transaction at
  // all, so ticking it here removes the existing one. Best-effort like Add
  // Entry's link - a failure keeps the previous link instead of blocking the
  // entry save.
  function planCardLink(parsedAmount) {
    const oldTxnId = entry.cardTransactionId || null;
    const trackedCardId = (id) => (id && !isStatementOnlyCard(creditCards.find((c) => c.id === id)) ? id : null);
    const oldCardId = trackedCardId(resolveInstrument(f.instruments, entry)?.cardId || null);
    // A ₹0 entry has no spend to earn on, so it carries no card transaction.
    const newCardId = parsedAmount === 0 || f.cardSkipped ? null : trackedCardId(selectedInstrument?.cardId || null);
    try {
      if (oldTxnId && newCardId && oldCardId === newCardId) {
        const updates = { amount: parsedAmount, date, description: note.trim() || category };
        // Re-infer the card transaction's reward fields only when this edit
        // actually changes what they should be: the multiplier box was changed
        // (including cleared), or the category changed on a transaction that
        // wasn't a booking. An existing booking survives a category change
        // unless its multiplier is cleared - otherwise re-inferring with the
        // box's value would wipe a booking set here or in the Cards tab.
        const multiplierChanged = f.showTravelMultiplier && f.effectiveTravelMultiplier !== f.initialTravelMultiplier;
        if (multiplierChanged || (category !== entry.category && !f.wasBooking)) {
          const card = creditCards.find((c) => c.id === newCardId);
          Object.assign(
            updates,
            inferCardRewardFields(card, category, resolveStrategyParamsForDate(card?.strategyParamsHistory, date), f.effectiveTravelMultiplier, { bookings: !isTravel }),
          );
        }
        return { kind: 'update', id: oldTxnId, updates };
      }
      if (!oldTxnId && !newCardId) return { kind: 'none', id: null };
      let newData = null;
      if (newCardId) {
        const newCard = creditCards.find((c) => c.id === newCardId);
        newData = {
          cardId: newCardId,
          amount: parsedAmount,
          date,
          description: note.trim() || category,
          linkedEntryId: entry.id,
          ...inferCardRewardFields(newCard, category, resolveStrategyParamsForDate(newCard?.strategyParamsHistory, date), f.effectiveTravelMultiplier, { bookings: !isTravel }),
        };
      }
      return { kind: 'replace', oldId: oldTxnId, newData };
    } catch (err) {
      reportError(err, 'Saved the entry, but could not update its linked card transaction');
      return { kind: 'none', id: oldTxnId };
    }
  }

  async function handleSave() {
    // Bad input used to make Save silently do nothing, or save wrong
    // ("1,200" as ₹1, a typed date that no month view could find).
    const parsed = parseAmountInput(amount);
    // 0 is allowed (a stay paid entirely with reward points).
    if (parsed == null) {
      notify('Check the amount', 'Enter an amount like 1200 or 1200.50.');
      return;
    }
    if (!isValidISODate(date)) {
      notify('Check the date', 'Use the format YYYY-MM-DD.');
      return;
    }
    if (splitType === 'owed' && (!owedBy || owedBy === payer)) {
      notify('Pick who owes', 'The person who owes must be different from who paid.');
      return;
    }
    const parsedLocal = isTravel && f.localAmount ? parseAmountInput(f.localAmount) : null;
    if (isTravel && f.localAmount && !(parsedLocal > 0)) {
      notify('Check the local amount', 'Enter an amount like 1200 or 1200.50, or leave it empty.');
      return;
    }
    const parsedPoints = f.hasPoints && f.rewardPoints ? parseAmountInput(f.rewardPoints, { allowNegative: true }) : null;
    if (f.hasPoints && f.rewardPoints && parsedPoints == null) {
      notify('Check the reward points', 'Enter points like 1500 or -250, or leave it empty.');
      return;
    }
    setSaving(true);
    const save = async () => {
      if (isSettlement) {
        await updateExpense(entry.id, {
          amount: parsed,
          note: note.trim(),
          date,
          paymentMethod: paymentMethod || null,
          paymentInstrumentId: selectedInstrument?.id || null,
          paymentType: selectedInstrument?.type || null,
        });
      } else {
        const effectiveSplitAmong =
          splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < members.length ? splitAmong : null;
        // The card side is planned here and written in the same commit as the
        // entry (one server round trip, atomic), not before it.
        const cardChange = planCardLink(parsed);
        await updateExpenseWithCard(entry.id, {
          amount: parsed,
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          splitAmong: splitType === 'custom' ? null : effectiveSplitAmong,
          splitShares: splitType === 'custom' ? parseCustomShares(customShares) : null,
          splitMode: splitType === 'custom' && f.splitMode === 'ratio' ? 'ratio' : null,
          note: note.trim(),
          tags: parseTagsInput(f.tagsText),
          date,
          paymentMethod: paymentMethod || null,
          paymentInstrumentId: selectedInstrument?.id || null,
          paymentType: selectedInstrument?.type || null,
          skipCardTracking: f.cardSkipped || null,
          localAmount: parsedLocal,
          rewardPoints: parsedPoints,
          // Withdrawals are only created from Trip Settings; editing one keeps
          // it, and a stale flag on a cash-paid entry is dropped here.
          isWithdrawal: isTravel && isWithdrawalEntry(entry),
        }, cardChange);
      }
    };
    // Wait for the server's acknowledgement only briefly (see settleOrHandOff):
    // the edit is already visible everywhere, so the form closes and a late
    // failure is reported afterwards.
    const outcome = await settleOrHandOff(save(), (error) => {
      onSaveError?.(error);
      notify('Could not save', error?.message || String(error));
    });
    setSaving(false);
    if (outcome.status === 'error') {
      onSaveError?.(outcome.error);
      notify('Could not save', outcome.error?.message || String(outcome.error));
      return;
    }
    onSaved?.();
  }

  const saveDisabled = saving || !amount || f.customSplitInvalid || (!isSettlement && f.inputInvalid);
  const buttons = (
    <View className="flex-row gap-2 mt-3">
      <Pressable onPress={onCancel} className="flex-1 min-h-11 rounded-xl border border-ink/15 items-center justify-center">
        <Text className="font-body-semibold text-sm text-ink">Cancel</Text>
      </Pressable>
      <Pressable
        onPress={handleSave}
        disabled={saveDisabled}
        className={`flex-1 min-h-11 rounded-xl bg-ledger-green items-center justify-center ${!saving && saveDisabled ? 'opacity-40' : ''}`}
      >
        <Text className="font-body-semibold text-sm text-white">{saving ? 'Saving...' : 'Save'}</Text>
      </Pressable>
    </View>
  );

  // A settlement is just a payment between the two of you: amount, date, how it
  // was paid and a note - no category, split or card.
  if (isSettlement) {
    return (
      <View style={cardShadow} className="mx-4 my-3 p-4 rounded-2xl bg-paper-card border border-ledger-green/40">
        <Text className="font-body text-sm text-ink mb-3">
          <Text className="font-body-semibold text-stamp-red">{entry.payer}</Text>
          <Text> paid </Text>
          <Text className="font-body-semibold text-ledger-green">{entry.owedBy}</Text>
        </Text>

        <View className="flex-row flex-wrap" style={{ gap: 14 }}>
          <View className="w-[47%] sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
              Amount ({isTravel ? currentCurrency : '₹'})
            </Text>
            <TextInput
              value={amount}
              onChangeText={f.setAmount}
              keyboardType="decimal-pad"
              className="font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
            />
          </View>

          <View className="w-[47%] sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
            <DateField
              value={date}
              onChange={f.setDate}
              className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
            />
          </View>

          <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
            <PickerField
              label="Payment Method"
              value={paymentMethod}
              options={[{ value: '', label: 'None' }, ...f.paymentMethodOptions]}
              onChange={f.setPaymentMethod}
            />
          </View>

          <View className="w-full lg:w-[calc(33.333%-9.333px)]">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={f.setNote}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
            />
          </View>
        </View>

        {buttons}
      </View>
    );
  }

  return (
    <View style={cardShadow} className="mx-4 my-3 p-4 rounded-2xl bg-paper-card border border-ledger-green/40">
      <EntryFormFields f={f} categories={categories} members={members} currentCurrency={currentCurrency} />
      {buttons}
    </View>
  );
}
