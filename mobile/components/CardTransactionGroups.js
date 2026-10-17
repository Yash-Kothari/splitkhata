import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import CardTransactionRow from './CardTransactionRow';
import CashbackCreditLine from './CashbackCreditLine';
import { saveCardBillingCycle } from '../lib/firebase';
import { formatCurrency, groupTransactionsByCycle, findCycleRecord, isStatementOnlyCard, cycleLastDay } from '../lib/utils';

function formatDate(dateStr, withYear = false) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

function formatReward(amount, unit) {
  return unit === 'points' ? `${Math.round(amount).toLocaleString('en-IN')} pts` : formatCurrency(amount);
}

// The card's transactions, one group per statement: the current cycle (not
// billed yet) on top, then each closed statement, newest first. A header tells
// you the state without opening it - period, bill, count, reward, paid or not.
// The current cycle and the latest statement start open; older ones are folded.
// `shownTxns` is the search-filtered list; the header figures always count the
// whole statement. While searching, groups with a match open and the rest hide.
export default function CardTransactionGroups({ card, cardTxns, shownTxns, searching, ledger, cardBillingCycles, today, onDelete, onSaveError }) {
  const [toggled, setToggled] = useState({});
  const statementOnly = isStatementOnlyCard(card);
  const day = card.billingCycleDay ?? 1;

  const all = groupTransactionsByCycle(cardTxns, day, today);
  const shownByCycle = new Map(groupTransactionsByCycle(shownTxns, day, today).map((g) => [g.cycleStart, g.txns]));
  const latestClosed = all.find((g) => g.status === 'closed')?.cycleStart;
  // The year appears (on both ends) once a statement touches any year but this
  // one, so a 2025 statement can't be mistaken for this year's.
  const thisYear = today.slice(0, 4);

  const groups = all.filter((g) => !searching || (shownByCycle.get(g.cycleStart) || []).length > 0);
  if (groups.length === 0) {
    return <Text className="font-body text-sm text-muted-text text-center py-6">{searching ? 'No transactions match.' : 'No transactions yet.'}</Text>;
  }

  // Entering the bank's cashback figure is the same write as the Reward box in Last Statement.
  const saveActualCashback = (sourceCycleStart, amount) =>
    saveCardBillingCycle(card.id, sourceCycleStart, { actualRewardCredited: amount, pointsConfirmedAt: new Date().toISOString() }).catch((err) => {
      onSaveError?.(err);
      throw err;
    });
  const resetActualCashback = (sourceCycleStart) =>
    saveCardBillingCycle(card.id, sourceCycleStart, { actualRewardCredited: null, pointsConfirmedAt: null }).catch((err) => {
      onSaveError?.(err);
      throw err;
    });

  return groups.map((g, index) => {
    const record = findCycleRecord(cardBillingCycles, card.id, g.cycleStart);
    const spend = g.txns.reduce((sum, t) => sum + t.amount, 0);
    const closed = g.status === 'closed';
    const lastDay = cycleLastDay(g.cycleEnd);
    const withYear = g.cycleStart.slice(0, 4) !== thisYear || lastDay.slice(0, 4) !== thisYear;
    const period = `${formatDate(g.cycleStart, withYear)} – ${formatDate(lastDay, withYear)}`;
    // The bill the ledger works out - transactions, less last statement's cashback credit.
    const bill = ledger.cycleBills[g.cycleStart]?.statement ?? spend;
    const credits = (ledger.cashbackCredits || []).filter((c) => c.cycleStart === g.cycleStart);
    const billShown = closed && record?.billConfirmedAt != null && record.actualBillAmount != null ? record.actualBillAmount : bill;
    const result = ledger.cycleRewards[g.cycleStart];
    const paid = record?.paidAt != null;
    const defaultOpen = !closed || g.cycleStart === latestClosed;
    const open = searching ? true : (toggled[g.cycleStart] ?? defaultOpen);
    const rows = shownByCycle.get(g.cycleStart) || [];
    // The cashback credit sits among the transactions at its credit date, like the
    // bank's statement (hidden while searching - it isn't a transaction to find).
    const items = [
      ...(searching ? [] : credits.map((credit) => ({ credit, date: credit.date, order: 0 }))),
      ...rows.map((txn) => ({ txn, date: txn.date, order: 1 })),
    ].sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);
    // Only the latest statement (or any, on a statement-only card) is shown as
    // unpaid - older ones you never ticked are history, not debts.
    const unpaid = closed && !paid && (statementOnly || g.cycleStart === latestClosed);
    const status = !closed ? (g.status === 'upcoming' ? 'Upcoming' : 'Not billed yet') : paid ? '✓ Paid' : unpaid ? 'Billed, unpaid' : 'Closed';
    const statusClass = !closed ? 'text-muted-text' : paid ? 'text-ledger-green' : unpaid ? 'text-mustard' : 'text-muted-text';

    return (
      <View key={g.cycleStart} className={index > 0 ? 'border-t border-ink/10' : ''}>
        <Pressable
          onPress={() => setToggled((prev) => ({ ...prev, [g.cycleStart]: !open }))}
          disabled={searching}
          className="py-3"
          accessibilityRole="button"
          accessibilityLabel={`${open ? 'Fold' : 'Open'} the ${period} statement`}
        >
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Text className="font-body-semibold text-sm text-ink flex-1" numberOfLines={1}>
              {open ? '▾' : '▸'} {closed ? '' : 'Current cycle · '}
              {period}
            </Text>
            <Text className={`font-body-semibold text-2xs ${statusClass}`}>{status}</Text>
          </View>
          <View className="flex-row items-center justify-between mt-1" style={{ gap: 8 }}>
            <Text className="font-mono-bold text-xs text-ink">
              {formatCurrency(billShown)}
              <Text className="font-body text-2xs text-muted-text"> · {g.txns.length} {g.txns.length === 1 ? 'transaction' : 'transactions'}</Text>
            </Text>
            {!statementOnly && result ? (
              <Text className="font-body text-2xs text-muted-text">
                {formatReward(result.totalReward, result.unit)}{result.unit === 'points' ? '' : ' cashback'}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {open ? (
          items.length === 0 ? (
            <Text className="font-body text-xs text-muted-text pb-3">No transactions in this cycle yet.</Text>
          ) : (
            items.map((item, i) =>
              item.credit ? (
                <CashbackCreditLine
                  key={`credit-${item.credit.sourceCycleStart}`}
                  credit={item.credit}
                  today={today}
                  thisYear={thisYear}
                  onSave={saveActualCashback}
                  onReset={resetActualCashback}
                />
              ) : (
                <CardTransactionRow
                  key={item.txn.id}
                  txn={item.txn}
                  card={card}
                  cardTxns={cardTxns}
                  cycleReward={ledger.cycleRewards[g.cycleStart] || null}
                  onDelete={onDelete}
                  isLast={i === items.length - 1}
                />
              ),
            )
          )
        ) : null}
      </View>
    );
  });
}
