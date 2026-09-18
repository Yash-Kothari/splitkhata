import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import {
  subscribeToExpenses,
  subscribeToCategories,
  subscribeToMembers,
  subscribeToHouseholdBudgets,
  subscribeToPaymentReminderConfig,
  subscribeToCreditCards,
  subscribeToCardTransactions,
  subscribeToRecurringRules,
  deleteExpense,
  deleteCardTransaction,
} from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { useJump } from '../../lib/JumpContext';
import { useUndoDelete } from '../../lib/useUndoDelete';
import { DEFAULT_PERSONS, DEFAULT_CATEGORIES, todayISO, getMonthKey, getAvailableMonths, formatCurrency } from '../../lib/utils';
import { reportError } from '../../lib/errorReporting';
import AddEntryForm from '../../components/AddEntryForm';
import EntryList from '../../components/EntryList';
import BudgetAlerts from '../../components/BudgetAlerts';
import MonthForecast from '../../components/MonthForecast';
import PaymentReminderBanner from '../../components/PaymentReminderBanner';
import AppHeader from '../../components/AppHeader';
import MonthChart from '../../components/MonthChart';
import CategoryChart from '../../components/CategoryChart';
import UndoToast from '../../components/UndoToast';

export default function Household() {
  const { user } = useAuth();
  const { pendingJump, setPendingJump } = useJump();
  const [entries, setEntries] = useState(null);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [members, setMembers] = useState(DEFAULT_PERSONS);
  const [budgets, setBudgets] = useState({});
  const [reminderConfig, setReminderConfig] = useState({ enabled: true, amountThreshold: 2000 });
  const [creditCards, setCreditCards] = useState([]);
  const [cardTransactions, setCardTransactions] = useState([]);
  const [recurringRules, setRecurringRules] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthKey(todayISO()));

  // Deleting a linked entry also deletes the card transaction it created
  // (see AddEntryForm's handleSubmit) - best-effort, so a failure here
  // doesn't block the entry deletion that already went through.
  async function deleteHouseholdEntry(id) {
    const entry = entries?.find((e) => e.id === id);
    await deleteExpense(id);
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
  useEffect(() => subscribeToPaymentReminderConfig(setReminderConfig), []);
  useEffect(() => subscribeToCreditCards(setCreditCards, (err) => reportError(err, 'Could not load credit cards')), []);
  useEffect(() => subscribeToCardTransactions(setCardTransactions, (err) => reportError(err, 'Could not load card transactions')), []);
  useEffect(() => subscribeToRecurringRules(setRecurringRules), []);

  const availableMonths = useMemo(() => getAvailableMonths(entries || []), [entries]);

  useEffect(() => {
    if (pendingJump?.ledger === 'household') {
      setSelectedMonth(pendingJump.monthKey || getMonthKey(todayISO()));
      setPendingJump(null);
    }
  }, [pendingJump, setPendingJump]);

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="🏠 Household Ledger" />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {/* Two-column shell above 1024px: the ledger (add entry + passbook)
            on the left, a context rail (alerts, forecast, charts) on the
            right - order-* keeps the rail's time-sensitive alerts appearing
            first when stacked on a narrow screen, same as before this
            split, while visually becoming the right-hand column at lg:. */}
        <View className="flex-col lg:flex-row" style={{ gap: 20 }}>
          <View className="order-2 lg:order-1 lg:flex-1">
            <View className="px-4">
              <AddEntryForm
                deviceName={user?.displayName}
                ledger="household"
                dbCategories={categories}
                dbMembers={members}
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
              pendingDeletes={pendingDeletes}
              onDelete={handleDelete}
              excludePaymentEntries
            />
          </View>

          <View className="order-1 lg:order-2 w-full lg:w-96 px-4" style={{ gap: 16 }}>
            {entries && <BudgetAlerts entries={entries} ledger="household" month={getMonthKey(todayISO())} budgets={budgets} />}
            {entries && <MonthForecast entries={entries} recurringRules={recurringRules} budgets={budgets} />}
            {entries && <PaymentReminderBanner entries={entries} dbMembers={members} config={reminderConfig} />}
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
          </View>
        </View>
      </ScrollView>

      <UndoToast
        pendingDeleteList={pendingDeleteList}
        getLabel={(entry) => `Deleted ${entry.note ? `"${entry.note}"` : entry.category} - ${formatCurrency(entry.amount)}`}
        onUndo={handleUndo}
      />
    </View>
  );
}
