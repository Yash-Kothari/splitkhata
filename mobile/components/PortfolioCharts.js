import { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';
import Card from './Card';
import FoldHeader from './FoldHeader';
import PortfolioPills from './PortfolioPills';
import LineChart, { CHART_HEIGHT, AXIS_LEFT, AXIS_BOTTOM, useChartColors, TapColumns } from './PortfolioLineChart';
import { formatShortDate, sliceHistory, addDaysISO } from '../lib/portfolio';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { gainClass } from './PortfolioSummary';

// A tidy symmetric limit for the daily bars (1, 2, 5 x a power of ten), so the axis reads as round numbers.
function niceLimit(maxAbs) {
  if (maxAbs <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(maxAbs));
  const r = maxAbs / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
}

export function DailyPnlChart({ history, collapsible = false }) {
  const { signed, compact } = usePortfolioPrivacy();
  const c = useChartColors();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(null);
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;

  const dates = history.dates.slice(-30);
  const vals = history.day.slice(-30);
  const last = vals.length ? vals[vals.length - 1] : 0;
  const limit = niceLimit(Math.max(...vals.map(Math.abs), 0));
  const plotW = Math.max(width - AXIS_LEFT, 0);
  const plotH = CHART_HEIGHT - AXIS_BOTTOM;
  const mid = plotH / 2;
  const slot = vals.length ? plotW / vals.length : 0;
  const barW = Math.max(Math.min(slot * 0.7, 18), 2);
  const sel = selected != null && selected < vals.length ? selected : null;

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Daily P&L"
        subtitle="Last 30 trading days"
        summary={vals.length ? `${formatShortDate(dates[dates.length - 1])}: ${signed(last)}` : null}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {!isOpen ? null : vals.length < 2 ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50 mt-2">
          <Text className="font-body text-sm text-muted-text">Not enough NAV history yet.</Text>
        </View>
      ) : (
        <View className="mt-1">
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
            {width > 0 && (
              <Svg width={width} height={CHART_HEIGHT}>
                <SvgText x={AXIS_LEFT - 6} y={10} fontSize={9} fill={c.axis} textAnchor="end">{`+${compact(limit)}`}</SvgText>
                <SvgText x={AXIS_LEFT - 6} y={mid + 3} fontSize={9} fill={c.axis} textAnchor="end">₹0</SvgText>
                <SvgText x={AXIS_LEFT - 6} y={plotH} fontSize={9} fill={c.axis} textAnchor="end">{`-${compact(limit)}`}</SvgText>
                <Line x1={AXIS_LEFT} y1={mid} x2={width} y2={mid} stroke={c.base} strokeOpacity={0.2} strokeWidth={1} />
                {vals.map((v, i) => {
                  const h = Math.max((Math.min(Math.abs(v), limit) / limit) * (mid - 4), v === 0 ? 0 : 1);
                  const x = AXIS_LEFT + i * slot + (slot - barW) / 2;
                  return (
                    <Path
                      key={dates[i]}
                      d={`M ${x} ${v >= 0 ? mid - h : mid} h ${barW} v ${h} h ${-barW} Z`}
                      fill={v >= 0 ? c.gain : c.loss}
                      fillOpacity={sel == null || sel === i ? 1 : 0.45}
                    />
                  );
                })}
                <SvgText x={AXIS_LEFT} y={CHART_HEIGHT - 4} fontSize={10} fill={c.axis}>{formatShortDate(dates[0])}</SvgText>
                <SvgText x={width} y={CHART_HEIGHT - 4} fontSize={10} fill={c.axis} textAnchor="end">{formatShortDate(dates[dates.length - 1])}</SvgText>
              </Svg>
            )}
            {width > 0 && (
              <TapColumns
                n={vals.length}
                left={AXIS_LEFT}
                slot={slot}
                height={plotH}
                onPick={(i) => setSelected((cur) => (cur === i ? null : i))}
                labelOf={(i) => `${formatShortDate(dates[i])}: ${signed(vals[i])}`}
              />
            )}
          </View>
          <View className="mt-2 rounded-xl border border-ink/15 bg-paper-card px-3.5 py-2.5 self-start shadow-2xs">
            <Text className="font-body-semibold text-sm text-ink">{formatShortDate(dates[sel ?? dates.length - 1])}</Text>
            <Text className={`font-mono-bold text-sm ${gainClass(vals[sel ?? vals.length - 1])}`}>{signed(vals[sel ?? vals.length - 1])}</Text>
          </View>
          <Text className="font-body text-2xs text-muted-text mt-2">
            Each day's change in value on the units you held the day before, so a day's SIP purchase does not count as profit.
          </Text>
        </View>
      )}
    </Card>
  );
}

