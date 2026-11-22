import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
import PortfolioSipAmounts, { planToDraft, draftToPlan } from './PortfolioSipAmounts';
import { simulateSip } from '../lib/portfolio';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

const HORIZONS = [
  { key: '3m', label: '3 Months', days: 63 },
  { key: '1y', label: '1 Year', days: 250 },
  { key: '3y', label: '3 Years', days: 750 },
];

const pct = (v) => (v == null ? '-' : `${v.toFixed(1)}%`);
const top = (by) => Object.entries(by || {}).sort((a, b) => b[1] - a[1])[0] || null;

// Each line is a metric and how it reads in each of the three columns: { value, sub }.
const LINES = [
  ['Adani Group', (m) => ({ value: pct(m.adaniPct) })],
  ['Largest Fund House', (m) => (top(m.byAmc) ? { value: pct(top(m.byAmc)[1]), sub: top(m.byAmc)[0] } : { value: '-' })],
  ['Thematic Funds', (m) => ({ value: pct(m.byCategory.Thematic ?? 0) })],
  ['Small Cap Funds', (m) => ({ value: pct(m.byCategory['Small cap'] ?? 0) })],
  ['Largest Stock', (m) => (m.maxStock ? { value: pct(m.maxStock.pct), sub: m.maxStock.name } : { value: '-' })],
];

// Where the money would sit after a stretch of SIPs: today, with the plan you run now, and with one you try here. Prices are
// held where they are, so this isolates the effect of the SIP choice; it compares plans, it does not forecast. The columns
// share the width (no fixed sizes), so it fits a phone and a narrow side column alike.
export default function PortfolioWhatIf({ portfolio, funds, overlapData, metrics, sipPlan, collapsible = false, defaultOpen = false }) {
  const { money } = usePortfolioPrivacy();
  const [openState, setOpenState] = useState(defaultOpen);
  const isOpen = !collapsible || openState;
  const [horizon, setHorizon] = useState('1y');
  const [draft, setDraft] = useState(() => planToDraft(sipPlan));
  const [editing, setEditing] = useState(false);
  const days = HORIZONS.find((h) => h.key === horizon).days;

  const current = useMemo(
    () => simulateSip({ rows: portfolio.rows, funds, overlapData, plan: sipPlan, days }),
    [portfolio.rows, funds, overlapData, sipPlan, days],
  );
  const tried = useMemo(
    () => simulateSip({ rows: portfolio.rows, funds, overlapData, plan: draftToPlan(draft), days }),
    [portfolio.rows, funds, overlapData, draft, days],
  );
  const cols = [
    ['Today', metrics],
    ['Current', current.metrics],
    ['Tried', tried.metrics],
  ];
  const triedCount = Object.keys(draftToPlan(draft)).length;

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="SIP What-If"
        subtitle="Compare plans, prices held still"
        summary={`${money(tried.perDay)} a day tried`}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        <View>
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1.5">After</Text>
          <View className="flex-row gap-1.5 mb-3">
            {HORIZONS.map((h) => (
              <Pressable
                key={h.key}
                onPress={() => setHorizon(h.key)}
                className={`flex-1 min-h-9 rounded-lg items-center justify-center border ${horizon === h.key ? 'bg-ledger-green border-ledger-green' : 'border-ink/15 bg-paper'}`}
              >
                <Text className={`font-body-semibold text-xs ${horizon === h.key ? 'text-white' : 'text-ink'}`}>{h.label}</Text>
              </Pressable>
            ))}
          </View>

          <View className="flex-row items-end gap-2 pb-1 border-b border-ink/10">
            <View style={{ flex: 1.3 }} />
            {cols.map(([title]) => (
              <Text key={title} className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text" style={{ flex: 1, textAlign: 'right' }}>
                {title}
              </Text>
            ))}
          </View>
          {LINES.map(([label, read]) => (
            <View key={label} className="flex-row items-center gap-2 py-2 border-b border-ink/10">
              <Text className="font-body text-sm text-ink" style={{ flex: 1.3 }} numberOfLines={2}>{label}</Text>
              {cols.map(([title, m]) => {
                const r = read(m);
                return (
                  <View key={title} style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text className="font-mono-bold text-xs text-ink">{r.value}</Text>
                    {r.sub ? <Text className="font-body text-2xs text-muted-text" numberOfLines={1}>{r.sub}</Text> : null}
                  </View>
                );
              })}
            </View>
          ))}
          <View className="flex-row items-center gap-2 py-2">
            <Text className="font-body text-sm text-ink" style={{ flex: 1.3 }}>Put In per Day</Text>
            <Text className="font-mono text-xs text-muted-text" style={{ flex: 1, textAlign: 'right' }}>-</Text>
            <Text className="font-mono text-xs text-ink" style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>{money(current.perDay)}</Text>
            <Text className="font-mono text-xs text-ink" style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>{money(tried.perDay)}</Text>
          </View>

          <View className="mt-1 mb-2 flex-row items-center justify-between gap-2">
            <Text className="font-body text-xs text-muted-text flex-1">
              Tried plan: {money(tried.perDay)} a day across {triedCount} fund{triedCount === 1 ? '' : 's'}.
            </Text>
            <Pressable onPress={() => setEditing((v) => !v)} className="min-h-8 px-2.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
              <Text className="font-body-semibold text-xs text-ink">{editing ? 'Done' : 'Change Tried Plan'}</Text>
            </Pressable>
          </View>

          {editing ? (
            <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-3 mb-2">
              <PortfolioSipAmounts funds={funds} draft={draft} onChange={setDraft} />
              <Pressable onPress={() => setDraft(planToDraft(sipPlan))} className="self-start mt-2 px-2.5 py-1 rounded-md bg-paper-card border border-ink/10">
                <Text className="font-body-semibold text-xs text-muted-text">Reset to My Current Plan</Text>
              </Pressable>
            </View>
          ) : null}

          <Text className="font-body text-2xs text-muted-text">
            Your holdings today plus {days} trading days of each plan at today's prices, using the same top holdings as Overlap, so the shares are a floor.
            This plan is only tried here; to change the real one, use Settings.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
