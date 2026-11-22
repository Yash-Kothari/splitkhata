import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
import PortfolioSipAmounts, { planToDraft, draftToPlan } from './PortfolioSipAmounts';
import { simulateSip } from '../lib/portfolio';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

const HORIZONS = [
  { key: '3m', label: '3 months', days: 63 },
  { key: '1y', label: '1 year', days: 250 },
  { key: '3y', label: '3 years', days: 750 },
];

const pct = (v) => (v == null ? '-' : `${v.toFixed(1)}%`);
const top = (by) => Object.entries(by || {}).sort((a, b) => b[1] - a[1])[0] || null;

// Where the money would sit after a stretch of SIPs, for the plan you run today and for one you try here. Prices are
// held where they are, so this shows the effect of the SIP choice alone; it is a way to compare plans, not a forecast.
export default function PortfolioWhatIf({ portfolio, funds, overlapData, metrics, sipPlan, collapsible = false }) {
  const { money } = usePortfolioPrivacy();
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;
  const [horizon, setHorizon] = useState('1y');
  const [draft, setDraft] = useState(() => planToDraft(sipPlan));
  const days = HORIZONS.find((h) => h.key === horizon).days;

  const current = useMemo(
    () => simulateSip({ rows: portfolio.rows, funds, overlapData, plan: sipPlan, days }),
    [portfolio.rows, funds, overlapData, sipPlan, days],
  );
  const tried = useMemo(
    () => simulateSip({ rows: portfolio.rows, funds, overlapData, plan: draftToPlan(draft), days }),
    [portfolio.rows, funds, overlapData, draft, days],
  );

  const lines = [
    ['Adani group', (m) => m.adaniPct, (m) => pct(m.adaniPct)],
    ['Largest fund house', (m) => top(m.byAmc)?.[1], (m) => (top(m.byAmc) ? `${top(m.byAmc)[0]} ${pct(top(m.byAmc)[1])}` : '-')],
    ['Thematic funds', (m) => m.byCategory.Thematic ?? 0, (m) => pct(m.byCategory.Thematic ?? 0)],
    ['Small cap funds', (m) => m.byCategory['Small cap'] ?? 0, (m) => pct(m.byCategory['Small cap'] ?? 0)],
    ['Largest stock', (m) => m.maxStock?.pct, (m) => (m.maxStock ? `${m.maxStock.name} ${pct(m.maxStock.pct)}` : '-')],
  ];
  const cols = [
    ['Today', metrics],
    ['Current plan', current.metrics],
    ['This plan', tried.metrics],
  ];

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="SIP what-if"
        subtitle="Compare plans, prices held still"
        summary={`${money(tried.perDay)} a day tried`}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        <View>
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1.5">Plan to try</Text>
          <PortfolioSipAmounts funds={funds} draft={draft} onChange={setDraft} />
          <Pressable onPress={() => setDraft(planToDraft(sipPlan))} className="self-start mt-2 mb-3 px-2.5 py-1 rounded-md bg-paper border border-ink/10">
            <Text className="font-body-semibold text-xs text-muted-text">Reset to my current plan</Text>
          </Pressable>

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

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: 440 }}>
              <View className="flex-row border-b border-ink/10 pb-1">
                <View style={{ width: 130 }} />
                {cols.map(([title]) => (
                  <Text key={title} className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text" style={{ width: 100, textAlign: 'right' }}>
                    {title}
                  </Text>
                ))}
              </View>
              {lines.map(([label, , fmt]) => (
                <View key={label} className="flex-row py-1.5 border-b border-ink/10">
                  <Text className="font-body text-sm text-ink" style={{ width: 130 }} numberOfLines={1}>{label}</Text>
                  {cols.map(([title, m]) => (
                    <Text key={title} className="font-mono text-xs text-ink" style={{ width: 100, textAlign: 'right' }} numberOfLines={2}>
                      {fmt(m)}
                    </Text>
                  ))}
                </View>
              ))}
              <View className="flex-row py-1.5">
                <Text className="font-body text-sm text-ink" style={{ width: 130 }}>Put in per day</Text>
                {[null, current.perDay, tried.perDay].map((v, i) => (
                  <Text key={i} className="font-mono text-xs text-ink" style={{ width: 100, textAlign: 'right' }}>
                    {v == null ? '-' : money(v)}
                  </Text>
                ))}
              </View>
            </View>
          </ScrollView>
          <Text className="font-body text-2xs text-muted-text mt-2">
            Uses your holdings today plus {days} trading days of each plan at today's prices, and the same top holdings as the Overlap card, so the shares are
            a floor.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
