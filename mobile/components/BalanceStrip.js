import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import PickerField from './PickerField';
import Card from './Card';
import { addExpense, updateExpense, deleteExpense, updateTripInDb, generateDigest } from '../lib/firebase';
import {
  formatCurrency,
  computeBalance,
  computeSettlements,
  computeMemberTotals,
  excludeCashSpend,
  computeTripTotalSpend,
  getTripLastDate,
  todayISO,
  PERSON_COLORS,
  groupByCategory,
  buildTripDigestPrompt,
} from '../lib/utils';

// RN port of web's BalanceStrip.jsx - household net balance, or (ledger=
// 'travel') a trip summary: guest settlements, reward points, total spend,
// and a rollup-to-household action.
export default function BalanceStrip({ entries, ledger, dbMembers = [], tripName = '', tripId = '', tripRollup = null, onSaveError }) {
  const isTravel = ledger === 'travel';
  const balanceEntries = useMemo(() => (isTravel ? excludeCashSpend(entries) : entries), [entries, isTravel]);
  const balance = useMemo(() => computeBalance(balanceEntries, ledger, dbMembers), [balanceEntries, ledger, dbMembers]);
  const ledgerLabel = isTravel ? 'Travel' : 'Household';
  const hasGuests = isTravel && dbMembers.length > 2;
  const settlements = useMemo(
    () => (hasGuests ? computeSettlements(balanceEntries, ledger, dbMembers) : null),
    [hasGuests, balanceEntries, ledger, dbMembers],
  );
  const memberTotals = useMemo(
    () => (isTravel ? computeMemberTotals(balanceEntries, dbMembers) : null),
    [balanceEntries, dbMembers, isTravel],
  );

  const hasPoints = isTravel && entries.some((e) => Number(e.rewardPoints || 0) !== 0);
  const pointsBalance = useMemo(
    () => (hasPoints && !hasGuests ? computeBalance(entries, ledger, dbMembers, 'rewardPoints') : null),
    [hasPoints, hasGuests, entries, ledger, dbMembers],
  );
  const pointsSettlements = useMemo(
    () => (hasPoints && hasGuests ? computeSettlements(entries, ledger, dbMembers, 'rewardPoints') : null),
    [hasPoints, hasGuests, entries, ledger, dbMembers],
  );
  const totalPointsSpent = useMemo(
    () => (isTravel ? entries.reduce((sum, e) => sum + Number(e.rewardPoints || 0), 0) : 0),
    [entries, isTravel],
  );
  const pointsMemberTotals = useMemo(
    () => (hasPoints ? computeMemberTotals(entries, dbMembers, 'rewardPoints') : null),
    [entries, dbMembers, hasPoints],
  );
  const totalSpend = useMemo(() => (isTravel ? computeTripTotalSpend(entries) : null), [entries, isTravel]);
  const displayCurrency = 'INR';
  const categoryBreakdown = useMemo(() => (isTravel ? groupByCategory(entries, null, 'travel') : null), [entries, isTravel]);
  const digestPrompt = useMemo(() => {
    if (!isTravel) return null;
    const settlementLines = hasGuests
      ? (settlements || []).map((s) => `${s.debtor} owes ${s.creditor} ${formatCurrency(s.amount, displayCurrency)}`)
      : balance.status !== 'settled'
        ? [`${balance.debtor} owes ${balance.creditor} ${formatCurrency(balance.amount, displayCurrency)}`]
        : [];
    return buildTripDigestPrompt({ tripName, currency: displayCurrency, totalSpend, memberTotals, categoryBreakdown, settlementLines });
  }, [isTravel, hasGuests, settlements, balance, tripName, displayCurrency, totalSpend, memberTotals, categoryBreakdown]);
  const [digest, setDigest] = useState({ status: 'idle', text: '', error: '' });

  async function handleGenerateDigest() {
    setDigest({ status: 'loading', text: '', error: '' });
    try {
      const text = await generateDigest(digestPrompt);
      setDigest({ status: 'done', text, error: '' });
    } catch (err) {
      setDigest({ status: 'error', text: '', error: err?.message || 'Could not generate digest.' });
    }
  }

  const rollupStale = Boolean(
    tripRollup &&
      (Math.abs(tripRollup.amount - balance.amount) > 0.01 || tripRollup.debtor !== balance.debtor || tripRollup.creditor !== balance.creditor),
  );
  const rollupNowSettled = Boolean(tripRollup && balance.status === 'settled');

  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState('');
  const [settlePayer, setSettlePayer] = useState('');
  const [settleOwedBy, setSettleOwedBy] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingRollup, setConfirmingRollup] = useState(false);
  const [rollingUp, setRollingUp] = useState(false);

  function startSettling() {
    const [defaultPayer, defaultOwedBy] =
      balance.status === 'settled' ? [dbMembers[0] || '', dbMembers[1] || ''] : [balance.debtor, balance.creditor];
    setAmount(balance.status === 'settled' ? '' : balance.amount.toFixed(2));
    setSettlePayer(defaultPayer);
    setSettleOwedBy(defaultOwedBy);
    setDate(todayISO());
    setNote('');
    setSettling(true);
  }

  const parsedAmount = parseFloat(amount) || 0;
  const previewBalance = useMemo(() => {
    if (!parsedAmount || !settlePayer || !settleOwedBy || settlePayer === settleOwedBy) return null;
    return computeBalance(
      [...balanceEntries, { amount: parsedAmount, payer: settlePayer, owedBy: settleOwedBy, splitType: 'settlement', split: true, ledger }],
      ledger,
      dbMembers,
    );
  }, [balanceEntries, parsedAmount, settlePayer, settleOwedBy, ledger, dbMembers]);

  async function handleConfirm() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0 || !settlePayer || !settleOwedBy || settlePayer === settleOwedBy) return;
    setSaving(true);
    try {
      await addExpense({
        amount: parsed,
        payer: settlePayer,
        owedBy: settleOwedBy,
        splitType: 'settlement',
        split: true,
        category: 'Settlement',
        note: note.trim(),
        date,
        ledger,
        tripName: isTravel ? tripName : '',
      });
      setSettling(false);
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not save', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRollup() {
    setRollingUp(true);
    try {
      if (rollupNowSettled) {
        await deleteExpense(tripRollup.entryId);
        if (tripId) {
          await updateTripInDb(tripId, { rolledUpEntryId: null, rolledUpAmount: null, rolledUpDebtor: null, rolledUpCreditor: null });
        }
      } else {
        const rollupRewardPoints = hasPoints && pointsBalance && pointsBalance.status !== 'settled' ? pointsBalance.amount : null;
        let entryId = tripRollup?.entryId;
        if (entryId) {
          await updateExpense(entryId, {
            amount: balance.amount,
            payer: balance.creditor,
            owedBy: balance.debtor,
            rewardPoints: rollupRewardPoints,
          });
        } else {
          const lastEntryDate = getTripLastDate(entries) || todayISO();
          entryId = await addExpense({
            amount: balance.amount,
            payer: balance.creditor,
            owedBy: balance.debtor,
            splitType: 'owed',
            split: true,
            category: 'Trip',
            note: `From ${tripName} trip`,
            date: lastEntryDate,
            ledger: 'household',
            tripName: '',
            isTripRollup: true,
            rewardPoints: rollupRewardPoints,
          });
        }
        if (tripId) {
          await updateTripInDb(tripId, {
            rolledUpEntryId: entryId,
            rolledUpAmount: balance.amount,
            rolledUpDebtor: balance.debtor,
            rolledUpCreditor: balance.creditor,
          });
        }
      }
      setConfirmingRollup(false);
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not update', err?.message || String(err));
    } finally {
      setRollingUp(false);
    }
  }

  return (
    <Card className="px-5 py-4 mb-4">
      <View className="flex-col sm:flex-row sm:items-start sm:justify-between" style={{ gap: 16 }}>
      <View className="sm:flex-1">
      <Text className="font-display text-lg text-ink mb-1">
        {isTravel ? 'Trip Summary' : 'Household Net Balance'}
      </Text>

      {hasGuests ? (
        settlements.length === 0 ? (
          <Text className="font-body-semibold text-base text-ledger-green">All settled up - no one owes anyone</Text>
        ) : (
          <View className="gap-1">
            {settlements.map((s) => (
              <Text key={`${s.debtor}-${s.creditor}`} className="font-body text-base text-ink">
                <Text className="font-body-semibold text-stamp-red">{s.debtor}</Text>
                <Text> owes </Text>
                <Text className="font-body-semibold text-ledger-green">{s.creditor}</Text>
                <Text> </Text>
                <Text className="font-mono text-lg text-ink">{formatCurrency(s.amount, displayCurrency)}</Text>
              </Text>
            ))}
          </View>
        )
      ) : balance.status === 'settled' ? (
        <Text className="font-body-semibold text-base text-ledger-green">All settled up - no one owes anyone</Text>
      ) : (
        <Text className="font-body text-base text-ink">
          <Text className="font-body-semibold text-stamp-red">{balance.debtor}</Text>
          <Text> owes </Text>
          <Text className="font-body-semibold text-ledger-green">{balance.creditor}</Text>
          <Text> </Text>
          <Text className="font-mono text-lg text-ink">{formatCurrency(balance.amount, displayCurrency)}</Text>
        </Text>
      )}

      {isTravel && totalSpend > 0 && (
        <Text className="font-body text-sm text-muted-text mt-1">
          Total trip expense: <Text className="font-mono text-ink">{formatCurrency(totalSpend, displayCurrency)}</Text>
        </Text>
      )}

      {isTravel && totalPointsSpent !== 0 && (
        <Text className="font-body text-sm text-muted-text mt-1">
          💳 Points {totalPointsSpent > 0 ? 'spent' : 'earned'}:{' '}
          <Text className="font-mono text-ink">{Math.abs(Math.round(totalPointsSpent)).toLocaleString('en-IN')} pts</Text>
        </Text>
      )}

      {hasGuests && hasPoints ? (
        pointsSettlements.length === 0 ? (
          <Text className="font-body-medium text-sm text-ledger-green mt-1">💳 All settled up in points</Text>
        ) : (
          pointsSettlements.map((s) => (
            <Text key={`pts-${s.debtor}-${s.creditor}`} className="font-body text-sm text-muted-text mt-1">
              💳 <Text className="font-body-semibold text-stamp-red">{s.debtor}</Text>
              <Text> owes </Text>
              <Text className="font-body-semibold text-ledger-green">{s.creditor}</Text>
              <Text> </Text>
              <Text className="font-mono text-ink">{Math.round(s.amount).toLocaleString('en-IN')} pts</Text>
            </Text>
          ))
        )
      ) : !hasGuests && hasPoints ? (
        pointsBalance.status === 'settled' ? (
          <Text className="font-body-medium text-sm text-ledger-green mt-1">💳 All settled up in points</Text>
        ) : (
          <Text className="font-body text-sm text-muted-text mt-1">
            💳 <Text className="font-body-semibold text-stamp-red">{pointsBalance.debtor}</Text>
            <Text> owes </Text>
            <Text className="font-body-semibold text-ledger-green">{pointsBalance.creditor}</Text>
            <Text> </Text>
            <Text className="font-mono text-ink">{Math.round(pointsBalance.amount).toLocaleString('en-IN')} pts</Text>
          </Text>
        )
      ) : null}

      {isTravel && dbMembers.length > 0 && (
        <View className="mt-3 pt-3 border-t border-ink/10 flex-row flex-wrap gap-x-4 gap-y-1.5">
          {dbMembers.map((m) => (
            <View key={m} className="flex-row items-center gap-1.5">
              <View className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PERSON_COLORS[m] || '#3D7068' }} />
              <Text className="text-xs text-muted-text">{m}</Text>
              <Text className="font-mono text-xs text-ink">{formatCurrency(memberTotals?.[m] || 0)}</Text>
            </View>
          ))}
        </View>
      )}

      {hasPoints && dbMembers.length > 0 && (
        <View className="mt-1.5 flex-row flex-wrap gap-x-4 gap-y-1.5">
          {dbMembers.map((m) => (
            <View key={m} className="flex-row items-center gap-1.5">
              <View className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PERSON_COLORS[m] || '#3D7068' }} />
              <Text className="text-xs text-muted-text">{m}</Text>
              <Text className="font-mono text-xs text-ink">
                💳 {Math.round(pointsMemberTotals?.[m] || 0).toLocaleString('en-IN')} pts
              </Text>
            </View>
          ))}
        </View>
      )}

      {isTravel && totalSpend > 0 && (
        <View className="mt-3 pt-3 border-t border-ink/10">
          {digest.status === 'idle' || digest.status === 'error' ? (
            <Pressable
              onPress={handleGenerateDigest}
              className="min-h-8 px-3 rounded-lg border border-ledger-green/30 bg-ledger-green/10 items-center justify-center self-start"
            >
              <Text className="font-body-semibold text-xs text-ledger-green">✨ AI Digest</Text>
            </Pressable>
          ) : digest.status === 'loading' ? (
            <Text className="font-body text-xs text-muted-text">✨ Writing digest...</Text>
          ) : (
            <View className="rounded-lg border border-ledger-green/20 bg-ledger-green/5 px-3 py-2.5">
              <Text className="font-body text-sm text-ink leading-relaxed">{digest.text}</Text>
              <Pressable onPress={() => setDigest({ status: 'idle', text: '', error: '' })} className="mt-2 self-start">
                <Text className="font-body text-xs text-muted-text underline">Dismiss</Text>
              </Pressable>
            </View>
          )}
          {digest.status === 'error' && <Text className="font-body text-xs text-stamp-red mt-1.5">{digest.error}</Text>}
        </View>
      )}
      </View>

      <View className="flex-col sm:flex-row sm:items-center w-full sm:w-auto mt-3 sm:mt-0" style={{ gap: 8 }}>
      {isTravel ? (
        hasGuests ? (
          <Text className="font-body text-2xs text-muted-text">Settle with guests separately - can't roll into household.</Text>
        ) : confirmingRollup ? null : rollupNowSettled ? (
          <Pressable onPress={() => setConfirmingRollup(true)} className="w-full sm:w-auto min-h-9 px-3.5 rounded-lg bg-mustard/90 items-center justify-center">
            <Text className="font-body-semibold text-xs text-white">Remove from Main Ledger</Text>
          </Pressable>
        ) : rollupStale ? (
          <Pressable onPress={() => setConfirmingRollup(true)} className="w-full sm:w-auto min-h-9 px-3.5 rounded-lg bg-mustard/90 items-center justify-center">
            <Text className="font-body-semibold text-xs text-white">Update Main Ledger</Text>
          </Pressable>
        ) : tripRollup ? (
          <Text className="font-body-medium text-xs text-ledger-green">✓ Added to main ledger</Text>
        ) : (
          balance.status !== 'settled' && (
            <Pressable onPress={() => setConfirmingRollup(true)} className="w-full sm:w-auto min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center">
              <Text className="font-body-semibold text-xs text-white">Add to Main Ledger</Text>
            </Pressable>
          )
        )
      ) : (
        !settling && (
          <Pressable onPress={startSettling} className="w-full sm:w-auto min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center">
            <Text className="font-body-semibold text-xs text-white">Record Payment</Text>
          </Pressable>
        )
      )}
      <Text className="font-body text-2xs text-muted-text">Calculated across {ledgerLabel.toLowerCase()} entries</Text>
      </View>
      </View>

      {isTravel && !hasGuests && confirmingRollup && (
        <View className="mt-4 pt-4 border-t border-ink/10">
          <Text className="font-body text-sm text-ink mb-3">
            {rollupNowSettled
              ? `${tripName} is back to settled, but the main Payments ledger still has an old line for it. This removes that line - nothing about ${tripName}'s own entries changes.`
              : rollupStale
                ? `${tripName} changed since it was last added - this updates the main ledger line to match the current balance.`
                : `This adds one line to the main Payments ledger, noted as coming from ${tripName}. ${tripName}'s own entries and balance here stay exactly as they are.`}
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={handleRollup}
              disabled={rollingUp}
              className="flex-1 min-h-10 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
            >
              {rollingUp ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="font-body-semibold text-xs text-white">
                  {rollupNowSettled ? 'Confirm & Remove' : rollupStale ? 'Confirm & Update' : 'Confirm & Add'}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setConfirmingRollup(false)}
              disabled={rollingUp}
              className="flex-1 min-h-10 rounded-lg border border-ink/15 items-center justify-center disabled:opacity-50"
            >
              <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!isTravel && settling && (
        <View className="mt-4 pt-4 border-t border-ink/10">
          <Text className="font-body text-sm text-ink mb-3">
            Record a real-world payment - either direction, any amount. It doesn't have to match the balance above; this just logs
            money that actually changed hands.
          </Text>

          <View className="flex-row flex-wrap mb-3" style={{ gap: 12 }}>
            <View className="w-full sm:w-[calc(50%-6px)]">
              <PickerField label="Paid by" value={settlePayer} options={dbMembers} onChange={setSettlePayer} />
            </View>
            <View className="w-full sm:w-[calc(50%-6px)]">
              <PickerField label="Paid to" value={settleOwedBy} options={dbMembers} onChange={setSettleOwedBy} />
            </View>
          </View>
          {settlePayer && settleOwedBy && settlePayer === settleOwedBy && (
            <Text className="font-body text-xs text-stamp-red mb-3">"Paid by" and "Paid to" can't be the same person.</Text>
          )}

          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Amount (₹)</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                className="font-mono-bold text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
              />
            </View>

            <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
              <TextInput
                value={date}
                onChangeText={setDate}
                className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
              />
            </View>

            <View className="w-full sm:w-[calc(33.333%-8px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Paid via UPI"
                className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
              />
            </View>
          </View>

          {parsedAmount > 0 && previewBalance && (
            <Text className="font-body text-xs text-muted-text mt-3 mb-3">
              {previewBalance.status === 'settled' ? (
                <Text className="font-body-semibold text-ledger-green">This fully settles the balance.</Text>
              ) : (
                <>
                  After this, <Text className="font-body-semibold text-ink">{previewBalance.debtor}</Text> will owe{' '}
                  <Text className="font-body-semibold text-ink">{previewBalance.creditor}</Text>{' '}
                  <Text className="font-mono-bold text-ink">{formatCurrency(previewBalance.amount, displayCurrency)}</Text>.
                </>
              )}
            </Text>
          )}

          <View className="flex-row gap-2 mt-3">
            <Pressable
              onPress={handleConfirm}
              disabled={saving || !amount || !settlePayer || !settleOwedBy || settlePayer === settleOwedBy}
              className="flex-1 min-h-10 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
            >
              {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Record Payment</Text>}
            </Pressable>
            <Pressable
              onPress={() => setSettling(false)}
              disabled={saving}
              className="flex-1 min-h-10 rounded-lg border border-ink/15 items-center justify-center disabled:opacity-50"
            >
              <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Card>
  );
}
