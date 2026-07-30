import { useState } from 'react';
import { deleteExpense } from '../firebase';
import {
  formatCurrency,
  formatMonthLabel,
  getMonthKey,
  normalizeLedger,
  PERSON_COLORS,
} from '../utils';

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function EntryList({
  entries,
  selectedMonth,
  onMonthChange,
  availableMonths = [],
  onDeleteError,
  ledger,
}) {
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = entries
    .filter((e) => {
      if (selectedMonth !== 'all' && getMonthKey(e.date) !== selectedMonth) return false;
      if (ledger && normalizeLedger(e.ledger) !== normalizeLedger(ledger)) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchNote = e.note?.toLowerCase().includes(term);
        const matchCat = e.category?.toLowerCase().includes(term);
        const matchPayer = e.payer?.toLowerCase().includes(term);
        const matchAmount = String(e.amount).includes(term);
        if (!matchNote && !matchCat && !matchPayer && !matchAmount) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });

  async function handleDelete(id) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    try {
      await deleteExpense(id);
    } catch (err) {
      onDeleteError?.(err);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Passbook Entries {selectedMonth === 'all' ? '(All Months)' : `(${formatMonthLabel(selectedMonth)})`}
          </h2>
          <p className="text-xs text-muted-text">
            {filtered.length} {filtered.length === 1 ? 'transaction' : 'transactions'} recorded
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {availableMonths.length > 0 && onMonthChange && (
            <select
              value={selectedMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="h-10 px-3 pr-8 rounded-xl border border-ink/15 bg-paper text-ink text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs appearance-none bg-[url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2324304A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e&quot;)] bg-[length:1rem_1rem] bg-[right_0.6rem_center] bg-no-repeat shrink-0"
              aria-label="Select month for passbook"
            >
              <option value="all">All Months</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search entries..."
            className="h-10 px-3.5 text-xs sm:text-sm rounded-xl border border-ink/15 bg-paper text-ink placeholder:text-muted-text/70 focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs w-full sm:w-48"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-ink/20 rounded-xl py-12 px-4 text-center text-muted-text text-sm bg-paper/50">
          {entries.length === 0
            ? 'No entries recorded yet. Add your first expense above!'
            : `No matching entries in ${formatMonthLabel(selectedMonth)}.`}
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {filtered.map((entry) => (
            <li
              key={entry.id}
              className="entry-row passbook-row py-3.5 pr-2 flex items-center justify-between gap-3 rounded-md transition-colors"
              style={{ '--dot-color': PERSON_COLORS[entry.payer] || '#3D7068' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-bold text-ink text-base">
                    {formatCurrency(entry.amount)}
                  </span>
                  <span className="text-xs text-muted-text shrink-0 font-medium bg-paper px-2 py-0.5 rounded border border-ink/10">
                    {formatDate(entry.date)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
                  <span className="font-semibold text-ink bg-paper-card px-2 py-0.5 rounded border border-ink/10">
                    {entry.category}
                  </span>
                  <span className="text-muted-text">
                    Paid by <strong className="text-ink">{entry.payer}</strong>
                  </span>
                  {!entry.split && (
                    <span className="px-1.5 py-0.2 rounded bg-mustard/20 text-mustard font-medium">
                      Personal
                    </span>
                  )}
                  {entry.splitType === 'owed' && entry.owedBy && (
                    <span className="px-1.5 py-0.2 rounded bg-ledger-green/15 text-ledger-green font-medium">
                      {entry.owedBy} owes full amount
                    </span>
                  )}
                  {entry.note && (
                    <span className="text-muted-text truncate max-w-xs">
                      - {entry.note}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(entry.id)}
                disabled={deletingId === entry.id}
                className={`shrink-0 min-h-8 min-w-8 px-2 py-1 flex items-center justify-center rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                  confirmDeleteId === entry.id
                    ? 'bg-stamp-red text-white hover:bg-stamp-red/90'
                    : 'text-stamp-red/70 hover:text-stamp-red hover:bg-stamp-red/10'
                }`}
                aria-label="Delete entry"
                title={confirmDeleteId === entry.id ? 'Click again to confirm delete' : 'Delete transaction'}
              >
                {confirmDeleteId === entry.id ? 'Delete?' : '✕'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
