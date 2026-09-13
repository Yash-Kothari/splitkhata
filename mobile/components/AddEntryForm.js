import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import PickerField from './PickerField';
import Card from './Card';
import { addExpense, addExpensesBatch } from '../lib/firebase';
import {
  DEFAULT_PERSONS as PERSONS,
  DEFAULT_CATEGORIES,
  DEFAULT_TRAVEL_CATEGORIES,
  todayISO,
  addMonthsToDateISO,
  splitAmountEvenly,
  computeFifoCashAmount,
  formatFifoBreakdownSummary,
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

// RN port of web's AddEntryForm.jsx - shared by Household and Travel.
// Quick Add / receipt-scan AI shortcuts are intentionally omitted (need
// Firebase App Check on RN, not set up yet); every field they'd auto-fill
// stays manually enterable, so no functionality is actually lost.
export default function AddEntryForm({
  deviceName,
  onSaveError,
  ledger = 'household',
  tripName = '',
  dbCategories,
  dbMembers = [],
  currentCurrency = 'INR',
  dbPaymentMethods = [],
  tripEntries = [],
}) {
  const isTravel = ledger === 'travel';
  const categories =
    dbCategories && dbCategories.length > 0 ? dbCategories : isTravel ? DEFAULT_TRAVEL_CATEGORIES : DEFAULT_CATEGORIES;
  const membersList = dbMembers && dbMembers.length > 0 ? dbMembers : PERSONS;
  const paymentMethodsList = dbPaymentMethods && dbPaymentMethods.length > 0 ? dbPaymentMethods : ['Cash'];

  const [amount, setAmount] = useState('');
  const [localAmount, setLocalAmount] = useState('');
  const [rewardPoints, setRewardPoints] = useState('');
  const [payer, setPayer] = useState(deviceName || membersList[0]);
  const [category, setCategory] = useState(categories[0] || 'Groceries');
  const [splitType, setSplitType] = useState('shared');
  const [owedBy, setOwedBy] = useState(() => membersList.find((p) => p !== (deviceName || membersList[0])) || '');
  const [splitAmong, setSplitAmong] = useState(membersList);
  const [paymentMethod, setPaymentMethod] = useState(paymentMethodsList[0] || 'Cash');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [splitAcrossMonths, setSplitAcrossMonths] = useState(false);
  const [monthsCount, setMonthsCount] = useState('6');

  const tripWithdrawals = useMemo(() => tripEntries.filter((e) => e.isWithdrawal), [tripEntries]);
  const otherCashEntries = useMemo(
    () => tripEntries.filter((e) => !e.isWithdrawal && e.paymentMethod === 'Cash'),
    [tripEntries],
  );
  const fifoResult = useMemo(() => {
    const parsedLocal = parseFloat(localAmount);
    if (!parsedLocal || parsedLocal <= 0) return null;
    return computeFifoCashAmount(tripWithdrawals, otherCashEntries, { id: null, date, createdAt: null, localAmount: parsedLocal });
  }, [tripWithdrawals, otherCashEntries, date, localAmount]);
  const fifoBreakdownText = useMemo(
    () => (fifoResult ? formatFifoBreakdownSummary(fifoResult.breakdown, currentCurrency) : ''),
    [fifoResult, currentCurrency],
  );
  const amountLocked = isTravel && paymentMethod === 'Cash' && fifoResult != null;

  useEffect(() => {
    if (categories.length && !categories.includes(category)) setCategory(categories[0]);
  }, [ledger, categories.join('|')]);

  useEffect(() => {
    if (deviceName && membersList.includes(deviceName)) {
      setPayer(deviceName);
    } else {
      setPayer((prev) => (membersList.includes(prev) ? prev : membersList[0]));
    }
  }, [deviceName, membersList.join('|')]);

  useEffect(() => {
    if (!owedBy || owedBy === payer || !membersList.includes(owedBy)) {
      setOwedBy(membersList.find((p) => p !== payer) || '');
    }
  }, [membersList.join('|'), owedBy, payer]);

  useEffect(() => {
    setSplitAmong(membersList);
  }, [membersList.join('|')]);

  useEffect(() => {
    if (paymentMethodsList.length && !paymentMethodsList.includes(paymentMethod)) {
      setPaymentMethod(paymentMethodsList[0]);
    }
  }, [paymentMethodsList.join('|')]);

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

  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      const trimmedNote = note.trim();
      const months = !isTravel && splitAcrossMonths ? Math.max(2, Math.min(36, Math.round(Number(monthsCount)) || 2)) : 1;
      const parsedLocal = isTravel && localAmount ? parseFloat(localAmount) : null;
      const parsedPoints = isTravel && rewardPoints ? parseFloat(rewardPoints) : null;
      const effectiveSplitAmong =
        splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < membersList.length ? splitAmong : null;

      if (months > 1) {
        const installmentAmounts = splitAmountEvenly(parsed, months);
        const installments = Array.from({ length: months }, (_, i) => ({
          amount: installmentAmounts[i],
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          splitAmong: effectiveSplitAmong,
          note: trimmedNote ? `${trimmedNote} (${i + 1}/${months})` : `Installment ${i + 1}/${months}`,
          date: addMonthsToDateISO(date, i),
          ledger,
          tripName: isTravel ? tripName : '',
          deviceName: deviceName || payer,
        }));
        await addExpensesBatch(installments);
      } else {
        await addExpense({
          amount: parsed,
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          splitAmong: effectiveSplitAmong,
          note: trimmedNote,
          date,
          ledger,
          tripName: isTravel ? tripName : '',
          paymentMethod: isTravel ? paymentMethod : null,
          localAmount: parsedLocal,
          rewardPoints: parsedPoints,
          deviceName: deviceName || payer,
        });
      }
      setAmount('');
      setLocalAmount('');
      setRewardPoints('');
      setNote('');
      setDate(todayISO());
      setSplitAcrossMonths(false);
      setMonthsCount('6');
      setSplitAmong(membersList);
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not save', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 mb-4">
      <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-center justify-between">
        <Text className="font-display text-lg font-bold text-ink">
          Add Entry{isTravel && tripName ? ` (${tripName})` : ''}
        </Text>
        <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          <Text className="font-body-semibold text-xs text-muted-text">{expanded ? 'Collapse' : 'Expand'}</Text>
        </View>
      </Pressable>

      {expanded && (
        <View className="mt-3">
          <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">
            Amount (₹){isTravel ? ' - real cost' : ''}
          </Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            editable={!amountLocked}
            placeholder="0.00"
            className={`font-mono text-base border border-ink/15 rounded-xl px-3 py-2.5 mb-3 ${
              amountLocked ? 'bg-paper/60 text-muted-text' : 'bg-paper text-ink'
            }`}
          />
          {amountLocked && fifoBreakdownText ? (
            <Text className="font-body text-2xs text-muted-text -mt-2 mb-3">{fifoBreakdownText}</Text>
          ) : null}

          {isTravel && (
            <>
              <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">
                Local Amount ({currentCurrency})
              </Text>
              <TextInput
                value={localAmount}
                onChangeText={setLocalAmount}
                keyboardType="decimal-pad"
                placeholder="Optional"
                className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
              />

              <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">
                Reward Points (+ spent / − earned)
              </Text>
              <TextInput
                value={rewardPoints}
                onChangeText={setRewardPoints}
                keyboardType="numbers-and-punctuation"
                placeholder="Optional"
                className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
              />
            </>
          )}

          <View className="mb-3">
            <PickerField label="Split Type" value={splitType} options={SPLIT_TYPE_OPTIONS} onChange={setSplitType} />
          </View>

          <View className="mb-3">
            <PickerField label="Who Paid" value={payer} options={membersList} onChange={setPayer} />
          </View>

          {splitType === 'owed' && (
            <View className="mb-3">
              <PickerField
                label="Who Owes the Full Amount"
                value={owedBy}
                options={membersList.filter((p) => p !== payer)}
                onChange={setOwedBy}
              />
            </View>
          )}

          <View className="mb-3">
            <PickerField label="Category" value={category} options={categories} onChange={setCategory} />
          </View>

          {isTravel && (
            <View className="mb-3">
              <PickerField label="Payment Method" value={paymentMethod} options={paymentMethodsList} onChange={setPaymentMethod} />
            </View>
          )}

          {splitType === 'shared' && membersList.length > 2 && (
            <View className="mb-3">
              <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">Split Among</Text>
              <View className="flex-row flex-wrap">
                {membersList.map((m) => (
                  <Chip key={m} label={m} selected={splitAmong.includes(m)} onPress={() => toggleSplitAmong(m)} />
                ))}
              </View>
              {splitAmong.length < membersList.length && (
                <Text className="font-body text-2xs text-muted-text mt-1">
                  Only split between {splitAmong.join(' and ')} - not everyone.
                </Text>
              )}
            </View>
          )}

          <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="2026-08-24"
            className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
          />

          <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What was this for?"
            className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
          />

          {!isTravel && (
            <View className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 mb-3">
              <Pressable onPress={() => setSplitAcrossMonths((v) => !v)} className="flex-row items-center gap-2.5">
                <View
                  className={`w-5 h-5 rounded border items-center justify-center ${
                    splitAcrossMonths ? 'bg-ledger-green border-ledger-green' : 'border-ink/30 bg-paper'
                  }`}
                >
                  {splitAcrossMonths && <Text className="text-white text-xs">✓</Text>}
                </View>
                <Text className="font-body-semibold text-sm text-ink flex-1">Split across multiple months</Text>
              </Pressable>
              <Text className="font-body text-2xs text-muted-text mt-1 ml-7">
                For lump-sum payments that cover several months - spreads the amount evenly across one entry per month.
              </Text>

              {splitAcrossMonths && (
                <View className="mt-3 ml-7 max-w-[8rem]">
                  <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">Number of Months</Text>
                  <TextInput
                    value={monthsCount}
                    onChangeText={setMonthsCount}
                    keyboardType="number-pad"
                    className="font-mono text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper"
                  />
                  {amount && parseFloat(amount) > 0 && (
                    <Text className="font-body text-2xs text-muted-text mt-1">
                      ~{(parseFloat(amount) / Math.max(2, Math.min(36, Math.round(Number(monthsCount)) || 2))).toFixed(2)} / month
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={saving || !amount}
            className="min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
          >
            {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-white">Add to Ledger</Text>}
          </Pressable>
        </View>
      )}
    </Card>
  );
}
