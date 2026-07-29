import { formatCurrency, computeBalance } from '../utils';

export default function BalanceStrip({ entries, ledger, dbMembers = [] }) {
  const balance = computeBalance(entries, ledger, dbMembers);
  const ledgerLabel = ledger === 'travel' ? 'Travel' : 'Household';

  return (
    <section className="panel-card px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-display text-lg font-bold text-ink">
            {ledgerLabel} Net Balance
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
              {formatCurrency(balance.amount)}
            </span>
          </p>
        )}
      </div>
      <div className="text-xs text-muted-text bg-paper px-3 py-2 rounded-lg border border-ink/10 self-start sm:self-auto">
        Calculated across {ledgerLabel.toLowerCase()} entries
      </div>
    </section>
  );
}
