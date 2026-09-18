import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import {
  subscribeToExpenses,
  subscribeToTrips,
  subscribeToCashMovements,
  subscribeToCategories,
  subscribeToMembers,
  subscribeToPaymentMethods,
  subscribeToCurrencies,
  subscribeToCreditCards,
  subscribeToCardTransactions,
  deleteExpense,
  deleteCardTransaction,
} from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { useJump } from '../../lib/JumpContext';
import { useUndoDelete } from '../../lib/useUndoDelete';
import { DEFAULT_PERSONS, DEFAULT_TRAVEL_CATEGORIES, normalizeLedger, formatCurrency } from '../../lib/utils';
import { reportError } from '../../lib/errorReporting';
import AppHeader from '../../components/AppHeader';
import TripPicker from '../../components/TripPicker';
import TripSettings from '../../components/TripSettings';
import BalanceStrip from '../../components/BalanceStrip';
import BudgetAlerts from '../../components/BudgetAlerts';
import AddEntryForm from '../../components/AddEntryForm';
import EntryList from '../../components/EntryList';
import CategoryChart from '../../components/CategoryChart';
import UndoToast from '../../components/UndoToast';

export default function Travel() {
  const { user } = useAuth();
  const { pendingJump, setPendingJump } = useJump();
  const [allTravelEntries, setAllTravelEntries] = useState(null);
  const [trips, setTrips] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_TRAVEL_CATEGORIES);
  const [members, setMembers] = useState(DEFAULT_PERSONS);
  const [paymentMethods, setPaymentMethods] = useState(['Cash']);
  const [currencies, setCurrencies] = useState([]);
  const [creditCards, setCreditCards] = useState([]);
  const [cardTransactions, setCardTransactions] = useState([]);

  const [selectedTrip, setSelectedTrip] = useState('');
  const [currentCurrency, setCurrentCurrency] = useState('INR');
  const [showSettings, setShowSettings] = useState(false);

  // Mirrors household.js - deleting a linked entry also deletes the card
  // transaction it created (see AddEntryForm's handleSubmit).
  async function deleteTravelEntry(id) {
    const entry = allTravelEntries?.find((e) => e.id === id);
    await deleteExpense(id);
    if (entry?.cardTransactionId) {
      try {
        await deleteCardTransaction(entry.cardTransactionId);
      } catch (err) {
        reportError(err, 'Deleted the entry, but could not remove its linked card transaction');
      }
    }
  }

  const { pendingDeletes, handleDelete, handleUndo, pendingDeleteList } = useUndoDelete(deleteTravelEntry, (err) =>
    reportError(err, 'Could not delete entry'),
  );

  useEffect(() => subscribeToExpenses('travel', setAllTravelEntries, (err) => reportError(err, 'Could not load travel entries')), []);
  useEffect(() => subscribeToTrips(setTrips, (err) => reportError(err, 'Could not load trips')), []);
  useEffect(() => subscribeToCashMovements(setCashMovements, (err) => reportError(err, 'Could not load cash movements')), []);
  useEffect(
    () =>
      subscribeToCategories((data) => {
        if (data.travel?.length) setCategories(data.travel);
      }, (err) => reportError(err, 'Could not load categories')),
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
  useEffect(
    () =>
      subscribeToPaymentMethods((data) => {
        if (data.methods?.length) setPaymentMethods(data.methods);
      }, (err) => reportError(err, 'Could not load payment methods')),
    [],
  );
  useEffect(() => subscribeToCurrencies((data) => setCurrencies(data.currencies), (err) => reportError(err, 'Could not load currencies')), []);
  useEffect(() => subscribeToCreditCards(setCreditCards, (err) => reportError(err, 'Could not load credit cards')), []);
  useEffect(() => subscribeToCardTransactions(setCardTransactions, (err) => reportError(err, 'Could not load card transactions')), []);

  const selectedTripObj = trips.find((t) => t.name === selectedTrip) || null;

  const tripEntries = useMemo(
    () => (allTravelEntries || []).filter((e) => normalizeLedger(e.ledger) === 'travel' && e.tripName === selectedTrip),
    [allTravelEntries, selectedTrip],
  );

  const activeMembersList = useMemo(
    () => (selectedTripObj?.guests?.length ? [...members, ...selectedTripObj.guests] : members),
    [members, selectedTripObj],
  );

  const tripRollup = selectedTripObj?.rolledUpEntryId
    ? {
        entryId: selectedTripObj.rolledUpEntryId,
        amount: selectedTripObj.rolledUpAmount,
        debtor: selectedTripObj.rolledUpDebtor,
        creditor: selectedTripObj.rolledUpCreditor,
      }
    : null;

  useEffect(() => {
    if (pendingJump?.ledger === 'travel') {
      if (pendingJump.tripName) setSelectedTrip(pendingJump.tripName);
      setPendingJump(null);
    }
  }, [pendingJump, setPendingJump]);

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge={selectedTrip ? `✈️ ${selectedTrip}` : '✈️ Travel'} />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          <TripPicker
            trips={trips}
            cashMovements={cashMovements}
            entries={allTravelEntries || []}
            dbCurrencies={currencies}
            selectedTrip={selectedTrip}
            onTripSelect={setSelectedTrip}
            currentCurrency={currentCurrency}
            onCurrencyChange={setCurrentCurrency}
            onOpenSettings={() => setShowSettings(true)}
            onSaveError={(err) => reportError(err, 'Could not save')}
          />

          {/* BalanceStrip has its own internal sm:-breakpoint layout (a
              settlement form meant to spread across a wide row) that breaks
              when squeezed into the narrow lg:w-96 rail below - Tailwind's
              sm:/lg: breakpoints key off viewport width, not this
              container's actual width, so at a wide viewport they'd still
              switch it into a wide-row layout inside a box that's nowhere
              near wide enough. Kept full-width here instead, same as
              TripPicker right above it. */}
          {selectedTripObj && allTravelEntries && (
            <BalanceStrip
              entries={tripEntries}
              ledger="travel"
              dbMembers={activeMembersList}
              tripName={selectedTrip}
              tripId={selectedTripObj.id}
              tripRollup={tripRollup}
            />
          )}
        </View>

        {/* Two-column shell above 1024px - see household.js for the same
            pattern and the reasoning behind the order-* stacking. */}
        {selectedTripObj && allTravelEntries && (
          <View className="flex-col lg:flex-row" style={{ gap: 20 }}>
            <View className="order-2 lg:order-1 lg:flex-1">
              <View className="px-4">
                <AddEntryForm
                  deviceName={user?.displayName}
                  ledger="travel"
                  tripName={selectedTrip}
                  dbCategories={categories}
                  dbMembers={activeMembersList}
                  currentCurrency={selectedTripObj.currency}
                  dbPaymentMethods={paymentMethods}
                  tripEntries={tripEntries}
                  creditCards={creditCards}
                  cardTransactions={cardTransactions}
                  recentEntries={tripEntries}
                />
              </View>

              <EntryList
                entries={tripEntries}
                ledger="travel"
                categories={categories}
                members={activeMembersList}
                dbPaymentMethods={paymentMethods}
                currentCurrency={selectedTripObj.currency}
                pendingDeletes={pendingDeletes}
                onDelete={handleDelete}
              />
            </View>

            <View className="order-1 lg:order-2 w-full lg:w-96 px-4" style={{ gap: 16 }}>
              <BudgetAlerts entries={tripEntries} ledger="travel" month={null} budgets={selectedTripObj.categoryBudgets || {}} />

              <CategoryChart
                entries={tripEntries}
                selectedMonth={null}
                onMonthChange={() => {}}
                availableMonths={[]}
                ledger="travel"
                budgets={selectedTripObj.categoryBudgets || {}}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <UndoToast
        pendingDeleteList={pendingDeleteList}
        getLabel={(entry) => `Deleted ${entry.note ? `"${entry.note}"` : entry.category} - ${formatCurrency(entry.amount)}`}
        onUndo={handleUndo}
      />

      <TripSettings
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        trip={selectedTripObj}
        trips={trips}
        entries={allTravelEntries || []}
        dbCategories={categories}
        dbPaymentMethods={paymentMethods}
        dbMembers={members}
        currentCurrency={selectedTripObj?.currency}
        onTripDeleted={() => setSelectedTrip('')}
        onSaveError={(err) => reportError(err, 'Could not save')}
      />
    </View>
  );
}
