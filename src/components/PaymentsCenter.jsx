import { useMemo, useState } from 'react';
import BalanceStrip from './BalanceStrip';
import EntryList from './EntryList';
import { addExpense } from '../firebase';
import { computeBalance, todayISO } from '../utils';

const inputClass =
  'w-full h-10 px-3 text-sm rounded-lg border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40';
const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-text mb-1';

// The combined view across both ledgers: household's own live balance (via
// BalanceStrip in household mode - unchanged, still "long running"), plus
// every trip's reward points combined into one balance, plus a history of
// just the payment-shaped entries (settlements + trip rollups), not the
// full household passbook.
export default function PaymentsCenter({ entries, travelEntries = [], dbMembers = [], onSaveError }) {
  const hasPoints = travelEntries.some((e) => Number(e.rewardPoints || 0) !== 0);
  // A points payment is recorded on the household ledger (so it shows up in
  // Payment History below, same as a money settlement) but every other
  // points-bearing entry lives on the travel ledger - combine both here,
  // with no ledger filter, so the payment actually cancels the debt it's
  // paying off. computeBalance already skips anything without a truthy
  // rewardPoints value, so mixing in the full household `entries` is safe.
  const pointsBalance = useMemo(
    () => (hasPoints ? computeBalance([...entries, ...travelEntries], null, dbMembers, 'rewardPoints') : null),
    [entries, travelEntries, dbMembers, hasPoints],
  );

  const [settlingPoints, setSettlingPoints] = useState(false);
  const [pointsAmount, setPointsAmount] = useState('');
  const [pointsDate, setPointsDate] = useState(todayISO());
  const [pointsNote, setPointsNote] = useState('');
  const [savingPoints, setSavingPoints] = useState(false);

  function startSettlingPoints() {
    setPointsAmount(Math.round(pointsBalance.amount).toString());
    setPointsDate(todayISO());
    setPointsNote('');
    setSettlingPoints(true);
  }

  const parsedPointsAmount = parseFloat(pointsAmount) || 0;
  const remainingPoints = pointsBalance && pointsBalance.status !== 'settled'
    ? pointsBalance.amount - parsedPointsAmount
    : 0;

  async function handleConfirmPoints(event) {
    event.preventDefault();
    const parsed = Math.round(parseFloat(pointsAmount));
    if (!parsed || parsed <= 0) return;

    setSavingPoints(true);
    try {
      // Same settlement shape as a money payment (splitType: 'settlement',
      // payer is who's paying it back), just with rewardPoints carrying the
      // value instead of amount - computeBalance treats either field the
      // same way, so this cancels the points debt exactly like a money
      // settlement cancels a money one. amount stays 0 so it's a no-op for
      // every money-based total (they all skip falsy amounts).
      await addExpense({
        amount: 0,
        payer: pointsBalance.debtor,
        owedBy: pointsBalance.creditor,
        splitType: 'settlement',
        split: true,
        category: 'Settlement',
        note: pointsNote.trim(),
        date: pointsDate,
        ledger: 'household',
        tripName: '',
        rewardPoints: parsed,
      });
      setSettlingPoints(false);
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSavingPoints(false);
    }
  }

  const paymentEntries = useMemo(
    () => entries.filter((e) => e.splitType === 'settlement' || e.isTripRollup),
    [entries],
  );

  return (
    <>
      <BalanceStrip
        entries={entries}
        ledger="household"
        dbMembers={dbMembers}
        onSaveError={onSaveError}
      />

      {hasPoints && (
        <section className="panel-card px-5 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ink mb-1">Reward Points Owed</h2>
              {pointsBalance.status === 'settled' ? (
                <p className="text-sm text-ledger-green font-semibold">All settled up across every trip</p>
              ) : (
                <p className="text-base text-ink">
                  💳 <span className="font-semibold text-stamp-red">{pointsBalance.debtor}</span>
                  {' owes '}
                  <span className="font-semibold text-ledger-green">{pointsBalance.creditor}</span>{' '}
                  <span className="font-mono font-bold text-lg text-ink">
                    {Math.round(pointsBalance.amount).toLocaleString('en-IN')} pts
                  </span>
                </p>
              )}
              <p className="text-xs text-muted-text mt-1">Combined across every trip's reward points, not just one.</p>
            </div>
            {pointsBalance.status !== 'settled' && !settlingPoints && (
              <button
                type="button"
                onClick={startSettlingPoints}
                className="w-full sm:w-auto h-9 px-3.5 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm hover:bg-ledger-green/90 transition-colors whitespace-nowrap shrink-0"
              >
                Record Points Payment
              </button>
            )}
          </div>

          {settlingPoints && (
            <form onSubmit={handleConfirmPoints} className="mt-4 pt-4 border-t border-ink/10 space-y-3">
              <p className="text-sm text-ink">
                Recording a points payment from <span className="font-semibold text-stamp-red">{pointsBalance.debtor}</span>
                {' to '}
                <span className="font-semibold text-ledger-green">{pointsBalance.creditor}</span>.
                {' '}Doesn't have to be the full amount - partial payments are fine.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="settle-points-amount" className={labelClass}>Points</label>
                  <input
                    id="settle-points-amount"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    required
                    value={pointsAmount}
                    onChange={(e) => setPointsAmount(e.target.value)}
                    className={`${inputClass} font-mono font-bold`}
                  />
                </div>
                <div>
                  <label htmlFor="settle-points-date" className={labelClass}>Date</label>
                  <input
                    id="settle-points-date"
                    type="date"
                    required
                    value={pointsDate}
                    onChange={(e) => setPointsDate(e.target.value)}
                    className={`${inputClass} date-input appearance-none`}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor="settle-points-note" className={labelClass}>Note (optional)</label>
                  <input
                    id="settle-points-note"
                    type="text"
                    value={pointsNote}
                    onChange={(e) => setPointsNote(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. Transferred miles"
                  />
                </div>
              </div>

              {parsedPointsAmount > 0 && (
                <p className="text-xs text-muted-text">
                  {Math.abs(remainingPoints) < 0.5 ? (
                    <span className="text-ledger-green font-semibold">This fully settles the points balance.</span>
                  ) : remainingPoints > 0 ? (
                    <>
                      After this, <span className="font-semibold text-ink">{pointsBalance.debtor}</span> will still owe{' '}
                      <span className="font-semibold text-ink">{pointsBalance.creditor}</span>{' '}
                      <span className="font-mono font-semibold text-ink">{Math.round(remainingPoints).toLocaleString('en-IN')} pts</span>.
                    </>
                  ) : (
                    <>
                      This overpays by {Math.round(-remainingPoints).toLocaleString('en-IN')} pts - <span className="font-semibold text-ink">{pointsBalance.creditor}</span>{' '}
                      will end up owing <span className="font-semibold text-ink">{pointsBalance.debtor}</span>{' '}
                      <span className="font-mono font-semibold text-ink">{Math.round(-remainingPoints).toLocaleString('en-IN')} pts</span>.
                    </>
                  )}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingPoints || !pointsAmount}
                  className="flex-1 sm:flex-none h-9 px-4 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
                >
                  {savingPoints ? 'Saving...' : 'Record Points Payment'}
                </button>
                <button
                  type="button"
                  onClick={() => setSettlingPoints(false)}
                  disabled={savingPoints}
                  className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-ink/15 text-ink font-semibold text-xs sm:text-sm hover:bg-ink/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      <EntryList
        title="Payment History"
        emptyMessage="No payments recorded yet - settle up Household above, or add a finished trip's balance from its own Trip Summary."
        entries={paymentEntries}
        selectedMonth="all"
        ledger="household"
        dbMembers={dbMembers}
        onDeleteError={onSaveError}
        onSaveError={onSaveError}
      />
    </>
  );
}
