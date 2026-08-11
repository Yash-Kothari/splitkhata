import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  getCategoryMoMComparison,
  getCategoryEntries,
  formatMonthLabel,
  formatCurrency,
  computeBudgetStatus,
  CATEGORY_COLORS,
  DEFAULT_CATEGORIES as CATEGORIES,
} from '../utils';

function CategoryDrilldownModal({ category, entries, currency, isTravel, selectedMonth, budgetStatus, onClose }) {
  const total = entries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const biggest = entries[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2.5 sm:px-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-paper-card border border-ink/15 shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-ink/10 flex items-center justify-between bg-paper/60 shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="font-display text-base sm:text-lg font-bold text-ink truncate">{category}</h2>
            <p className="text-xs text-muted-text">
              {isTravel ? 'Whole trip' : formatMonthLabel(selectedMonth)} · {formatCurrency(total, currency)} total
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-ink/15 bg-paper flex items-center justify-center text-ink hover:bg-paper-card font-bold transition-colors shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          {budgetStatus && (
            <div className="space-y-1 rounded-xl border border-ink/10 bg-paper px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-text">Budget</p>
                <span className="text-xs text-muted-text">{Math.round(budgetStatus.pctUsed * 100)}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    budgetStatus.pctUsed >= 1 ? 'bg-stamp-red' : budgetStatus.pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green'
                  }`}
                  style={{ width: `${Math.min(budgetStatus.pctUsed * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-text">
                {formatCurrency(budgetStatus.spent, currency)} of {formatCurrency(budgetStatus.limit, currency)}
              </p>
            </div>
          )}

          {biggest && (
            <div className="rounded-xl border border-ledger-green/30 bg-ledger-green/10 px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ledger-green mb-1">
                Biggest expense
              </p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{biggest.note || 'No note'}</p>
                  <p className="text-xs text-muted-text">
                    {biggest.date} · Paid by {biggest.payer}
                  </p>
                </div>
                <span className="font-mono font-bold text-ink text-sm shrink-0">
                  {formatCurrency(biggest.amount, currency)}
                </span>
              </div>
            </div>
          )}

          {entries.length > 1 && (
            <ul className="space-y-1">
              {entries.slice(1).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 py-2 px-2.5 rounded-lg hover:bg-paper/80 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{entry.note || 'No note'}</p>
                    <p className="text-xs text-muted-text">
                      {entry.date} · Paid by {entry.payer}
                    </p>
                  </div>
                  <span className="font-mono font-semibold text-ink text-sm shrink-0">
                    {formatCurrency(entry.amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {entries.length === 0 && (
            <p className="text-sm text-muted-text text-center py-6">No expenses found for this category.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DonutTooltip({ active, payload, currency, showTrend }) {
  if (!active || !payload?.length) return null;
  const { category, amount, pctChange, isNew, prevAmount } = payload[0].payload;
  return (
    <div className="rounded-xl bg-paper-card border border-ink/15 px-3.5 py-2.5 text-sm shadow-md">
      <p className="font-bold text-ink">{category}</p>
      <p className="font-mono text-ink font-bold">{formatCurrency(amount, currency)}</p>
      {showTrend && prevAmount > 0 ? (
        <p
          className={`text-xs font-semibold mt-1 ${
            pctChange > 0 ? 'text-red-700' : pctChange < 0 ? 'text-emerald-800' : 'text-muted-text'
          }`}
        >
          {pctChange > 0 ? '▲ +' : pctChange < 0 ? '▼ ' : ''}
          {pctChange}% vs last month
        </p>
      ) : showTrend && isNew ? (
        <p className="text-xs font-semibold text-indigo-700 mt-1">New category spend this month</p>
      ) : null}
    </div>
  );
}

export default function CategoryChart({ entries, selectedMonth, onMonthChange, availableMonths, ledger, budgets = {} }) {
  const isTravel = ledger === 'travel';
  // A trip is usually days, not months - skip month filtering and the MoM
  // comparison entirely for travel, and just show the trip's full breakdown.
  const data = useMemo(
    () => getCategoryMoMComparison(entries, isTravel ? null : selectedMonth, ledger).sort((a, b) => b.amount - a.amount),
    [entries, selectedMonth, ledger, isTravel],
  );
  const total = useMemo(() => data.reduce((sum, d) => sum + d.amount, 0), [data]);
  // amount is always INR now (real cost) - a trip's local currency is a
  // per-entry reference (see EntryList), not what spend charts total up.
  const currency = 'INR';
  // The center total sits inside a fixed-size donut hole - a long total
  // (large trips, or currencies whose symbol/format runs wide) can overflow
  // that circle and spill onto the ring, so its font size scales down by
  // string length instead of staying fixed regardless of digit count.
  const totalLabel = formatCurrency(total, currency);

  const [selectedCategory, setSelectedCategory] = useState(null);
  const drilldownEntries = useMemo(
    () => (selectedCategory ? getCategoryEntries(entries, isTravel ? null : selectedMonth, ledger, selectedCategory) : []),
    [entries, isTravel, selectedMonth, ledger, selectedCategory],
  );
  // Always shown regardless of how close to the limit it is (unlike the
  // Budget Alerts banner, which only surfaces >=80%) - you asked to see
  // this specific category, so its status is worth showing outright.
  // Filtered to just the one budget so computeBudgetStatus's "no limit
  // set" skip logic naturally makes this null when there's nothing to show.
  const budgetStatus = useMemo(() => {
    if (!selectedCategory || !budgets?.[selectedCategory]) return null;
    const [status] = computeBudgetStatus(data, { [selectedCategory]: budgets[selectedCategory] });
    return status || null;
  }, [selectedCategory, budgets, data]);

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Category Breakdown
          </h2>
          <p className="text-xs text-muted-text">{isTravel ? 'Spend by category' : 'Monthly spend & MoM comparison'}</p>
        </div>
        {!isTravel && (
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
        )}
      </div>

      {data.length === 0 ? (
        <div className="border-2 border-dashed border-ink/20 rounded-xl py-12 text-center text-muted-text text-sm bg-paper/50">
          {isTravel ? 'No expenses recorded yet.' : `No expenses recorded in ${formatMonthLabel(selectedMonth)}.`}
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
                  cursor="pointer"
                  onClick={(entry) => setSelectedCategory(entry.payload?.category ?? entry.category)}
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
                <Tooltip
                  content={<DonutTooltip currency={currency} showTrend={!isTravel} />}
                  position={{ x: 0, y: 0 }}
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center px-2 max-w-[38%]">
                <p
                  className={`font-mono font-bold text-ink leading-tight ${
                    totalLabel.length > 12 ? 'text-xs sm:text-sm' : totalLabel.length > 9 ? 'text-sm sm:text-base' : 'text-lg sm:text-xl'
                  }`}
                >
                  {totalLabel}
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
                {!isTravel && <span className="min-w-[4.25rem] text-right">MoM %</span>}
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
                    onClick={() => setSelectedCategory(entry.category)}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-paper/80 cursor-pointer transition-colors"
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
                        {formatCurrency(entry.amount, currency)}
                      </span>

                      {!isTravel && (
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
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {selectedCategory && (
        <CategoryDrilldownModal
          category={selectedCategory}
          entries={drilldownEntries}
          currency={currency}
          isTravel={isTravel}
          selectedMonth={selectedMonth}
          budgetStatus={budgetStatus}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </section>
  );
}
