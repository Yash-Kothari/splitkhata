import { useState } from 'react';
import { deleteExpense } from '../firebase';
import EditEntryRow from './EditEntryRow';
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
  title = 'Passbook Entries',
  emptyMessage = 'No entries recorded yet. Add your first expense above!',
  entries,
  selectedMonth,
  onMonthChange,
  availableMonths = [],
  onDeleteError,
  onSaveError,
  ledger,
  dbCategories = [],
  dbMembers = [],
  currentCurrency = 'INR',
  dbPaymentMethods = [],
  excludePaymentEntries = false,
}) {
  const isTravel = ledger === 'travel';
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);

  const filtered = entries
    .filter((e) => {
      // A trip is usually days, not months - only apply the month filter
      // for the household ledger, where it actually helps.
      if (!isTravel && selectedMonth !== 'all' && getMonthKey(e.date) !== selectedMonth) return false;
      if (ledger && normalizeLedger(e.ledger) !== normalizeLedger(ledger)) return false;
      // Settlements and trip rollups already have their own home in the
      // Payments tab - showing them again in the household passbook makes
      // it look like real household spend crept in among the groceries.
      // Opt-in only: PaymentsCenter's own list is exactly these entries, so
      // it must not filter them back out.
      if (excludePaymentEntries && (e.splitType === 'settlement' || e.isTripRollup)) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchNote = e.note?.toLowerCase().includes(term);
        const matchCat = e.category?.toLowerCase().includes(term);
        const matchPayer = e.payer?.toLowerCase().includes(term);
        const matchAmount = String(e.amount).includes(term) || String(e.localAmount ?? '').includes(term);
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
            {title} {!isTravel && (selectedMonth === 'all' ? '(All Months)' : `(${formatMonthLabel(selectedMonth)})`)}
          </h2>
          <p className="text-xs text-muted-text">
            {filtered.length} {filtered.length === 1 ? 'transaction' : 'transactions'} recorded
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {!isTravel && availableMonths.length > 0 && onMonthChange && (
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
            ? emptyMessage
            : isTravel
              ? 'No entries match your search.'
              : `No matching entries in ${formatMonthLabel(selectedMonth)}.`}
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {filtered.map((entry) =>
            editingId === entry.id ? (
              <EditEntryRow
                key={entry.id}
                entry={entry}
                dbCategories={dbCategories}
                dbMembers={dbMembers}
                dbPaymentMethods={dbPaymentMethods}
                ledger={ledger}
                currentCurrency={currentCurrency}
                tripEntries={entries}
                onCancel={() => setEditingId(null)}
                onSaved={() => setEditingId(null)}
                onSaveError={onSaveError}
              />
            ) : (
              <li
                key={entry.id}
                className="entry-row passbook-row py-3.5 pr-2 flex items-center justify-between gap-3 rounded-md transition-colors"
                style={{ '--dot-color': PERSON_COLORS[entry.payer] || '#3D7068' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-mono font-bold text-ink text-base">
                        {formatCurrency(entry.amount, 'INR')}
                      </span>
                      {isTravel && entry.localAmount != null && (
                        <span className="font-mono text-muted-text text-xs">
                          ({formatCurrency(entry.localAmount, currentCurrency)})
                        </span>
                      )}
                      {(isTravel || entry.isTripRollup) && entry.rewardPoints ? (
                        <span
                          className={`font-mono text-xs px-1.5 py-0.2 rounded font-semibold ${
                            entry.rewardPoints > 0
                              ? 'bg-mustard/20 text-mustard'
                              : 'bg-ledger-green/15 text-ledger-green'
                          }`}
                        >
                          🪙 {entry.rewardPoints > 0 ? `-${entry.rewardPoints}` : `+${Math.abs(entry.rewardPoints)}`} pts
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-text shrink-0 font-medium bg-paper px-2 py-0.5 rounded border border-ink/10">
                      {formatDate(entry.date)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
                    {entry.splitType === 'settlement' ? (
                      <span className="px-1.5 py-0.2 rounded bg-ledger-green/15 text-ledger-green font-medium">
                        ⇄ {entry.payer} paid {entry.owedBy}
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold text-ink bg-paper-card px-2 py-0.5 rounded border border-ink/10">
                          {entry.category}
                        </span>
                        <span className="text-muted-text">
                          Paid by <strong className="text-ink">{entry.payer}</strong>
                        </span>
                        {!entry.split && (
                          isTravel && entry.paymentMethod === 'Cash' ? (
                            <span
                              className="px-1.5 py-0.2 rounded bg-slate-500/15 text-slate-600 font-medium"
                              title="Joint cash from the trip's ATM withdrawal, not this person's own money - its cost was already covered when the withdrawal was split, so this doesn't affect the balance."
                            >
                              Cash Pool
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded bg-mustard/20 text-mustard font-medium">
                              Personal
                            </span>
                          )
                        )}
                        {entry.splitType === 'owed' && entry.owedBy && (
                          <span className="px-1.5 py-0.2 rounded bg-ledger-green/15 text-ledger-green font-medium">
                            {entry.owedBy} owes full amount
                          </span>
                        )}
                        {entry.paymentMethod && (
                          <span className="text-muted-text">
                            via <strong className="text-ink">{entry.paymentMethod}</strong>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {entry.note && (
                    <div className="mt-1 text-xs text-muted-text truncate">
                      {entry.note}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingId(entry.id)}
                    className="min-h-8 min-w-8 px-2 py-1 flex items-center justify-center rounded-lg text-xs font-semibold text-muted-text hover:text-ink hover:bg-ink/5 transition-colors"
                    aria-label="Edit entry"
                    title="Edit transaction"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    disabled={deletingId === entry.id}
                    className={`min-h-8 min-w-8 px-2 py-1 flex items-center justify-center rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                      confirmDeleteId === entry.id
                        ? 'bg-stamp-red text-white hover:bg-stamp-red/90'
                        : 'text-stamp-red/70 hover:text-stamp-red hover:bg-stamp-red/10'
                    }`}
                    aria-label="Delete entry"
                    title={confirmDeleteId === entry.id ? 'Click again to confirm delete' : 'Delete transaction'}
                  >
                    {confirmDeleteId === entry.id ? 'Delete?' : '✕'}
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
}
