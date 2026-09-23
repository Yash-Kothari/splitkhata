import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import {
  subscribeToCreditCards,
  subscribeToCardTransactions,
  subscribeToCardBillingCycles,
  deleteCardTransaction,
} from '../../lib/firebase';
import {
  todayISO,
  formatCurrency,
  getCardCycleForDate,
  getTransactionsInCycle,
  computeCardRewardLedger,
  isStatementOnlyCard,
  resolveCardParams,
  computeCardMilestoneProgress,
  getQuarterlyMilestoneCreditDate,
  getAnnualMilestoneWindow,
  computeCardCapStatus,
  getQuarterBounds,
} from '../../lib/utils';
import { reportError } from '../../lib/errorReporting';
import { useUndoDelete } from '../../lib/useUndoDelete';
import Card from '../../components/Card';
import CardTransactionForm from '../../components/CardTransactionForm';
import CardTransactionRow from '../../components/CardTransactionRow';
import CardBillingHistory from '../../components/CardBillingHistory';
import AppHeader from '../../components/AppHeader';
import UndoToast from '../../components/UndoToast';

function formatReward(amount, unit) {
  return unit === 'points' ? `${Math.round(amount).toLocaleString('en-IN')} pts` : formatCurrency(amount);
}

function ProgressBar({ pctUsed, invert = false }) {
  const colorClass = invert
    ? pctUsed >= 1 ? 'bg-stamp-red' : pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green/60'
    : pctUsed >= 1 ? 'bg-ledger-green' : pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green/60';
  return (
    <View className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
      <View className={`h-full rounded-full ${colorClass}`} style={{ width: `${Math.min(pctUsed * 100, 100)}%` }} />
    </View>
  );
}

