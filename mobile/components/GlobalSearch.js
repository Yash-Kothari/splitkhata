import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { subscribeToExpenses, subscribeToTrips } from '../lib/firebase';
import { useJump } from '../lib/JumpContext';
import { formatCurrency, normalizeLedger, searchAllEntries, getMonthKey } from '../lib/utils';
import { reportError } from '../lib/errorReporting';
import PickerField from './PickerField';
import DateField from './DateField';

function formatDate(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function uniqueSortedField(entries, field) {
  return Array.from(new Set(entries.map((e) => e[field]).filter(Boolean))).sort();
}

// RN port of web's GlobalSearch.jsx - searches every household + travel
// entry regardless of which tab/trip/month is currently open. Self-contained
// (subscribes to both ledgers itself) since it's opened from AppHeader,
// present on every screen, rather than receiving already-loaded entries
// the way web's App.jsx passes them down.
export default function GlobalSearch({ visible, onClose: onCloseProp }) {
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { setPendingJump } = useJump();
  const [term, setTerm] = useState('');
  const [payerFilter, setPayerFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  function clearFilters() {
    setPayerFilter('');
    setCategoryFilter('');
    setPaymentMethodFilter('');
    setDateFrom('');
    setDateTo('');
  }
  // Closing starts the next search fresh instead of showing the old query.
  function onClose() {
    setTerm('');
    clearFilters();
    onCloseProp();
  }
  const [householdEntries, setHouseholdEntries] = useState([]);
  const [travelEntries, setTravelEntries] = useState([]);
  const [trips, setTrips] = useState([]);

  useEffect(() => {
    if (!visible) return undefined;
    return subscribeToExpenses('household', setHouseholdEntries, (err) => reportError(err, 'Could not load household entries'));
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    return subscribeToExpenses('travel', setTravelEntries, (err) => reportError(err, 'Could not load travel entries'));
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    return subscribeToTrips(setTrips, (err) => reportError(err, 'Could not load trips'));
  }, [visible]);

  // tripName isn't written to new travel entries any more (P1-4 - tripId is
  // the real join key) - resolve the trip's current name live here, once,
  // so both the search match below and the result rows' display text stay
  // correct even after a rename, without searchAllEntries needing to know
  // about tripId at all.
  const allEntries = useMemo(() => {
    const tripsById = Object.fromEntries(trips.map((t) => [t.id, t]));
    return [...householdEntries, ...travelEntries].map((e) =>
      e.tripId ? { ...e, tripName: tripsById[e.tripId]?.name ?? e.tripName } : e,
    );
  }, [householdEntries, travelEntries, trips]);
  // Filter option lists come straight from the loaded entries, not a
  // separate categories/members/payment-methods subscription - one fewer
  // set of listeners to keep alive just for this modal (see P1-11).
  const payerOptions = useMemo(() => uniqueSortedField(allEntries, 'payer'), [allEntries]);
  const categoryOptions = useMemo(() => uniqueSortedField(allEntries, 'category'), [allEntries]);
  const paymentMethodOptions = useMemo(() => uniqueSortedField(allEntries, 'paymentMethod'), [allEntries]);
  const hasActiveFilters = Boolean(payerFilter || categoryFilter || paymentMethodFilter || dateFrom || dateTo);

  const results = searchAllEntries(allEntries, term, {
    payer: payerFilter || undefined,
    category: categoryFilter || undefined,
    paymentMethod: paymentMethodFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  function handleJumpTo(entry) {
    if (normalizeLedger(entry.ledger) === 'travel') {
      setPendingJump({ ledger: 'travel', tripId: entry.tripId || null, tripName: entry.tripName || null, entryId: entry.id });
      router.push('/travel');
    } else {
      setPendingJump({ ledger: 'household', monthKey: getMonthKey(entry.date), entryId: entry.id });
      router.push('/household');
    }
    setTerm('');
    clearFilters();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center px-2.5" style={{ paddingTop: 64 }}>
        <View
          className="w-full rounded-2xl bg-paper-card border border-ink/15 overflow-hidden"
          style={{ maxWidth: 480, maxHeight: Math.round(windowHeight * 0.85) }}
        >
          <View className="px-4 py-3.5 border-b border-ink/10 flex-row items-center gap-2 bg-paper/60">
            <Text className="text-muted-text">🔎</Text>
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder="Search all entries - any ledger, any trip..."
              autoFocus
              className="flex-1 font-body text-sm text-ink"
              style={{ outlineStyle: 'none' }}
            />
            <Pressable onPress={onClose} hitSlop={8} className="w-8 h-8 rounded-full border border-ink/15 bg-paper items-center justify-center shrink-0">
              <Text className="font-body-semibold text-ink">✕</Text>
            </Pressable>
          </View>

          <View className="px-4 py-3 border-b border-ink/10 bg-paper/30">
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <View className="w-[calc(50%-4px)]">
                <PickerField label="Payer" value={payerFilter || 'Anyone'} options={['Anyone', ...payerOptions]} onChange={(v) => setPayerFilter(v === 'Anyone' ? '' : v)} />
              </View>
              <View className="w-[calc(50%-4px)]">
                <PickerField label="Category" value={categoryFilter || 'Any category'} options={['Any category', ...categoryOptions]} onChange={(v) => setCategoryFilter(v === 'Any category' ? '' : v)} />
              </View>
              <View className="w-full">
                <PickerField label="Payment method" value={paymentMethodFilter || 'Any method'} options={['Any method', ...paymentMethodOptions]} onChange={(v) => setPaymentMethodFilter(v === 'Any method' ? '' : v)} />
              </View>
              <View className="w-[calc(50%-4px)]">
                <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">From</Text>
                <DateField value={dateFrom} onChange={setDateFrom} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper" />
              </View>
              <View className="w-[calc(50%-4px)]">
                <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">To</Text>
                <DateField value={dateTo} onChange={setDateTo} className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper" />
              </View>
            </View>
            {hasActiveFilters && (
              <Pressable onPress={clearFilters} className="self-start mt-2">
                <Text className="font-body text-xs text-muted-text underline">Clear filters</Text>
              </Pressable>
            )}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {term.trim() === '' && !hasActiveFilters ? (
              <Text className="font-body text-sm text-muted-text text-center px-5 py-8">
                Start typing, or set a filter above, to search across household and travel expenses.
              </Text>
            ) : results.length === 0 ? (
              <Text className="font-body text-sm text-muted-text text-center px-5 py-8">No entries match.</Text>
            ) : (
              results.map((entry, i) => {
                const isTravel = normalizeLedger(entry.ledger) === 'travel';
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => handleJumpTo(entry)}
                    className={`px-4 py-3 flex-row items-center justify-between gap-3 ${
                      i < results.length - 1 ? 'border-b border-ink/10' : ''
                    }`}
                  >
                    <View className="flex-1 min-w-0">
                      <View className="flex-row items-center flex-wrap gap-1.5">
                        <Text className="font-body-semibold text-sm text-ink bg-paper px-2 py-0.5 rounded border border-ink/10">
                          {entry.category}
                        </Text>
                        <View className="px-1.5 py-0.5 rounded bg-ledger-green/15">
                          <Text className="font-body-medium text-2xs text-ledger-green">
                            {isTravel ? `✈️ ${entry.tripName || 'Travel'}` : '🏠 Household'}
                          </Text>
                        </View>
                      </View>
                      {entry.note ? (
                        <Text numberOfLines={1} className="font-body text-xs text-muted-text mt-1">{entry.note}</Text>
                      ) : null}
                      <Text className="font-body text-2xs text-muted-text mt-0.5">
                        {formatDate(entry.date)} · Paid by {entry.payer}
                      </Text>
                    </View>
                    <Text className="font-mono-bold text-sm text-ink shrink-0">{formatCurrency(entry.amount, 'INR')}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
