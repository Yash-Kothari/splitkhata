import { useState, useEffect } from 'react';
import { addExpense, addExpensesBatch } from '../firebase';
import {
  getLedgerCategories,
  DEFAULT_PERSONS as PERSONS,
  todayISO,
  addMonthsToDateISO,
  splitAmountEvenly,
} from '../utils';

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
  const [splitType, setSplitType] = useState('shared');
  const [owedBy, setOwedBy] = useState(() => membersList.find((person) => person !== (deviceName || membersList[0])) || '');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [splitAcrossMonths, setSplitAcrossMonths] = useState(false);
  const [monthsCount, setMonthsCount] = useState(6);

  useEffect(() => {
    if (categories.length && !categories.includes(category)) {
      setCategory(categories[0]);
    }
  }, [ledger, categories, category]);

  // Default the payer to this device's identity, but only when the identity
  // itself changes (or the member list changes) — not on every payer edit,
  // otherwise manually picking a different payer gets immediately overwritten.
  useEffect(() => {
    if (deviceName && membersList.includes(deviceName)) {
      setPayer(deviceName);
    } else {
      setPayer((prev) => (membersList.includes(prev) ? prev : membersList[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceName, membersList]);

  useEffect(() => {
    if (!owedBy || owedBy === payer || !membersList.includes(owedBy)) {
      setOwedBy(membersList.find((person) => person !== payer) || '');
    }
  }, [membersList, owedBy, payer]);

  async function handleSubmit(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;

    const trimmedNote = note.trim();
    const months = splitAcrossMonths ? Math.max(2, Math.min(36, Math.round(monthsCount) || 2)) : 1;

    setSaving(true);
    try {
      if (months > 1) {
        const installmentAmounts = splitAmountEvenly(parsed, months);
        const installments = Array.from({ length: months }, (_, i) => ({
          amount: installmentAmounts[i],
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          note: trimmedNote ? `${trimmedNote} (${i + 1}/${months})` : `Installment ${i + 1}/${months}`,
          date: addMonthsToDateISO(date, i),
          ledger,
          tripName: ledger === 'travel' ? tripName : '',
        }));
        await addExpensesBatch(installments);
      } else {
        await addExpense({
          amount: parsed,
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          note: trimmedNote,
          date,
          ledger,
          tripName: ledger === 'travel' ? tripName : '',
        });
      }
      setAmount('');
      setNote('');
      setDate(todayISO());
      setSplitAcrossMonths(false);
      setMonthsCount(6);
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
                value={splitType}
                onChange={(e) => setSplitType(e.target.value)}
                className={selectClass}
              >
                <option value="shared">Split</option>
                <option value="owed">Owed</option>
                <option value="personal">Personal</option>
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

            {splitType === 'owed' && (
              <div>
                <label htmlFor="owedBy" className={labelClass}>
                  Who Owes the Full Amount
                </label>
                <select
                  id="owedBy"
                  value={owedBy}
                  onChange={(e) => setOwedBy(e.target.value)}
                  className={selectClass}
                  required
                >
                  {membersList.filter((person) => person !== payer).map((person) => (
                    <option key={person} value={person}>{person}</option>
                  ))}
                </select>
              </div>
            )}

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
                className={`${inputClass} date-input appearance-none lg:h-12 lg:px-4`}
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

          <div className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={splitAcrossMonths}
                onChange={(e) => setSplitAcrossMonths(e.target.checked)}
                className="h-4 w-4 rounded border-ink/30 text-ledger-green focus:ring-ledger-green/40"
              />
              <span className="text-sm font-semibold text-ink">
                Split across multiple months
              </span>
            </label>
            <p className="text-xs text-muted-text mt-1 ml-6">
              For lump-sum payments that cover several months (e.g. 6 months of WiFi) - spreads the amount evenly across one entry per month instead of inflating a single month.
            </p>

            {splitAcrossMonths && (
              <div className="mt-3 ml-6 max-w-[10rem]">
                <label htmlFor="monthsCount" className={labelClass}>
                  Number of Months
                </label>
                <input
                  id="monthsCount"
                  type="number"
                  inputMode="numeric"
                  min="2"
                  max="36"
                  step="1"
                  value={monthsCount}
                  onChange={(e) => setMonthsCount(e.target.value)}
                  className={inputClass}
                />
                {amount && parseFloat(amount) > 0 && (
                  <p className="text-xs text-muted-text mt-1.5">
                    ~₹{(parseFloat(amount) / Math.max(2, Math.min(36, Math.round(monthsCount) || 2))).toFixed(2)} / month
                  </p>
                )}
              </div>
            )}
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
