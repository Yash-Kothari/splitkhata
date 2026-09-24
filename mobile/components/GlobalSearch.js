import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { subscribeToExpenses } from '../lib/firebase';
import { useJump } from '../lib/JumpContext';
import { formatCurrency, normalizeLedger, searchAllEntries, getMonthKey } from '../lib/utils';
import { reportError } from '../lib/errorReporting';

function formatDate(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
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
  // Closing starts the next search fresh instead of showing the old query.
  function onClose() {
    setTerm('');
    onCloseProp();
  }
  const [householdEntries, setHouseholdEntries] = useState([]);
  const [travelEntries, setTravelEntries] = useState([]);

  useEffect(() => {
    if (!visible) return undefined;
    return subscribeToExpenses('household', setHouseholdEntries, (err) => reportError(err, 'Could not load household entries'));
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    return subscribeToExpenses('travel', setTravelEntries, (err) => reportError(err, 'Could not load travel entries'));
  }, [visible]);

  const results = searchAllEntries([...householdEntries, ...travelEntries], term);

  function handleJumpTo(entry) {
    if (normalizeLedger(entry.ledger) === 'travel') {
      setPendingJump({ ledger: 'travel', tripName: entry.tripName || null });
      router.push('/travel');
    } else {
      setPendingJump({ ledger: 'household', monthKey: getMonthKey(entry.date) });
      router.push('/household');
    }
    setTerm('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center px-2.5" style={{ paddingTop: 64 }}>
        <View
          className="w-full rounded-2xl bg-paper-card border border-ink/15 overflow-hidden"
          style={{ maxWidth: 480, maxHeight: Math.round(windowHeight * 0.7) }}
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

          <ScrollView keyboardShouldPersistTaps="handled">
            {term.trim() === '' ? (
              <Text className="font-body text-sm text-muted-text text-center px-5 py-8">
                Start typing to search across household and travel expenses.
              </Text>
            ) : results.length === 0 ? (
              <Text className="font-body text-sm text-muted-text text-center px-5 py-8">No entries match "{term}".</Text>
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
