import { formatCurrency, computeBalance } from '../constants';

export default function BalanceStrip({ entries }) {
  const balance = computeBalance(entries);

  return (
    <section className="rounded-xl bg-paper-card px-5 py-4 border border-ink/10">
      <h2 className="font-display text-lg font-medium text-ink mb-2">Balance</h2>
      {balance.status === 'settled' ? (
        <p className="text-base text-ledger-green font-medium">
          All settled up — no one owes anyone
        </p>
      ) : (
        <p className="text-base text-ink">
          <span className="font-medium">{balance.debtor}</span>
          {' owes '}
          <span className="font-medium">{balance.creditor}</span>
          {' '}
          <span className="font-mono font-semibold text-lg">
            {formatCurrency(balance.amount)}
          </span>
        </p>
      )}
      <p className="text-sm text-muted-text mt-1">
        Based on split expenses only
      </p>
    </section>
  );
}
