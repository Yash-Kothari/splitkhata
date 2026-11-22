import { useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import Card from './Card';
import FoldHeader from './FoldHeader';
import PortfolioPills from './PortfolioPills';
import LineChart, { useChartColors } from './PortfolioLineChart';
import { projectCorpus, summariseProjection, inTodaysMoney } from '../lib/portfolio';
import { parseAmountInput } from '../lib/utils';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper';
const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const MARKS = [5, 10, 15, 20, 25, 30];

// `width` is a share of the row; minWidth 0 lets the input shrink to it (a TextInput otherwise keeps its own
// default width on the web and runs out of the card).
function Field({ label: text, value, onChange, width = '47%' }) {
  return (
    <View style={{ width }}>
      <Text className={label} numberOfLines={1}>{text}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" aria-label={text} className={input} style={{ minWidth: 0, width: '100%' }} />
    </View>
  );
}

// What the SIPs and today's value could grow to over a long horizon at a low, middle and high yearly return. This is
// compounding arithmetic on numbers you can change, an illustration of how time and return interact, not a forecast.
export default function PortfolioProjection({ portfolio, sipPlan, collapsible = false }) {
  const { money, compact } = usePortfolioPrivacy();
  const c = useChartColors();
  const [pickedYear, setPickedYear] = useState(null);
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;
  const perDay = Object.values(sipPlan || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const [monthly, setMonthly] = useState(String(Math.round((perDay * 250) / 12)));
  const [years, setYears] = useState('20');
  const [stepUp, setStepUp] = useState('0');
  const [low, setLow] = useState('8');
  const [mid, setMid] = useState('11');
  const [high, setHigh] = useState('14');
  const [inflation, setInflation] = useState('6');
  const [view, setView] = useState('future');

  const n = (t, fallback) => {
    const v = parseAmountInput(t);
    return v == null ? fallback : v;
  };
  const horizon = Math.min(Math.max(Math.round(n(years, 20)), 1), 40);
  const infl = n(inflation, 6);
  const scenarios = useMemo(
    () =>
      [
        ['Low', n(low, 8)],
        ['Middle', n(mid, 11)],
        ['High', n(high, 14)],
      ].map(([name, r]) => ({
        name,
        r,
        path: projectCorpus({ start: portfolio.total.value, monthlySip: n(monthly, 0), annualReturnPct: r, years: horizon, stepUpPct: n(stepUp, 0) }),
      })),
    [portfolio.total.value, monthly, horizon, stepUp, low, mid, high],
  );
  const marks = [...MARKS.filter((m) => m <= horizon), ...(MARKS.includes(horizon) ? [] : [horizon])].sort((a, b) => a - b);
  const middle = scenarios[1];
  const head = summariseProjection(middle.path, horizon, infl);
  // The chart is always in future rupees (what the account would show); the table below can switch to today's money.
  const HIGH_COLOR = '#457B9D';
  const lineColors = [c.mustard, c.gain, HIGH_COLOR];
  const yearList = middle.path.map((p) => p.year);
  const yearIdx = pickedYear != null && pickedYear < yearList.length ? pickedYear : yearList.length - 1;
  const shown = (path, year) => {
    const v = path.find((p) => p.year === year)?.value ?? 0;
    return compact(view === 'real' ? inTodaysMoney(v, year, infl) : v);
  };

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Long-Term Illustration"
        subtitle="Your numbers, not a forecast"
        summary={`${horizon} years at ${middle.r}%: ${compact(head.value)}`}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        <View>
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <Field label="SIP per Month (₹)" value={monthly} onChange={setMonthly} />
            <Field label="Years" value={years} onChange={setYears} />
            <Field label="Yearly SIP Increase (%)" value={stepUp} onChange={setStepUp} />
            <Field label="Inflation (%)" value={inflation} onChange={setInflation} />
          </View>
          <Text className={`${label} mt-3`}>Yearly Return (%)</Text>
          <View className="flex-row" style={{ gap: 10 }}>
            <Field label="Low" value={low} onChange={setLow} width="31%" />
            <Field label="Middle" value={mid} onChange={setMid} width="31%" />
            <Field label="High" value={high} onChange={setHigh} width="31%" />
          </View>

          <View className="rounded-xl border border-ledger-green/20 bg-ledger-green/10 px-3.5 py-3 mt-4">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-ledger-green">After {horizon} Years at {middle.r}%</Text>
            <Text className="font-mono-bold text-2xl text-ink mt-0.5">{compact(head.value)}</Text>
            <Text className="font-body text-xs text-muted-text">{compact(head.real)} in today's money</Text>
            <View className="flex-row h-2 rounded-full overflow-hidden mt-2.5">
              <View className="bg-ink/40" style={{ width: `${Math.round(head.investedShare * 100)}%` }} />
              <View className="bg-ledger-green flex-1" />
            </View>
            <View className="flex-row justify-between mt-1.5">
              <Text className="font-body text-2xs text-muted-text">Put in {compact(head.invested)}</Text>
              <Text className="font-body text-2xs text-ledger-green">Growth {compact(head.growth)}</Text>
            </View>
          </View>

          <View className="mt-4">
            <LineChart
              series={[
                { key: 'putin', color: c.axis, width: 1.5, dash: '4 3', values: middle.path.map((p) => p.invested) },
                ...scenarios.map((sc, i) => ({ key: sc.name, color: lineColors[i], width: i === 1 ? 2.5 : 1.75, values: sc.path.map((p) => p.value) })),
              ]}
              xLabels={['Today', `Year ${horizon}`]}
              formatY={compact}
              selected={yearIdx}
              onSelect={setPickedYear}
              labelOf={(i) => `Year ${yearList[i]}: ${money(middle.path[i].value)}`}
            />
            <View className="flex-row flex-wrap items-center mt-2" style={{ gap: 12 }}>
              {scenarios.map((sc, i) => (
                <View key={sc.name} className="flex-row items-center gap-1.5">
                  <View style={{ width: 16, height: i === 1 ? 3 : 2, backgroundColor: lineColors[i] }} />
                  <Text className="font-body text-2xs text-muted-text">{sc.name} {sc.r}%</Text>
                </View>
              ))}
              <View className="flex-row items-center gap-1.5">
                <Svg width={16} height={4}>
                  <Line x1={0} y1={2} x2={16} y2={2} stroke={c.axis} strokeWidth={1.5} strokeDasharray="4 3" />
                </Svg>
                <Text className="font-body text-2xs text-muted-text">Put in</Text>
              </View>
            </View>
            <View className="mt-2 rounded-xl border border-ink/15 bg-paper-card px-3.5 py-2.5 shadow-2xs">
              <Text className="font-body-semibold text-sm text-ink">{yearList[yearIdx] === 0 ? 'Today' : `Year ${yearList[yearIdx]}`}</Text>
              {scenarios.map((sc, i) => (
                <View key={sc.name} className="flex-row items-center justify-between mt-0.5">
                  <View className="flex-row items-center gap-1.5">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: lineColors[i] }} />
                    <Text className="font-body text-xs text-muted-text">{sc.name} {sc.r}%</Text>
                  </View>
                  <Text className={`font-mono${i === 1 ? '-bold' : ''} text-xs text-ink`}>{compact(sc.path[yearIdx]?.value ?? 0)}</Text>
                </View>
              ))}
              <View className="flex-row items-center justify-between mt-0.5">
                <Text className="font-body text-xs text-muted-text">Put in</Text>
                <Text className="font-mono text-xs text-muted-text">{compact(middle.path[yearIdx]?.invested ?? 0)}</Text>
              </View>
            </View>
          </View>
          <View className="mt-4">
            <PortfolioPills
              options={[
                ['future', 'Future Rupees'],
                ['real', "Today's Money"],
              ]}
              value={view}
              onChange={setView}
            />
          </View>
          <View className="mt-3">
            <View className="flex-row gap-2 border-b border-ink/10 pb-1">
              <Text className={label.replace('mb-1', '')} style={{ width: 36 }}>Year</Text>
              {scenarios.map((s) => (
                <Text key={s.name} className={label.replace('mb-1', '')} style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
                  {s.name} {s.r}%
                </Text>
              ))}
            </View>
            {marks.map((year) => (
              <View key={year} className="flex-row gap-2 py-2 border-b border-ink/10">
                <Text className="font-body-semibold text-sm text-ink" style={{ width: 36 }}>{year}</Text>
                {scenarios.map((s, i) => (
                  <Text
                    key={s.name}
                    className={`${i === 1 ? 'font-mono-bold text-ink' : 'font-mono text-muted-text'} text-sm`}
                    style={{ flex: 1, textAlign: 'right' }}
                    numberOfLines={1}
                  >
                    {shown(s.path, year)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
          <Text className="font-body text-2xs text-muted-text mt-2">
            {view === 'real' ? `In today's money after ${infl}% a year inflation. ` : 'Future rupees, before inflation. '}
            Starts from today's {money(portfolio.total.value)} and adds the SIP at each month end; the SIP starts at your current plan. L is lakh, Cr is crore. Real returns swing a lot and can be negative for long stretches.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
