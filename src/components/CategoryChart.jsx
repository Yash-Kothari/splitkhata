import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  groupByCategory,
  formatMonthLabel,
  formatCurrency,
  CATEGORY_COLORS,
  CATEGORIES,
} from '../constants';

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { category, amount } = payload[0].payload;
  return (
    <div className="rounded-lg bg-paper-card border border-ink/15 px-3 py-2 text-sm shadow-sm">
      <p className="font-medium text-ink">{category}</p>
      <p className="font-mono text-ink">{formatCurrency(amount)}</p>
    </div>
  );
}

export default function CategoryChart({ entries, selectedMonth, onMonthChange, availableMonths }) {
  const data = groupByCategory(entries, selectedMonth);
  const total = data.reduce((sum, d) => sum + d.amount, 0);

  return (
    <section className="rounded-xl bg-paper-card px-5 py-4 border border-ink/10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 className="font-display text-lg font-medium text-ink">
          Spend by Category
        </h2>
        <select
          value={selectedMonth}
          onChange={(e) => onMonthChange(e.target.value)}
          className="min-h-11 px-3 py-2 rounded-lg border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
          aria-label="Filter by month"
        >
          {availableMonths.map((m) => (
            <option key={m} value={m}>{formatMonthLabel(m)}</option>
          ))}
        </select>
      </div>

      {data.length === 0 ? (
        <div className="border-2 border-dashed border-ink/20 rounded-lg py-12 text-center text-muted-text text-sm">
          No expenses in {formatMonthLabel(selectedMonth)}
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
                  {data.map((entry) => {
                    const idx = CATEGORIES.indexOf(entry.category);
                    return (
                      <Cell
                        key={entry.category}
                        fill={CATEGORY_COLORS[idx >= 0 ? idx : CATEGORY_COLORS.length - 1]}
                      />
                    );
                  })}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="font-mono font-semibold text-lg text-ink">
                  {formatCurrency(total)}
                </p>
                <p className="text-xs text-muted-text">total</p>
              </div>
            </div>
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
            {data.map((entry) => {
              const idx = CATEGORIES.indexOf(entry.category);
              const color = CATEGORY_COLORS[idx >= 0 ? idx : CATEGORY_COLORS.length - 1];
              return (
                <li key={entry.category} className="flex items-center gap-2 text-sm">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-muted-text truncate">{entry.category}</span>
                  <span className="font-mono text-ink ml-auto">
                    {formatCurrency(entry.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
