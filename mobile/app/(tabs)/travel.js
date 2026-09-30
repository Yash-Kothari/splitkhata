import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Platform, KeyboardAvoidingView, useWindowDimensions } from 'react-native';
import {
  subscribeToExpenses,
  subscribeToTrips,
  subscribeToCashMovements,
  subscribeToCategories,
  subscribeToMembers,
  subscribeToGuests,
  subscribeToCurrencies,
  subscribeToCreditCards,
  subscribeToCardTransactions,
  deleteExpense,
  deleteCardTransaction,
  deleteCashMovementFromDb,
} from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { useJump } from '../../lib/JumpContext';
import { useUndoDelete } from '../../lib/useUndoDelete';
import { usePaymentInstruments } from '../../lib/usePaymentInstruments';
import { DEFAULT_PERSONS, DEFAULT_TRAVEL_CATEGORIES, normalizeLedger, formatCurrency, memberForUser } from '../../lib/utils';
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
  const [guests, setGuests] = useState([]);
  const [guestRawDocs, setGuestRawDocs] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [creditCards, setCreditCards] = useState([]);
  const [cardTransactions, setCardTransactions] = useState([]);
  const instruments = usePaymentInstruments(creditCards);

  const [selectedTripId, setSelectedTripId] = useState('');
  const [currentCurrency, setCurrentCurrency] = useState('INR');
  const [showSettings, setShowSettings] = useState(false);
  // Tailwind's order-* classes only apply on the website - see
  // household.js for the same pattern and the reasoning.
  const { width } = useWindowDimensions();
  const nativeStacked = Platform.OS !== 'web' && width < 1024;

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
    if (entry?.cashMovementId) {
      try {
        await deleteCashMovementFromDb(entry.cashMovementId);
      } catch (err) {
        reportError(err, 'Deleted the entry, but could not remove its linked cash movement');
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
      subscribeToGuests((data) => {
        setGuests(data.guests || []);
        setGuestRawDocs(data.rawDocs || []);
      }, (err) => reportError(err, 'Could not load guests')),
    [],
  );
  useEffect(() => subscribeToCurrencies((data) => setCurrencies(data.currencies), (err) => reportError(err, 'Could not load currencies')), []);
  useEffect(() => subscribeToCreditCards(setCreditCards, (err) => reportError(err, 'Could not load credit cards')), []);
  useEffect(() => subscribeToCardTransactions(setCardTransactions, (err) => reportError(err, 'Could not load card transactions')), []);

  const selectedTripObj = trips.find((t) => t.id === selectedTripId) || null;

  const tripEntries = useMemo(
    () =>
      (allTravelEntries || []).filter(
        (e) =>
          normalizeLedger(e.ledger) === 'travel' &&
          (e.tripId ? e.tripId === selectedTripId : e.tripName === selectedTripObj?.name),
      ),
    [allTravelEntries, selectedTripId, selectedTripObj],
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

  const [highlightEntryId, setHighlightEntryId] = useState(null);
  useEffect(() => {
    if (pendingJump?.ledger === 'travel') {
      // tripId is the real join key (P1-4); tripName is a fallback for a
      // jump to an entry the backfill hasn't tagged yet.
      if (pendingJump.tripId) {
        setSelectedTripId(pendingJump.tripId);
      } else if (pendingJump.tripName) {
        const match = trips.find((t) => t.name === pendingJump.tripName);
        if (match) setSelectedTripId(match.id);
      }
      setHighlightEntryId(pendingJump.entryId || null);
      setPendingJump(null);
    }
  }, [pendingJump, setPendingJump, trips]);

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge={selectedTripObj ? `✈️ ${selectedTripObj.name}` : '✈️ Travel'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          <TripPicker
            trips={trips}
            cashMovements={cashMovements}
            entries={allTravelEntries || []}
            dbCurrencies={currencies}
            selectedTripId={selectedTripId}
            onTripSelect={setSelectedTripId}
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
              tripName={selectedTripObj.name}
              tripId={selectedTripObj.id}
              tripRollup={tripRollup}
              instruments={instruments}
            />
          )}
        </View>

        {/* Two-column shell above 1024px - see household.js for the same
            pattern and the reasoning behind the order-* stacking. */}
        {selectedTripObj && allTravelEntries && (
          <View className="flex-col lg:flex-row" style={nativeStacked ? { gap: 20, flexDirection: 'column-reverse' } : { gap: 20 }}>
            <View className="order-2 lg:order-1 lg:flex-1">
              <View className="px-4">
                <AddEntryForm
                  deviceName={memberForUser(user, members) || undefined}
                  ledger="travel"
                  tripName={selectedTripObj.name}
                  tripId={selectedTripObj.id}
                  dbCategories={categories}
                  dbMembers={activeMembersList}
                  currentCurrency={selectedTripObj.currency}
                  instruments={instruments}
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
                instruments={instruments}
                creditCards={creditCards}
                cardTransactions={cardTransactions}
                currentCurrency={selectedTripObj.currency}
                highlightId={highlightEntryId}
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
      </KeyboardAvoidingView>

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
        dbCurrencies={currencies}
        instruments={instruments}
        dbMembers={members}
        dbGuests={guests}
        guestRawDocs={guestRawDocs}
        currentCurrency={selectedTripObj?.currency}
        onTripDeleted={() => setSelectedTripId('')}
        onSaveError={(err) => reportError(err, 'Could not save')}
      />
    </View>
  );
}
