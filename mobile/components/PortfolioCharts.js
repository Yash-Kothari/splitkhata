import { useState } from 'react';
import { useColorScheme } from 'nativewind';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import Card from './Card';
import FoldHeader from './FoldHeader';
import { formatShortDate } from '../lib/portfolio';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { themeColor } from '../lib/theme';
import { gainClass } from './PortfolioSummary';

const CHART_HEIGHT = 180;
const AXIS_LEFT = 46;
const AXIS_BOTTOM = 20;

// A tidy symmetric limit for the daily bars (1, 2, 5 x a power of ten), so the axis reads as round numbers.
function niceLimit(maxAbs) {
  if (maxAbs <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(maxAbs));
  const r = maxAbs / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
}

function useChartColors() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    gain: themeColor('ledgerGreen', isDark),
    loss: themeColor('stampRed', isDark),
    axis: themeColor('mutedText', isDark),
    base: themeColor('ink', isDark),
  };
}

// Taps go on invisible columns over the chart, not on the SVG shapes (react-native-svg can't take a press on a
// shape on the website).
function TapColumns({ n, left, slot, height, onPick, labelOf }) {
  return Array.from({ length: n }, (_, i) => (
    <Pressable
      key={i}
      onPress={() => onPick(i)}
      accessibilityRole="button"
      accessibilityLabel={labelOf(i)}
      style={{ position: 'absolute', left: left + i * slot, top: 0, width: slot, height, cursor: 'pointer' }}
    />
  ));
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

export function ValueChart({ history, collapsible = false }) {
  const { money, compact } = usePortfolioPrivacy();
  const c = useChartColors();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(null);
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;

  const { dates, value } = history;
  const n = value.length;
  const lo = n ? Math.min(...value) : 0;
  const hi = n ? Math.max(...value) : 1;
  const pad = (hi - lo) * 0.08 || hi * 0.01 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const plotW = Math.max(width - AXIS_LEFT, 0);
  const plotH = CHART_HEIGHT - AXIS_BOTTOM;
  const x = (i) => AXIS_LEFT + (n > 1 ? (plotW * i) / (n - 1) : 0);
  const y = (v) => plotH - ((v - min) / (max - min)) * plotH;
  const sel = selected != null && selected < n ? selected : n - 1;
  const slot = n ? plotW / n : 0;

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Portfolio Value"
        subtitle="Last 90 days"
        summary={n ? `${formatShortDate(dates[n - 1])}: ${money(value[n - 1])}` : null}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {!isOpen ? null : n < 2 ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50 mt-2">
          <Text className="font-body text-sm text-muted-text">Not enough NAV history yet.</Text>
        </View>
      ) : (
        <View className="mt-1">
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
            {width > 0 && (
              <Svg width={width} height={CHART_HEIGHT}>
                <SvgText x={AXIS_LEFT - 6} y={10} fontSize={9} fill={c.axis} textAnchor="end">{compact(hi)}</SvgText>
                <SvgText x={AXIS_LEFT - 6} y={plotH} fontSize={9} fill={c.axis} textAnchor="end">{compact(lo)}</SvgText>
                <Line x1={AXIS_LEFT} y1={plotH} x2={width} y2={plotH} stroke={c.base} strokeOpacity={0.125} strokeWidth={1} />
                <Path d={value.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} fill="none" stroke={c.gain} strokeWidth={2} />
                <Circle cx={x(sel)} cy={y(value[sel])} r={4} fill={c.gain} />
                <SvgText x={AXIS_LEFT} y={CHART_HEIGHT - 4} fontSize={10} fill={c.axis}>{formatShortDate(dates[0])}</SvgText>
                <SvgText x={width} y={CHART_HEIGHT - 4} fontSize={10} fill={c.axis} textAnchor="end">{formatShortDate(dates[n - 1])}</SvgText>
              </Svg>
            )}
            {width > 0 && (
              <TapColumns
                n={n}
                left={AXIS_LEFT - slot / 2}
                slot={slot}
                height={plotH}
                onPick={setSelected}
                labelOf={(i) => `${formatShortDate(dates[i])}: ${money(value[i])}`}
              />
            )}
          </View>
          <View className="mt-2 rounded-xl border border-ink/15 bg-paper-card px-3.5 py-2.5 self-start shadow-2xs">
            <Text className="font-body-semibold text-sm text-ink">{formatShortDate(dates[sel])}</Text>
            <Text className="font-mono-bold text-sm text-ink">{money(value[sel])}</Text>
          </View>
        </View>
      )}
    </Card>
  );
}
