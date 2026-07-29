import { useState, useEffect } from 'react';
import { addExpense } from '../firebase';
import { getLedgerCategories, DEFAULT_PERSONS as PERSONS, todayISO } from '../utils';

export default function AddEntryForm({
  deviceName,
  onSaveError,
  ledger = 'household',
  tripName = '',
  dbCategories,
  dbMembers = [],
  currentCurrency = 'INR',
}) {
  const categories = dbCategories && dbCategories.length > 0
    ? dbCategories
    : getLedgerCategories(ledger);

  const membersList = dbMembers && dbMembers.length > 0 ? dbMembers : PERSONS;

  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState(deviceName || membersList[0]);
  const [category, setCategory] = useState(categories[0] || 'Groceries');
  const [split, setSplit] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (categories.length && !categories.includes(category)) {
      setCategory(categories[0]);
    }
  }, [ledger, categories, category]);

  useEffect(() => {
    if (deviceName) {
      setPayer(deviceName);
    } else if (membersList.length && !membersList.includes(payer)) {
      setPayer(membersList[0]);
    }
  }, [deviceName, membersList, payer]);

  async function handleSubmit(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;

    setSaving(true);
    try {
      await addExpense({
        amount: parsed,
        payer,
        category,
        split,
        note: note.trim(),
        date,
        ledger,
        tripName: ledger === 'travel' ? tripName : '',
      });
      setAmount('');
      setNote('');
      setDate(todayISO());
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full h-11 px-3.5 text-sm sm:text-base rounded-xl border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs transition-all flex items-center';

  const selectClass =
    `${inputClass} appearance-none bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2324304A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")] bg-[length:1.1rem_1.1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9`;

  const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-muted-text mb-1.5';

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between min-h-11 text-left font-display text-lg font-bold text-ink hover:text-ledger-green transition-colors"
        aria-expanded={expanded}
      >
        <span>
          Add Entry {ledger === 'travel' && tripName ? `(${tripName})` : ''}
        </span>
        <span className="text-muted-text text-xs sm:text-sm font-sans font-semibold px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          {expanded ? 'Collapse' : 'Expand'}
        </span>
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="amount" className={labelClass}>
                Amount ({ledger === 'travel' ? currentCurrency : '₹'})
              </label>
              <input
                id="amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputClass} font-mono font-bold`}
                placeholder="0.00"
              />
            </div>

            <div>
              <label htmlFor="split" className={labelClass}>
                Split Type
              </label>
              <select
                id="split"
                value={split ? 'yes' : 'no'}
                onChange={(e) => setSplit(e.target.value === 'yes')}
                className={selectClass}
              >
                <option value="yes">Split</option>
                <option value="no">Personal</option>
              </select>
            </div>

            <div>
              <label htmlFor="payer" className={labelClass}>
                Who Paid
              </label>
              <select
                id="payer"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
                className={selectClass}
              >
                {membersList.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="category" className={labelClass}>
                Category
              </label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectClass}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="date" className={labelClass}>
                Date
              </label>
              <input
                id="date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${inputClass} appearance-none`}
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="note" className={labelClass}>
                Note (optional)
              </label>
              <input
                id="note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass}
                placeholder="What was this for?"
              />
            </div>
          </div>

          <div className="sticky bottom-0 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 bg-paper-card/95 backdrop-blur-xs border-t border-ink/10 sm:static sm:border-0 sm:p-0 sm:bg-transparent sm:backdrop-blur-none z-10">
            <button
              type="submit"
              disabled={saving || !amount}
              className="w-full h-11 px-4 py-2.5 rounded-xl bg-ledger-green text-white font-semibold text-sm sm:text-base shadow-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-ledger-green/50 transition-all flex items-center justify-center gap-2"
            >
              <span>{saving ? 'Saving...' : 'Add to Ledger'}</span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

