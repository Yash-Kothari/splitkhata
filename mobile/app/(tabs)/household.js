import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import {
  subscribeToExpenses,
  subscribeToCategories,
  subscribeToMembers,
  subscribeToHouseholdBudgets,
  subscribeToPaymentReminderConfig,
} from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { DEFAULT_PERSONS, DEFAULT_CATEGORIES, todayISO, getMonthKey, getAvailableMonths } from '../../lib/utils';
import AddEntryForm from '../../components/AddEntryForm';
import EntryList from '../../components/EntryList';
import BudgetAlerts from '../../components/BudgetAlerts';
import PaymentReminderBanner from '../../components/PaymentReminderBanner';
import AppHeader from '../../components/AppHeader';
import MonthChart from '../../components/MonthChart';
import CategoryChart from '../../components/CategoryChart';

export default function Household() {
  const { user } = useAuth();
  const [entries, setEntries] = useState(null);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [members, setMembers] = useState(DEFAULT_PERSONS);
  const [budgets, setBudgets] = useState({});
  const [reminderConfig, setReminderConfig] = useState({ enabled: true, amountThreshold: 2000 });
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthKey(todayISO()));

  useEffect(() => subscribeToExpenses('household', setEntries, (err) => console.warn(err)), []);
  useEffect(
    () =>
      subscribeToCategories(
        (data) => data.household?.length && setCategories(data.household),
        (err) => console.warn(err),
      ),
    [],
  );
  useEffect(
    () =>
      subscribeToMembers(
        (data) => data.members?.length && setMembers(data.members),
        (err) => console.warn(err),
      ),
    [],
  );
  useEffect(() => subscribeToHouseholdBudgets(setBudgets), []);
  useEffect(() => subscribeToPaymentReminderConfig(setReminderConfig), []);

  const availableMonths = useMemo(() => getAvailableMonths(entries || []), [entries]);

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="🏠 Household Ledger" />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          {entries && <BudgetAlerts entries={entries} ledger="household" month={getMonthKey(todayISO())} budgets={budgets} />}
          {entries && <PaymentReminderBanner entries={entries} dbMembers={members} config={reminderConfig} />}

          <AddEntryForm deviceName={user?.displayName} ledger="household" dbCategories={categories} dbMembers={members} />

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

        <EntryList
          title="Passbook Entries"
          emptyMessage="No entries recorded yet. Add your first expense above!"
          entries={entries}
          ledger="household"
          categories={categories}
          members={members}
        />
      </ScrollView>
    </View>
  );
}
