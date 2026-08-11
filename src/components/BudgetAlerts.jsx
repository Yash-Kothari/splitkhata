import { useMemo } from 'react';
import { groupByCategory, computeBudgetAlerts, formatCurrency } from '../utils';

// Purely presentational over computeBudgetAlerts - renders nothing when
// there's nothing to say, which is the common case (no limit set, or
// nowhere near it). month=null means "the whole entry set" (a trip has no
// natural month boundary); household passes the current month explicitly
// so browsing a past month elsewhere in the app never affects what alert
// shows here.
export default function BudgetAlerts({ entries, ledger, month = null, budgets = {} }) {
  const alerts = useMemo(() => {
    if (!budgets || Object.keys(budgets).length === 0) return [];
    const totals = groupByCategory(entries, month, ledger);
    return computeBudgetAlerts(totals, budgets);
  }, [entries, ledger, month, budgets]);

  if (alerts.length === 0) return null;

  return (
    <section className="panel-card px-4 sm:px-5 py-4 border-l-4 border-stamp-red/60">
      <h3 className="font-display text-sm font-bold text-ink mb-2">⚠️ Budget Alerts</h3>
      <div className="space-y-1.5">
        {alerts.map((a) => (
          <div key={a.category} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${a.status === 'over' ? 'bg-stamp-red' : 'bg-mustard'}`}
              />
              <span className="text-ink font-medium truncate">{a.category}</span>
            </span>
            <span className="font-mono text-xs text-muted-text shrink-0">
              {formatCurrency(a.spent)} / {formatCurrency(a.limit)} ({Math.round(a.pctUsed * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
