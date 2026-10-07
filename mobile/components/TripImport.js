import { useRef } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { notify, confirmAsync } from '../lib/dialogs';
import { importTripBundle } from '../lib/firebase';
import { reportError } from '../lib/errorReporting';
import { computeBalance, formatCurrency, validateTripBundle } from '../lib/utils';

// TEMPORARY - one-time import of a prepared {trip, entries} file (a Splitwise
// trip). Web only. Remove this file, its use in TripPicker, importTripBundle in
// firebase.js and validateTripBundle in utils.js once the trip is imported.
export default function TripImport({ trips, members, onImported }) {
  const inputRef = useRef(null);
  if (Platform.OS !== 'web') return null;

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      const errors = validateTripBundle(bundle, members, trips.map((t) => t.name));
      if (errors.length) {
        notify('Cannot import this file', errors.slice(0, 6).join('\n') + (errors.length > 6 ? `\n...and ${errors.length - 6} more` : ''));
        return;
      }
      const balance = computeBalance(bundle.entries, 'travel', members);
      const total = bundle.entries.reduce((sum, e) => sum + (e.amount || 0), 0);
      const owes = balance.status === 'settled' ? 'all settled' : `${balance.debtor} owes ${balance.creditor} ${formatCurrency(balance.amount)}`;
      const ok = await confirmAsync({
        title: `Import "${bundle.trip.name}"?`,
        message: `${bundle.entries.length} entries, total ${formatCurrency(total)}, ${owes}. This adds a new trip and all its entries at once.`,
        confirmLabel: 'Import',
        destructive: false,
      });
      if (!ok) return;
      const count = await importTripBundle(bundle);
      onImported?.(bundle.trip.id);
      notify('Imported', `${count} entries added to "${bundle.trip.name}".`);
    } catch (err) {
      reportError(err, 'Could not import the trip');
      notify('Could not import', err?.message || String(err));
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".json,application/json" onChange={handleFile} style={{ display: 'none' }} />
      <Pressable onPress={() => inputRef.current?.click()} className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
        <Text className="font-body-semibold text-xs text-muted-text">Import file</Text>
      </Pressable>
    </>
  );
}
