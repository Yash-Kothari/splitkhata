import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import {
  subscribeToExpenses,
  subscribeToCategories,
  subscribeToMembers,
  subscribeToHouseholdBudgets,
  subscribeToOverallBudget,
  subscribeToPaymentReminderConfig,
  subscribeToCreditCards,
  subscribeToCardTransactions,
  subscribeToRecurringRules,
  deleteExpense,
  deleteCardTransaction,
  clearTripRollupPointer,
} from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { useJump } from '../../lib/JumpContext';
import { useUndoDelete } from '../../lib/useUndoDelete';
import { usePaymentInstruments } from '../../lib/usePaymentInstruments';
import { DEFAULT_PERSONS, DEFAULT_CATEGORIES, todayISO, getMonthKey, getAvailableMonths, formatCurrency, memberForUser } from '../../lib/utils';
import { reportError } from '../../lib/errorReporting';
import AddEntryForm from '../../components/AddEntryForm';
import EntryList from '../../components/EntryList';
import BudgetAlerts from '../../components/BudgetAlerts';
import MonthForecast from '../../components/MonthForecast';
import PaymentReminderBanner from '../../components/PaymentReminderBanner';
import BalanceStrip from '../../components/BalanceStrip';
import AppHeader from '../../components/AppHeader';
import MonthChart from '../../components/MonthChart';
import CategoryChart from '../../components/CategoryChart';
import PersonSpendCard from '../../components/PersonSpendCard';
import UndoToast from '../../components/UndoToast';

export default function Household() {
  const { user } = useAuth();
  const { pendingJump, setPendingJump } = useJump();
  const [entries, setEntries] = useState(null);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [members, setMembers] = useState(DEFAULT_PERSONS);
  const [budgets, setBudgets] = useState({});
  const [overallBudget, setOverallBudget] = useState(null);
  const [reminderConfig, setReminderConfig] = useState({ enabled: true, amountThreshold: 2000 });
  const [creditCards, setCreditCards] = useState([]);
  const [cardTransactions, setCardTransactions] = useState([]);
  const instruments = usePaymentInstruments(creditCards);
  const [recurringRules, setRecurringRules] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthKey(todayISO()));

  // Deleting a linked entry also deletes the card transaction it created
  // (see AddEntryForm's handleSubmit) - best-effort, so a failure here
  // doesn't block the entry deletion that already went through.
  async function deleteHouseholdEntry(id) {
    const entry = entries?.find((e) => e.id === id);
    await deleteExpense(id);
    if (entry?.isTripRollup) {
      clearTripRollupPointer(id).catch((err) => reportError(err, "Deleted the trip line, but couldn't reset the trip's rollup"));
    }
    if (entry?.cardTransactionId) {
      try {
        await deleteCardTransaction(entry.cardTransactionId);
      } catch (err) {
        reportError(err, 'Deleted the entry, but could not remove its linked card transaction');
      }
    }
  }

  const { pendingDeletes, handleDelete, handleUndo, pendingDeleteList } = useUndoDelete(deleteHouseholdEntry, (err) =>
    reportError(err, 'Could not delete entry'),
  );

  useEffect(() => subscribeToExpenses('household', setEntries, (err) => reportError(err, 'Could not load household entries')), []);
  useEffect(
    () =>
      subscribeToCategories(
        (data) => data.household?.length && setCategories(data.household),
        (err) => reportError(err, 'Could not load categories'),
      ),
    [],
  );
  useEffect(
    () =>
      subscribeToMembers(
        (data) => data.members?.length && setMembers(data.members),
        (err) => reportError(err, 'Could not load members'),
      ),
    [],
  );
  useEffect(() => subscribeToHouseholdBudgets(setBudgets), []);
  useEffect(() => subscribeToOverallBudget(setOverallBudget), []);
  useEffect(() => subscribeToPaymentReminderConfig(setReminderConfig), []);
  useEffect(() => subscribeToCreditCards(setCreditCards, (err) => reportError(err, 'Could not load credit cards')), []);
  useEffect(() => subscribeToCardTransactions(setCardTransactions, (err) => reportError(err, 'Could not load card transactions')), []);
  useEffect(() => subscribeToRecurringRules(setRecurringRules), []);

  const availableMonths = useMemo(() => getAvailableMonths(entries || []), [entries]);

  const [highlightEntryId, setHighlightEntryId] = useState(null);
  useEffect(() => {
    if (pendingJump?.ledger === 'household') {
      setSelectedMonth(pendingJump.monthKey || getMonthKey(todayISO()));
      setHighlightEntryId(pendingJump.entryId || null);
      setPendingJump(null);
    }
  }, [pendingJump, setPendingJump]);

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="🏠 Household Ledger" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {/* Balance + reminder live full-width above the two-column shell,
            same stacking as payments.js - BalanceStrip's settle form breaks
            when squeezed into the narrow lg:w-96 rail below (its own
            sm:-breakpoint layout keys off viewport width, not the
            container's actual width). Previously this balance only showed
            on the Payments tab; P1-7 surfaces it here too so you don't have
            to switch tabs to see who owes whom. */}
        <View className="px-4">
          {entries && <PaymentReminderBanner entries={entries} dbMembers={members} config={reminderConfig} />}
          {entries && <BalanceStrip entries={entries} ledger="household" dbMembers={members} instruments={instruments} />}
        </View>

        {/* Two-column shell above 1024px: the ledger (add entry + passbook)
            on the left, a context rail (alerts, forecast, charts) on the
            right. Stacked on a phone the ledger comes first, so Add Entry is
            right under the balance and the charts sit below the passbook. */}
        <View className="flex-col lg:flex-row" style={{ gap: 20 }}>
          <View className="lg:flex-1">
            <View className="px-4">
              <AddEntryForm
                deviceName={memberForUser(user, members) || undefined}
                ledger="household"
                dbCategories={categories}
                dbMembers={members}
                instruments={instruments}
                creditCards={creditCards}
                cardTransactions={cardTransactions}
                recentEntries={entries || []}
              />
            </View>

            <EntryList
              title="Passbook Entries"
              emptyMessage="No entries recorded yet. Add your first expense above!"
              entries={entries}
              selectedMonth={selectedMonth}
              onMonthChange={setSelectedMonth}
              availableMonths={availableMonths}
              ledger="household"
              categories={categories}
              members={members}
              instruments={instruments}
              creditCards={creditCards}
              cardTransactions={cardTransactions}
              highlightId={highlightEntryId}
              pendingDeletes={pendingDeletes}
              onDelete={handleDelete}
              excludePaymentEntries
            />
          </View>

          <View className="w-full lg:w-96 px-4" style={{ gap: 16 }}>
            {entries && <BudgetAlerts entries={entries} ledger="household" month={getMonthKey(todayISO())} budgets={budgets} />}
            {entries && (
              <MonthForecast entries={entries} recurringRules={recurringRules} budgets={budgets} overallBudget={overallBudget} />
            )}
            {entries && <MonthChart entries={entries} ledger="household" />}
            {entries && (
              <CategoryChart
                entries={entries}
                selectedMonth={selectedMonth}
                onMonthChange={setSelectedMonth}
                availableMonths={availableMonths}
                ledger="household"
                budgets={budgets}
              />
            )}
            {entries && (
              <PersonSpendCard entries={entries} members={members} deviceMemberName={memberForUser(user, members)} />
            )}
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <UndoToast
        pendingDeleteList={pendingDeleteList}
        getLabel={(entry) => `Deleted ${entry.note ? `"${entry.note}"` : entry.category} - ${formatCurrency(entry.amount)}`}
        onUndo={handleUndo}
      />
    </View>
  );
}