// RN port of web's CardsManager.jsx main export - self-contained screen
// (unlike web, which receives these as props from App.jsx) since mobile
// screens each own their own Firestore subscriptions.
export default function Cards() {
  const [creditCards, setCreditCards] = useState([]);
  const [cardTransactions, setCardTransactions] = useState([]);
  const [cardBillingCycles, setCardBillingCycles] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [txnSearch, setTxnSearch] = useState('');
  const [showMilestones, setShowMilestones] = useState(true);
  const [showCaps, setShowCaps] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const { pendingDeletes, handleDelete, handleUndo, pendingDeleteList } = useUndoDelete(deleteCardTransaction, (err) =>
    reportError(err, 'Could not delete transaction'),
  );

  useEffect(() => subscribeToCreditCards(setCreditCards, (err) => reportError(err, 'Could not load credit cards')), []);
  useEffect(() => subscribeToCardTransactions(setCardTransactions, (err) => reportError(err, 'Could not load card transactions')), []);
  useEffect(() => subscribeToCardBillingCycles(setCardBillingCycles, (err) => reportError(err, 'Could not load billing cycles')), []);

  const selectedCard = creditCards.find((c) => c.id === selectedCardId) || creditCards[0] || null;
  const statementOnly = isStatementOnlyCard(selectedCard);
  const cardNameCounts = creditCards.reduce((acc, c) => ({ ...acc, [c.name]: (acc[c.name] || 0) + 1 }), {});

  const cardTxns = useMemo(
    () => (selectedCard ? cardTransactions.filter((t) => t.cardId === selectedCard.id) : []),
    [cardTransactions, selectedCard],
  );

  const today = todayISO();
  const currentCycle = selectedCard ? getCardCycleForDate(today, selectedCard.billingCycleDay ?? 1) : null;
  const currentCycleTxns = currentCycle ? getTransactionsInCycle(cardTxns, selectedCard.id, currentCycle.cycleStart, currentCycle.cycleEnd) : [];
  // Everything is computed statement by statement (caps and the Diners slab
  // remainder carry per cycle), with each reward placed on the day it is
  // actually credited - see computeCardRewardLedger.
  const ledger = selectedCard
    ? computeCardRewardLedger(selectedCard, cardTxns, today)
    : { total: 0, credited: 0, pending: [], cycleRewards: {}, unit: 'inr' };
  const currentCycleReward = ledger.cycleRewards[currentCycle?.cycleStart] || { totalReward: 0, unit: ledger.unit, perTransaction: [] };
  const currentCycleSpend = currentCycleTxns.reduce((s, t) => s + t.amount, 0);
  const lifetimePointsRedeemed = cardTxns.reduce((s, t) => s + (t.pointsRedeemed || 0), 0);
  const params = selectedCard ? resolveCardParams(selectedCard, today) : {};
  // Quarterly milestone bonuses (e.g. Diners' 10,000 pts at ₹4L/quarter) are
  // a separate lump sum on top of computeCardCycleReward's per-cycle math -
  // computeCardRewardLedger folds them in as their own dated lumps, so
  // ledger.credited/pending already reflect them; see
  // computeQuarterlyMilestoneLumps for why they can't live inside
  // computeCardCycleReward and getQuarterlyMilestoneCreditDate for how their
  // date is worked out.
  const quarterlyStarting = {
    spend: selectedCard?.quarterlyMilestoneStartingSpend || 0,
    quarterStart: selectedCard?.quarterlyMilestoneStartingQuarter || null,
  };
  // Only rewards already credited count as "in account"; the rest is shown as pending with its date.
  const lifetimeRewardTotal =
    (selectedCard?.startingRewardPoints || 0) + ledger.credited - lifetimePointsRedeemed;

  const { quarterStart, quarterEnd } = getQuarterBounds(today);
  const quarterlyMilestoneCreditDate = selectedCard && params.quarterlyMilestoneTarget
    ? getQuarterlyMilestoneCreditDate(selectedCard, quarterEnd)
    : null;
  const { periodStart: annualPeriodStart, periodEnd: annualPeriodEnd } = getAnnualMilestoneWindow(
    selectedCard?.annualMilestoneAnchorMonth,
    today,
  );
  const quarterlyMilestone = params.quarterlyMilestoneTarget
    ? computeCardMilestoneProgress(
        cardTxns,
        selectedCard.id,
        quarterStart,
        quarterEnd,
        params.quarterlyMilestoneTarget,
        quarterlyStarting.quarterStart === quarterStart ? quarterlyStarting.spend : 0,
      )
    : null;
  const annualMilestone = params.annualMilestoneTarget
    ? computeCardMilestoneProgress(
        cardTxns,
        selectedCard.id,
        annualPeriodStart,
        annualPeriodEnd,
        params.annualMilestoneTarget,
        selectedCard.annualMilestoneStartingSpend,
      )
    : null;
  const capStatuses = selectedCard ? computeCardCapStatus(selectedCard, cardTxns, currentCycleTxns, today) : [];

  const filteredTxns = useMemo(() => {
    const term = txnSearch.trim().toLowerCase();
    return cardTxns
      .filter((t) => !pendingDeletes[t.id])
      .filter((t) => !term || (t.description || t.note)?.toLowerCase().includes(term) || String(t.amount).includes(term))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [cardTxns, txnSearch, pendingDeletes]);

  if (creditCards.length === 0) {
    return (
      <View className="flex-1 bg-paper">
        <AppHeader badge="💳 Cards" showSettings={showSettings} onShowSettingsChange={setShowSettings} />
        <View className="px-4" style={{ paddingTop: 16 }}>
          <Card className="items-center px-6 py-8">
            <Text className="font-display text-lg text-ink mb-2">No cards yet</Text>
            <Text className="font-body text-sm text-muted-text text-center mb-4">
              Add your first credit card in Settings to start tracking transactions, reward points, and billing cycles.
            </Text>
            <Pressable onPress={() => setShowSettings(true)} className="min-h-11 px-4 rounded-xl bg-ledger-green items-center justify-center">
              <Text className="font-body-semibold text-white">Open Settings</Text>
            </Pressable>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="💳 Cards" showSettings={showSettings} onShowSettingsChange={setShowSettings} />

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4" contentContainerStyle={{ gap: 6 }}>
            {creditCards.map((card) => (
              <Pressable
                key={card.id}
                onPress={() => setSelectedCardId(card.id)}
                className={`px-3.5 py-2 rounded-xl ${
                  selectedCard?.id === card.id ? 'bg-ledger-green shadow-xs' : 'bg-paper border border-ink/10'
                }`}
              >
                <Text className={`font-body-semibold text-sm ${selectedCard?.id === card.id ? 'text-white' : 'text-muted-text'}`}>
                  {card.name}{cardNameCounts[card.name] > 1 && card.owner ? ` (${card.owner})` : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

        </View>

        {/* Two-column shell above 1024px - see household.js for the same
            pattern and the reasoning behind the order-* stacking. */}
        {selectedCard && (
          <View className="flex-col lg:flex-row" style={{ gap: 20 }}>
            <View className="order-2 lg:order-1 lg:flex-1 px-4">
              <CardTransactionForm card={selectedCard} cardTxns={cardTxns} onSaveError={(err) => reportError(err, 'Could not save transaction')} />

              <Card className="p-4 mb-4">
                <View className="flex-row items-center justify-between gap-2 mb-3">
                  <Text className="font-display text-base text-ink">Transactions</Text>
                  <TextInput
                    value={txnSearch}
                    onChangeText={setTxnSearch}
                    placeholder="Search..."
                    className="h-9 px-3 text-xs font-body rounded-lg border border-ink/15 bg-paper text-ink w-36 shadow-2xs"
                  />
                </View>
                {filteredTxns.length === 0 ? (
                  <Text className="font-body text-sm text-muted-text text-center py-6">No transactions yet.</Text>
                ) : (
                  filteredTxns.map((txn, i) => (
                    <CardTransactionRow
                      key={txn.id}
                      txn={txn}
                      card={selectedCard}
                      cardTxns={cardTxns}
                      cycleReward={ledger.cycleRewards[getCardCycleForDate(txn.date, selectedCard.billingCycleDay ?? 1).cycleStart] || null}
                      onDelete={handleDelete}
                      isLast={i === filteredTxns.length - 1}
                    />
                  ))
                )}
              </Card>

              <CardBillingHistory
                card={selectedCard}
                cardTxns={cardTxns}
                cardBillingCycles={cardBillingCycles}
                today={today}
                onSaveError={(err) => reportError(err, 'Could not save billing cycle')}
              />
            </View>

            <View className="order-1 lg:order-2 w-full lg:w-96 px-4" style={{ gap: 16 }}>
              <Card className="p-4">
                <View className="mb-3">
                  <Text className="font-display text-lg text-ink" numberOfLines={1}>{selectedCard.name}</Text>
                  <Text className="font-body text-2xs text-muted-text mb-1.5">
                    {selectedCard.owner ? `${selectedCard.owner}'s card` : 'Shared card'}
                  </Text>
                  <View className="self-start px-2.5 py-1 rounded-full bg-ledger-green/10">
                    <Text className="font-body-semibold text-2xs text-ledger-green">
                      Cycle: {currentCycle.cycleStart} – {currentCycle.cycleEnd}
                    </Text>
                  </View>
                </View>
                {!statementOnly && (
                <View className="rounded-xl bg-ledger-green/10 px-3.5 py-2.5 mb-3">
                  <Text className="font-body-semibold text-2xs text-ledger-green uppercase tracking-wider">
                    {currentCycleReward.unit === 'points' ? 'Total reward points in account' : 'Total cashback in account'}
                  </Text>
                  <Text className="font-mono-bold text-ledger-green text-2xl">
                    {formatReward(lifetimeRewardTotal, currentCycleReward.unit)}
                  </Text>
                </View>
                )}
                {!statementOnly && ledger.pending.length > 0 && (
                  <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5 mb-3">
                    <Text className="font-body-semibold text-2xs text-muted-text uppercase tracking-wider mb-1">Still to be credited</Text>
                    {ledger.pending.map((p) => (
                      <View key={p.date} className="flex-row items-center justify-between">
                        <Text className="font-body text-xs text-muted-text">
                          {new Date(`${p.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </Text>
                        <Text className="font-mono-bold text-xs text-ink">{formatReward(p.amount, ledger.unit)}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="font-body-semibold text-2xs text-muted-text uppercase tracking-wider">Spent so far</Text>
                    <Text className="font-mono-bold text-ink text-lg">{formatCurrency(currentCycleSpend)}</Text>
                  </View>
                  {!statementOnly && (
                  <View className="flex-1">
                    <Text className="font-body-semibold text-2xs text-muted-text uppercase tracking-wider">Estimated reward</Text>
                    <Text className="font-mono-bold text-ink text-lg">
                      {formatReward(currentCycleReward.totalReward, currentCycleReward.unit)}
                    </Text>
                  </View>
                  )}
                </View>
              </Card>

              {(quarterlyMilestone || annualMilestone) && (
                <Card className="p-4">
                  <Pressable onPress={() => setShowMilestones((v) => !v)} className="flex-row items-center justify-between">
                    <Text className="font-display text-sm text-ink">Milestone Progress</Text>
                    <View className="px-2 py-0.5 rounded-md bg-paper border border-ink/10">
                      <Text className="font-body-semibold text-2xs text-muted-text">{showMilestones ? 'Collapse' : 'Expand'}</Text>
                    </View>
                  </Pressable>
                  {showMilestones && (
                    <View className="mt-4" style={{ gap: 16 }}>
                      {quarterlyMilestone && (
                        <View>
                          <View className="flex-row items-center justify-between mb-1">
                            <Text className="font-body-medium text-xs text-ink">This quarter ({quarterStart} – {quarterEnd})</Text>
                            <Text className="font-body text-xs text-muted-text">{Math.round(quarterlyMilestone.pctUsed * 100)}%</Text>
                          </View>
                          <ProgressBar pctUsed={quarterlyMilestone.pctUsed} />
                          <Text className="font-body text-2xs text-muted-text mt-1">
                            {formatCurrency(quarterlyMilestone.spent)} of {formatCurrency(quarterlyMilestone.target)} -{' '}
                            {quarterlyMilestone.pctUsed >= 1
                              ? quarterlyMilestoneCreditDate <= today
                                ? `${params.quarterlyMilestoneBonus?.toLocaleString('en-IN')} bonus points earned, included above`
                                : `Target reached - ${params.quarterlyMilestoneBonus?.toLocaleString('en-IN')} bonus points pending, credits ${new Date(`${quarterlyMilestoneCreditDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                              : `${params.quarterlyMilestoneBonus?.toLocaleString('en-IN')} bonus points at target`}
                          </Text>
                        </View>
                      )}
                      {annualMilestone && (
                        <View>
                          <View className="flex-row items-center justify-between mb-1">
                            <Text className="font-body-medium text-xs text-ink">This year ({annualPeriodStart} – {annualPeriodEnd})</Text>
                            <Text className="font-body text-xs text-muted-text">{Math.round(annualMilestone.pctUsed * 100)}%</Text>
                          </View>
                          <ProgressBar pctUsed={annualMilestone.pctUsed} />
                          <Text className="font-body text-2xs text-muted-text mt-1">
                            {formatCurrency(annualMilestone.spent)} of {formatCurrency(annualMilestone.target)} - {params.annualMilestoneLabel}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </Card>
              )}

              {capStatuses.length > 0 && (
                <Card className="p-4">
                  <Pressable onPress={() => setShowCaps((v) => !v)} className="flex-row items-center justify-between">
                    <Text className="font-display text-sm text-ink">Caps Remaining</Text>
                    <View className="px-2 py-0.5 rounded-md bg-paper border border-ink/10">
                      <Text className="font-body-semibold text-2xs text-muted-text">{showCaps ? 'Collapse' : 'Expand'}</Text>
                    </View>
                  </Pressable>
                  {showCaps && (
                    <View className="mt-4" style={{ gap: 16 }}>
                      {capStatuses.map((cap) => {
                        const pctUsed = cap.capAmount ? cap.earned / cap.capAmount : 0;
                        const periodLabel = cap.capPeriod === 'day' ? 'today' : cap.capPeriod === 'cycle' ? 'this cycle' : 'this month';
                        const remainingColor = pctUsed >= 1 ? 'text-stamp-red' : pctUsed >= 0.8 ? 'text-mustard' : 'text-ledger-green';
                        return (
                          <View key={cap.key}>
                            <View className="flex-row items-center justify-between mb-1">
                              <Text className="font-body-medium text-xs text-ink">{cap.label}</Text>
                              <Text className={`font-mono text-xs ${remainingColor}`}>
                                {formatReward(cap.remaining, cap.unit)} left
                              </Text>
                            </View>
                            <ProgressBar pctUsed={pctUsed} invert />
                            <Text className="font-body text-2xs text-muted-text mt-1">
                              {formatReward(cap.earned, cap.unit)} of {formatReward(cap.capAmount, cap.unit)} used {periodLabel}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </Card>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <UndoToast
        pendingDeleteList={pendingDeleteList}
        getLabel={(txn) => `Deleted ${txn.description || txn.note ? `"${txn.description || txn.note}"` : formatCurrency(txn.amount)}`}
        onUndo={handleUndo}
      />
    </View>
  );
}
