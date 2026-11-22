import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
import PortfolioPills from './PortfolioPills';
import LineChart, { useChartColors } from './PortfolioLineChart';
import { BENCHMARK_PERIODS, computeRelativeLines, formatShortDate } from '../lib/portfolio';
import { CATEGORY_COLORS } from '../lib/utils';
import { gainClass } from './PortfolioSummary';

const COL = 74;
const NAME = 140;

const fmt = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const DEFAULT_SHOWN = 3;
const PERIOD_DAYS = Object.fromEntries(BENCHMARK_PERIODS);

// The funds against the index over a window, as lines of percent change since its start. Every fund is a chip (a dot in
// its line's colour, its name and its return) that turns its line on or off; the three largest holdings start on, because
// a dozen lines at once cannot be read. The numbers are NAV to NAV, not what you earned on your own purchases.
function RelativeChart({ rows, navByCode, benchmark }) {
  const c = useChartColors();
  const [period, setPeriod] = useState('1Y');
  const [chosen, setChosen] = useState(null); // null = the default few
  const [selected, setSelected] = useState(null);
  const lines = useMemo(
    () => computeRelativeLines({ rows, navByCode, benchmarkCode: benchmark?.schemeCode, days: PERIOD_DAYS[period] }),
    [rows, navByCode, benchmark, period],
  );
  const colorOf = (key) => CATEGORY_COLORS[Math.max(lines.funds.findIndex((f) => f.key === key), 0) % CATEGORY_COLORS.length];
  const shownKeys = (chosen ?? lines.funds.slice(0, DEFAULT_SHOWN).map((f) => f.key)).filter((k) => lines.funds.some((f) => f.key === k));
  const shown = lines.funds.filter((f) => shownKeys.includes(f.key));
  const toggle = (key) => setChosen((cur) => {
    const base = cur ?? lines.funds.slice(0, DEFAULT_SHOWN).map((f) => f.key);
    return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
  });
  const n = lines.dates.length;
  const sel = selected != null && selected < n ? selected : n - 1;

  return (
    <View className="mb-4">
      <PortfolioPills options={BENCHMARK_PERIODS.map(([k]) => [k, k])} value={period} onChange={(k) => { setPeriod(k); setSelected(null); }} />
      <View className="mt-3">
        {n < 2 ? (
          <View className="border-2 border-dashed border-ink/20 rounded-xl py-8 items-center justify-center bg-paper/50 px-4">
            <Text className="font-body text-sm text-muted-text text-center">The stored NAV history does not reach back {period} yet.</Text>
          </View>
        ) : (
          <LineChart
            zeroLine
            series={[
              ...shown.map((f) => ({ key: f.key, color: colorOf(f.key), width: 1.75, values: f.values })),
              { key: 'nifty', color: c.base, width: 2.5, values: lines.benchmark },
            ]}
            xLabels={[formatShortDate(lines.dates[0]), formatShortDate(lines.dates[n - 1])]}
            formatY={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
            selected={sel}
            onSelect={setSelected}
            labelOf={(i) => `${formatShortDate(lines.dates[i])}: Nifty 50 ${fmt(lines.benchmark[i])}`}
          />
        )}
      </View>
      {n >= 2 ? (
        <>
          <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
            <View className="flex-row items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/5 px-2.5 py-1.5">
              <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: c.base }} />
              <Text className="font-body-semibold text-xs text-ink">Nifty 50</Text>
              <Text className="font-mono text-2xs text-muted-text">{fmt(lines.benchmark[n - 1])}</Text>
            </View>
            {lines.funds.map((f) => {
              const on = shownKeys.includes(f.key);
              return (
                <Pressable
                  key={f.key}
                  onPress={() => toggle(f.key)}
                  accessibilityRole="button"
                  aria-selected={on}
                  className={`flex-row items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${on ? 'border-ink/30 bg-paper-card' : 'border-ink/10 bg-paper'}`}
                  style={{ opacity: on ? 1 : 0.6 }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(f.key) }} />
                  <Text className="font-body-semibold text-xs text-ink" numberOfLines={1}>{f.short}</Text>
                  <Text className="font-mono text-2xs text-muted-text">{fmt(f.last)}</Text>
                </Pressable>
              );
            })}
          </View>
          <View className="mt-2 rounded-xl border border-ink/15 bg-paper-card px-3.5 py-2.5 shadow-2xs">
            <Text className="font-body-semibold text-sm text-ink">{formatShortDate(lines.dates[sel])}</Text>
            <View className="flex-row items-center justify-between mt-0.5">
              <Text className="font-body text-xs text-muted-text">Nifty 50</Text>
              <Text className={`font-mono-bold text-xs ${gainClass(lines.benchmark[sel])}`}>{fmt(lines.benchmark[sel])}</Text>
            </View>
            {shown.map((f) => (
              <View key={f.key} className="flex-row items-center justify-between mt-0.5">
                <View className="flex-row items-center gap-1.5 flex-1 pr-2">
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(f.key) }} />
                  <Text className="font-body text-xs text-muted-text" numberOfLines={1}>{f.short}</Text>
                </View>
                <Text className={`font-mono-bold text-xs ${gainClass(f.values[sel])}`}>{fmt(f.values[sel])}</Text>
              </View>
            ))}
          </View>
          <Text className="font-body text-2xs text-muted-text mt-2">
            Percent change since the start of the window, NAV to NAV. Tap a fund to add or remove its line; a fund the stored history does not cover is left out.
          </Text>
        </>
      ) : null}
    </View>
  );
}

