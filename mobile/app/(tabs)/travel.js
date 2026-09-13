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
} from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { DEFAULT_PERSONS, DEFAULT_TRAVEL_CATEGORIES, normalizeLedger } from '../../lib/utils';
import AppHeader from '../../components/AppHeader';
import TripPicker from '../../components/TripPicker';
import TripSettings from '../../components/TripSettings';
import BalanceStrip from '../../components/BalanceStrip';
import BudgetAlerts from '../../components/BudgetAlerts';
import AddEntryForm from '../../components/AddEntryForm';
import EntryList from '../../components/EntryList';

export default function Travel() {
  const { user } = useAuth();
  const [allTravelEntries, setAllTravelEntries] = useState(null);
  const [trips, setTrips] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_TRAVEL_CATEGORIES);
  const [rawCategoryDocs, setRawCategoryDocs] = useState([]);
  const [members, setMembers] = useState(DEFAULT_PERSONS);
  const [paymentMethods, setPaymentMethods] = useState(['Cash']);
  const [rawPaymentMethodDocs, setRawPaymentMethodDocs] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  const [selectedTrip, setSelectedTrip] = useState('');
  const [currentCurrency, setCurrentCurrency] = useState('INR');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => subscribeToExpenses('travel', setAllTravelEntries, (err) => console.warn(err)), []);
  useEffect(() => subscribeToTrips(setTrips, (err) => console.warn(err)), []);
  useEffect(() => subscribeToCashMovements(setCashMovements, (err) => console.warn(err)), []);
  useEffect(
    () =>
      subscribeToCategories((data) => {
        if (data.travel?.length) setCategories(data.travel);
        setRawCategoryDocs(data.rawDocs.filter((d) => d.ledger === 'travel'));
      }, (err) => console.warn(err)),
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
  useEffect(
    () =>
      subscribeToPaymentMethods((data) => {
        if (data.methods?.length) setPaymentMethods(data.methods);
        setRawPaymentMethodDocs(data.rawDocs);
      }, (err) => console.warn(err)),
    [],
  );
  useEffect(() => subscribeToCurrencies((data) => setCurrencies(data.currencies), (err) => console.warn(err)), []);

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
          />

          {selectedTripObj && allTravelEntries && (
            <>
              <BalanceStrip
                entries={tripEntries}
                ledger="travel"
                dbMembers={activeMembersList}
                tripName={selectedTrip}
                tripId={selectedTripObj.id}
                tripRollup={tripRollup}
              />

              <BudgetAlerts entries={tripEntries} ledger="travel" month={null} budgets={selectedTripObj.categoryBudgets || {}} />

              <AddEntryForm
                deviceName={user?.displayName}
                ledger="travel"
                tripName={selectedTrip}
                dbCategories={categories}
                dbMembers={activeMembersList}
                currentCurrency={selectedTripObj.currency}
                dbPaymentMethods={paymentMethods}
                tripEntries={tripEntries}
              />
            </>
          )}
        </View>

        {selectedTripObj && allTravelEntries && (
          <EntryList
            title="Trip Passbook"
            emptyMessage="No entries recorded yet. Add your first expense above!"
            entries={tripEntries}
            ledger="travel"
            categories={categories}
            members={activeMembersList}
            dbPaymentMethods={paymentMethods}
            currentCurrency={selectedTripObj.currency}
          />
        )}
      </ScrollView>

      <TripSettings
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        trip={selectedTripObj}
        trips={trips}
        entries={allTravelEntries || []}
        dbCategories={categories}
        rawCategoryDocs={rawCategoryDocs}
        dbPaymentMethods={paymentMethods}
        rawPaymentMethodDocs={rawPaymentMethodDocs}
        dbMembers={members}
        currentCurrency={selectedTripObj?.currency}
        onTripDeleted={() => setSelectedTrip('')}
      />
    </View>
  );
}
