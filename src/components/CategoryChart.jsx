import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  getCategoryMoMComparison,
  formatMonthLabel,
  formatCurrency,
  CATEGORY_COLORS,
  DEFAULT_CATEGORIES as CATEGORIES,
} from '../utils';

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { category, amount, pctChange, isNew, prevAmount } = payload[0].payload;
  return (
    <div className="rounded-xl bg-paper-card border border-ink/15 px-3.5 py-2.5 text-sm shadow-md">
      <p className="font-bold text-ink">{category}</p>
      <p className="font-mono text-ink font-bold">{formatCurrency(amount)}</p>
      {prevAmount > 0 ? (
        <p
          className={`text-xs font-semibold mt-1 ${
            pctChange > 0 ? 'text-red-700' : pctChange < 0 ? 'text-emerald-800' : 'text-muted-text'
          }`}
        >
          {pctChange > 0 ? '▲ +' : pctChange < 0 ? '▼ ' : ''}
          {pctChange}% vs last month
        </p>
      ) : isNew ? (
        <p className="text-xs font-semibold text-indigo-700 mt-1">New category spend this month</p>
      ) : null}
    </div>
  );
}

export default function CategoryChart({ entries, selectedMonth, onMonthChange, availableMonths, ledger }) {
  const data = useMemo(
    () => getCategoryMoMComparison(entries, selectedMonth, ledger),
    [entries, selectedMonth, ledger],
  );
  const total = useMemo(() => data.reduce((sum, d) => sum + d.amount, 0), [data]);

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Category Breakdown
          </h2>
          <p className="text-xs text-muted-text">Monthly spend & MoM comparison</p>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => onMonthChange(e.target.value)}
          className="h-10 px-3 pr-8 rounded-xl border border-ink/15 bg-paper text-ink text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs appearance-none bg-[url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2324304A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e&quot;)] bg-[length:1rem_1rem] bg-[right_0.6rem_center] bg-no-repeat shrink-0"
          aria-label="Filter by month"
        >
          {availableMonths.map((m) => (
            <option key={m} value={m}>{formatMonthLabel(m)}</option>
          ))}
        </select>
      </div>

      {data.length === 0 ? (
        <div className="border-2 border-dashed border-ink/20 rounded-xl py-12 text-center text-muted-text text-sm bg-paper/50">
          No expenses recorded in {formatMonthLabel(selectedMonth)}.
        </div>
      ) : (
        <>
          <div className="h-56 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((entry, index) => {
                    const idx = CATEGORIES.indexOf(entry.category);
                    const colorIndex = idx >= 0 ? idx : index;
                    return (
                      <Cell
                        key={entry.category}
                        fill={CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length]}
                      />
                    );
                  })}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="font-mono font-bold text-lg sm:text-xl text-ink">
                  {formatCurrency(total)}
                </p>
                <p className="text-[10px] text-muted-text font-medium uppercase tracking-wider">Total</p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-ink/10">
            <div className="flex justify-between items-center text-[10px] sm:text-[11px] font-semibold text-muted-text uppercase tracking-wider mb-2 px-1">
              <span>Category</span>
              <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                <span>Amount</span>
                <span className="min-w-[4.25rem] text-right">MoM %</span>
              </div>
            </div>

            <ul className="space-y-1.5 text-xs">
              {data.map((entry, index) => {
                const idx = CATEGORIES.indexOf(entry.category);
                const colorIndex = idx >= 0 ? idx : index;
                const color = CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length];
                const isIncreased = entry.pctChange > 0;
                const isDecreased = entry.pctChange < 0;

                return (
                  <li
                    key={entry.category}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-paper/80 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-ink font-semibold sm:font-medium text-xs sm:text-sm truncate">
                        {entry.category}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <span className="font-mono text-ink font-bold text-xs sm:text-sm text-right">
                        {formatCurrency(entry.amount)}
                      </span>

                      <div className="min-w-[4.25rem] flex justify-end shrink-0">
                        {entry.prevAmount > 0 ? (
                          <span
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold font-mono whitespace-nowrap ${
                              isIncreased
                                ? 'bg-red-100 text-red-700'
                                : isDecreased
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-ink/5 text-muted-text'
                            }`}
                          >
                            {isIncreased ? '▲ +' : isDecreased ? '▼ ' : ''}
                            {entry.pctChange}%
                          </span>
                        ) : entry.isNew ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold bg-indigo-100 text-indigo-700 whitespace-nowrap">
                            New
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-text font-medium text-right font-mono">-</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
