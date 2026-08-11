import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import BalanceStrip from './components/BalanceStrip';
import AddEntryForm from './components/AddEntryForm';
import AskQuestion from './components/AskQuestion';
import BudgetAlerts from './components/BudgetAlerts';
import EntryList from './components/EntryList';
import ConnectionState from './components/ConnectionState';
import TravelManager from './components/TravelManager';
import PaymentsCenter from './components/PaymentsCenter';
import SettingsModal from './components/SettingsModal';
import PinLockScreen from './components/PinLockScreen';
import {
  subscribeToExpenses,
  subscribeToCategories,
  subscribeToCurrencies,
  subscribeToMembers,
  subscribeToTrips,
  subscribeToCashMovements,
  subscribeToPaymentMethods,
  subscribeToPinConfig,
  subscribeToHouseholdBudgets,
  isFirebaseConfigured,
  subscribeToAuth,
  signInWithGoogle,
  signOutUser,
  isAllowedUser,
} from './firebase';
import {
  DEFAULT_PERSONS as PERSONS,
  DEFAULT_CURRENCIES as CURRENCIES,
  DEFAULT_PAYMENT_METHODS as PAYMENT_METHODS,
  getDeviceName,
  setDeviceName,
  getAvailableMonths,
  getStoredActiveLedger,
  setStoredActiveLedger,
  getPinConfig,
  getActiveTrip,
  getMonthKey,
  todayISO,
} from './utils';

// recharts pulls in a lot of weight for content that's below the fold on
// first paint - load it as its own chunk instead of the main bundle.
const MonthChart = lazy(() => import('./components/MonthChart'));
const CategoryChart = lazy(() => import('./components/CategoryChart'));

function ChartSkeleton() {
  return (
    <div className="panel-card px-4 sm:px-5 py-4 h-72 animate-pulse">
      <div className="h-4 w-32 bg-ink/10 rounded mb-2" />
      <div className="h-3 w-48 bg-ink/10 rounded mb-6" />
      <div className="h-40 bg-ink/5 rounded" />
    </div>
  );
}

