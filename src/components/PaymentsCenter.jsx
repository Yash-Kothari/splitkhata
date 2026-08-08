import { useMemo } from 'react';
import BalanceStrip from './BalanceStrip';
import EntryList from './EntryList';
import { computeBalance } from '../utils';

// The combined view across both ledgers: household's own live balance (via
// BalanceStrip in household mode - unchanged, still "long running"), plus
// every trip's reward points combined into one balance, plus a history of
// just the payment-shaped entries (settlements + trip rollups), not the
// full household passbook.
export default function PaymentsCenter({ entries, travelEntries = [], dbMembers = [], onSaveError }) {
  const hasPoints = travelEntries.some((e) => Number(e.rewardPoints || 0) !== 0);
  const pointsBalance = useMemo(
    () => (hasPoints ? computeBalance(travelEntries, 'travel', dbMembers, 'rewardPoints') : null),
    [travelEntries, dbMembers, hasPoints],
  );

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
          <h2 className="font-display text-lg font-bold text-ink mb-1">Reward Points Owed</h2>
          {pointsBalance.status === 'settled' ? (
            <p className="text-sm text-ledger-green font-semibold">All settled up across every trip</p>
          ) : (
            <p className="text-base text-ink">
              🪙 <span className="font-semibold text-stamp-red">{pointsBalance.debtor}</span>
              {' owes '}
              <span className="font-semibold text-ledger-green">{pointsBalance.creditor}</span>{' '}
              <span className="font-mono font-bold text-lg text-ink">
                {Math.round(pointsBalance.amount).toLocaleString('en-IN')} pts
              </span>
            </p>
          )}
          <p className="text-xs text-muted-text mt-1">Combined across every trip's reward points, not just one.</p>
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
