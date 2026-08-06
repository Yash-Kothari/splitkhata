import { useState, useMemo } from 'react';
import { addExpense } from '../firebase';
import { formatCurrency, computeBalance, todayISO } from '../utils';

export default function BalanceStrip({ entries, ledger, dbMembers = [], tripName = '', onSaveError }) {
  const balance = useMemo(() => computeBalance(entries, ledger, dbMembers), [entries, ledger, dbMembers]);
  const ledgerLabel = ledger === 'travel' ? 'Travel' : 'Household';

  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

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
        tripName: ledger === 'travel' ? tripName : '',
      });
      setSettling(false);
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel-card px-5 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          {balance.status !== 'settled' && !settling && (
            <button
              type="button"
              onClick={startSettling}
              className="w-full sm:w-auto h-9 px-3.5 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm hover:bg-ledger-green/90 transition-colors whitespace-nowrap"
            >
              Record Payment
            </button>
          )}
          <div className="text-xs text-muted-text text-center sm:text-left sm:h-9 sm:flex sm:items-center sm:bg-paper sm:px-3 sm:rounded-lg sm:border sm:border-ink/10">
            Calculated across {ledgerLabel.toLowerCase()} entries
          </div>
        </div>
      </div>

      {settling && (
        <form onSubmit={handleConfirm} className="mt-4 pt-4 border-t border-ink/10 space-y-3">
          <p className="text-sm text-ink">
            Recording a payment from <span className="font-semibold text-stamp-red">{balance.debtor}</span>
            {' to '}
            <span className="font-semibold text-ledger-green">{balance.creditor}</span>.
            {' '}Doesn't have to be the full amount - partial payments are fine.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="settle-amount" className={labelClass}>Amount (₹)</label>
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
                  <span className="font-mono font-semibold text-ink">{formatCurrency(remaining)}</span>.
                </>
              ) : (
                <>
                  This overpays by {formatCurrency(-remaining)} - <span className="font-semibold text-ink">{balance.creditor}</span>{' '}
                  will end up owing <span className="font-semibold text-ink">{balance.debtor}</span>{' '}
                  <span className="font-mono font-semibold text-ink">{formatCurrency(-remaining)}</span>.
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
