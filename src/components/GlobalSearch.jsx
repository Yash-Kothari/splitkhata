import { useMemo, useState } from 'react';
import { formatCurrency, normalizeLedger } from '../utils';

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const RESULT_LIMIT = 50;

// Searches every household + travel entry regardless of which tab/trip/month
// is currently open - EntryList's own search box is deliberately scoped to
// what's on screen, this is the "I know I bought this, where did I put it"
// escape hatch.
export default function GlobalSearch({ entries, onClose, onJumpTo }) {
  const [term, setTerm] = useState('');

  const results = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    return entries
      .filter((e) => e.splitType !== 'settlement' && !e.isTripRollup)
      .filter((e) => {
        const matchNote = e.note?.toLowerCase().includes(q);
        const matchCat = e.category?.toLowerCase().includes(q);
        const matchPayer = e.payer?.toLowerCase().includes(q);
        const matchTrip = e.tripName?.toLowerCase().includes(q);
        const matchAmount = String(e.amount ?? '').includes(q) || String(e.localAmount ?? '').includes(q);
        return matchNote || matchCat || matchPayer || matchTrip || matchAmount;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, RESULT_LIMIT);
  }, [entries, term]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-2.5 sm:px-4 pt-16 sm:pt-24 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-paper-card border border-ink/15 shadow-2xl overflow-hidden flex flex-col max-h-[75dvh]">
        <div className="px-4 sm:px-5 py-3.5 border-b border-ink/10 flex items-center gap-2 bg-paper/60 shrink-0">
          <span className="text-muted-text">🔎</span>
          <input
            type="text"
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search all entries - any ledger, any trip..."
            className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-muted-text/70 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-ink/15 bg-paper flex items-center justify-center text-ink hover:bg-paper-card font-bold transition-colors shrink-0"
            aria-label="Close search"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto">
          {term.trim() === '' ? (
            <p className="px-5 py-8 text-center text-sm text-muted-text">
              Start typing to search across household and travel expenses.
            </p>
          ) : results.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-text">No entries match "{term}".</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {results.map((entry) => {
                const isTravel = normalizeLedger(entry.ledger) === 'travel';
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onJumpTo(entry)}
                      className="w-full text-left px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-paper/60 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-ink text-sm bg-paper px-2 py-0.5 rounded border border-ink/10">
                            {entry.category}
                          </span>
                          <span className="text-2xs px-1.5 py-0.2 rounded bg-ledger-green/15 text-ledger-green font-medium">
                            {isTravel ? `✈️ ${entry.tripName || 'Travel'}` : '🏠 Household'}
                          </span>
                        </div>
                        {entry.note && (
                          <p className="mt-1 text-xs text-muted-text truncate">{entry.note}</p>
                        )}
                        <p className="mt-0.5 text-2xs text-muted-text">
                          {formatDate(entry.date)} · Paid by {entry.payer}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-ink text-sm shrink-0">
                        {formatCurrency(entry.amount, 'INR')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {results.length === RESULT_LIMIT && (
            <p className="px-5 py-2.5 text-center text-2xs text-muted-text border-t border-ink/10">
              Showing the first {RESULT_LIMIT} matches - narrow your search for more.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
