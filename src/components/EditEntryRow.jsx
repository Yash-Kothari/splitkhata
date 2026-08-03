import { useState } from 'react';
import { updateExpense } from '../firebase';
import { DEFAULT_PERSONS as PERSONS } from '../utils';

export default function EditEntryRow({
  entry,
  dbMembers = [],
  dbCategories = [],
  ledger = 'household',
  currentCurrency = 'INR',
  onCancel,
  onSaved,
  onSaveError,
}) {
  const membersList = dbMembers && dbMembers.length > 0 ? dbMembers : PERSONS;
  const categories = dbCategories && dbCategories.length > 0 ? dbCategories : [entry.category];

  const [amount, setAmount] = useState(String(entry.amount ?? ''));
  const [payer, setPayer] = useState(membersList.includes(entry.payer) ? entry.payer : membersList[0]);
  const [category, setCategory] = useState(categories.includes(entry.category) ? entry.category : categories[0]);
  const [splitType, setSplitType] = useState(entry.splitType || (entry.split ? 'shared' : 'personal'));
  const [owedBy, setOwedBy] = useState(
    entry.owedBy && membersList.includes(entry.owedBy)
      ? entry.owedBy
      : membersList.find((p) => p !== payer) || ''
  );
  const [date, setDate] = useState(entry.date || '');
  const [note, setNote] = useState(entry.note || '');
  const [saving, setSaving] = useState(false);

  const inputClass =
    'w-full h-10 px-3 text-sm rounded-lg border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40';
  const selectClass = `${inputClass} appearance-none`;
  const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-text mb-1';

  async function handleSave(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;

    setSaving(true);
    try {
      await updateExpense(entry.id, {
        amount: parsed,
        payer,
        category,
        split: splitType !== 'personal',
        splitType,
        owedBy: splitType === 'owed' ? owedBy : null,
        note: note.trim(),
        date,
      });
      onSaved?.();
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="py-3.5 px-2 rounded-md bg-paper/60 border border-ledger-green/30">
      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor={`edit-amount-${entry.id}`} className={labelClass}>
              Amount ({ledger === 'travel' ? currentCurrency : '₹'})
            </label>
            <input
              id={`edit-amount-${entry.id}`}
              type="number"
              inputMode="decimal"
              min="0.01"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${inputClass} font-mono font-bold`}
            />
          </div>

          <div>
            <label htmlFor={`edit-split-${entry.id}`} className={labelClass}>
              Split Type
            </label>
            <select
              id={`edit-split-${entry.id}`}
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
            <label htmlFor={`edit-payer-${entry.id}`} className={labelClass}>
              Who Paid
            </label>
            <select
              id={`edit-payer-${entry.id}`}
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
              <label htmlFor={`edit-owedby-${entry.id}`} className={labelClass}>
                Who Owes Full Amount
              </label>
              <select
                id={`edit-owedby-${entry.id}`}
                value={owedBy}
                onChange={(e) => setOwedBy(e.target.value)}
                className={selectClass}
                required
              >
                {membersList.filter((p) => p !== payer).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor={`edit-category-${entry.id}`} className={labelClass}>
              Category
            </label>
            <select
              id={`edit-category-${entry.id}`}
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
            <label htmlFor={`edit-date-${entry.id}`} className={labelClass}>
              Date
            </label>
            <input
              id={`edit-date-${entry.id}`}
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputClass} date-input appearance-none`}
            />
          </div>

          <div className="col-span-2 sm:col-span-3">
            <label htmlFor={`edit-note-${entry.id}`} className={labelClass}>
              Note (optional)
            </label>
            <input
              id={`edit-note-${entry.id}`}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
              placeholder="What was this for?"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !amount}
            className="h-9 px-4 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-9 px-4 rounded-lg border border-ink/15 text-ink font-semibold text-xs sm:text-sm hover:bg-ink/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}
