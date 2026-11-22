import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
import { BENCHMARK_PERIODS } from '../lib/portfolio';
import { gainClass } from './PortfolioSummary';

const COL = 74;
const NAME = 140;

const fmt = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

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
export default function PortfolioBenchmark({ table, benchmark, collapsible = false }) {
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
