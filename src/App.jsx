import { useState, useEffect, useCallback } from 'react';
import BalanceStrip from './components/BalanceStrip';
import AddEntryForm from './components/AddEntryForm';
import MonthChart from './components/MonthChart';
import CategoryChart from './components/CategoryChart';
import EntryList from './components/EntryList';
import ConnectionState from './components/ConnectionState';
import {
  subscribeToExpenses,
  isFirebaseConfigured,
} from './firebase';
import {
  PERSONS,
  getDeviceName,
  setDeviceName,
  getAvailableMonths,
} from './constants';

function DeviceNamePicker({ onSelect }) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl bg-paper-card px-6 py-8 border border-ink/10 text-center">
        <h1 className="font-display text-2xl font-bold text-ink mb-2">
          Household Ledger
        </h1>
        <p className="text-muted-text text-sm mb-6">
          Who&apos;s using this device?
        </p>
        <div className="flex flex-col gap-3">
          {PERSONS.map((person) => (
            <button
              key={person}
              type="button"
              onClick={() => onSelect(person)}
              className="min-h-11 px-4 py-2 rounded-lg border border-ink/15 bg-paper font-medium text-ink hover:bg-paper-card focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
            >
              {person}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-text mt-4">
          Saved on this device only — no login needed
        </p>
      </div>
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl bg-paper-card px-6 py-8 border border-ink/10">
        <h1 className="font-display text-2xl font-bold text-ink mb-2">
          Setup Required
        </h1>
        <p className="text-muted-text text-sm mb-4">
          Firebase is not configured yet. Copy{' '}
          <code className="font-mono text-xs bg-paper px-1 py-0.5 rounded">.env.example</code>{' '}
          to <code className="font-mono text-xs bg-paper px-1 py-0.5 rounded">.env</code>{' '}
          and add your Firebase project credentials.
        </p>
        <ol className="text-sm text-ink space-y-2 list-decimal list-inside">
          <li>Create a Firebase project (Spark / free plan)</li>
          <li>Enable Firestore Database</li>
          <li>Add a web app and copy the config values</li>
          <li>Set the <code className="font-mono text-xs">VITE_FIREBASE_*</code> env vars</li>
        </ol>
      </div>
    </div>
  );
}

export default function App() {
  const [deviceName, setDeviceNameState] = useState(() => getDeviceName());
  const [entries, setEntries] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('ok');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const handleSaveError = useCallback((err) => {
    setConnectionStatus('error');
    setErrorMessage(err?.message || 'Failed to save');
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured() || !deviceName) return;

    setConnectionStatus('syncing');
    const unsubscribe = subscribeToExpenses(
      (data) => {
        setEntries(data);
        setConnectionStatus(navigator.onLine ? 'ok' : 'offline');
      },
      (err) => {
        setConnectionStatus('error');
        setErrorMessage(err?.message || 'Failed to load entries');
      },
    );

    function handleOnline() {
      setConnectionStatus((prev) => (prev === 'offline' ? 'ok' : prev));
    }
    function handleOffline() {
      setConnectionStatus('offline');
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [deviceName]);

  const availableMonths = getAvailableMonths(entries);

  useEffect(() => {
    if (availableMonths.length && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  if (!isFirebaseConfigured()) return <SetupScreen />;
  if (!deviceName) {
    return (
      <DeviceNamePicker
        onSelect={(name) => {
          setDeviceName(name);
          setDeviceNameState(name);
        }}
      />
    );
  }

  return (
    <>
      <ConnectionState
        status={connectionStatus}
        message={errorMessage}
        onDismiss={() => {
          setConnectionStatus('ok');
          setErrorMessage('');
        }}
      />

      <div className={`min-h-dvh ${connectionStatus !== 'ok' ? 'pt-10' : ''}`}>
        <header className="px-4 pt-6 pb-4 max-w-5xl mx-auto">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="font-display text-2xl font-bold text-ink">
              Household Ledger
            </h1>
            <button
              type="button"
              onClick={() => {
                setDeviceName('');
                setDeviceNameState(null);
              }}
              className="text-xs text-muted-text underline min-h-11 flex items-center"
            >
              {deviceName}
            </button>
          </div>
        </header>

        <main className="px-4 pb-8 max-w-5xl mx-auto space-y-5">
          <BalanceStrip entries={entries} />
          <AddEntryForm deviceName={deviceName} onSaveError={handleSaveError} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <MonthChart entries={entries} />
            <CategoryChart
              entries={entries}
              selectedMonth={selectedMonth}
              onMonthChange={setSelectedMonth}
              availableMonths={availableMonths}
            />
          </div>

          <EntryList
            entries={entries}
            selectedMonth={selectedMonth}
            onDeleteError={handleSaveError}
          />
        </main>
      </div>
    </>
  );
}
