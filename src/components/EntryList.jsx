import { useState } from 'react';
import { deleteExpense } from '../firebase';
import {
  formatCurrency,
  formatMonthLabel,
  getMonthKey,
  PERSON_COLORS,
} from '../constants';

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function EntryList({ entries, selectedMonth, onDeleteError }) {
  const [deletingId, setDeletingId] = useState(null);

  const filtered = entries
    .filter((e) => getMonthKey(e.date) === selectedMonth)
    .sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });

  async function handleDelete(id) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await deleteExpense(id);
    } catch (err) {
      onDeleteError?.(err);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-xl bg-paper-card px-5 py-4 border border-ink/10">
      <h2 className="font-display text-lg font-medium text-ink mb-3">
        Entries — {formatMonthLabel(selectedMonth)}
      </h2>

      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-ink/20 rounded-lg py-12 text-center text-muted-text text-sm">
          {entries.length === 0
            ? 'No entries yet — add your first expense above'
            : `No entries in ${formatMonthLabel(selectedMonth)}`}
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {filtered.map((entry) => (
            <li
              key={entry.id}
              className="entry-row passbook-row py-3 pr-1 flex items-start gap-3"
              style={{ '--dot-color': PERSON_COLORS[entry.payer] }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-semibold text-ink">
                    {formatCurrency(entry.amount)}
                  </span>
                  <span className="text-xs text-muted-text shrink-0">
                    {formatDate(entry.date)}
                  </span>
                </div>
                <p className="text-sm text-ink mt-0.5">
                  {entry.category}
                  {!entry.split && (
                    <span className="text-muted-text"> · personal</span>
                  )}
                </p>
                <p className="text-xs text-muted-text mt-0.5">
                  Paid by {entry.payer}
                  {entry.note && ` · ${entry.note}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(entry.id)}
                disabled={deletingId === entry.id}
                className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-stamp-red/70 hover:text-stamp-red hover:bg-stamp-red/10 text-sm disabled:opacity-50"
                aria-label="Delete entry"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
