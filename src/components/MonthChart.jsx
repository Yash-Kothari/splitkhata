import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { groupByMonth, formatMonthLabel, formatCurrency } from '../constants';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-paper-card border border-ink/15 px-3 py-2 text-sm shadow-sm">
      <p className="font-medium text-ink mb-1">{formatMonthLabel(label)}</p>
      {payload.map((item) => (
        <p key={item.name} className="text-muted-text">
          {item.name}:{' '}
          <span className="font-mono text-ink">{formatCurrency(item.value)}</span>
        </p>
      ))}
    </div>
  );
}

export default function MonthChart({ entries }) {
  const data = groupByMonth(entries);

  if (data.length === 0) {
    return (
      <section className="rounded-xl bg-paper-card px-5 py-4 border border-ink/10">
        <h2 className="font-display text-lg font-medium text-ink mb-3">
          Spend Over Time
        </h2>
        <div className="border-2 border-dashed border-ink/20 rounded-lg py-12 text-center text-muted-text text-sm">
          Add your first entry to see monthly trends
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-paper-card px-5 py-4 border border-ink/10">
      <h2 className="font-display text-lg font-medium text-ink mb-3">
        Spend Over Time
      </h2>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
            <XAxis
              dataKey="month"
              tickFormatter={formatMonthLabel}
              tick={{ fontSize: 11, fill: '#5C6478' }}
              axisLine={{ stroke: '#24304A20' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#5C6478' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="circle"
              iconSize={8}
            />
            <Bar dataKey="Husband" fill="#A63D40" radius={[3, 3, 0, 0]} maxBarSize={32} />
            <Bar dataKey="Wife" fill="#3D7068" radius={[3, 3, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
