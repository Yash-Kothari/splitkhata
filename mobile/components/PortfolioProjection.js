import { useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
import { projectCorpus } from '../lib/portfolio';
import { parseAmountInput } from '../lib/utils';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper';
const MARKS = [5, 10, 15, 20, 25, 30];

function Field({ label, value, onChange, suffix }) {
  return (
    <View style={{ width: '47%' }}>
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">{label}</Text>
      <View className="flex-row items-center gap-1.5">
        <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" aria-label={label} className={`${input} flex-1`} />
        {suffix ? <Text className="font-body text-xs text-muted-text">{suffix}</Text> : null}
      </View>
    </View>
  );
}

// What the SIPs and today's value could grow to over a long horizon at a low, middle and high yearly return. This is
// compounding arithmetic on numbers you can change, an illustration of how time and return interact, not a forecast.
export default function PortfolioProjection({ portfolio, sipPlan, collapsible = false }) {
  const { money, compact } = usePortfolioPrivacy();
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

  const n = (t, fallback) => {
    const v = parseAmountInput(t);
    return v == null ? fallback : v;
  };
  const horizon = Math.min(Math.max(Math.round(n(years, 20)), 1), 40);
  const scenarios = useMemo(
    () =>
      [
        ['Low', n(low, 8)],
        ['Middle', n(mid, 11)],
        ['High', n(high, 14)],
      ].map(([label, r]) => ({
        label,
        r,
        path: projectCorpus({ start: portfolio.total.value, monthlySip: n(monthly, 0), annualReturnPct: r, years: horizon, stepUpPct: n(stepUp, 0) }),
      })),
    [portfolio.total.value, monthly, horizon, stepUp, low, mid, high],
  );
  const marks = [...MARKS.filter((m) => m <= horizon), ...(MARKS.includes(horizon) ? [] : [horizon])].sort((a, b) => a - b);
  const at = (path, year) => path.find((p) => p.year === year);
  const infl = n(inflation, 6);
  const real = (v, year) => v / Math.pow(1 + infl / 100, year);

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Long-Term Illustration"
        subtitle="Arithmetic on numbers you set, not a forecast"
        summary={`${horizon} years at ${n(mid, 11)}%: ${money(at(scenarios[1].path, horizon)?.value ?? 0)}`}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        <View>
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <Field label="SIP per Month (₹)" value={monthly} onChange={setMonthly} />
            <Field label="Years" value={years} onChange={setYears} />
            <Field label="Yearly SIP Increase" value={stepUp} onChange={setStepUp} suffix="%" />
            <Field label="Inflation" value={inflation} onChange={setInflation} suffix="%" />
            <Field label="Low Return a Year" value={low} onChange={setLow} suffix="%" />
            <Field label="Middle Return" value={mid} onChange={setMid} suffix="%" />
            <Field label="High Return" value={high} onChange={setHigh} suffix="%" />
          </View>
          <Text className="font-body text-2xs text-muted-text mt-2">
            Starts from today's value of {money(portfolio.total.value)} and adds the monthly SIP at each month end. The SIP field starts at your current plan.
          </Text>

          <View className="mt-3">
            <View className="flex-row gap-2 border-b border-ink/10 pb-1">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text" style={{ width: 44 }}>Year</Text>
              {scenarios.map((s) => (
                <Text key={s.label} className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text" style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
                  {s.label} {s.r}%
                </Text>
              ))}
            </View>
            {marks.map((year) => (
              <View key={year} className="py-1.5 border-b border-ink/10">
                <View className="flex-row gap-2">
                  <Text className="font-body-semibold text-sm text-ink" style={{ width: 44 }}>{year}</Text>
                  {scenarios.map((s) => (
                    <Text key={s.label} className="font-mono-bold text-xs text-ink" style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
                      {compact(at(s.path, year)?.value ?? 0)}
                    </Text>
                  ))}
                </View>
                <View className="flex-row gap-2">
                  <Text className="font-body text-2xs text-muted-text" style={{ width: 44 }}>real</Text>
                  {scenarios.map((s) => (
                    <Text key={s.label} className="font-mono text-2xs text-muted-text" style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
                      {compact(real(at(s.path, year)?.value ?? 0, year))}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
            <Text className="font-body text-2xs text-muted-text pt-1.5">
              Put in by year {horizon}: {money(at(scenarios[1].path, horizon)?.invested ?? 0)}. Figures in lakh (L) and crore (Cr); "real" is the same amount in today's money after the inflation you set.
            </Text>
          </View>
          <Text className="font-body text-2xs text-muted-text mt-2">
            Real returns vary a lot from year to year and can be negative for long stretches. The "real" line takes the inflation you set off each figure.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
