import { useState } from 'react';
import { useColorScheme } from 'nativewind';
import { View, Pressable } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { themeColor } from '../lib/theme';

export const CHART_HEIGHT = 180;
export const AXIS_LEFT = 46;
export const AXIS_BOTTOM = 20;
const RIGHT_PAD = 6;

export function useChartColors() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    gain: themeColor('ledgerGreen', isDark),
    loss: themeColor('stampRed', isDark),
    axis: themeColor('mutedText', isDark),
    base: themeColor('ink', isDark),
    mustard: themeColor('mustard', isDark),
  };
}

// Taps go on invisible columns over the chart, not on the SVG shapes (react-native-svg can't take a press on a
// shape on the website).
export function TapColumns({ n, left, slot, height, onPick, labelOf }) {
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

// One chart for every Portfolio line graph: several series sharing the same x positions (a date, a year), a value
// axis labelled at its top and bottom (and at 0 when `zeroLine` and the lines cross it), the first and last x labels,
// a faint guide and a dot on the selected point. A series is { key, color, values: [number | null], width?, dash? }; a null
// breaks the line. `formatY` makes every axis label, so Hide Amounts only has to mask it there.
export default function LineChart({ series, xLabels, formatY, selected, onSelect, labelOf, zeroLine = false, height = CHART_HEIGHT }) {
  const c = useChartColors();
  const [width, setWidth] = useState(0);
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  if (zeroLine) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const plotW = Math.max(width - AXIS_LEFT - RIGHT_PAD, 0);
  const plotH = height - AXIS_BOTTOM;
  const x = (i) => AXIS_LEFT + (n > 1 ? (plotW * i) / (n - 1) : 0);
  const y = (v) => plotH - ((v - min) / (max - min)) * plotH;
  const slot = n > 1 ? plotW / (n - 1) : plotW;
  const sel = selected != null && selected < n ? selected : null;
  const ticks = [hi, ...(zeroLine && lo < 0 && hi > 0 ? [0] : []), lo];
  const draw = (values) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {ticks.map((t) => (
            <SvgText key={t} x={AXIS_LEFT - 6} y={Math.min(Math.max(y(t) + 3, 9), plotH)} fontSize={9} fill={c.axis} textAnchor="end">{formatY(t)}</SvgText>
          ))}
          <Line x1={AXIS_LEFT} y1={plotH} x2={width - RIGHT_PAD} y2={plotH} stroke={c.base} strokeOpacity={0.125} strokeWidth={1} />
          {zeroLine && lo < 0 && hi > 0 ? <Line x1={AXIS_LEFT} y1={y(0)} x2={width - RIGHT_PAD} y2={y(0)} stroke={c.base} strokeOpacity={0.25} strokeWidth={1} /> : null}
          {sel != null ? <Line x1={x(sel)} y1={0} x2={x(sel)} y2={plotH} stroke={c.base} strokeOpacity={0.15} strokeWidth={1} /> : null}
          {series.map((s) => (
            <Path key={s.key} d={draw(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2} strokeDasharray={s.dash || undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {sel != null
            ? series.map((s) => (s.values[sel] != null ? <Circle key={s.key} cx={x(sel)} cy={y(s.values[sel])} r={3.5} fill={s.color} /> : null))
            : null}
          <SvgText x={AXIS_LEFT} y={height - 4} fontSize={10} fill={c.axis}>{xLabels[0]}</SvgText>
          <SvgText x={width - RIGHT_PAD} y={height - 4} fontSize={10} fill={c.axis} textAnchor="end">{xLabels[1]}</SvgText>
        </Svg>
      )}
      {width > 0 && n > 0 && (
        <TapColumns n={n} left={AXIS_LEFT - slot / 2} slot={slot} height={plotH} onPick={onSelect} labelOf={labelOf} />
      )}
    </View>
  );
}
