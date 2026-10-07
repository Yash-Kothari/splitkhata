import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { notify } from '../lib/dialogs';
import Card from './Card';
import PickerField from './PickerField';
import DateField from './DateField';
import { addTripToDb } from '../lib/firebase';
import { DEFAULT_CURRENCIES, isTripActive, todayISO, isValidISODate, computeTripCashStats } from '../lib/utils';

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
  selectedTripId,
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
  const [showArchived, setShowArchived] = useState(false);
  // With a trip selected the picker folds into one line so Add Entry stays
  // near the top of a phone screen; "Change" opens the full list again.
  const [browsing, setBrowsing] = useState(false);

  // Archiving only declutters this browse list - an archived trip's entries
  // stay fully searchable/askable/exportable, and it's still reachable here
  // via the "Show archived" toggle below.
  const unarchivedTrips = useMemo(() => trips.filter((t) => !t.archived), [trips]);
  const archivedCount = trips.length - unarchivedTrips.length;
  const browsableTrips = showArchived ? trips : unarchivedTrips;

  const activeTrip = useMemo(() => unarchivedTrips.find((t) => isTripActive(t, todayISO())), [unarchivedTrips]);

  const selectedTripObj = trips.find((t) => t.id === selectedTripId);

  const cashStats = useMemo(() => {
    if (!selectedTripId) return { balance: 0, withdrawn: 0 };
    const stats = computeTripCashStats(entries, cashMovements, selectedTripId, selectedTripObj?.name);
    return { balance: stats.balance, withdrawn: stats.opening + stats.withdrawn };
  }, [cashMovements, entries, selectedTripId, selectedTripObj]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trips.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      notify('Trip already exists', `"${trimmed}" is already a trip.`);
      return;
    }
    // Dates must be real YYYY-MM-DD dates, and the trip can't end before it starts.
    if ((startDate && !isValidISODate(startDate)) || (endDate && !isValidISODate(endDate))) {
      notify('Check the dates', 'Use the format YYYY-MM-DD.');
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      notify('Check the dates', 'The end date is before the start date.');
      return;
    }
    setSaving(true);
    try {
      const newTripId = await addTripToDb(trimmed, currency, Number(year) || currentYear(), trips, startDate || null, endDate || null);
      if (newTripId) onTripSelect?.(newTripId);
      setBrowsing(false);
      onCurrencyChange?.(currency);
      setName('');
      setCurrency('INR');
      setYear(String(currentYear()));
      setStartDate('');
      setEndDate('');
      setAddingTrip(false);
    } catch (err) {
      onSaveError?.(err);
      notify('Could not create trip', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const filteredTrips = browsableTrips.filter((t) => t.name.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const byYear = {};
  filteredTrips.forEach((t) => {
    const y = t.year || 'Other';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(t);
  });
  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

  const addTripForm = (
    <View className={trips.length === 0 ? '' : 'mt-3 pt-3 border-t border-ink/10'}>
      <View className="flex-row flex-wrap" style={{ gap: 12 }}>
        <View className="w-full sm:w-[calc(25%-9px)]">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Trip Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Japan 2026"
            className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
          />
        </View>
        <View className="w-full sm:w-[calc(25%-9px)]">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Year</Text>
          <TextInput
            value={year}
            onChangeText={setYear}
            keyboardType="number-pad"
            className="font-mono text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
          />
        </View>
        <View className="w-full sm:w-[calc(25%-9px)]">
          <PickerField label="Default Currency" value={currency} options={currencies} onChange={setCurrency} />
        </View>
        <View className="w-full sm:w-[calc(25%-9px)]">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Start Date (optional)</Text>
          <DateField
            value={startDate}
            onChange={setStartDate}
            className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
          />
        </View>
        <View className="w-full sm:w-[calc(25%-9px)]">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">End Date (optional)</Text>
          <DateField
            value={endDate}
            onChange={setEndDate}
            className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
          />
        </View>
      </View>
      <Pressable
        onPress={handleCreate}
        disabled={saving || !name.trim()}
        className="mt-3 min-h-11 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
      >
        <Text className="font-body-semibold text-white">{saving ? 'Creating...' : 'Create Trip'}</Text>
      </Pressable>
    </View>
  );

  const activeBanner =
    activeTrip && activeTrip.id !== selectedTripId && (
    <View className="mt-3 rounded-lg border border-ledger-green/40 bg-ledger-green/10 px-3.5 py-2.5 flex-row items-center justify-between gap-2">
      <View>
        <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-ledger-green">🧳 Currently Traveling</Text>
        <Text className="font-body-semibold text-sm text-ink mt-0.5">{activeTrip.name}</Text>
      </View>
      <Pressable
        onPress={() => {
          onTripSelect?.(activeTrip.id);
          onCurrencyChange?.(activeTrip.currency);
        }}
        className="min-h-9 px-3 rounded-lg bg-ledger-green items-center justify-center shrink-0"
      >
        <Text className="font-body-semibold text-xs text-white">Switch to it</Text>
      </Pressable>
    </View>
  );

  if (trips.length === 0) {
    return (
      <Card className="px-5 py-4 mb-4">
        <Text className="font-display text-lg text-ink mb-1">Create Your First Trip</Text>
        <Text className="font-body text-sm text-muted-text mb-3">
          Create a trip to organize transactions, track cash balances, and manage trip currency.
        </Text>
        {addTripForm}
      </Card>
    );
  }

  if (selectedTripObj && !browsing && !addingTrip) {
    const dates =
      selectedTripObj.startDate && selectedTripObj.endDate ? `${selectedTripObj.startDate} → ${selectedTripObj.endDate}` : '';
    return (
      <Card className="px-4 py-3 mb-4">
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <View className="flex-1">
            <Text className="font-display text-base text-ink" numberOfLines={1}>
              {isTripActive(selectedTripObj, todayISO()) ? '🧳 ' : ''}
              {selectedTripObj.name}
            </Text>
            {dates ? (
              <Text className="font-mono text-2xs text-muted-text mt-0.5" numberOfLines={1}>
                {dates} · {selectedTripObj.currency}
              </Text>
            ) : null}
            <View
              className={`self-start mt-1.5 px-2.5 py-1 rounded-md border ${
                cashStats.balance < 0 ? 'bg-stamp-red/10 border-stamp-red/30' : 'bg-ledger-green/10 border-ledger-green/30'
              }`}
            >
              <Text className={`font-mono-bold text-xs ${cashStats.balance < 0 ? 'text-stamp-red' : 'text-ledger-green'}`}>
                💵 Cash left: {selectedTripObj.currency} {cashStats.balance.toFixed(2)}
              </Text>
            </View>
          </View>
          <Pressable onPress={() => setBrowsing(true)} className="px-2.5 py-1.5 rounded-md bg-paper border border-ink/10">
            <Text className="font-body-semibold text-xs text-muted-text">Change</Text>
          </Pressable>
          <Pressable onPress={onOpenSettings} className="px-2.5 py-1.5 rounded-md bg-paper border border-ink/10">
            <Text className="font-body-semibold text-xs text-muted-text">Settings</Text>
          </Pressable>
        </View>
        {activeBanner}
      </Card>
    );
  }

  return (
    <Card className="px-5 py-4 mb-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-display text-lg text-ink">Trips</Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {selectedTripObj && !addingTrip && (
            <Pressable onPress={() => setBrowsing(false)} className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
              <Text className="font-body-semibold text-xs text-muted-text">Done</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setAddingTrip((v) => !v)} className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
            <Text className="font-body-semibold text-xs text-muted-text">{addingTrip ? 'Cancel' : '+ Add Trip'}</Text>
          </Pressable>
        </View>
      </View>

      {addingTrip && addTripForm}

      {!searchTerm.trim() && activeBanner}

      <TextInput
        value={searchTerm}
        onChangeText={setSearchTerm}
        placeholder="Search trips..."
        className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mt-3 mb-1 bg-paper shadow-2xs"
      />

      <View className="mt-2">
        {years.length === 0 && (
          <Text className="font-body text-sm text-muted-text py-2">No trips match "{searchTerm.trim()}".</Text>
        )}
        {years.map((y) => (
          <View key={y} className="mb-2">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1.5">{y}</Text>
            {byYear[y].map((t) => {
              const isSelected = t.id === selectedTripId;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    onTripSelect?.(t.id);
                    onCurrencyChange?.(t.currency);
                    setBrowsing(false);
                  }}
                  className={`flex-row items-center justify-between px-3.5 py-2.5 rounded-lg mb-1 border ${
                    isSelected ? 'bg-ledger-green/10 border-ledger-green/30' : 'bg-paper border-ink/10'
                  }`}
                >
                  <Text className={`font-body-semibold text-sm ${isSelected ? 'text-ledger-green' : 'text-ink'}`}>
                    {t.name}{t.archived ? ' (archived)' : ''}
                  </Text>
                  <Text className="font-body text-xs text-muted-text">{t.currency}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {archivedCount > 0 && (
        <Pressable onPress={() => setShowArchived((v) => !v)} className="mt-1 self-start">
          <Text className="font-body text-xs text-muted-text underline">
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </Text>
        </Pressable>
      )}

      {selectedTripObj && (
        <View className="mt-3 pt-3 border-t border-ink/10">
          <View className="flex-row gap-2 mb-3">
            <View className="flex-1 rounded-lg bg-paper-card border border-ink/10 px-3.5 py-2.5">
              <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-muted-text">Active Trip</Text>
              <Text className="font-body-semibold text-sm text-ink mt-0.5" numberOfLines={1}>
                {selectedTripObj.name}
              </Text>
            </View>
            <View className="flex-1 rounded-lg bg-paper-card border border-ink/10 px-3.5 py-2.5">
              <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-muted-text">Currency</Text>
              <Text className="font-body-semibold text-sm text-ink mt-0.5">{selectedTripObj.currency}</Text>
            </View>
            <View className="flex-1 rounded-lg bg-paper-card border border-ink/10 px-3.5 py-2.5">
              <Text className="font-body-semibold text-[10px] uppercase tracking-wider text-muted-text">Cash Balance</Text>
              <Text className="font-mono-bold text-sm text-ink mt-0.5">
                {cashStats.balance.toFixed(2)} {selectedTripObj.currency}
              </Text>
              {cashStats.withdrawn > 0 && (
                <Text className="font-mono text-2xs text-muted-text mt-0.5">
                  {cashStats.withdrawn.toFixed(2)} {selectedTripObj.currency} withdrawn
                </Text>
              )}
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
