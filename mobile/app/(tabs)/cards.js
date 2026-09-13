import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  subscribeToCreditCards,
  subscribeToCardTransactions,
  subscribeToCardBillingCycles,
  deleteCardTransaction,
  signOutUser,
} from '../../lib/firebase';
import {
  todayISO,
  formatCurrency,
  getCardCycleForDate,
  getTransactionsInCycle,
  computeCardCycleReward,
  resolveStrategyParamsForDate,
  computeCardMilestoneProgress,
  getAnnualMilestoneWindow,
  computeCardCapStatus,
  applyRewardOverrides,
  getQuarterBounds,
} from '../../lib/utils';
import Card from '../../components/Card';
import CardTransactionForm from '../../components/CardTransactionForm';
import CardTransactionRow from '../../components/CardTransactionRow';
import CardBillingHistory from '../../components/CardBillingHistory';
import SettingsModal from '../../components/SettingsModal';

const UNDO_WINDOW_MS = 6000;

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
  const [pendingDeletes, setPendingDeletes] = useState({});
  const [txnSearch, setTxnSearch] = useState('');
  const [showMilestones, setShowMilestones] = useState(true);
  const [showCaps, setShowCaps] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => subscribeToCreditCards(setCreditCards, (err) => console.warn(err)), []);
  useEffect(() => subscribeToCardTransactions(setCardTransactions, (err) => console.warn(err)), []);
  useEffect(() => subscribeToCardBillingCycles(setCardBillingCycles, (err) => console.warn(err)), []);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const selectedCard = creditCards.find((c) => c.id === selectedCardId) || creditCards[0] || null;
  const cardNameCounts = creditCards.reduce((acc, c) => ({ ...acc, [c.name]: (acc[c.name] || 0) + 1 }), {});

  const cardTxns = useMemo(
    () => (selectedCard ? cardTransactions.filter((t) => t.cardId === selectedCard.id) : []),
    [cardTransactions, selectedCard],
  );

  const today = todayISO();
  const currentCycle = selectedCard ? getCardCycleForDate(today, selectedCard.billingCycleDay ?? 1) : null;
  const currentCycleTxns = currentCycle ? getTransactionsInCycle(cardTxns, selectedCard.id, currentCycle.cycleStart, currentCycle.cycleEnd) : [];
  const currentCycleReward = selectedCard
    ? applyRewardOverrides(computeCardCycleReward(selectedCard, currentCycleTxns, currentCycle.cycleStart), currentCycleTxns)
    : { totalReward: 0, unit: 'inr' };
  const currentCycleSpend = currentCycleTxns.reduce((s, t) => s + t.amount, 0);
  const lifetimeReward = selectedCard
    ? applyRewardOverrides(computeCardCycleReward(selectedCard, cardTxns, today), cardTxns)
    : { totalReward: 0, unit: 'inr' };
  const lifetimePointsRedeemed = cardTxns.reduce((s, t) => s + (t.pointsRedeemed || 0), 0);
  const lifetimeRewardTotal = (selectedCard?.startingRewardPoints || 0) + lifetimeReward.totalReward - lifetimePointsRedeemed;

  const params = selectedCard ? resolveStrategyParamsForDate(selectedCard.strategyParamsHistory, today) : {};
  const { quarterStart, quarterEnd } = getQuarterBounds(today);
  const { periodStart: annualPeriodStart, periodEnd: annualPeriodEnd } = getAnnualMilestoneWindow(
    selectedCard?.annualMilestoneAnchorMonth,
    today,
  );
  const quarterlyMilestone = params.quarterlyMilestoneTarget
    ? computeCardMilestoneProgress(cardTxns, selectedCard.id, quarterStart, quarterEnd, params.quarterlyMilestoneTarget)
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
      .filter((t) => !term || t.description?.toLowerCase().includes(term) || String(t.amount).includes(term))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [cardTxns, txnSearch, pendingDeletes]);

  function handleDelete(txn) {
    const timeoutId = setTimeout(async () => {
      try {
        await deleteCardTransaction(txn.id);
      } catch (err) {
        console.warn(err);
      } finally {
        if (isMountedRef.current) {
          setPendingDeletes((prev) => {
            const next = { ...prev };
            delete next[txn.id];
            return next;
          });
        }
      }
    }, UNDO_WINDOW_MS);
    setPendingDeletes((prev) => ({ ...prev, [txn.id]: { txn, timeoutId } }));
  }

  function handleUndo(id) {
    setPendingDeletes((prev) => {
      const pending = prev[id];
      if (!pending) return prev;
      clearTimeout(pending.timeoutId);
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const pendingDeleteList = Object.values(pendingDeletes);

  if (creditCards.length === 0) {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="bg-paper" edges={['top']}>
          <View className="flex-row items-center gap-1.5 px-4 pt-2 pb-3 border-b border-ink/10">
            <Text className="font-display text-xl text-ink tracking-tight" numberOfLines={1}>
              Splitkhata
            </Text>
            <View className="px-2 py-1.5 rounded-xl border border-ledger-green/30 bg-ledger-green/10">
              <Text className="font-body-semibold text-2xs text-ledger-green" numberOfLines={1}>
                💳 Credit Cards
              </Text>
            </View>
            <View className="flex-1" />
            <Pressable onPress={() => setShowSettings(true)} hitSlop={8} className="px-2 py-1.5 rounded-xl border border-ink/15 bg-paper shrink-0">
              <Text className="font-body-semibold text-2xs text-ink">⚙️</Text>
            </Pressable>
            <Pressable onPress={() => signOutUser()} hitSlop={8} className="px-2.5 py-1.5 rounded-xl border border-ink/15 bg-paper shrink-0">
              <Text className="font-body-semibold text-2xs text-stamp-red">Sign out</Text>
            </Pressable>
          </View>
        </SafeAreaView>
        <View className="flex-1 items-center justify-center px-6">
          <Card className="items-center px-6 py-8 w-full max-w-sm">
            <Text className="font-display text-lg text-ink mb-2">No cards yet</Text>
            <Text className="font-body text-sm text-muted-text text-center mb-4">
              Add your first credit card in Settings to start tracking transactions, reward points, and billing cycles.
            </Text>
            <Pressable onPress={() => setShowSettings(true)} className="min-h-11 px-4 rounded-xl bg-ledger-green items-center justify-center">
              <Text className="font-body-semibold text-white">Open Settings</Text>
            </Pressable>
          </Card>
        </View>
        <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="bg-paper" edges={['top']}>
        <View className="flex-row items-center gap-1.5 px-4 pt-2 pb-3 border-b border-ink/10">
          <Text className="font-display text-xl text-ink tracking-tight" numberOfLines={1}>
            Splitkhata
          </Text>
          <View className="px-2 py-1.5 rounded-xl border border-ledger-green/30 bg-ledger-green/10">
            <Text className="font-body-semibold text-2xs text-ledger-green" numberOfLines={1}>
              💳 Credit Cards
            </Text>
          </View>
          <View className="flex-1" />
          <Pressable onPress={() => setShowSettings(true)} hitSlop={8} className="px-2 py-1.5 rounded-xl border border-ink/15 bg-paper shrink-0">
            <Text className="font-body-semibold text-2xs text-ink">⚙️</Text>
          </Pressable>
          <Pressable onPress={() => signOutUser()} hitSlop={8} className="px-2.5 py-1.5 rounded-xl border border-ink/15 bg-paper shrink-0">
            <Text className="font-body-semibold text-2xs text-stamp-red">Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4" contentContainerStyle={{ gap: 6 }}>
            {creditCards.map((card) => (
              <Pressable
                key={card.id}
                onPress={() => setSelectedCardId(card.id)}
                className={`px-3.5 py-2 rounded-xl ${
                  selectedCard?.id === card.id ? 'bg-ledger-green' : 'bg-paper-card border border-ink/10'
                }`}
              >
                <Text className={`font-body-semibold text-sm ${selectedCard?.id === card.id ? 'text-white' : 'text-muted-text'}`}>
                  {card.name}{cardNameCounts[card.name] > 1 && card.owner ? ` (${card.owner})` : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {selectedCard && (
            <>
              <Card className="p-4 mb-4">
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
                <View className="rounded-xl bg-ledger-green/10 px-3.5 py-2.5 mb-3">
                  <Text className="font-body-semibold text-2xs text-ledger-green uppercase tracking-wider">
                    Total reward points in account
                  </Text>
                  <Text className="font-mono text-ledger-green text-2xl">
                    {formatReward(lifetimeRewardTotal, currentCycleReward.unit)}
                  </Text>
                </View>
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="font-body-semibold text-2xs text-muted-text uppercase tracking-wider">Spent so far</Text>
                    <Text className="font-mono text-ink text-lg">{formatCurrency(currentCycleSpend)}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-body-semibold text-2xs text-muted-text uppercase tracking-wider">Estimated reward</Text>
                    <Text className="font-mono text-ink text-lg">
                      {formatReward(currentCycleReward.totalReward, currentCycleReward.unit)}
                    </Text>
                  </View>
                </View>
              </Card>

              {(quarterlyMilestone || annualMilestone) && (
                <Card className="p-4 mb-4">
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
                            {formatCurrency(quarterlyMilestone.spent)} of {formatCurrency(quarterlyMilestone.target)} - {params.quarterlyMilestoneBonus?.toLocaleString('en-IN')} bonus points at target
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
                <Card className="p-4 mb-4">
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

              <CardTransactionForm card={selectedCard} cardTxns={cardTxns} onSaveError={(err) => console.warn(err)} />

              <Card className="p-4 mb-4">
                <View className="flex-row items-center justify-between gap-2 mb-3">
                  <Text className="font-display text-base text-ink">Transactions</Text>
                  <TextInput
                    value={txnSearch}
                    onChangeText={setTxnSearch}
                    placeholder="Search..."
                    className="h-9 px-3 text-xs font-body rounded-lg border border-ink/15 bg-paper text-ink w-36"
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
                      cycleReward={txn.date >= currentCycle.cycleStart && txn.date < currentCycle.cycleEnd ? currentCycleReward : null}
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
                onSaveError={(err) => console.warn(err)}
              />
            </>
          )}
        </View>
      </ScrollView>

      {pendingDeleteList.length > 0 && (
        <View className="absolute left-4 right-4 bottom-24" style={{ gap: 8 }}>
          {pendingDeleteList.map(({ txn }) => (
            <View key={txn.id} className="flex-row items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3">
              <Text className="flex-1 font-body text-sm text-paper" numberOfLines={1}>
                Deleted {txn.description ? `"${txn.description}"` : formatCurrency(txn.amount)}
              </Text>
              <Pressable onPress={() => handleUndo(txn.id)} hitSlop={8}>
                <Text className="font-body-semibold text-sm text-ledger-green underline">Undo</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </View>
  );
}
