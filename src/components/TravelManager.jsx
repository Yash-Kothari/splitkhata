import { useMemo, useState } from 'react';
import {
  addCategoryToDb,
  deleteCategoryFromDb,
  addTripToDb,
  deleteTripFromDb,
  addCashMovementToDb,
  addPaymentMethodToDb,
  deletePaymentMethodFromDb,
} from '../firebase';
import { DEFAULT_CURRENCIES as CURRENCIES, normalizeLedger } from '../utils';

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
  onSaveError,
}) {
  const [tripName, setTripName] = useState('');
  const [tripCurrency, setTripCurrency] = useState('INR');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [paymentMethodDraft, setPaymentMethodDraft] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [addingTrip, setAddingTrip] = useState(false);

  const displayCategories = dbCategories;
  const currenciesList = dbCurrencies && dbCurrencies.length > 0 ? dbCurrencies : CURRENCIES;

  const availableTrips = useMemo(() => trips, [trips]);
  const selectedTripCash = useMemo(() => {
    const relevant = cashMovements.filter((movement) => movement.tripName === selectedTrip);
    const opening = relevant.filter((movement) => movement.type === 'opening').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const withdrawals = relevant.filter((movement) => movement.type === 'withdrawal').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const cashSpent = entries
      .filter((e) => normalizeLedger(e.ledger) === 'travel' && e.tripName === selectedTrip && e.paymentMethod === 'Cash')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);
    return opening + withdrawals - cashSpent;
  }, [cashMovements, entries, selectedTrip]);

  async function handleAddTrip(event) {
    event.preventDefault();
    const normalized = tripName.trim();
    if (!normalized) return;
    if (trips.some((trip) => trip.name.toLowerCase() === normalized.toLowerCase())) return;
    try {
      await addTripToDb(normalized, tripCurrency, trips);
      onTripSelect?.(normalized);
      onCurrencyChange?.(tripCurrency);
      setTripName('');
      setTripCurrency('INR');
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
    if (parsedWithdrawal > 0) {
      try {
        await addCashMovementToDb({ tripName: selectedTrip, type: 'withdrawal', amount: parsedWithdrawal });
        setWithdrawalAmount('');
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
        <form onSubmit={handleAddTrip} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Trip Name</label>
            <input
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              className={inputClass}
              placeholder="e.g., Taiwan 2026"
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
          <div className="sm:col-span-2">
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
        <form onSubmit={handleAddTrip} className="rounded-xl border border-ink/15 bg-paper/80 p-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Trip Name</label>
            <input
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              className={inputClass}
              placeholder="e.g., Singapore 2026"
              autoFocus
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
        <div className="flex flex-wrap gap-2">
          {availableTrips.map((trip) => {
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
                  onClick={() => {
                    onTripSelect?.(trip.name);
                    onCurrencyChange?.(trip.currency || 'INR');
                  }}
                  className={`min-h-10 pl-3.5 pr-2 text-xs font-semibold ${active ? 'text-white' : 'text-ink'}`}
                >
                  {trip.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteTrip(trip)}
                  className={`min-h-10 min-w-8 px-2 text-xs font-bold rounded-r-lg transition-colors ${
                    active ? 'text-white/80 hover:bg-white/10' : 'text-muted-text hover:text-stamp-red hover:bg-stamp-red/10'
                  }`}
                  title={`Delete ${trip.name}`}
                >
                  ✕
                </button>
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
              <label className="block text-xs font-medium text-muted-text mb-1">ATM Cash Withdrawal</label>
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
            <div className="flex items-end">
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
        </div>
      )}
    </section>
  );
}
