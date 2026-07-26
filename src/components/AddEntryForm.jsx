import { useState } from 'react';
import { addExpense } from '../firebase';
import { CATEGORIES, PERSONS } from '../constants';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AddEntryForm({ deviceName, onSaveError }) {
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState(deviceName || 'Husband');
  const [category, setCategory] = useState('Groceries');
  const [split, setSplit] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

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
    'w-full min-h-11 px-3 py-2 rounded-lg border border-ink/15 bg-paper text-ink text-base focus:outline-none focus:ring-2 focus:ring-ledger-green/40';

  return (
    <section className="rounded-xl bg-paper-card px-5 py-4 border border-ink/10">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between min-h-11"
        aria-expanded={expanded}
      >
        <h2 className="font-display text-lg font-medium text-ink">Add Entry</h2>
        <span className="text-muted-text text-sm">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-muted-text mb-1">
                Amount (₹)
              </label>
              <input
                id="amount"
                type="number"
                inputMode="decimal"
                min="1"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputClass} font-mono`}
                placeholder="0"
              />
            </div>

            <div>
              <label htmlFor="split" className="block text-sm font-medium text-muted-text mb-1">
                Split?
              </label>
              <select
                id="split"
                value={split ? 'yes' : 'no'}
                onChange={(e) => setSplit(e.target.value === 'yes')}
                className={inputClass}
              >
                <option value="yes">Split 50/50</option>
                <option value="no">Personal</option>
              </select>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="payer" className="block text-sm font-medium text-muted-text mb-1">
                Who paid
              </label>
              <select
                id="payer"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
                className={inputClass}
              >
                {PERSONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="category" className="block text-sm font-medium text-muted-text mb-1">
                Category
              </label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="date" className="block text-sm font-medium text-muted-text mb-1">
                Date
              </label>
              <input
                id="date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label htmlFor="note" className="block text-sm font-medium text-muted-text mb-1">
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

          <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-paper-card/95 backdrop-blur-sm border-t border-ink/10 sm:static sm:border-0 sm:p-0 sm:bg-transparent sm:backdrop-blur-none">
            <button
              type="submit"
              disabled={saving || !amount}
              className="w-full min-h-11 px-4 py-2 rounded-lg bg-ledger-green text-white font-medium text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 focus:outline-none focus:ring-2 focus:ring-ledger-green/50"
            >
              {saving ? 'Saving…' : 'Add to ledger'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
