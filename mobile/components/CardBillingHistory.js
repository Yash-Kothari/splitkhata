import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import PickerField from './PickerField';
import { saveCardBillingCycle } from '../lib/firebase';
import {
  formatCurrency,
  listRecentCardCycles,
  getTransactionsInCycle,
  computeCardCycleReward,
  applyRewardOverrides,
  getCardBillingCycleKey,
} from '../lib/utils';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';

function formatReward(amount, unit) {
  return unit === 'points' ? `${Math.round(amount).toLocaleString('en-IN')} pts` : formatCurrency(amount);
}

function formatDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatCycleMonthLabel(cycle) {
  const monthName = new Date(`${cycle.cycleEnd}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' });
  return `${monthName} (${formatDate(cycle.cycleStart)} – ${formatDate(cycle.cycleEnd)})`;
}

// RN port of web's BillingCycleRow (inside CardsManager.jsx).
function BillingCycleRow({ card, cycle, transactions, cycleRecord, onSaveError }) {
  const [billDraft, setBillDraft] = useState('');
  const [pointsDraft, setPointsDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const cycleTxns = getTransactionsInCycle(transactions, card.id, cycle.cycleStart, cycle.cycleEnd);
  const expectedBill = cycleTxns.reduce((s, t) => s + t.amount, 0);
  const { totalReward: expectedReward, unit: rewardUnit } = applyRewardOverrides(
    computeCardCycleReward(card, cycleTxns, cycle.cycleStart),
    cycleTxns,
  );

  const billConfirmed = cycleRecord?.billConfirmedAt != null;
  const pointsConfirmed = cycleRecord?.pointsConfirmedAt != null;
  const amountMismatch = billConfirmed && cycleRecord.actualBillAmount != null
    ? Math.round((cycleRecord.actualBillAmount - expectedBill) * 100) / 100
    : null;
  const rewardMismatch = pointsConfirmed && cycleRecord.actualRewardCredited != null
    ? Math.round((cycleRecord.actualRewardCredited - expectedReward) * 100) / 100
    : null;

  async function confirmBill() {
    const amount = parseFloat(billDraft);
    if (!amount && amount !== 0) return;
    setSaving(true);
    try {
      await saveCardBillingCycle(card.id, cycle.cycleStart, { actualBillAmount: amount, billConfirmedAt: new Date().toISOString() });
      setBillDraft('');
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  async function confirmPoints() {
    const amount = parseFloat(pointsDraft);
    if (!amount && amount !== 0) return;
    setSaving(true);
    try {
      await saveCardBillingCycle(card.id, cycle.cycleStart, { actualRewardCredited: amount, pointsConfirmedAt: new Date().toISOString() });
      setPointsDraft('');
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3">
      <Text className="font-body-semibold text-sm text-ink mb-2">
        {formatDate(cycle.cycleStart)} – {formatDate(cycle.cycleEnd)}
      </Text>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Text className="font-body text-xs text-muted-text">Bill</Text>
          <Text className="font-mono-bold text-xs text-ink">Expected {formatCurrency(expectedBill)}</Text>
          {billConfirmed ? (
            <Text className={`font-mono-bold text-xs mt-0.5 ${amountMismatch !== 0 ? 'text-stamp-red' : 'text-ledger-green'}`}>
              Actual {formatCurrency(cycleRecord.actualBillAmount)}
              {amountMismatch !== 0 ? ` (${amountMismatch > 0 ? '+' : ''}${formatCurrency(amountMismatch)})` : ''}
            </Text>
          ) : (
            <View className="flex-row gap-1.5 mt-1">
              <TextInput
                value={billDraft}
                onChangeText={setBillDraft}
                keyboardType="decimal-pad"
                placeholder="Actual ₹"
                className="w-20 font-body text-xs text-ink border border-ink/15 rounded-lg px-2 py-1.5 bg-paper shadow-2xs"
              />
              <Pressable onPress={confirmBill} disabled={saving || !billDraft} className="px-2.5 py-1.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50">
                {saving ? <ActivityIndicator color="white" size="small" /> : <Text className="font-body-semibold text-2xs text-white">Confirm</Text>}
              </Pressable>
            </View>
          )}
        </View>
        <View className="flex-1">
          <Text className="font-body text-xs text-muted-text">Reward</Text>
          <Text className="font-mono-bold text-xs text-ink">Expected {formatReward(expectedReward, rewardUnit)}</Text>
          {pointsConfirmed ? (
            <Text className={`font-mono-bold text-xs mt-0.5 ${rewardMismatch !== 0 ? 'text-stamp-red' : 'text-ledger-green'}`}>
              Actual {formatReward(cycleRecord.actualRewardCredited, rewardUnit)}
              {rewardMismatch !== 0 ? ` (${rewardMismatch > 0 ? '+' : ''}${Math.round(rewardMismatch)})` : ''}
            </Text>
          ) : (
            <View className="flex-row gap-1.5 mt-1">
              <TextInput
                value={pointsDraft}
                onChangeText={setPointsDraft}
                keyboardType="decimal-pad"
                placeholder="Actual"
                className="w-20 font-body text-xs text-ink border border-ink/15 rounded-lg px-2 py-1.5 bg-paper shadow-2xs"
              />
              <Pressable onPress={confirmPoints} disabled={saving || !pointsDraft} className="px-2.5 py-1.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50">
                {saving ? <ActivityIndicator color="white" size="small" /> : <Text className="font-body-semibold text-2xs text-white">Confirm</Text>}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// RN port of the "Billing Cycle History" section inside web's CardsManager.
export default function CardBillingHistory({ card, cardTxns, cardBillingCycles, today, onSaveError }) {
  const [historyYear, setHistoryYear] = useState(null);
  const [historyCycleKey, setHistoryCycleKey] = useState(null);

  const earliestTxnDate = cardTxns.length > 0 ? cardTxns.reduce((min, t) => (t.date < min ? t.date : min), cardTxns[0].date) : null;
  const pastCycles = earliestTxnDate
    ? listRecentCardCycles(card.billingCycleDay ?? 1, today, 60)
        .slice(1)
        .filter((cyc) => cyc.cycleEnd > earliestTxnDate)
    : [];

  if (pastCycles.length === 0) return null;

  const cyclesByYear = {};
  pastCycles.forEach((cyc) => {
    const year = cyc.cycleEnd.slice(0, 4);
    (cyclesByYear[year] = cyclesByYear[year] || []).push(cyc);
  });
  const historyYears = Object.keys(cyclesByYear).sort((a, b) => b.localeCompare(a));
  const effectiveHistoryYear = historyYears.includes(historyYear) ? historyYear : historyYears[0] || null;
  const cyclesInHistoryYear = effectiveHistoryYear ? cyclesByYear[effectiveHistoryYear] : [];
  const effectiveHistoryCycleKey = cyclesInHistoryYear.some((c) => c.cycleKey === historyCycleKey)
    ? historyCycleKey
    : cyclesInHistoryYear[0]?.cycleKey || null;
  const selectedHistoryCycle = cyclesInHistoryYear.find((c) => c.cycleKey === effectiveHistoryCycleKey) || null;
  const cycleRecordFor = (cycle) =>
    cardBillingCycles.find((c) => getCardBillingCycleKey(c.cardId, c.cycleStart) === getCardBillingCycleKey(card.id, cycle.cycleStart));

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-base text-ink mb-3">Billing Cycle History</Text>
      <View className="flex-row gap-3 mb-3">
        <View className="flex-1">
          <PickerField
            label="Year"
            value={effectiveHistoryYear}
            options={historyYears}
            onChange={(v) => {
              setHistoryYear(v);
              setHistoryCycleKey(null);
            }}
          />
        </View>
        <View className="flex-1">
          <PickerField
            label="Month"
            value={effectiveHistoryCycleKey}
            options={cyclesInHistoryYear.map((c) => ({ value: c.cycleKey, label: formatCycleMonthLabel(c) }))}
            onChange={setHistoryCycleKey}
          />
        </View>
      </View>
      {selectedHistoryCycle && (
        <BillingCycleRow
          key={selectedHistoryCycle.cycleKey}
          card={card}
          cycle={selectedHistoryCycle}
          transactions={cardTxns}
          cycleRecord={cycleRecordFor(selectedHistoryCycle)}
          onSaveError={onSaveError}
        />
      )}
    </Card>
  );
}
