import { useState, useMemo } from 'react';
import { addExpense, updateExpense, deleteExpense, updateTripInDb } from '../firebase';
import { formatCurrency, computeBalance, computeMemberTotals, todayISO, PERSON_COLORS } from '../utils';

export default function BalanceStrip({
  entries,
  ledger,
  dbMembers = [],
  tripName = '',
  tripId = '',
  tripRollup = null,
  onSaveError,
}) {
  const isTravel = ledger === 'travel';
  // A cash withdrawal and the itemized purchases it funds both carry a real
  // INR `amount`, but they're the SAME money once, not twice - the
  // withdrawal already creates the shared debt for that cash (both people
  // owe half of what was taken out), so re-splitting each individual
  // Cash-tagged purchase on top double-counts it. This mirrors the
  // memberTotals exclusion below for the same reason: it went unnoticed
  // for trips where every cash purchase was personal (nothing shared to
  // double-count) or where the discrepancy hid inside a blended real-life
  // settlement figure, until South Korea's Splitwise-recorded settlement
  // (₹23,736.98) didn't match the computed balance (₹17,090) by roughly
  // the withdrawal's own amount - Kruti's cash purchases were shared, so
  // the withdrawal and her itemized spending were both counted.
  const balanceEntries = useMemo(
    () => (isTravel ? entries.filter((e) => e.paymentMethod !== 'Cash') : entries),
    [entries, isTravel],
  );
  const balance = useMemo(() => computeBalance(balanceEntries, ledger, dbMembers), [balanceEntries, ledger, dbMembers]);
  const ledgerLabel = isTravel ? 'Travel' : 'Household';

  // Mirrors the Excel's "Total Kruti / Total Yash" panel: it only ever
  // prices card-paid entries and the ATM withdrawal itself, never
  // individual cash purchases - so this excludes every Cash-paid entry,
  // personal or shared, and keeps the withdrawal (paid by card, not
  // "Cash"). Same underlying reason as balanceEntries above.
  const memberTotals = useMemo(
    () => (isTravel ? computeMemberTotals(balanceEntries, dbMembers) : null),
    [balanceEntries, dbMembers, isTravel],
  );

  // Reward points get their own balance, computed with the exact same
  // split/owed logic as money but never converted to INR - a positive
  // rewardPoints value is points spent (owed back), negative is points
  // earned (owed to the other person, since they sit in one account).
  const hasPoints = isTravel && entries.some((e) => Number(e.rewardPoints || 0) !== 0);
  const pointsBalance = useMemo(
    () => (hasPoints ? computeBalance(entries, ledger, dbMembers, 'rewardPoints') : null),
    [entries, ledger, dbMembers, hasPoints],
  );
  // Total points spent on the trip, regardless of split - unlike
  // pointsBalance (which only counts split entries, so a personal
  // points-funded flight nets to "settled" and shows nothing) this is
  // purely informational: how many points did this trip burn, full stop.
  const totalPointsSpent = useMemo(
    () => (isTravel ? entries.reduce((sum, e) => sum + Number(e.rewardPoints || 0), 0) : 0),
    [entries, isTravel],
  );
  // Per-person points breakdown - same attribution rules as memberTotals
  // (personal counts fully against the payer, shared splits evenly), just
  // reading rewardPoints instead of amount. This is what makes a
  // personal points-funded flight show up as "Yash: 22,345 pts" instead
  // of vanishing the way pointsBalance does (that one only counts split
  // entries, since a personal redemption isn't a debt to anyone).
  const pointsMemberTotals = useMemo(
    () => (hasPoints ? computeMemberTotals(entries, dbMembers, 'rewardPoints') : null),
    [entries, dbMembers, hasPoints],
  );

  // Same total as the Category Breakdown card - every real spend, minus
  // settlements (not a spend) and withdrawals (already counted via the
  // cash purchases they funded).
  const totalSpend = useMemo(
    () =>
      isTravel
        ? entries
            .filter((e) => e.splitType !== 'settlement' && !e.isWithdrawal && !e.isTripRollup)
            .reduce((sum, e) => sum + Number(e.amount || 0), 0)
        : null,
    [entries, isTravel],
  );
  // Settlements are always in real money (INR) - a trip's local-currency
  // figure is per-entry reference only, it doesn't drive who-owes-whom.
  const displayCurrency = 'INR';

  // Editing/adding/deleting an entry after a trip's been rolled up changes
  // this trip's live balance without touching the snapshot that got copied
  // into the main ledger - compare against that snapshot (cached on the
  // trip doc, see App.jsx) to notice when the two have drifted apart.
  const rollupStale = Boolean(
    tripRollup &&
      (Math.abs(tripRollup.amount - balance.amount) > 0.01 ||
        tripRollup.debtor !== balance.debtor ||
        tripRollup.creditor !== balance.creditor),
  );
  const rollupNowSettled = Boolean(tripRollup && balance.status === 'settled');

  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingRollup, setConfirmingRollup] = useState(false);
  const [rollingUp, setRollingUp] = useState(false);

  const inputClass =
    'w-full h-10 px-3 text-sm rounded-lg border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40';
  const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-text mb-1';

  function startSettling() {
    setAmount(balance.amount.toFixed(2));
    setDate(todayISO());
    setNote('');
    setSettling(true);
  }

  const parsedAmount = parseFloat(amount) || 0;
  const remaining = balance.status !== 'settled' ? balance.amount - parsedAmount : 0;

  async function handleConfirm(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;

    setSaving(true);
    try {
      await addExpense({
        amount: parsed,
        payer: balance.debtor,
        owedBy: balance.creditor,
        splitType: 'settlement',
        split: true,
        category: 'Settlement',
        note: note.trim(),
        date,
        ledger,
        tripName: isTravel ? tripName : '',
      });
      setSettling(false);
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  // Doesn't settle this trip's own balance (its entries and history stay
  // exactly as they are) - it adds ONE line to the household-ledger
  // Payments tab instead, noting where it came from, so a finished trip's
  // debt joins the same ongoing pot as everything else instead of being
  // tracked separately forever. Also handles keeping that line in sync:
  // if the trip's entries changed since the rollup (rollupStale), this
  // updates the existing line in place instead of adding a second one; if
  // the trip landed back at exactly settled, it removes the line entirely.
  async function handleRollup() {
    setRollingUp(true);
    try {
      if (rollupNowSettled) {
        await deleteExpense(tripRollup.entryId);
        if (tripId) {
          await updateTripInDb(tripId, {
            rolledUpEntryId: null,
            rolledUpAmount: null,
            rolledUpDebtor: null,
            rolledUpCreditor: null,
          });
        }
      } else {
        // Only carry a points figure onto the rollup line when it's an
        // actual person-to-person points debt (like the money amount is) -
        // totalPointsSpent includes personal, non-owed redemptions too, and
        // showing that on a "Kruti paid, Yash owes" line reads as if Yash
        // owes points back as well, even when points are fully settled.
        const rollupRewardPoints = hasPoints && pointsBalance.status !== 'settled' ? pointsBalance.amount : null;
        let entryId = tripRollup?.entryId;
        if (entryId) {
          await updateExpense(entryId, {
            amount: balance.amount,
            payer: balance.creditor,
            owedBy: balance.debtor,
            rewardPoints: rollupRewardPoints,
          });
        } else {
          // Defaults to the trip's own last entry date, not today - a trip
          // rolled up months after it happened (or backfilled well after
          // the fact) should still read as having happened when it did.
          const lastEntryDate = entries.reduce((max, e) => (e.date && e.date > max ? e.date : max), '') || todayISO();
          entryId = await addExpense({
            amount: balance.amount,
            payer: balance.creditor,
            owedBy: balance.debtor,
            splitType: 'owed',
            split: true,
            category: 'Trip',
            note: `From ${tripName} trip`,
            date: lastEntryDate,
            ledger: 'household',
            tripName: '',
            isTripRollup: true,
            rewardPoints: rollupRewardPoints,
          });
        }
        if (tripId) {
          await updateTripInDb(tripId, {
            rolledUpEntryId: entryId,
            rolledUpAmount: balance.amount,
            rolledUpDebtor: balance.debtor,
            rolledUpCreditor: balance.creditor,
          });
        }
      }
      setConfirmingRollup(false);
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setRollingUp(false);
    }
  }

  return (
    <section className="panel-card px-5 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-display text-lg font-bold text-ink">
              {isTravel ? 'Trip Summary' : 'Household Net Balance'}
            </h2>
          </div>
          {balance.status === 'settled' ? (
            <p className="text-base text-ledger-green font-semibold">
              All settled up - no one owes anyone
            </p>
          ) : (
            <p className="text-base text-ink">
              <span className="font-semibold text-stamp-red">{balance.debtor}</span>
              {' owes '}
              <span className="font-semibold text-ledger-green">{balance.creditor}</span>
              {' '}
              <span className="font-mono font-bold text-lg text-ink">
                {formatCurrency(balance.amount, displayCurrency)}
              </span>
            </p>
          )}
          {isTravel && totalSpend > 0 && (
            <p className="text-sm text-muted-text mt-1">
              Total trip expense:{' '}
              <span className="font-mono font-semibold text-ink">{formatCurrency(totalSpend, displayCurrency)}</span>
            </p>
          )}
          {isTravel && totalPointsSpent !== 0 && (
            <p className="text-sm text-muted-text mt-1">
              💳 Points {totalPointsSpent > 0 ? 'spent' : 'earned'}:{' '}
              <span className="font-mono font-semibold text-ink">
                {Math.abs(Math.round(totalPointsSpent)).toLocaleString('en-IN')} pts
              </span>
            </p>
          )}
          {hasPoints && (
            pointsBalance.status === 'settled' ? (
              <p className="text-sm text-ledger-green font-medium mt-1">💳 All settled up in points</p>
            ) : (
              <p className="text-sm text-muted-text mt-1">
                💳 <span className="font-semibold text-stamp-red">{pointsBalance.debtor}</span>
                {' owes '}
                <span className="font-semibold text-ledger-green">{pointsBalance.creditor}</span>
                {' '}
                <span className="font-mono font-semibold text-ink">
                  {Math.round(pointsBalance.amount).toLocaleString('en-IN')} pts
                </span>
              </p>
            )
          )}
          {isTravel && dbMembers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-ink/10 flex flex-wrap gap-x-4 gap-y-1.5">
              {dbMembers.map((member) => (
                <div key={member} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: PERSON_COLORS[member] || '#3D7068' }}
                  />
                  <span className="text-muted-text">{member}</span>
                  <span className="font-mono font-semibold text-ink">{formatCurrency(memberTotals?.[member] || 0)}</span>
                </div>
              ))}
            </div>
          )}
          {hasPoints && dbMembers.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {dbMembers.map((member) => (
                <div key={member} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: PERSON_COLORS[member] || '#3D7068' }}
                  />
                  <span className="text-muted-text">{member}</span>
                  <span className="font-mono font-semibold text-ink">
                    💳 {Math.round(pointsMemberTotals?.[member] || 0).toLocaleString('en-IN')} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          {isTravel ? (
            confirmingRollup ? null : rollupNowSettled ? (
              <button
                type="button"
                onClick={() => setConfirmingRollup(true)}
                className="w-full sm:w-auto h-9 px-3.5 rounded-lg bg-mustard/90 text-white font-semibold text-xs sm:text-sm hover:bg-mustard transition-colors whitespace-nowrap"
              >
                Remove from Main Ledger
              </button>
            ) : rollupStale ? (
              <button
                type="button"
                onClick={() => setConfirmingRollup(true)}
                className="w-full sm:w-auto h-9 px-3.5 rounded-lg bg-mustard/90 text-white font-semibold text-xs sm:text-sm hover:bg-mustard transition-colors whitespace-nowrap"
              >
                Update Main Ledger
              </button>
            ) : tripRollup ? (
              <div className="text-xs text-muted-text text-center sm:text-left sm:h-9 sm:flex sm:items-center sm:bg-ledger-green/10 sm:px-3 sm:rounded-lg sm:border sm:border-ledger-green/20 font-medium">
                ✓ Added to main ledger
              </div>
            ) : (
              balance.status !== 'settled' && (
                <button
                  type="button"
                  onClick={() => setConfirmingRollup(true)}
                  className="w-full sm:w-auto h-9 px-3.5 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm hover:bg-ledger-green/90 transition-colors whitespace-nowrap"
                >
                  Add to Main Ledger
                </button>
              )
            )
          ) : (
            balance.status !== 'settled' && !settling && (
              <button
                type="button"
                onClick={startSettling}
                className="w-full sm:w-auto h-9 px-3.5 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm hover:bg-ledger-green/90 transition-colors whitespace-nowrap"
              >
                Record Payment
              </button>
            )
          )}
          <div className="text-xs text-muted-text text-center sm:text-left sm:h-9 sm:flex sm:items-center sm:bg-paper sm:px-3 sm:rounded-lg sm:border sm:border-ink/10">
            Calculated across {ledgerLabel.toLowerCase()} entries
          </div>
        </div>
      </div>

      {isTravel && confirmingRollup && (
        <div className="mt-4 pt-4 border-t border-ink/10 space-y-3">
          <p className="text-sm text-ink">
            {rollupNowSettled ? (
              <>
                {tripName} is back to settled, but the main Payments ledger still has an old line for it:{' '}
                <span className="font-semibold">{tripRollup.debtor} owed {tripRollup.creditor}{' '}
                  {formatCurrency(tripRollup.amount, displayCurrency)}</span>. This removes that line - nothing about
                {' '}{tripName}'s own entries changes.
              </>
            ) : rollupStale ? (
              <>
                {tripName} changed since it was last added - the main Payments ledger still has{' '}
                <span className="font-semibold">{tripRollup.debtor} owed {tripRollup.creditor}{' '}
                  {formatCurrency(tripRollup.amount, displayCurrency)}</span>. This updates that same line to{' '}
                <span className="font-semibold text-stamp-red">{balance.debtor}</span>
                {' owes '}
                <span className="font-semibold text-ledger-green">{balance.creditor}</span>{' '}
                <span className="font-mono font-bold">{formatCurrency(balance.amount, displayCurrency)}</span> instead
                of adding a second one.
              </>
            ) : (
              <>
                This adds one line to the main Payments ledger:{' '}
                <span className="font-semibold text-stamp-red">{balance.debtor}</span>
                {' owes '}
                <span className="font-semibold text-ledger-green">{balance.creditor}</span>{' '}
                <span className="font-mono font-bold">{formatCurrency(balance.amount, displayCurrency)}</span>, noted as
                coming from {tripName}. {tripName}'s own entries and balance here stay exactly as they are.
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRollup}
              disabled={rollingUp}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
            >
              {rollingUp
                ? (rollupNowSettled ? 'Removing...' : rollupStale ? 'Updating...' : 'Adding...')
                : (rollupNowSettled ? 'Confirm & Remove' : rollupStale ? 'Confirm & Update' : 'Confirm & Add')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRollup(false)}
              disabled={rollingUp}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-ink/15 text-ink font-semibold text-xs sm:text-sm hover:bg-ink/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isTravel && settling && (
        <form onSubmit={handleConfirm} className="mt-4 pt-4 border-t border-ink/10 space-y-3">
          <p className="text-sm text-ink">
            Recording a payment from <span className="font-semibold text-stamp-red">{balance.debtor}</span>
            {' to '}
            <span className="font-semibold text-ledger-green">{balance.creditor}</span>.
            {' '}Doesn't have to be the full amount - partial payments are fine.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="settle-amount" className={labelClass}>Amount ({displayCurrency})</label>
              <input
                id="settle-amount"
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
              <label htmlFor="settle-date" className={labelClass}>Date</label>
              <input
                id="settle-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${inputClass} date-input appearance-none`}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="settle-note" className={labelClass}>Note (optional)</label>
              <input
                id="settle-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass}
                placeholder="e.g. Paid via UPI"
              />
            </div>
          </div>

          {parsedAmount > 0 && (
            <p className="text-xs text-muted-text">
              {Math.abs(remaining) < 0.01 ? (
                <span className="text-ledger-green font-semibold">This fully settles the balance.</span>
              ) : remaining > 0 ? (
                <>
                  After this, <span className="font-semibold text-ink">{balance.debtor}</span> will still owe{' '}
                  <span className="font-semibold text-ink">{balance.creditor}</span>{' '}
                  <span className="font-mono font-semibold text-ink">{formatCurrency(remaining, displayCurrency)}</span>.
                </>
              ) : (
                <>
                  This overpays by {formatCurrency(-remaining, displayCurrency)} - <span className="font-semibold text-ink">{balance.creditor}</span>{' '}
                  will end up owing <span className="font-semibold text-ink">{balance.debtor}</span>{' '}
                  <span className="font-mono font-semibold text-ink">{formatCurrency(-remaining, displayCurrency)}</span>.
                </>
              )}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !amount}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
            >
              {saving ? 'Saving...' : 'Record Payment'}
            </button>
            <button
              type="button"
              onClick={() => setSettling(false)}
              disabled={saving}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-ink/15 text-ink font-semibold text-xs sm:text-sm hover:bg-ink/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
