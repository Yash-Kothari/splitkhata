import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import Card from './Card';
import PickerField from './PickerField';
import { addTripToDb } from '../lib/firebase';
import { DEFAULT_CURRENCIES, formatCurrency, isTripActive, normalizeLedger, todayISO } from '../lib/utils';

function currentYear() {
  return new Date().getFullYear();
}

// RN port of TravelManager.jsx's trip-picker sections (not the Trip
// Settings modal, that's TripSettings.js): create-trip form, "currently
// traveling" banner, search + year-grouped browse list, 3-tile summary.
export default function TripPicker({
  trips,
  cashMovements,
  entries,
  dbCurrencies,
  selectedTrip,
  onTripSelect,
  currentCurrency,
  onCurrencyChange,
  onOpenSettings,
  onSaveError,
}) {
  const currencies = dbCurrencies && dbCurrencies.length > 0 ? dbCurrencies : DEFAULT_CURRENCIES;
  const [addingTrip, setAddingTrip] = useState(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [year, setYear] = useState(String(currentYear()));
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const activeTrip = useMemo(() => trips.find((t) => isTripActive(t, todayISO())), [trips]);

  const selectedTripObj = trips.find((t) => t.name === selectedTrip);

  const cashStats = useMemo(() => {
    if (!selectedTrip) return null;
    const relevant = cashMovements.filter((m) => m.tripName === selectedTrip);
    const opening = relevant.filter((m) => m.type === 'opening').reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const withdrawals = relevant.filter((m) => m.type === 'withdrawal').reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const cashSpent = entries
      .filter((e) => normalizeLedger(e.ledger) === 'travel' && e.tripName === selectedTrip && e.paymentMethod === 'Cash')
      .reduce((sum, e) => sum + Number(e.localAmount || 0), 0);
    return opening + withdrawals - cashSpent;
  }, [cashMovements, entries, selectedTrip]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trips.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      Alert.alert('Trip already exists', `"${trimmed}" is already a trip.`);
      return;
    }
    setSaving(true);
    try {
      await addTripToDb(trimmed, currency, Number(year) || currentYear(), trips, startDate || null, endDate || null);
      onTripSelect?.(trimmed);
      onCurrencyChange?.(currency);
      setName('');
      setCurrency('INR');
      setYear(String(currentYear()));
      setStartDate('');
      setEndDate('');
      setAddingTrip(false);
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not create trip', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const filteredTrips = trips.filter((t) => t.name.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const byYear = {};
  filteredTrips.forEach((t) => {
    const y = t.year || 'Other';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(t);
  });
  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

  const addTripForm = (
    <View className={trips.length === 0 ? '' : 'mt-3 pt-3 border-t border-ink/10'}>
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Trip Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Japan 2026"
        className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
      />
      <View className="mb-3">
        <PickerField label="Currency" value={currency} options={currencies} onChange={setCurrency} />
      </View>
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Year</Text>
      <TextInput
        value={year}
        onChangeText={setYear}
        keyboardType="number-pad"
        className="font-mono text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
      />
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Start Date (optional)</Text>
      <TextInput
        value={startDate}
        onChangeText={setStartDate}
        placeholder="2026-08-24"
        className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
      />
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">End Date (optional)</Text>
      <TextInput
        value={endDate}
        onChangeText={setEndDate}
        placeholder="2026-09-02"
        className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
      />
      <Pressable
        onPress={handleCreate}
        disabled={saving || !name.trim()}
        className="min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
      >
        <Text className="font-body-semibold text-white">{saving ? 'Creating...' : 'Create Trip'}</Text>
      </Pressable>
    </View>
  );

  if (trips.length === 0) {
    return (
      <Card className="px-5 py-4 mb-4">
        <Text className="font-display text-lg text-ink mb-1">Create Your First Trip</Text>
        <Text className="font-body text-sm text-muted-text mb-3">
          Give it a name, pick a currency, and start tracking travel spend separately from the household.
        </Text>
        {addTripForm}
      </Card>
    );
  }

  return (
    <Card className="px-5 py-4 mb-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-display text-lg text-ink">Trips</Text>
        <Pressable onPress={() => setAddingTrip((v) => !v)} className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          <Text className="font-body-semibold text-xs text-muted-text">{addingTrip ? 'Cancel' : '+ Add Trip'}</Text>
        </Pressable>
      </View>

      {addingTrip && addTripForm}

      {!searchTerm.trim() && activeTrip && activeTrip.name !== selectedTrip && (
        <View className="mt-3 rounded-lg border border-ledger-green/40 bg-ledger-green/10 px-3.5 py-2.5 flex-row items-center justify-between gap-2">
          <View>
            <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-ledger-green">🧳 Currently Traveling</Text>
            <Text className="font-body-semibold text-sm text-ink mt-0.5">{activeTrip.name}</Text>
          </View>
          <Pressable
            onPress={() => {
              onTripSelect?.(activeTrip.name);
              onCurrencyChange?.(activeTrip.currency);
            }}
            className="min-h-9 px-3 rounded-lg bg-ledger-green items-center justify-center shrink-0"
          >
            <Text className="font-body-semibold text-xs text-white">View</Text>
          </Pressable>
        </View>
      )}

      <TextInput
        value={searchTerm}
        onChangeText={setSearchTerm}
        placeholder="Search trips..."
        className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mt-3 mb-1 bg-paper shadow-2xs"
      />

      <View className="mt-2">
        {years.map((y) => (
          <View key={y} className="mb-2">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1.5">{y}</Text>
            {byYear[y].map((t) => {
              const isSelected = t.name === selectedTrip;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    onTripSelect?.(t.name);
                    onCurrencyChange?.(t.currency);
                  }}
                  className={`flex-row items-center justify-between px-3.5 py-2.5 rounded-lg mb-1 border ${
                    isSelected ? 'bg-ledger-green/10 border-ledger-green/30' : 'bg-paper border-ink/10'
                  }`}
                >
                  <Text className={`font-body-semibold text-sm ${isSelected ? 'text-ledger-green' : 'text-ink'}`}>{t.name}</Text>
                  <Text className="font-body text-xs text-muted-text">{t.currency}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {selectedTripObj && (
        <View className="mt-3 pt-3 border-t border-ink/10">
          <View className="flex-row gap-2 mb-3">
            <View className="flex-1 rounded-lg bg-paper-card border border-ink/10 px-3.5 py-2.5">
              <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-muted-text">Trip</Text>
              <Text className="font-body-semibold text-sm text-ink mt-0.5" numberOfLines={1}>
                {selectedTripObj.name}
              </Text>
            </View>
            <View className="flex-1 rounded-lg bg-paper-card border border-ink/10 px-3.5 py-2.5">
              <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-muted-text">Currency</Text>
              <Text className="font-body-semibold text-sm text-ink mt-0.5">{selectedTripObj.currency}</Text>
            </View>
            <View className="flex-1 rounded-lg bg-paper-card border border-ink/10 px-3.5 py-2.5">
              <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-muted-text">Cash in Hand</Text>
              <Text className="font-mono-bold text-sm text-ink mt-0.5">
                {(cashStats ?? 0).toLocaleString('en-IN')} {selectedTripObj.currency}
              </Text>
            </View>
          </View>
          <Pressable onPress={onOpenSettings} className="min-h-10 rounded-xl border border-ink/15 items-center justify-center">
            <Text className="font-body-semibold text-sm text-ink">Trip Settings</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}
