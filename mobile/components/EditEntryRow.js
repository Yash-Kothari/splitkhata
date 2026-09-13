import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import PickerField from './PickerField';
import { cardShadow } from './Card';
import { updateExpense } from '../lib/firebase';
import { computeFifoCashAmount, formatFifoBreakdownSummary } from '../lib/utils';

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
  dbPaymentMethods = [],
  ledger = 'household',
  currentCurrency = 'INR',
  tripEntries = [],
  onCancel,
  onSaved,
  onSaveError,
}) {
  const isTravel = ledger === 'travel';
  const isSettlement = entry.splitType === 'settlement';
  const paymentMethodsList = dbPaymentMethods && dbPaymentMethods.length > 0 ? dbPaymentMethods : ['Cash'];

  const [amount, setAmount] = useState(String(entry.amount ?? ''));
  const [localAmount, setLocalAmount] = useState(entry.localAmount != null ? String(entry.localAmount) : '');
  const [rewardPoints, setRewardPoints] = useState(entry.rewardPoints != null ? String(entry.rewardPoints) : '');
  const [isWithdrawal, setIsWithdrawal] = useState(Boolean(entry.isWithdrawal));
  const [payer, setPayer] = useState(entry.payer);
  const [category, setCategory] = useState(entry.category);
  const [splitType, setSplitType] = useState(entry.splitType || (entry.split ? 'shared' : 'personal'));
  const [owedBy, setOwedBy] = useState(entry.owedBy || members.find((m) => m !== payer) || '');
  const [splitAmong, setSplitAmong] = useState(entry.splitAmong || members);
  const [paymentMethod, setPaymentMethod] = useState(
    entry.paymentMethod && paymentMethodsList.includes(entry.paymentMethod) ? entry.paymentMethod : paymentMethodsList[0] || 'Cash',
  );
  const [date, setDate] = useState(entry.date);
  const [note, setNote] = useState(entry.note || '');
  const [saving, setSaving] = useState(false);

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

  async function handleSave() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      if (isSettlement) {
        await updateExpense(entry.id, { amount: parsed, note: note.trim(), date });
      } else {
        const effectiveSplitAmong =
          splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < members.length ? splitAmong : null;
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
          paymentMethod: isTravel ? paymentMethod : null,
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
      setSaving(false);
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

        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Amount</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
        />

        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
        />

        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
        />

        <View className="flex-row gap-2">
          <Pressable onPress={onCancel} className="flex-1 min-h-11 rounded-xl border border-ink/15 items-center justify-center">
            <Text className="font-body-semibold text-sm text-ink">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving || !amount}
            className="flex-1 min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
          >
            {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-sm text-white">Save</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={cardShadow} className="mx-4 mb-4 p-4 rounded-2xl bg-paper-card border border-ledger-green/40">
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
        Amount (₹){isTravel ? ' - real cost' : ''}
      </Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        editable={!amountLocked}
        className={`font-mono text-base border border-ink/15 rounded-xl px-3 py-2.5 mb-3 ${
          amountLocked ? 'bg-paper/60 text-muted-text' : 'bg-paper text-ink'
        }`}
      />
      {amountLocked && fifoBreakdownText ? (
        <Text className="font-body text-2xs text-muted-text -mt-2 mb-3">{fifoBreakdownText}</Text>
      ) : null}

      {isTravel && (
        <>
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
            Local Amount ({currentCurrency})
          </Text>
          <TextInput
            value={localAmount}
            onChangeText={setLocalAmount}
            keyboardType="decimal-pad"
            className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
          />

          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Reward Points</Text>
          <TextInput
            value={rewardPoints}
            onChangeText={setRewardPoints}
            keyboardType="numbers-and-punctuation"
            className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
          />
        </>
      )}

      <View className="mb-3">
        <PickerField label="Split Type" value={splitType} options={SPLIT_TYPE_OPTIONS} onChange={setSplitType} />
      </View>

      <View className="mb-3">
        <PickerField label="Who Paid" value={payer} options={members} onChange={setPayer} />
      </View>

      {splitType === 'owed' && (
        <View className="mb-3">
          <PickerField
            label="Who Owes the Full Amount"
            value={owedBy}
            options={members.filter((m) => m !== payer)}
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

      {splitType === 'shared' && members.length > 2 && (
        <View className="mb-3">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Split Among</Text>
          <View className="flex-row flex-wrap">
            {members.map((m) => (
              <Chip key={m} label={m} selected={splitAmong.includes(m)} onPress={() => toggleSplitAmong(m)} />
            ))}
          </View>
        </View>
      )}

      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date (YYYY-MM-DD)</Text>
      <TextInput
        value={date}
        onChangeText={setDate}
        placeholder="2026-08-24"
        className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
      />

      {isTravel && (
        <Pressable onPress={() => setIsWithdrawal((v) => !v)} className="flex-row items-center gap-2.5 mb-3">
          <View
            className={`w-5 h-5 rounded border items-center justify-center ${
              isWithdrawal ? 'bg-ledger-green border-ledger-green' : 'border-ink/30 bg-paper'
            }`}
          >
            {isWithdrawal && <Text className="text-white text-xs">✓</Text>}
          </View>
          <Text className="font-body-semibold text-sm text-ink flex-1">Cash withdrawal (exclude from spend totals)</Text>
        </Pressable>
      )}

      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="What was this for?"
        className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
      />

      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} className="flex-1 min-h-11 rounded-xl border border-ink/15 items-center justify-center">
          <Text className="font-body-semibold text-sm text-ink">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving || !amount}
          className="flex-1 min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
        >
          {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-sm text-white">Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}