const RANGES = [
  ['1M', 30],
  ['3M', 91],
  ['6M', 182],
  ['1Y', 365],
];

// What the portfolio was worth against what you had put in, over a range you pick. The gap between the two lines is the
// growth. Put in is the cost of the units held: the snapshot's, plus the SIP and trades since (estimated between snapshots).
export function ValueChart({ history, collapsible = false }) {
  const { money, compact, signed } = usePortfolioPrivacy();
  const c = useChartColors();
  const [selected, setSelected] = useState(null);
  const [range, setRange] = useState('3M');
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;

  const days = RANGES.find(([k]) => k === range)[1];
  const h = useMemo(() => sliceHistory(history, days), [history, days]);
  const { dates, value, invested } = h;
  const n = value.length;
  const hasCost = invested.length === n && n > 0;
  const sel = selected != null && selected < n ? selected : n - 1;
  const gain = hasCost ? value[sel] - invested[sel] : null;
  // The stored history may not reach back as far as the range asks for (a week of slack, like the benchmark table).
  const lastDate = history.dates[history.dates.length - 1];
  const covers = history.dates.length > 0 && history.dates[0] <= addDaysISO(addDaysISO(lastDate, -days), 7);

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Portfolio Value"
        subtitle={hasCost ? 'Value against what you put in' : `Last ${range}`}
        summary={history.value.length ? `${formatShortDate(history.dates[history.dates.length - 1])}: ${money(history.value[history.value.length - 1])}` : null}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {!isOpen ? null : history.value.length < 2 ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50 mt-2">
          <Text className="font-body text-sm text-muted-text">Not enough NAV history yet.</Text>
        </View>
      ) : (
        <View className="mt-1">
          <PortfolioPills options={RANGES.map(([k]) => [k, k])} value={range} onChange={(k) => { setRange(k); setSelected(null); }} />
          <View className="mt-3">
            {n < 2 ? (
              <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50">
                <Text className="font-body text-sm text-muted-text">Not enough NAV history for {range}.</Text>
              </View>
            ) : (
              <LineChart
                series={[
                  ...(hasCost ? [{ key: 'invested', color: c.axis, width: 1.5, dash: '4 3', values: invested }] : []),
                  { key: 'value', color: c.gain, width: 2, values: value },
                ]}
                xLabels={[formatShortDate(dates[0]), formatShortDate(dates[n - 1])]}
                formatY={compact}
                selected={sel}
                onSelect={setSelected}
                labelOf={(i) => `${formatShortDate(dates[i])}: ${money(value[i])}`}
              />
            )}
          </View>
          {n >= 2 ? (
            <>
              <View className="flex-row flex-wrap items-center mt-2" style={{ gap: 12 }}>
                <View className="flex-row items-center gap-1.5">
                  <View style={{ width: 16, height: 2, backgroundColor: c.gain }} />
                  <Text className="font-body text-2xs text-muted-text">Value</Text>
                </View>
                {hasCost ? (
                  <View className="flex-row items-center gap-1.5">
                    <Svg width={16} height={4}>
                      <Line x1={0} y1={2} x2={16} y2={2} stroke={c.axis} strokeWidth={1.5} strokeDasharray="4 3" />
                    </Svg>
                    <Text className="font-body text-2xs text-muted-text">Put in</Text>
                  </View>
                ) : null}
              </View>
              <View className="mt-2 rounded-xl border border-ink/15 bg-paper-card px-3.5 py-2.5 self-start shadow-2xs">
                <Text className="font-body-semibold text-sm text-ink">{formatShortDate(dates[sel])}</Text>
                <Text className="font-mono-bold text-sm text-ink">{money(value[sel])}</Text>
                {hasCost ? (
                  <Text className="font-body text-xs text-muted-text">
                    Put in {money(invested[sel])} · <Text className={`font-mono-bold ${gainClass(gain)}`}>{signed(gain)}</Text>
                  </Text>
                ) : null}
              </View>
              {!covers ? <Text className="font-body text-2xs text-muted-text mt-2">NAV history here starts later than {range}, so this shows what is stored.</Text> : null}
              <Text className="font-body text-2xs text-muted-text mt-2">
                Put in is the cost of the units held. Between snapshots it is estimated from your SIP plan and recorded trades, and before the first snapshot it is held flat.
              </Text>
            </>
          ) : null}
        </View>
      )}
    </Card>
  );
}