function Cell({ ret, vs, bold = false }) {
  return (
    <View style={{ width: COL, alignItems: 'flex-end' }}>
      <Text className={`font-mono${bold ? '-bold' : ''} text-xs text-ink`}>{fmt(ret)}</Text>
      {vs !== undefined ? <Text className={`font-mono text-2xs ${vs == null ? 'text-muted-text' : gainClass(vs)}`}>{vs == null ? '' : `${vs > 0 ? '+' : ''}${vs.toFixed(1)} vs`}</Text> : null}
    </View>
  );
}

// Each fund's return over the last month, quarter, half year and year next to a Nifty 50 index fund's, and how far ahead
// or behind it is. These are the funds' own returns (NAV to NAV), not what you earned on your own purchases.
export default function PortfolioBenchmark({ table, benchmark, rows = [], navByCode = {}, collapsible = false }) {
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;
  const { hasBenchmark } = table;

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Fund vs Nifty 50"
        subtitle={benchmark?.name ? `Against ${benchmark.name}` : 'Returns over 1 month to 1 year'}
        summary={hasBenchmark ? `Nifty 50 1Y ${fmt(table.benchmark['1Y'])}` : 'No benchmark yet'}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        !hasBenchmark ? (
          <Text className="font-body text-sm text-muted-text">
            {benchmark
              ? 'The benchmark NAVs are still loading. Open Check NAVs in a moment.'
              : 'No benchmark is set yet. Import the latest setup file, which names the index fund to compare against.'}
          </Text>
        ) : (
          <View>
            <RelativeChart rows={rows} navByCode={navByCode} benchmark={benchmark} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ minWidth: NAME + COL * 4 }}>
                <View className="flex-row border-b border-ink/10 pb-1">
                  <View style={{ width: NAME }} />
                  {BENCHMARK_PERIODS.map(([label]) => (
                    <Text key={label} className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text" style={{ width: COL, textAlign: 'right' }}>
                      {label}
                    </Text>
                  ))}
                </View>
                <View className="flex-row items-center py-1.5 border-b border-ink/10 bg-ledger-green/10">
                  <Text className="font-body-semibold text-sm text-ink px-1" style={{ width: NAME }} numberOfLines={1}>Nifty 50</Text>
                  {BENCHMARK_PERIODS.map(([label]) => (
                    <Cell key={label} ret={table.benchmark[label]} bold />
                  ))}
                </View>
                {table.table.map((r) => (
                  <View key={r.key} className="flex-row items-center py-1.5 border-b border-ink/10">
                    <Text className="font-body text-sm text-ink px-1" style={{ width: NAME }} numberOfLines={1}>{r.short}</Text>
                    {BENCHMARK_PERIODS.map(([label]) => (
                      <Cell key={label} ret={r.returns[label]} vs={r.vs[label]} />
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text className="font-body text-2xs text-muted-text mt-2">
              Scroll sideways for the 6-month and 1-year columns. NAV to NAV returns over each window, sorted by the 1-year gap to the index. A dash means the stored
              history does not reach back that far. These are past returns, and funds of different types are not like for like (a liquid fund is not meant to beat the index).
            </Text>
          </View>
        )
      ) : null}
    </Card>
  );
}
