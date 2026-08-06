import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { getLast6MonthsData, formatCurrency, CURRENCY_SYMBOLS } from '../utils';

function ChartTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  const isUp = data.pctChange > 0;
  const isDown = data.pctChange < 0;

  return (
    <div className="rounded-xl bg-paper-card border border-ink/15 px-3.5 py-2.5 text-sm shadow-md">
      <p className="font-bold text-ink mb-1">{data.label}</p>
      <p className="text-muted-text font-medium text-xs">
        Total Spend:{' '}
        <span className="font-mono text-ink font-bold text-sm ml-1">
          {formatCurrency(data.total, currency)}
        </span>
      </p>
      {data.prevTotal > 0 ? (
        <div className="flex items-center gap-1 mt-1 text-xs font-semibold">
          <span className="text-muted-text font-normal">MoM:</span>
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] ${
              isUp
                ? 'bg-red-100 text-red-700'
                : isDown
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-ink/5 text-muted-text'
            }`}
          >
            {isUp ? '▲ +' : isDown ? '▼ ' : ''}
            {data.pctChange}% vs prev month
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-muted-text mt-1">No spend recorded in prior month</p>
      )}
    </div>
  );
}

export default function MonthChart({ entries, ledger, currentCurrency = 'INR' }) {
  const data = useMemo(() => getLast6MonthsData(entries, ledger), [entries, ledger]);
  const latestMonth = data[data.length - 1];
  const hasSpend = data.some((d) => d.total > 0);
  const currency = ledger === 'travel' ? currentCurrency : 'INR';
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Monthly Spend (Last 6 Months)
          </h2>
          <p className="text-xs text-muted-text">Total spend month over month</p>
        </div>
        {latestMonth && latestMonth.total > 0 && (
          <div className="flex items-center gap-2 bg-paper px-3 py-1.5 rounded-xl border border-ink/10 text-xs self-start sm:self-auto">
            <span className="text-muted-text font-medium">{latestMonth.label}:</span>
            <span className="font-mono font-bold text-ink">{formatCurrency(latestMonth.total, currency)}</span>
            {latestMonth.prevTotal > 0 && (
              <span
                className={`font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                  latestMonth.pctChange > 0
                    ? 'bg-red-100 text-red-700'
                    : latestMonth.pctChange < 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-ink/5 text-muted-text'
                }`}
              >
                {latestMonth.pctChange > 0 ? '▲ +' : latestMonth.pctChange < 0 ? '▼ ' : ''}
                {latestMonth.pctChange}%
              </span>
            )}
          </div>
        )}
      </div>

      {!hasSpend ? (
        <div className="border-2 border-dashed border-ink/20 rounded-xl py-12 text-center text-muted-text text-sm bg-paper/50">
          No monthly spend data recorded yet.
        </div>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 4, left: -12, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#5C6478', fontWeight: 500 }}
                axisLine={{ stroke: '#24304A20' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#5C6478' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${symbol}${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
              />
              <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: '#24304A08' }} />
              <Bar dataKey="total" radius={[6, 6, 0, 0]} maxBarSize={40}>
                {data.map((entry, index) => {
                  const isLatest = index === data.length - 1;
                  return (
                    <Cell
                      key={`cell-${entry.month}`}
                      fill={isLatest ? '#3D7068' : '#3D706890'}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
