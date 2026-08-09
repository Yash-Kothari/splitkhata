import { useEffect, useMemo, useState } from 'react';
import {
  addCategoryToDb,
  deleteCategoryFromDb,
  addTripToDb,
  deleteTripFromDb,
  addCashMovementToDb,
  addPaymentMethodToDb,
  deletePaymentMethodFromDb,
  addExpense,
} from '../firebase';
import { DEFAULT_CURRENCIES as CURRENCIES, normalizeLedger, todayISO } from '../utils';

export default function TravelManager({
  onTripSelect,
  selectedTrip,
  currentCurrency,
  onCurrencyChange,
  dbCategories = [],
  rawCategoryDocs = [],
  dbCurrencies = [],
  trips = [],
  cashMovements = [],
  entries = [],
  dbPaymentMethods = [],
  rawPaymentMethodDocs = [],
  dbMembers = [],
  deviceName = '',
  onSaveError,
}) {
  const currentYear = new Date().getFullYear();
  const [tripName, setTripName] = useState('');
  const [tripCurrency, setTripCurrency] = useState('INR');
  const [tripYear, setTripYear] = useState(currentYear);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [paymentMethodDraft, setPaymentMethodDraft] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalInr, setWithdrawalInr] = useState('');
  const [withdrawalDate, setWithdrawalDate] = useState(todayISO());
  const [withdrawalPayer, setWithdrawalPayer] = useState(deviceName || dbMembers[0] || '');
  const [withdrawalPaymentMethod, setWithdrawalPaymentMethod] = useState(dbPaymentMethods[0] || 'Cash');
  const [showSettings, setShowSettings] = useState(false);
  const [addingTrip, setAddingTrip] = useState(false);
  const [confirmingDeleteTrip, setConfirmingDeleteTrip] = useState(false);

  const displayCategories = dbCategories;
  const currenciesList = dbCurrencies && dbCurrencies.length > 0 ? dbCurrencies : CURRENCIES;

  const availableTrips = useMemo(() => trips, [trips]);
  // Newest year first, and within a year, whatever order they were created.
  const tripsByYear = useMemo(() => {
    const groups = {};
    for (const trip of availableTrips) {
      const year = trip.year || 'Unsorted';
      if (!groups[year]) groups[year] = [];
      groups[year].push(trip);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Unsorted') return 1;
      if (b === 'Unsorted') return -1;
      return Number(b) - Number(a);
    });
  }, [availableTrips]);
  const selectedTripYear = availableTrips.find((t) => t.name === selectedTrip)?.year;
  // A year is expanded by default only if it's the most recent one or holds
  // the active trip - otherwise this list would only ever grow taller as
  // trips pile up year after year. `toggledYears` tracks explicit clicks as
  // a flip against that default, rather than storing expanded/collapsed
  // directly, so a newly-added year still opens by default without needing
  // to be added to this set first.
  const [toggledYears, setToggledYears] = useState(() => new Set());
  function isYearExpanded(year, isDefaultExpanded) {
    return toggledYears.has(year) ? !isDefaultExpanded : isDefaultExpanded;
  }
  function toggleYear(year) {
    setToggledYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }
  // Picking a trip should always leave its year visibly expanded - without
  // this, selecting a trip inside a year the user had manually toggled
  // open would flip `isDefaultExpanded` (now true, since it holds the
  // active trip) against a stale toggle and immediately re-collapse it.
  function selectTrip(trip) {
    onTripSelect?.(trip.name);
    onCurrencyChange?.(trip.currency || 'INR');
    // tripsByYear's keys are strings (Object.entries always stringifies
    // keys), but trip.year is stored as a number - comparing/deleting
    // against toggledYears without coercing here silently no-ops.
    const year = String(trip.year || 'Unsorted');
    setToggledYears((prev) => {
      if (!prev.has(year)) return prev;
      const next = new Set(prev);
      next.delete(year);
      return next;
    });
  }
  useEffect(() => {
    setConfirmingDeleteTrip(false);
  }, [selectedTrip]);

  const selectedTripCash = useMemo(() => {
    const relevant = cashMovements.filter((movement) => movement.tripName === selectedTrip);
    const opening = relevant.filter((movement) => movement.type === 'opening').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const withdrawals = relevant.filter((movement) => movement.type === 'withdrawal').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    // Cash movements and cash-paid entries are tracked in the trip's local
    // currency (physical notes in hand), not entry.amount - that's always
    // INR now (the real cost that drives who-owes-whom).
    const cashSpent = entries
      .filter((e) => normalizeLedger(e.ledger) === 'travel' && e.tripName === selectedTrip && e.paymentMethod === 'Cash')
      .reduce((sum, e) => sum + Number(e.localAmount || 0), 0);
    return opening + withdrawals - cashSpent;
  }, [cashMovements, entries, selectedTrip]);

  async function handleAddTrip(event) {
    event.preventDefault();
    const normalized = tripName.trim();
    if (!normalized) return;
    if (trips.some((trip) => trip.name.toLowerCase() === normalized.toLowerCase())) return;
    try {
      await addTripToDb(normalized, tripCurrency, Number(tripYear) || currentYear, trips);
      onTripSelect?.(normalized);
      onCurrencyChange?.(tripCurrency);
      setTripName('');
      setTripCurrency('INR');
      setTripYear(currentYear);
      setAddingTrip(false);
      setShowSettings(true);
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleDeleteTrip(trip) {
    try {
      await deleteTripFromDb(trip.id, trip.name);
      if (selectedTrip === trip.name) {
        onTripSelect?.('');
      }
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleAddCategory(event) {
    event.preventDefault();
    const normalized = categoryDraft.trim();
    if (!normalized) return;
    try {
      await addCategoryToDb('travel', normalized, rawCategoryDocs);
      setCategoryDraft('');
    } catch (err) {
      console.error('Failed to add category:', err);
    }
  }

  async function handleDeleteCategory(categoryName) {
    try {
      await deleteCategoryFromDb('travel', categoryName, rawCategoryDocs);
    } catch (err) {
      console.error('Failed to delete category:', err);
    }
  }

  async function handleAddPaymentMethod(event) {
    event.preventDefault();
    const normalized = paymentMethodDraft.trim();
    if (!normalized) return;
    try {
      await addPaymentMethodToDb(normalized, rawPaymentMethodDocs);
      setPaymentMethodDraft('');
    } catch (err) {
      console.error('Failed to add payment method:', err);
    }
  }

  async function handleDeletePaymentMethod(name) {
    try {
      await deletePaymentMethodFromDb(name, rawPaymentMethodDocs);
    } catch (err) {
      console.error('Failed to delete payment method:', err);
    }
  }

  async function handleSaveCash(event) {
    event.preventDefault();
    if (!selectedTrip) return;
    const parsedOpening = parseFloat(openingCash);
    if (parsedOpening > 0) {
      try {
        await addCashMovementToDb({ tripName: selectedTrip, type: 'opening', amount: parsedOpening });
        setOpeningCash('');
      } catch (err) {
        onSaveError?.(err);
      }
    }
  }

  async function handleAddWithdrawal(event) {
    event.preventDefault();
    if (!selectedTrip) return;
    const parsedWithdrawal = parseFloat(withdrawalAmount);
    const parsedInr = parseFloat(withdrawalInr);
    // INR cost is required, not optional - without it there's no rate to
    // register the joint debt or to auto-price the "Cash" purchases it
    // funds, which just pushes that math back onto whoever's entering
    // expenses by hand. Requiring it here is what keeps every Cash entry
    // FIFO-priced automatically instead of typed in manually.
    if (parsedWithdrawal > 0 && parsedInr > 0 && withdrawalPayer) {
      try {
        await addCashMovementToDb({ tripName: selectedTrip, type: 'withdrawal', amount: parsedWithdrawal, date: withdrawalDate });
        await addExpense({
          amount: parsedInr,
          localAmount: parsedWithdrawal,
          payer: withdrawalPayer,
          category: 'Misc',
          split: true,
          splitType: 'shared',
          owedBy: null,
          note: `${currentCurrency || 'Local'} ATM Withdrawal`,
          date: withdrawalDate,
          ledger: 'travel',
          tripName: selectedTrip,
          paymentMethod: withdrawalPaymentMethod,
          isWithdrawal: true,
        });

        setWithdrawalAmount('');
        setWithdrawalInr('');
        setWithdrawalDate(todayISO());
      } catch (err) {
        onSaveError?.(err);
      }
    }
  }

  const inputClass =
    'w-full h-11 px-3.5 text-sm rounded-xl border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs flex items-center';

  const selectClass =
    `${inputClass} appearance-none bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2324304A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")] bg-[length:1.1rem_1.1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9`;

  if (!availableTrips.length) {
    return (
      <section className="panel-card px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-ink">Create Your First Trip</h2>
          <span className="text-xs rounded-full border border-ink/10 bg-paper px-3 py-1 font-medium text-muted-text">
            Travel Workspace
          </span>
        </div>
        <p className="text-sm text-muted-text">Create a trip to organize transactions, track cash balances, and manage trip currency.</p>
        <form onSubmit={handleAddTrip} className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Trip Name</label>
            <input
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              className={inputClass}
              placeholder="e.g., Taiwan"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Year</label>
            <input
              type="number"
              inputMode="numeric"
              step="1"
              value={tripYear}
              onChange={(e) => setTripYear(e.target.value)}
              className={inputClass}
              placeholder={String(currentYear)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Default Currency</label>
            <select
              value={tripCurrency}
              onChange={(e) => setTripCurrency(e.target.value)}
              className={selectClass}
            >
              {currenciesList.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <button type="submit" className="w-full min-h-11 rounded-lg bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 transition-colors shadow-xs">
              Create Trip
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="panel-card px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Trip Workspace</h2>
          <p className="text-xs text-muted-text">Manage your active trip, cash balances, and trip options.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            className="min-h-10 rounded-lg border border-ink/15 bg-paper px-3.5 py-2 text-xs font-semibold text-ink hover:bg-paper-card transition-colors shadow-2xs"
          >
            {showSettings ? 'Hide Trip Settings' : 'Trip Settings'}
          </button>
          <button
            type="button"
            onClick={() => {
              setTripName('');
              setTripCurrency('INR');
              setAddingTrip((v) => !v);
            }}
            className="min-h-10 rounded-lg border border-ink/15 bg-paper px-3.5 py-2 text-xs font-semibold text-ink hover:bg-paper-card transition-colors shadow-2xs"
          >
            {addingTrip ? 'Cancel' : '+ Add Trip'}
          </button>
        </div>
      </div>

      {addingTrip && (
        <form onSubmit={handleAddTrip} className="rounded-xl border border-ink/15 bg-paper/80 p-4 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Trip Name</label>
            <input
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              className={inputClass}
              placeholder="e.g., Singapore"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Year</label>
            <input
              type="number"
              inputMode="numeric"
              step="1"
              value={tripYear}
              onChange={(e) => setTripYear(e.target.value)}
              className={inputClass}
              placeholder={String(currentYear)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Default Currency</label>
            <select
              value={tripCurrency}
              onChange={(e) => setTripCurrency(e.target.value)}
              className={selectClass}
            >
              {currenciesList.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="w-full min-h-11 rounded-lg bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 transition-colors shadow-xs">
              Create Trip
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-ink/10 bg-paper px-4 py-4 space-y-3">
        <div className="space-y-2.5">
          {tripsByYear.map(([year, yearTrips], idx) => {
            const isDefaultExpanded = idx === 0 || String(year) === String(selectedTripYear);
            const expanded = isYearExpanded(year, isDefaultExpanded);
            return (
              <div key={year}>
                <button
                  type="button"
                  onClick={() => toggleYear(year)}
                  className="w-full flex items-center justify-between gap-2 mb-1.5 group"
                  aria-expanded={expanded}
                >
                  <span className="text-2xs font-bold uppercase tracking-wider text-muted-text group-hover:text-ink transition-colors">
                    {year}
                  </span>
                  <span className="flex items-center gap-1.5 text-2xs font-semibold text-muted-text group-hover:text-ink transition-colors">
                    {!expanded && `${yearTrips.length} trip${yearTrips.length === 1 ? '' : 's'}`}
                    <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
                  </span>
                </button>
                {expanded && (
                  <div className="flex flex-wrap gap-2">
                    {yearTrips.map((trip) => {
                      const active = selectedTrip === trip.name;
                      return (
                        <div
                          key={trip.name}
                          className={`flex items-center min-h-10 rounded-lg border transition-all ${
                            active
                              ? 'bg-ledger-green border-ledger-green shadow-2xs'
                              : 'border-ink/15 bg-paper hover:bg-paper-card'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => selectTrip(trip)}
                            className={`min-h-10 px-3.5 text-xs font-semibold ${active ? 'text-white' : 'text-ink'}`}
                          >
                            {trip.name}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-ink/10 bg-paper-card px-3.5 py-2.5">
            <p className="text-2xs uppercase font-bold tracking-wider text-muted-text">Active Trip</p>
            <p className="font-bold text-ink mt-0.5 text-sm">{selectedTrip || 'None Selected'}</p>
          </div>
          <div className="rounded-lg border border-ink/10 bg-paper-card px-3.5 py-2.5">
            <p className="text-2xs uppercase font-bold tracking-wider text-muted-text">Currency</p>
            <p className="font-bold text-ink mt-0.5 text-sm">{currentCurrency || 'INR'}</p>
          </div>
          <div className="rounded-lg border border-ink/10 bg-paper-card px-3.5 py-2.5">
            <p className="text-2xs uppercase font-bold tracking-wider text-muted-text">Cash Balance</p>
            <p className="font-mono font-bold text-ink mt-0.5 text-sm">
              {selectedTrip ? `${selectedTripCash.toFixed(2)} ${currentCurrency || 'INR'}` : '0.00'}
            </p>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="rounded-xl border border-ink/15 bg-paper/80 p-4 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ink">Trip Management & Cash</p>

          <form onSubmit={handleSaveCash} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted-text mb-1">Starting Cash</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div className="flex items-end">
              <button type="submit" className="w-full min-h-11 rounded-lg bg-ledger-green text-white font-semibold text-xs hover:bg-ledger-green/90 transition-colors">
                Save Starting Cash
              </button>
            </div>
          </form>

          <form onSubmit={handleAddWithdrawal} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted-text mb-1">ATM Cash Withdrawal ({currentCurrency || 'Local'})</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-text mb-1">INR Cost</label>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                required
                value={withdrawalInr}
                onChange={(e) => setWithdrawalInr(e.target.value)}
                className={inputClass}
                placeholder="From card/forex statement"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-text mb-1">Date</label>
              <input
                type="date"
                value={withdrawalDate}
                onChange={(e) => setWithdrawalDate(e.target.value)}
                className={`${inputClass} date-input appearance-none`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-text mb-1">Withdrawn By</label>
              <select
                value={withdrawalPayer}
                onChange={(e) => setWithdrawalPayer(e.target.value)}
                className={selectClass}
              >
                {(dbMembers.length > 0 ? dbMembers : [withdrawalPayer].filter(Boolean)).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-text mb-1">Card Used</label>
              <select
                value={withdrawalPaymentMethod}
                onChange={(e) => setWithdrawalPaymentMethod(e.target.value)}
                className={selectClass}
              >
                {dbPaymentMethods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <p className="text-2xs text-muted-text mb-2">
                This is the only place to record an ATM withdrawal. The INR cost is required - it's what registers the joint debt above and gives every "Cash" purchase you add afterward its rate, so nothing needs pricing by hand.
              </p>
              <button type="submit" className="w-full min-h-11 rounded-lg border border-ink/15 bg-paper font-semibold text-xs text-ink hover:bg-paper-card transition-colors">
                Record Withdrawal
              </button>
            </div>
          </form>

          <div className="space-y-2 pt-2 border-t border-ink/10">
            <p className="text-xs font-medium text-ink">Travel Categories</p>
            <form onSubmit={handleAddCategory} className="flex gap-2">
              <input
                value={categoryDraft}
                onChange={(e) => setCategoryDraft(e.target.value)}
                className="flex-1 min-h-10 px-3 py-1.5 rounded-lg border border-ink/15 bg-paper text-ink text-xs focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                placeholder="Add travel category"
              />
              <button type="submit" className="min-h-10 rounded-lg border border-ink/15 bg-paper px-3 py-1.5 font-semibold text-xs text-ink hover:bg-paper-card transition-colors">
                Add Category
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {displayCategories.map((category) => (
                <span
                  key={category}
                  className="inline-flex items-center gap-1 rounded-md border border-ink/10 bg-paper px-2.5 py-1 text-xs text-ink font-medium shadow-2xs"
                >
                  <span>{category}</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(category)}
                    className="text-muted-text hover:text-stamp-red text-xs font-bold px-1 py-0.2 rounded hover:bg-stamp-red/10 transition-colors"
                    title={`Remove ${category}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-ink/10">
            <p className="text-xs font-medium text-ink">Payment Methods</p>
            <p className="text-2xs text-muted-text -mt-1">
              Which card or "Cash" paid for each expense - used to reconcile cash spend against the balance above.
            </p>
            <form onSubmit={handleAddPaymentMethod} className="flex gap-2">
              <input
                value={paymentMethodDraft}
                onChange={(e) => setPaymentMethodDraft(e.target.value)}
                className="flex-1 min-h-10 px-3 py-1.5 rounded-lg border border-ink/15 bg-paper text-ink text-xs focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                placeholder="e.g. Yash Forex, Kruti Diners"
              />
              <button type="submit" className="min-h-10 rounded-lg border border-ink/15 bg-paper px-3 py-1.5 font-semibold text-xs text-ink hover:bg-paper-card transition-colors">
                Add
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {dbPaymentMethods.map((method) => (
                <span
                  key={method}
                  className="inline-flex items-center gap-1 rounded-md border border-ink/10 bg-paper px-2.5 py-1 text-xs text-ink font-medium shadow-2xs"
                >
                  <span>{method}</span>
                  {method !== 'Cash' && (
                    <button
                      type="button"
                      onClick={() => handleDeletePaymentMethod(method)}
                      className="text-muted-text hover:text-stamp-red text-xs font-bold px-1 py-0.2 rounded hover:bg-stamp-red/10 transition-colors"
                      title={`Remove ${method}`}
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>

          {selectedTrip && (
            <div className="space-y-2 pt-2 border-t border-ink/10">
              <p className="text-xs font-bold uppercase tracking-wider text-stamp-red">Danger Zone</p>
              {!confirmingDeleteTrip ? (
                <button
                  type="button"
                  onClick={() => setConfirmingDeleteTrip(true)}
                  className="min-h-10 rounded-lg border border-stamp-red/30 bg-paper px-3.5 py-2 text-xs font-semibold text-stamp-red hover:bg-stamp-red/10 transition-colors"
                >
                  Delete {selectedTrip}…
                </button>
              ) : (
                <div className="rounded-lg border border-stamp-red/30 bg-stamp-red/5 p-3 space-y-2.5">
                  <p className="text-xs text-ink">
                    Permanently delete <span className="font-semibold">{selectedTrip}</span>? Its entries and cash
                    movements aren't deleted with it, but they'll no longer be reachable from any trip. This can't be
                    undone.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const trip = trips.find((t) => t.name === selectedTrip);
                        if (trip) handleDeleteTrip(trip);
                        setConfirmingDeleteTrip(false);
                      }}
                      className="h-9 px-4 rounded-lg bg-stamp-red text-white font-semibold text-xs hover:bg-stamp-red/90 transition-colors"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteTrip(false)}
                      className="h-9 px-4 rounded-lg border border-ink/15 text-ink font-semibold text-xs hover:bg-ink/5 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