function DeviceNamePicker({ onSelect, members = [] }) {
  const memberList = members && members.length > 0 ? members : PERSONS;
  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-paper">
      <div className="w-full max-w-sm rounded-2xl bg-paper-card px-6 py-8 border border-ink/15 text-center shadow-xl">
        <h1 className="font-display text-3xl font-bold text-ink mb-2">
          Splitkhata
        </h1>
        <p className="text-muted-text text-sm mb-6">
          Who is using this device?
        </p>
        <div className="flex flex-col gap-3">
          {memberList.map((person) => (
            <button
              key={person}
              type="button"
              onClick={() => onSelect(person)}
              className="min-h-12 px-4 py-3 rounded-xl border border-ink/15 bg-paper font-semibold text-ink text-base hover:bg-ledger-green/10 hover:border-ledger-green hover:text-ledger-green transition-all shadow-2xs"
            >
              {person}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-text mt-5 font-medium">
          Saved on this device only - no password needed
        </p>
      </div>
    </div>
  );
}

function SetupBanner({ onShowDetails }) {
  return (
    <div className="bg-mustard/15 border-b border-mustard/30 px-4 py-2 text-xs sm:text-sm text-ink flex items-center justify-between max-w-5xl mx-auto rounded-b-lg">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-mustard"></span>
        <span>
          <strong>Local DB Mode:</strong> Expenses & categories stored in browser. Add Firebase keys in <code className="font-mono text-xs">.env</code> for cloud sync.
        </span>
      </div>
      <button
        type="button"
        onClick={onShowDetails}
        className="underline font-semibold hover:text-ink shrink-0 ml-2"
      >
        Settings & Setup
      </button>
    </div>
  );
}

function GoogleSignIn({ error, onSignIn }) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-paper">
      <div className="w-full max-w-sm rounded-2xl bg-paper-card px-6 py-8 border border-ink/15 text-center shadow-xl">
        <h1 className="font-display text-3xl font-bold text-ink mb-2">Splitkhata</h1>
        <p className="text-muted-text text-sm mb-6">Sign in with an approved Google account to access the shared ledger.</p>
        {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
        <button type="button" onClick={onSignIn} className="w-full min-h-12 rounded-xl bg-ledger-green px-4 py-3 font-semibold text-white hover:opacity-90">
          Continue with Google
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(() => isFirebaseConfigured());
  const [currentUser, setCurrentUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [deviceName, setDeviceNameState] = useState(() => getDeviceName());
  const [isLocked, setIsLocked] = useState(() => {
    const cfg = getPinConfig();
    return cfg.enabled && Boolean(cfg.pin);
  });
  const [entries, setEntries] = useState([]);
  const [paymentsTravelEntries, setPaymentsTravelEntries] = useState([]);
  const [askHouseholdEntries, setAskHouseholdEntries] = useState([]);
  const [askTravelEntries, setAskTravelEntries] = useState([]);
  const [dbCategories, setDbCategories] = useState({ household: [], travel: [], rawDocs: [] });
  const [dbCurrencies, setDbCurrencies] = useState({ currencies: [], rawDocs: [] });
  const [dbMembers, setDbMembers] = useState({ members: [], rawDocs: [] });
  const [dbTrips, setDbTrips] = useState([]);
  const [dbCashMovements, setDbCashMovements] = useState([]);
  const [dbPaymentMethods, setDbPaymentMethods] = useState({ methods: [], rawDocs: [] });
  const [dbHouseholdBudgets, setDbHouseholdBudgets] = useState({});
  const [connectionStatus, setConnectionStatus] = useState('ok');
  const [errorMessage, setErrorMessage] = useState('');
  const [activeLedger, setActiveLedgerState] = useState(() => getStoredActiveLedger());
  // Deliberately not persisted (unlike activeLedger) - a trip should only
  // ever come up automatically because it's actually in progress today
  // (see the auto-select effect below), never because it's whatever was
  // last looked at before the page was closed.
  const [selectedTrip, setSelectedTrip] = useState('');
  const [currentCurrency, setCurrentCurrency] = useState('INR');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const setActiveLedger = useCallback((ledger) => {
    setActiveLedgerState(ledger);
    setStoredActiveLedger(ledger);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) return undefined;
    return subscribeToAuth((user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
  }, []);

  const handleSaveError = useCallback((err) => {
    setConnectionStatus('error');
    setErrorMessage(err?.message || 'Failed to save');
  }, []);

  // Keeps currentCurrency in sync with whatever trip is selected (its
  // currency lives on the trip record itself, which only becomes available
  // once the trips subscription loads). Also the only place a trip ever
  // gets auto-selected, and only when one is genuinely in progress today by
  // date range - selectedTrip is intentionally not persisted and has no
  // "most recent trip" fallback, so every fresh visit lands on the empty
  // "search to pick a trip" state unless a trip is actually active right
  // now, never on whatever was last looked at.
  useEffect(() => {
    if (!dbTrips.length) return;
    const trip = dbTrips.find((t) => t.name === selectedTrip);
    if (trip) {
      if (trip.currency) setCurrentCurrency(trip.currency);
      return;
    }
    const activeTrip = getActiveTrip(dbTrips);
    if (activeTrip) setSelectedTrip(activeTrip.name);
  }, [selectedTrip, dbTrips, setSelectedTrip]);

  // Subscribe to real-time database collections
  useEffect(() => {
    if (isFirebaseConfigured() && !isAllowedUser(currentUser)) return undefined;
    const unsubCurrencies = subscribeToCurrencies(
      (data) => setDbCurrencies(data),
      (err) => console.warn('Currencies sync warning:', err),
    );

    const unsubMembers = subscribeToMembers(
      (data) => setDbMembers(data),
      (err) => console.warn('Members sync warning:', err),
    );

    const unsubTrips = subscribeToTrips(
      (data) => setDbTrips(data),
      (err) => console.warn('Trips sync warning:', err),
    );

    const unsubCashMovements = subscribeToCashMovements(
      (data) => setDbCashMovements(data),
      (err) => console.warn('Cash movements sync warning:', err),
    );

    const unsubPaymentMethods = subscribeToPaymentMethods(
      (data) => setDbPaymentMethods(data),
      (err) => console.warn('Payment methods sync warning:', err),
    );

    const unsubPin = subscribeToPinConfig((cfg) => {
      if (cfg.enabled && cfg.pin) {
        setIsLocked(true);
      } else {
        setIsLocked(false);
      }
    });

    const unsubBudgets = subscribeToHouseholdBudgets((budgets) => setDbHouseholdBudgets(budgets));

    // Real-time subscriptions initialized
    return () => {
      unsubCurrencies();
      unsubMembers();
      unsubTrips();
      unsubCashMovements();
      unsubPaymentMethods();
      unsubPin();
      unsubBudgets();
    };
  }, [currentUser]);

  // Payments is a tab, not a real `ledger` value - it's a combined view over
  // household-ledger data (settlements + trip rollups), so it reads from
  // 'household' underneath rather than a third literal ledger.
  const dataLedger = activeLedger === 'payments' ? 'household' : activeLedger;

  useEffect(() => {
    if (!deviceName || (isFirebaseConfigured() && !isAllowedUser(currentUser))) return undefined;

    setConnectionStatus('syncing');
    const unsubExpenses = subscribeToExpenses(
      dataLedger,
      (data) => {
        setEntries(data);
        setConnectionStatus(navigator.onLine ? 'ok' : 'offline');
      },
      (err) => {
        setConnectionStatus('error');
        setErrorMessage(err?.message || 'Failed to load entries');
      },
    );

    const unsubCategories = subscribeToCategories(
      (catData) => {
        setDbCategories(catData);
      },
      (err) => {
        console.warn('Category sync warning:', err);
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
      unsubExpenses();
      unsubCategories();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [deviceName, currentUser, dataLedger]);

  // The Payments tab also needs every trip's reward points (not just
  // household data) to show the combined points balance - fetched
  // separately, only while that tab is open, so Household/Travel don't pay
  // for a second subscription they never use.
  useEffect(() => {
    if (activeLedger !== 'payments' || !deviceName || (isFirebaseConfigured() && !isAllowedUser(currentUser))) {
      setPaymentsTravelEntries([]);
      return undefined;
    }
    return subscribeToExpenses(
      'travel',
      (data) => setPaymentsTravelEntries(data),
      (err) => console.warn('Payments travel-entries sync warning:', err),
    );
  }, [activeLedger, deviceName, currentUser]);

  // Ask (the floating chat) is reachable from every tab, so it needs both
  // ledgers' full data at all times - not just whichever one `entries`
  // above happens to be scoped to right now - so a question can name a
  // trip that has nothing to do with the tab you're actually on.
  useEffect(() => {
    if (!deviceName || (isFirebaseConfigured() && !isAllowedUser(currentUser))) {
      setAskHouseholdEntries([]);
      setAskTravelEntries([]);
      return undefined;
    }
    const unsubHousehold = subscribeToExpenses(
      'household',
      (data) => setAskHouseholdEntries(data),
      (err) => console.warn('Ask household-entries sync warning:', err),
    );
    const unsubTravel = subscribeToExpenses(
      'travel',
      (data) => setAskTravelEntries(data),
      (err) => console.warn('Ask travel-entries sync warning:', err),
    );
    return () => {
      unsubHousehold();
      unsubTravel();
    };
  }, [deviceName, currentUser]);

  const availableMonths = getAvailableMonths(entries);

  useEffect(() => {
    if (availableMonths.length && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const activeMembersList = dbMembers.members.length > 0 ? dbMembers.members : PERSONS;
  const activeCurrenciesList = dbCurrencies.currencies.length > 0 ? dbCurrencies.currencies : CURRENCIES;
  const activePaymentMethodsList = dbPaymentMethods.methods.length > 0 ? dbPaymentMethods.methods : PAYMENT_METHODS;

  // `entries` is scoped to the ledger (household vs travel) by the Firestore
  // query, but travel entries span every trip - narrow to the trip you're
  // actually looking at so a second trip's data can't bleed into this one's
  // balance/charts/passbook. TravelSummaryCard is the exception: it shows
  // every trip at once, so it gets the unfiltered `entries`.
  const tripEntries = activeLedger === 'travel' && selectedTrip
    ? entries.filter((e) => e.tripName === selectedTrip)
    : entries;

  const currentTrip = dbTrips.find((t) => t.name === selectedTrip);
  const tripRollup = currentTrip?.rolledUpEntryId
    ? {
        entryId: currentTrip.rolledUpEntryId,
        amount: Number(currentTrip.rolledUpAmount || 0),
        debtor: currentTrip.rolledUpDebtor,
        creditor: currentTrip.rolledUpCreditor,
      }
    : null;

  // A trip's guests are scoped to that trip only (stored on the trip doc,
  // never in the household `members` collection) - folded into the members
  // list passed to entry-adding/balance components ONLY while on the travel
  // ledger with that trip selected, so they can never surface as a
  // payer/split option on the household ledger or Payments tab.
  const activeLedgerMembersList = activeLedger === 'travel' && currentTrip?.guests?.length
    ? [...activeMembersList, ...currentTrip.guests]
    : activeMembersList;

  // Everything Ask needs to answer a question about ANY ledger/trip,
  // regardless of which tab is actually open - see the askHouseholdEntries/
  // askTravelEntries subscriptions above.
  const askAllEntries = [...askHouseholdEntries, ...askTravelEntries];
  const askCategories = Array.from(new Set([...dbCategories.household, ...dbCategories.travel]));
  const askTripNames = dbTrips.map((t) => t.name);
  const askCurrentContext = activeLedger === 'travel'
    ? (selectedTrip ? `Travel ledger, trip: ${selectedTrip}` : 'Travel ledger (no specific trip selected)')
    : activeLedger === 'payments'
      ? 'Payments tab (no single ledger in view - default to household)'
      : 'Household ledger';
  // Short form of the same thing, for display in the Ask popup itself -
  // askCurrentContext above is written as an instruction for the AI
  // prompt, too verbose to show as a UI label.
  const askCurrentContextLabel = activeLedger === 'travel'
    ? (selectedTrip ? `Travel · ${selectedTrip}` : 'Travel (no trip selected)')
    : activeLedger === 'payments'
      ? 'Payments (defaults to Household)'
      : 'Household';
  // Shown as clickable starter chips when the chat thread is empty -
  // tailored per tab/trip instead of one static pair, and using real trip
  // names when there are enough of them to make "compare" concrete instead
  // of hypothetical.
  const askExampleQuestions = activeLedger === 'travel'
    ? (selectedTrip
        ? [`Biggest expense of this trip`, `How much did we spend on Hotel here?`]
        : askTripNames.length >= 2
          ? [`Compare ${askTripNames[0]} and ${askTripNames[1]} trip expenses`, `In which trip did I spend more on Food?`]
          : askTripNames.length === 1
            ? [`Biggest expense of my ${askTripNames[0]} trip`, `Top 3 biggest travel expenses`]
            : ['In which trip did I spend more on Food?', 'Top 3 biggest travel expenses'])
    : activeLedger === 'payments'
      ? ['Who owes who right now?', 'Total household spend this month']
      : ['Top 3 Biggest Expense of the month', 'How is Grocery expense compared to last month'];

  const pinConfig = getPinConfig();

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4 bg-paper text-muted-text">
        Checking sign-in…
      </div>
    );
  }

  if (isFirebaseConfigured() && !isAllowedUser(currentUser)) {
    return (
      <GoogleSignIn
        error={authError}
        onSignIn={async () => {
          setAuthError('');
          try {
            const result = await signInWithGoogle();
            if (!isAllowedUser(result.user)) {
              await signOutUser();
              setAuthError('This Google account is not allowed to access this ledger.');
            }
          } catch (err) {
            setAuthError(err?.message || 'Google sign-in failed. Please try again.');
          }
        }}
      />
    );
  }

  if (isLocked && pinConfig.enabled && pinConfig.pin) {
    return (
      <PinLockScreen
        correctPin={pinConfig.pin}
        onUnlock={() => setIsLocked(false)}
      />
    );
  }

  if (!deviceName) {
    return (
      <DeviceNamePicker
        members={activeMembersList}
        onSelect={(name) => {
          setDeviceName(name);
          setDeviceNameState(name);
        }}
      />
    );
  }

  const hasFirebase = isFirebaseConfigured();
  const currentDbCategories = activeLedger === 'travel'
    ? dbCategories.travel
    : dbCategories.household;

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

      {showSettingsModal && (
        <SettingsModal
          onClose={() => setShowSettingsModal(false)}
          deviceName={deviceName}
          onChangeDeviceName={(newName) => {
            setDeviceName(newName);
            setDeviceNameState(newName);
          }}
          dbCategories={dbCategories}
          rawCategoryDocs={dbCategories.rawDocs}
          dbCurrencies={activeCurrenciesList}
          rawCurrencyDocs={dbCurrencies.rawDocs}
          dbMembers={activeMembersList}
          rawMemberDocs={dbMembers.rawDocs}
          activeLedger={activeLedger}
          householdBudgets={dbHouseholdBudgets}
          householdEntries={askHouseholdEntries}
        />
      )}

      <div className={`min-h-dvh pb-10 ${connectionStatus !== 'ok' ? 'pt-10' : ''}`}>
        {!hasFirebase && <SetupBanner onShowDetails={() => setShowSettingsModal(true)} />}

        <header className="px-3 sm:px-4 pt-4 sm:pt-6 pb-4 max-w-5xl mx-auto border-b border-ink/10 mb-4 sm:mb-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <div className="min-w-0">
              <h1 className="font-display text-xl sm:text-2xl font-bold text-ink tracking-tight">
                Splitkhata
              </h1>
            </div>

            <span className="px-2.5 sm:px-3.5 py-1.5 rounded-xl border border-ledger-green/30 bg-ledger-green/10 text-ledger-green text-[11px] sm:text-xs font-bold tracking-wide shadow-2xs whitespace-nowrap truncate max-w-[40vw] sm:max-w-none">
              {activeLedger === 'travel'
                ? (selectedTrip ? `✈️ ${selectedTrip}` : '✈️ Travel')
                : activeLedger === 'payments'
                  ? '💰 Payments'
                  : '🏠 Household Ledger'}
            </span>

              <div className="flex items-center justify-end gap-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="flex items-center justify-center gap-1.5 min-w-9 min-h-9 px-2 sm:px-3 py-1.5 rounded-xl border border-ink/15 bg-paper text-xs font-semibold text-ink hover:bg-paper-card active:scale-95 transition-all shadow-2xs"
                  title="Open Settings"
                >
                  <span>⚙️</span>
                  <span className="hidden sm:inline">Settings</span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAccountMenu((open) => !open)}
                    className="text-xs font-medium text-muted-text bg-paper-card min-w-9 min-h-9 max-w-24 sm:max-w-none px-2 sm:px-3 py-1.5 rounded-xl border border-ink/10 hover:border-ink/20 active:scale-95 transition-all truncate"
                    aria-expanded={showAccountMenu}
                    aria-haspopup="menu"
                  >
                    <span className="hidden sm:inline">User: </span><strong className="text-ink">{deviceName}</strong>
                  </button>

                  {showAccountMenu && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-ink/15 bg-paper-card p-2 shadow-xl"
                    >
                      {hasFirebase && currentUser?.email && (
                        <p className="px-2 py-1.5 text-xs text-muted-text truncate" title={currentUser.email}>
                          {currentUser.email}
                        </p>
                      )}
                      {pinConfig.enabled && pinConfig.pin && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowAccountMenu(false);
                            setIsLocked(true);
                          }}
                          className="w-full min-h-10 rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-paper"
                        >
                          Lock app
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={async () => {
                          setShowAccountMenu(false);
                          await signOutUser();
                        }}
                        className="w-full min-h-10 rounded-lg px-3 py-2 text-left text-sm font-semibold text-stamp-red hover:bg-stamp-red/10"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              </div>
          </div>
        </header>

        <div className="px-3 sm:px-4 max-w-5xl mx-auto mb-4 sm:mb-6">
          <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-xl bg-paper border border-ink/10">
            <button
              type="button"
              onClick={() => setActiveLedger('payments')}
              className={`min-h-11 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                activeLedger === 'payments'
                  ? 'bg-ledger-green text-white shadow-xs'
                  : 'text-muted-text hover:text-ink'
              }`}
            >
              💰 Payments
            </button>
            <button
              type="button"
              onClick={() => setActiveLedger('household')}
              className={`min-h-11 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                activeLedger === 'household'
                  ? 'bg-ledger-green text-white shadow-xs'
                  : 'text-muted-text hover:text-ink'
              }`}
            >
              🏠 Household
            </button>
            <button
              type="button"
              onClick={() => setActiveLedger('travel')}
              className={`min-h-11 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                activeLedger === 'travel'
                  ? 'bg-ledger-green text-white shadow-xs'
                  : 'text-muted-text hover:text-ink'
              }`}
            >
              ✈️ Travel
            </button>
          </div>
        </div>

        <main className="px-3 sm:px-4 max-w-5xl mx-auto space-y-4 sm:space-y-6">
          <AskQuestion
            entries={askAllEntries}
            dbMembers={activeMembersList}
            dbCategories={askCategories}
            trips={askTripNames}
            currentContext={askCurrentContext}
            currentContextLabel={askCurrentContextLabel}
            exampleQuestions={askExampleQuestions}
          />

          {activeLedger === 'household' && (
            <BudgetAlerts
              entries={entries}
              ledger="household"
              month={getMonthKey(todayISO())}
              budgets={dbHouseholdBudgets}
            />
          )}

          {activeLedger === 'payments' && (
            <PaymentsCenter
              entries={entries}
              travelEntries={paymentsTravelEntries}
              dbMembers={activeMembersList}
              onSaveError={handleSaveError}
            />
          )}

          {activeLedger === 'travel' && (
            <TravelManager
              selectedTrip={selectedTrip}
              onTripSelect={setSelectedTrip}
              currentCurrency={currentCurrency}
              onCurrencyChange={setCurrentCurrency}
              dbCategories={dbCategories.travel}
              rawCategoryDocs={dbCategories.rawDocs}
              dbCurrencies={activeCurrenciesList}
              trips={dbTrips}
              cashMovements={dbCashMovements}
              entries={entries}
              dbPaymentMethods={activePaymentMethodsList}
              rawPaymentMethodDocs={dbPaymentMethods.rawDocs}
              dbMembers={activeMembersList}
              deviceName={deviceName}
              onSaveError={handleSaveError}
            />
          )}
          {/* TravelManager keeps dbMembers=activeMembersList (household only)
              above - it needs the pure household list to dedupe a new guest
              name against, and reads the current trip's own guest list
              itself via selectedTripObj.guests. Everything below this point
              (BalanceStrip in travel mode, AddEntryForm, EntryList) gets the
              guest-merged list instead, since those are what actually let a
              guest be picked as a payer/split target. */}

          {activeLedger === 'travel' && !currentTrip ? (
            dbTrips.length > 0 && (
              <div className="border-2 border-dashed border-ink/20 rounded-xl py-10 px-4 text-center text-muted-text text-sm bg-paper/50">
                Search and select a trip above to see its balance, spend breakdown, and passbook.
              </div>
            )
          ) : activeLedger !== 'payments' && (
            <>
              {activeLedger === 'travel' && (
                <BalanceStrip
                  entries={tripEntries}
                  ledger="travel"
                  dbMembers={activeLedgerMembersList}
                  tripName={selectedTrip}
                  tripId={currentTrip?.id}
                  tripRollup={tripRollup}
                  onSaveError={handleSaveError}
                />
              )}

              {activeLedger === 'travel' && (
                <BudgetAlerts
                  entries={tripEntries}
                  ledger="travel"
                  budgets={currentTrip?.categoryBudgets || {}}
                />
              )}

              <AddEntryForm
                deviceName={deviceName}
                onSaveError={handleSaveError}
                ledger={activeLedger}
                tripName={selectedTrip}
                dbCategories={currentDbCategories}
                dbMembers={activeLedgerMembersList}
                currentCurrency={currentCurrency}
                dbPaymentMethods={activePaymentMethodsList}
                tripEntries={tripEntries}
              />

              <div className={activeLedger === 'travel' ? '' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
                {activeLedger !== 'travel' && (
                  <Suspense fallback={<ChartSkeleton />}>
                    <MonthChart entries={tripEntries} ledger={activeLedger} />
                  </Suspense>
                )}
                <Suspense fallback={<ChartSkeleton />}>
                  <CategoryChart
                    entries={tripEntries}
                    selectedMonth={selectedMonth}
                    onMonthChange={setSelectedMonth}
                    availableMonths={availableMonths}
                    ledger={activeLedger}
                  />
                </Suspense>
              </div>

              <EntryList
                entries={tripEntries}
                selectedMonth={selectedMonth}
                onMonthChange={setSelectedMonth}
                availableMonths={availableMonths}
                onDeleteError={handleSaveError}
                onSaveError={handleSaveError}
                ledger={activeLedger}
                dbCategories={currentDbCategories}
                dbMembers={activeLedgerMembersList}
                currentCurrency={currentCurrency}
                dbPaymentMethods={activePaymentMethodsList}
                excludePaymentEntries={activeLedger === 'household'}
              />
            </>
          )}
        </main>
      </div>
    </>
  );
}
