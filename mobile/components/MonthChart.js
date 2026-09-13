import { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';
import Card from './Card';
import { getLast6MonthsData, formatCurrency } from '../lib/utils';

const BAR_COLOR = '#3D7068';
const BAR_COLOR_DIM_OPACITY = 0.56;
const CHART_HEIGHT = 180;
const AXIS_LEFT = 34;
const AXIS_BOTTOM = 20;
const BAR_RADIUS = 4;

function yTick(v) {
  return `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`;
}

// Mirrors recharts' default "nice round numbers" tick generation for the Y
// axis (web never passes an explicit domain/tickCount, so recharts derives
// this itself) - without it the axis shows awkward fractional values like
// ₹1.8k instead of a clean ₹0/₹500/₹1k/₹1.5k/₹2k scale.
function niceTicks(maxValue, tickCount = 4) {
  if (maxValue <= 0) return [0];
  const rawStep = maxValue / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1;
  const step = niceResidual * magnitude;
  const niceMax = Math.ceil(maxValue / step) * step;
  const ticks = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

// A Rect only supports a uniform corner radius on all four sides, but web's
// bars are rounded on top and flush/square on the bottom (recharts
// radius={[6,6,0,0]}) - draw the outline directly instead.
function roundedTopBarPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  if (r <= 0) return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
  return [
    `M ${x} ${y + height}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `V ${y + height}`,
    'Z',
  ].join(' ');
}

// RN port of web's MonthChart.jsx. recharts has no RN equivalent, so this is
// a hand-rolled bar chart on react-native-svg - tap a bar for the same MoM
// tooltip web shows on hover.
export default function MonthChart({ entries, ledger }) {
  const data = useMemo(() => getLast6MonthsData(entries, ledger), [entries, ledger]);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(null);

  const latestMonth = data[data.length - 1];
  const hasSpend = data.some((d) => d.total > 0);
  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const ticks = niceTicks(maxTotal);
  const domainMax = ticks[ticks.length - 1] || 1;

  const plotWidth = Math.max(width - AXIS_LEFT, 0);
  const plotHeight = CHART_HEIGHT - AXIS_BOTTOM;
  const barSlot = data.length ? plotWidth / data.length : 0;
  const barWidth = Math.min(barSlot * 0.9, 40);

  const selectedDatum = selected != null ? data[selected] : null;

  return (
    <Card className="p-4 mb-4">
      <View className="flex-row items-center justify-between gap-2 mb-1">
        <View className="flex-1">
          <Text className="font-display text-lg text-ink">Monthly Spend (Last 6 Months)</Text>
          <Text className="font-body text-xs text-muted-text">Total spend month over month</Text>
        </View>
      </View>
      {latestMonth && latestMonth.total > 0 && (
        <View className="flex-row items-center gap-2 bg-paper px-3 py-1.5 rounded-xl border border-ink/10 self-start mb-3 mt-2">
          <Text className="font-body-medium text-xs text-muted-text">{latestMonth.label}:</Text>
          <Text className="font-mono-bold text-xs text-ink">{formatCurrency(latestMonth.total)}</Text>
          {latestMonth.prevTotal > 0 && (
            <View
              className={`px-1.5 py-0.5 rounded ${
                latestMonth.pctChange > 0 ? 'bg-stamp-red/15' : latestMonth.pctChange < 0 ? 'bg-ledger-green/15' : 'bg-ink/5'
              }`}
            >
              <Text
                className={`font-mono text-2xs ${
                  latestMonth.pctChange > 0 ? 'text-stamp-red' : latestMonth.pctChange < 0 ? 'text-ledger-green' : 'text-muted-text'
                }`}
              >
                {latestMonth.pctChange > 0 ? '▲ +' : latestMonth.pctChange < 0 ? '▼ ' : ''}
                {latestMonth.pctChange}%
              </Text>
            </View>
          )}
        </View>
      )}

      {!hasSpend ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50 mt-2">
          <Text className="font-body text-sm text-muted-text">No monthly spend data recorded yet.</Text>
        </View>
      ) : (
        <View className="mt-1">
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
            {width > 0 && (
              <Svg width={width} height={CHART_HEIGHT}>
                {ticks.map((t) => (
                  <SvgText
                    key={t}
                    x={AXIS_LEFT - 6}
                    y={plotHeight - (t / domainMax) * plotHeight + 3}
                    fontSize={9}
                    fill="#5C6478"
                    textAnchor="end"
                  >
                    {yTick(t)}
                  </SvgText>
                ))}
                <Line x1={AXIS_LEFT} y1={plotHeight} x2={width} y2={plotHeight} stroke="#24304A" strokeOpacity={0.125} strokeWidth={1} />
                {data.map((d, i) => {
                  const barH = domainMax > 0 ? (d.total / domainMax) * plotHeight : 0;
                  const x = AXIS_LEFT + i * barSlot + (barSlot - barWidth) / 2;
                  const y = plotHeight - Math.max(barH, d.total > 0 ? 1 : 0);
                  const isLatest = i === data.length - 1;
                  return (
                    <Path
                      key={d.month}
                      d={roundedTopBarPath(x, y, barWidth, Math.max(barH, d.total > 0 ? 1 : 0), BAR_RADIUS)}
                      fill={BAR_COLOR}
                      fillOpacity={isLatest ? 1 : BAR_COLOR_DIM_OPACITY}
                      onPress={() => setSelected(selected === i ? null : i)}
                    />
                  );
                })}
                {data.map((d, i) => {
                  const x = AXIS_LEFT + i * barSlot + barSlot / 2;
                  return (
                    <SvgText key={d.month} x={x} y={CHART_HEIGHT - 4} fontSize={10} fontWeight="500" fill="#5C6478" textAnchor="middle">
                      {d.label}
                    </SvgText>
                  );
                })}
              </Svg>
            )}
          </View>

          {selectedDatum && (
            <View className="mt-2 rounded-xl bg-paper-card border border-ink/15 px-3.5 py-2.5 self-start">
              <Text className="font-body-semibold text-sm text-ink mb-1">{selectedDatum.label}</Text>
              <Text className="font-body-medium text-xs text-muted-text">
                Total Spend: <Text className="font-mono-bold text-sm text-ink">{formatCurrency(selectedDatum.total)}</Text>
              </Text>
              {selectedDatum.prevTotal > 0 ? (
                <View className="flex-row items-center gap-1 mt-1">
                  <Text className="font-body text-xs text-muted-text">MoM:</Text>
                  <View
                    className={`px-1.5 py-0.5 rounded ${
                      selectedDatum.pctChange > 0 ? 'bg-stamp-red/15' : selectedDatum.pctChange < 0 ? 'bg-ledger-green/15' : 'bg-ink/5'
                    }`}
                  >
                    <Text
                      className={`font-mono text-2xs ${
                        selectedDatum.pctChange > 0 ? 'text-stamp-red' : selectedDatum.pctChange < 0 ? 'text-ledger-green' : 'text-muted-text'
                      }`}
                    >
                      {selectedDatum.pctChange > 0 ? '▲ +' : selectedDatum.pctChange < 0 ? '▼ ' : ''}
                      {selectedDatum.pctChange}% vs prev month
                    </Text>
                  </View>
                </View>
              ) : (
                <Text className="font-body text-2xs text-muted-text mt-1">No spend recorded in prior month</Text>
              )}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
