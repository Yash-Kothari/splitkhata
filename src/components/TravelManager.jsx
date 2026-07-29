import { useEffect, useMemo, useState } from 'react';
import {
  CURRENCIES,
  getStoredCashMovements,
  getStoredTravelCategories,
  getStoredTrips,
  setStoredCashMovements,
  setStoredTravelCategories,
  setStoredTrips,
} from '../constants';

export default function TravelManager({ onTripSelect, selectedTrip, currentCurrency, onCurrencyChange }) {
  const [trips, setTrips] = useState(() => getStoredTrips());
  const [tripName, setTripName] = useState('');
  const [tripCurrency, setTripCurrency] = useState('INR');
  const [customCategories, setCustomCategories] = useState(() => getStoredTravelCategories());
  const [cashMovements, setCashMovements] = useState(() => getStoredCashMovements());
  const [categoryDraft, setCategoryDraft] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    setStoredTrips(trips);
  }, [trips]);

  useEffect(() => {
    setStoredTravelCategories(customCategories);
  }, [customCategories]);

  useEffect(() => {
    setStoredCashMovements(cashMovements);
  }, [cashMovements]);

  const availableTrips = useMemo(() => trips, [trips]);
  const selectedTripCash = useMemo(() => {
    const relevant = cashMovements.filter((movement) => movement.tripName === selectedTrip);
    const opening = relevant.filter((movement) => movement.type === 'opening').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const withdrawals = relevant.filter((movement) => movement.type === 'withdrawal').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    return opening - withdrawals;
  }, [cashMovements, selectedTrip]);

  function handleAddTrip(event) {
    event.preventDefault();
    const normalized = tripName.trim();
    if (!normalized) return;
    if (trips.some((trip) => trip.name.toLowerCase() === normalized.toLowerCase())) return;
    const nextTrip = { name: normalized, currency: tripCurrency };
    const nextTrips = [...trips, nextTrip];
    setTrips(nextTrips);
    onTripSelect?.(nextTrip.name);
    onCurrencyChange?.(tripCurrency);
    setTripName('');
    setTripCurrency('INR');
    setShowSettings(true);
  }

  function handleAddCategory(event) {
    event.preventDefault();
    const normalized = categoryDraft.trim();
    if (!normalized) return;
    if (customCategories.includes(normalized)) return;
    setCustomCategories([...customCategories, normalized]);
    setCategoryDraft('');
  }

  function handleSaveCash(event) {
    event.preventDefault();
    if (!selectedTrip) return;
    const parsedOpening = parseFloat(openingCash);
    if (parsedOpening > 0) {
      setCashMovements((prev) => [
        ...prev,
        { tripName: selectedTrip, type: 'opening', amount: parsedOpening, createdAt: new Date().toISOString() },
      ]);
      setOpeningCash('');
    }
  }

  function handleAddWithdrawal(event) {
    event.preventDefault();
    if (!selectedTrip) return;
    const parsedWithdrawal = parseFloat(withdrawalAmount);
    if (parsedWithdrawal > 0) {
      setCashMovements((prev) => [
        ...prev,
        { tripName: selectedTrip, type: 'withdrawal', amount: parsedWithdrawal, createdAt: new Date().toISOString() },
      ]);
      setWithdrawalAmount('');
    }
  }

  if (!availableTrips.length) {
    return (
      <section className="panel-card px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-medium text-ink">Create your first trip</h2>
          <span className="text-xs rounded-full border border-ink/10 bg-paper px-3 py-1 text-muted-text">
            Travel mode
          </span>
        </div>
        <p className="text-sm text-muted-text">Create a trip first so you can add transactions, manage cash, and keep trip-level settings together.</p>
        <form onSubmit={handleAddTrip} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Trip name</label>
            <input
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-ink/15 bg-paper text-ink focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
              placeholder="Taiwan 2026"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-text mb-1">Default currency</label>
            <select
              value={tripCurrency}
              onChange={(e) => setTripCurrency(e.target.value)}
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-ink/15 bg-paper text-ink focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="w-full min-h-11 rounded-lg bg-ledger-green text-white font-medium">
              Create trip
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
          <h2 className="font-display text-lg font-medium text-ink">Trip workspace</h2>
          <p className="text-sm text-muted-text">Manage your active trip, cash, and trip-level settings from one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            className="min-h-10 rounded-full border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
          >
            {showSettings ? 'Hide settings' : 'Trip settings'}
          </button>
          <button
            type="button"
            onClick={() => {
              setTripName('');
              setTripCurrency('INR');
              setShowSettings(false);
            }}
            className="min-h-10 rounded-full border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
          >
            Add trip
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-paper px-4 py-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {availableTrips.map((trip) => {
            const active = selectedTrip === trip.name;
            return (
              <button
                key={trip.name}
                type="button"
                onClick={() => {
                  onTripSelect?.(trip.name);
                  onCurrencyChange?.(trip.currency || 'INR');
                }}
                className={`min-h-10 rounded-full px-3 py-2 text-sm border ${active ? 'bg-ledger-green text-white border-ledger-green' : 'border-ink/15 bg-paper text-ink'}`}
              >
                {trip.name}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-ink/10 bg-paper-card px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-text">Trip</p>
            <p className="font-medium text-ink mt-1">{selectedTrip || 'No trip selected'}</p>
          </div>
          <div className="rounded-lg border border-ink/10 bg-paper-card px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-text">Currency</p>
            <p className="font-medium text-ink mt-1">{currentCurrency || 'INR'}</p>
          </div>
          <div className="rounded-lg border border-ink/10 bg-paper-card px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-text">Cash left</p>
            <p className="font-medium text-ink mt-1">{selectedTrip ? `${selectedTripCash.toFixed(2)} ${currentCurrency || 'INR'}` : 'None yet'}</p>
          </div>
        </div>
      </div>

      {showSettings ? (
        <div className="settings-panel space-y-4" data-panel="settings">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Trip settings</p>
            <form onSubmit={handleSaveCash} className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-muted-text mb-1">Starting cash</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  className="w-full min-h-11 px-3 py-2 rounded-lg border border-ink/15 bg-paper text-ink focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                  placeholder="0"
                />
              </div>
              <div className="flex items-end">
                <button type="submit" className="w-full min-h-11 rounded-lg bg-ledger-green text-white font-medium">
                  Save start cash
                </button>
              </div>
            </form>

            <form onSubmit={handleAddWithdrawal} className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-muted-text mb-1">ATM withdrawal</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={withdrawalAmount}
                  onChange={(e) => setWithdrawalAmount(e.target.value)}
                  className="w-full min-h-11 px-3 py-2 rounded-lg border border-ink/15 bg-paper text-ink focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                  placeholder="0"
                />
              </div>
              <div className="flex items-end">
                <button type="submit" className="w-full min-h-11 rounded-lg border border-ink/15 bg-paper px-4 py-2 text-ink">
                  Add withdrawal
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Custom travel categories</p>
            <form onSubmit={handleAddCategory} className="flex flex-col gap-2 sm:flex-row">
              <input
                value={categoryDraft}
                onChange={(e) => setCategoryDraft(e.target.value)}
                className="flex-1 min-h-11 px-3 py-2 rounded-lg border border-ink/15 bg-paper text-ink focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                placeholder="Add a category"
              />
              <button type="submit" className="min-h-11 rounded-lg border border-ink/15 bg-paper px-4 py-2 text-ink">
                Add
              </button>
            </form>
            <div className="flex flex-wrap gap-2">
              {customCategories.map((category) => (
                <span key={category} className="rounded-full border border-ink/10 bg-paper px-3 py-1 text-sm text-ink">
                  {category}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
