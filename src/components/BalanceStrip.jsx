import { useState, useMemo } from 'react';
import { addExpense, updateExpense, deleteExpense, updateTripInDb, generateDigest } from '../firebase';
import {
  formatCurrency,
  computeBalance,
  computeSettlements,
  computeMemberTotals,
  excludeCashSpend,
  computeTripTotalSpend,
  getTripLastDate,
  todayISO,
  PERSON_COLORS,
  groupByCategory,
  buildTripDigestPrompt,
} from '../utils';

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
  // See excludeCashSpend in utils.js for why every trip-level money figure
  // (this balance, memberTotals, totalSpend below) excludes Cash-paid
  // entries - a shared ATM withdrawal and the itemized cash purchases it
  // funds are the same money counted once, not twice.
  const balanceEntries = useMemo(
    () => (isTravel ? excludeCashSpend(entries) : entries),
    [entries, isTravel],
  );
  const balance = useMemo(() => computeBalance(balanceEntries, ledger, dbMembers), [balanceEntries, ledger, dbMembers]);
  const ledgerLabel = isTravel ? 'Travel' : 'Household';
  // A trip with a guest has 3+ people on it - there's no single honest "X
  // owes Y" figure once a third person is splitting bills (computeBalance's
  // fallback for that case just reports the single biggest pair and drops
  // the rest), so this switches to the real pairwise settlement list
  // instead, and skips the household-rollup flow entirely below - there's
  // no clean way to fold a 3-way trip split into the 2-person household
  // balance, so a guest trip settles separately, outside this app.
  const hasGuests = isTravel && dbMembers.length > 2;
  const settlements = useMemo(
    () => (hasGuests ? computeSettlements(balanceEntries, ledger, dbMembers) : null),
    [hasGuests, balanceEntries, ledger, dbMembers],
  );

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
    () => (hasPoints && !hasGuests ? computeBalance(entries, ledger, dbMembers, 'rewardPoints') : null),
    [hasPoints, hasGuests, entries, ledger, dbMembers],
  );
  const pointsSettlements = useMemo(
    () => (hasPoints && hasGuests ? computeSettlements(entries, ledger, dbMembers, 'rewardPoints') : null),
    [hasPoints, hasGuests, entries, ledger, dbMembers],
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

  // Same basis as memberTotals, not the Category Breakdown card - card
  // entries plus the ATM withdrawal itself, never the itemized cash
  // purchases it funded (see balanceEntries above). This is what keeps
  // "Total trip expense" always equal to Yash + Kruti's totals below;
  // Category Breakdown is the only place that looks at itemized cash
  // spend, and can legitimately show a smaller sum when some withdrawn
  // cash is still unspent (not a mismatch to reconcile).
  const totalSpend = useMemo(
    () => (isTravel ? computeTripTotalSpend(entries) : null),
    [entries, isTravel],
  );
  // Settlements are always in real money (INR) - a trip's local-currency
  // figure is per-entry reference only, it doesn't drive who-owes-whom.
  const displayCurrency = 'INR';

  // Same entries/basis as the real Category Breakdown card (raw entries,
  // not balanceEntries) so the digest's category mix matches what's shown
  // elsewhere on the page - monthKey null means "whole trip", not one month.
  const categoryBreakdown = useMemo(
    () => (isTravel ? groupByCategory(entries, null, 'travel') : null),
    [entries, isTravel],
  );
  const digestPrompt = useMemo(() => {
    if (!isTravel) return null;
    const settlementLines = hasGuests
      ? (settlements || []).map((s) => `${s.debtor} owes ${s.creditor} ${formatCurrency(s.amount, displayCurrency)}`)
      : balance.status !== 'settled'
        ? [`${balance.debtor} owes ${balance.creditor} ${formatCurrency(balance.amount, displayCurrency)}`]
        : [];
    return buildTripDigestPrompt({
      tripName,
      currency: displayCurrency,
      totalSpend,
      memberTotals,
      categoryBreakdown,
      settlementLines,
    });
  }, [isTravel, hasGuests, settlements, balance, tripName, displayCurrency, totalSpend, memberTotals, categoryBreakdown]);

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
  const [settlePayer, setSettlePayer] = useState('');
  const [settleOwedBy, setSettleOwedBy] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingRollup, setConfirmingRollup] = useState(false);
  const [rollingUp, setRollingUp] = useState(false);
  const [digest, setDigest] = useState({ status: 'idle', text: '', error: '' });

  async function handleGenerateDigest() {
    setDigest({ status: 'loading', text: '', error: '' });
    try {
      const text = await generateDigest(digestPrompt);
      setDigest({ status: 'done', text, error: '' });
    } catch (err) {
      setDigest({ status: 'error', text: '', error: err?.message || 'Could not generate digest.' });
    }
  }

  const inputClass =
    'w-full h-10 px-3 text-sm rounded-lg border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40';
  const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-text mb-1';
  const selectClass = `${inputClass} appearance-none`;

  // Defaults to whichever direction pays off the current balance, but both
  // sides stay fully editable - a real-world payment doesn't have to match
  // what this app currently thinks is owed (e.g. reimbursing something
  // unrelated, or logging a transfer that happened outside it entirely).
  function startSettling() {
    const [defaultPayer, defaultOwedBy] = balance.status === 'settled'
      ? [dbMembers[0] || '', dbMembers[1] || '']
      : [balance.debtor, balance.creditor];
    setAmount(balance.status === 'settled' ? '' : balance.amount.toFixed(2));
    setSettlePayer(defaultPayer);
    setSettleOwedBy(defaultOwedBy);
    setDate(todayISO());
    setNote('');
    setSettling(true);
  }

  const parsedAmount = parseFloat(amount) || 0;
  // Simulates the entry being recorded rather than hand-deriving the math,
  // so it's correct regardless of which direction was picked - paying off
  // the existing debt, overpaying it (which flips who owes whom), or an
  // unrelated transfer that creates a new debt from scratch.
  const previewBalance = useMemo(() => {
    if (!parsedAmount || !settlePayer || !settleOwedBy || settlePayer === settleOwedBy) return null;
    return computeBalance(
      [...balanceEntries, { amount: parsedAmount, payer: settlePayer, owedBy: settleOwedBy, splitType: 'settlement', split: true, ledger }],
      ledger,
      dbMembers,
    );
  }, [balanceEntries, parsedAmount, settlePayer, settleOwedBy, ledger, dbMembers]);

  async function handleConfirm(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0 || !settlePayer || !settleOwedBy || settlePayer === settleOwedBy) return;

    setSaving(true);
    try {
      await addExpense({
        amount: parsed,
        payer: settlePayer,
        owedBy: settleOwedBy,
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
          const lastEntryDate = getTripLastDate(entries) || todayISO();
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
          {hasGuests ? (
            settlements.length === 0 ? (
              <p className="text-base text-ledger-green font-semibold">
                All settled up - no one owes anyone
              </p>
            ) : (
              <div className="space-y-1">
                {settlements.map((s) => (
                  <p key={`${s.debtor}-${s.creditor}`} className="text-base text-ink">
                    <span className="font-semibold text-stamp-red">{s.debtor}</span>
                    {' owes '}
                    <span className="font-semibold text-ledger-green">{s.creditor}</span>
                    {' '}
                    <span className="font-mono font-bold text-lg text-ink">
                      {formatCurrency(s.amount, displayCurrency)}
                    </span>
                  </p>
                ))}
              </div>
            )
          ) : balance.status === 'settled' ? (
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
          {hasGuests && hasPoints && (
            pointsSettlements.length === 0 ? (
              <p className="text-sm text-ledger-green font-medium mt-1">💳 All settled up in points</p>
            ) : (
              pointsSettlements.map((s) => (
                <p key={`pts-${s.debtor}-${s.creditor}`} className="text-sm text-muted-text mt-1">
                  💳 <span className="font-semibold text-stamp-red">{s.debtor}</span>
                  {' owes '}
                  <span className="font-semibold text-ledger-green">{s.creditor}</span>
                  {' '}
                  <span className="font-mono font-semibold text-ink">
                    {Math.round(s.amount).toLocaleString('en-IN')} pts
                  </span>
                </p>
              ))
            )
          )}
          {!hasGuests && hasPoints && (
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
          {isTravel && totalSpend > 0 && (
            <div className="mt-3 pt-3 border-t border-ink/10">
              {digest.status === 'idle' || digest.status === 'error' ? (
                <button
                  type="button"
                  onClick={handleGenerateDigest}
                  className="h-8 px-3 rounded-lg border border-ledger-green/30 bg-ledger-green/10 text-ledger-green font-semibold text-xs hover:bg-ledger-green/20 transition-colors"
                >
                  ✨ AI Digest
                </button>
              ) : digest.status === 'loading' ? (
                <p className="text-xs text-muted-text">✨ Writing digest...</p>
              ) : (
                <div className="rounded-lg border border-ledger-green/20 bg-ledger-green/5 px-3 py-2.5">
                  <p className="text-sm text-ink leading-relaxed">{digest.text}</p>
                  <button
                    type="button"
                    onClick={() => setDigest({ status: 'idle', text: '', error: '' })}
                    className="mt-2 text-xs text-muted-text hover:text-ink underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {digest.status === 'error' && (
                <p className="text-xs text-stamp-red mt-1.5">{digest.error}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          {isTravel ? (
            hasGuests ? (
              <div className="text-xs text-muted-text text-center sm:text-left sm:h-9 sm:flex sm:items-center sm:bg-paper sm:px-3 sm:rounded-lg sm:border sm:border-ink/10 sm:max-w-64">
                Settle with guests separately - can't roll into household.
              </div>
            ) : confirmingRollup ? null : rollupNowSettled ? (
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
            !settling && (
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

      {isTravel && !hasGuests && confirmingRollup && (
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
            Record a real-world payment - either direction, any amount. It doesn't have to match the balance
            above or pay it down; this just logs money that actually changed hands.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="settle-payer" className={labelClass}>Paid by</label>
              <select
                id="settle-payer"
                required
                value={settlePayer}
                onChange={(e) => setSettlePayer(e.target.value)}
                className={selectClass}
              >
                {dbMembers.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="settle-owedby" className={labelClass}>Paid to</label>
              <select
                id="settle-owedby"
                required
                value={settleOwedBy}
                onChange={(e) => setSettleOwedBy(e.target.value)}
                className={selectClass}
              >
                {dbMembers.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          {settlePayer && settleOwedBy && settlePayer === settleOwedBy && (
            <p className="text-xs text-stamp-red font-medium">"Paid by" and "Paid to" can't be the same person.</p>
          )}
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

          {parsedAmount > 0 && previewBalance && (
            <p className="text-xs text-muted-text">
              {previewBalance.status === 'settled' ? (
                <span className="text-ledger-green font-semibold">This fully settles the balance.</span>
              ) : (
                <>
                  After this, <span className="font-semibold text-ink">{previewBalance.debtor}</span> will owe{' '}
                  <span className="font-semibold text-ink">{previewBalance.creditor}</span>{' '}
                  <span className="font-mono font-semibold text-ink">{formatCurrency(previewBalance.amount, displayCurrency)}</span>.
                </>
              )}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !amount || !settlePayer || !settleOwedBy || settlePayer === settleOwedBy}
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
