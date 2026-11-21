import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Platform, KeyboardAvoidingView, useWindowDimensions } from 'react-native';
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
import { Redirect } from 'expo-router';
import { FEATURES } from '../../lib/edition';
import { useAuth } from '../../lib/AuthContext';
import { useJump } from '../../lib/JumpContext';
import { useUndoDelete } from '../../lib/useUndoDelete';
import { usePaymentInstruments } from '../../lib/usePaymentInstruments';
import { DEFAULT_PERSONS, DEFAULT_CATEGORIES, todayISO, getMonthKey, getAvailableMonths, formatCurrency, memberForUser, memberNameForEmail } from '../../lib/utils';
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

// `topSlot` (shared edition) is the group header shown above the balance - see groups.js.
export function HouseholdScreen({ topSlot = null }) {
  const { user } = useAuth();
  const { pendingJump, setPendingJump } = useJump();
  const [entries, setEntries] = useState(null);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [members, setMembers] = useState(DEFAULT_PERSONS);
  const [memberDocs, setMemberDocs] = useState([]);
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
        (data) => {
          if (data.members?.length) setMembers(data.members);
          setMemberDocs(data.rawDocs || []);
        },
        (err) => reportError(err, 'Could not load members'),
      ),
    [],
  );
  useEffect(() => subscribeToHouseholdBudgets(setBudgets), []);
  useEffect(() => subscribeToOverallBudget(setOverallBudget), []);
  useEffect(() => subscribeToPaymentReminderConfig(setReminderConfig), []);
  useEffect(() => (FEATURES.cards ? subscribeToCreditCards(setCreditCards, (err) => reportError(err, 'Could not load credit cards')) : undefined), []);
  useEffect(() => (FEATURES.cards ? subscribeToCardTransactions(setCardTransactions, (err) => reportError(err, 'Could not load card transactions')) : undefined), []);
  useEffect(() => subscribeToRecurringRules(setRecurringRules), []);

  // Shared edition: you are the member whose email is yours (names can repeat across groups); admin: matched by first name.
  const myName = FEATURES.groups ? memberNameForEmail(memberDocs, user?.email) : memberForUser(user, members);

  const availableMonths = useMemo(() => getAvailableMonths(entries || []), [entries]);

  const [highlightEntryId, setHighlightEntryId] = useState(null);
  useEffect(() => {
    if (pendingJump?.ledger === 'household') {
      setSelectedMonth(pendingJump.monthKey || getMonthKey(todayISO()));
      setHighlightEntryId(pendingJump.entryId || null);
      setPendingJump(null);
    }
  }, [pendingJump, setPendingJump]);

  // Above 1024px the breakdown lives in the side rail, open. On a phone it
  // sits right under Add Entry instead, folded to a one-line summary.
  const { width } = useWindowDimensions();
  const wide = width >= 1024;
  const categoryChart = entries && (
    <CategoryChart
      entries={entries}
      selectedMonth={selectedMonth}
      onMonthChange={setSelectedMonth}
      availableMonths={availableMonths}
      ledger="household"
      budgets={budgets}
      collapsible={!wide}
    />
  );

  // The cards that sit in the side rail on a wide screen. On a phone they come above the passbook
  // instead (the charts folded to one line), so the passbook is never buried under them.
  const budgetAlerts = entries && <BudgetAlerts entries={entries} ledger="household" month={getMonthKey(todayISO())} budgets={budgets} />;
  const forecast = entries && (
    <MonthForecast entries={entries} recurringRules={recurringRules} budgets={budgets} overallBudget={overallBudget} />
  );
  const monthChart = entries && <MonthChart entries={entries} ledger="household" collapsible={!wide} />;
  const personSpend = entries && (
    <PersonSpendCard entries={entries} members={members} deviceMemberName={myName} collapsible={!wide} />
  );

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge={FEATURES.groups ? '👥 Groups' : '🏠 Household Ledger'} />
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
          {topSlot}
          {entries && <PaymentReminderBanner entries={entries} dbMembers={members} config={reminderConfig} />}
          {entries && <BalanceStrip entries={entries} ledger="household" dbMembers={members} instruments={instruments} />}
        </View>

        {/* Two-column shell above 1024px: the ledger (add entry + passbook)
            on the left, a context rail (alerts, forecast, charts) on the
            right. Stacked on a phone the ledger comes first, so Add Entry is
            right under the balance, then the alerts and folded charts, then the passbook. */}
        <View className="flex-col lg:flex-row" style={{ gap: 20 }}>
          <View className="lg:flex-1">
            <View className="px-4">
              <AddEntryForm
                deviceName={myName || undefined}
                ledger="household"
                dbCategories={categories}
                dbMembers={members}
                instruments={instruments}
                creditCards={creditCards}
                cardTransactions={cardTransactions}
                recentEntries={entries || []}
              />
            </View>

            <View className="px-4">
              {!wide && (
                <>
                  {budgetAlerts}
                  {forecast}
                  {categoryChart}
                  {monthChart}
                  {personSpend}
                </>
              )}
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

          {wide && (
            <View className="w-full lg:w-96 px-4" style={{ gap: 16 }}>
              {budgetAlerts}
              {forecast}
              {monthChart}
              {categoryChart}
              {personSpend}
            </View>
          )}
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

// The admin app's Household tab. The shared edition shows this same ledger inside a group (groups.js) instead.
export default function Household() {
  if (FEATURES.groups) return <Redirect href="/groups" />;
  return <HouseholdScreen />;
}
