import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Card from './Card';
import FoldHeader from './FoldHeader';
import PortfolioPills from './PortfolioPills';
import { useChartColors } from './PortfolioLineChart';
import { MAX_DONUT_SIZE, MIN_DONUT_SIZE, OUTER_R_RATIO, INNER_R_RATIO, PAD_DEG, donutSlicePath } from './donut';
import { computeAllocation } from '../lib/portfolio';
import { CATEGORY_COLORS } from '../lib/utils';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

const VIEWS = [
  ['category', 'Category'],
  ['amc', 'Fund House'],
  ['fund', 'Fund'],
];

// What the portfolio is made of, as a donut you can switch between category, fund house and fund. Tapping a legend row
// (not a slice: a press on an SVG shape does not work on the website) lights up its slice and dims the rest.
export default function PortfolioAllocation({ rows, collapsible = false, defaultOpen = false }) {
  const { money, compact } = usePortfolioPrivacy();
  const c = useChartColors();
  const [by, setBy] = useState('category');
  const [picked, setPicked] = useState(null);
  const [openState, setOpenState] = useState(defaultOpen);
  const [cardWidth, setCardWidth] = useState(0);
  const isOpen = !collapsible || openState;

  const slices = useMemo(() => computeAllocation(rows, by), [rows, by]);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const colorOf = (s, i) => (s.label === 'Others' && s.others ? c.axis : CATEGORY_COLORS[i % CATEGORY_COLORS.length]);

  const size = cardWidth > 0 ? Math.max(MIN_DONUT_SIZE, Math.min(cardWidth - 32, MAX_DONUT_SIZE)) : MIN_DONUT_SIZE;
  const outerR = size * OUTER_R_RATIO;
  const innerR = size * INNER_R_RATIO;
  const center = size / 2;
  const arcs = slices.map((s, i) => {
    const from = (slices.slice(0, i).reduce((a, x) => a + x.pct, 0) / 100) * 360;
    const raw = (s.pct / 100) * 360;
    const inset = slices.length > 1 ? Math.min(PAD_DEG / 2, raw / 2) : 0;
    return { s, i, start: from + inset, end: from + raw - inset };
  });
  const sel = picked != null && picked < slices.length ? picked : null;
  const lead = slices[0];

  return (
    <Card className="p-4 mb-4" onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
      <FoldHeader
        title="Allocation"
        subtitle="What your money is in"
        summary={lead ? `${lead.label} ${Math.round(lead.pct)}%` : null}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {!isOpen ? null : slices.length === 0 ? (
        <Text className="font-body text-sm text-muted-text">No holdings to show yet.</Text>
      ) : (
        <View>
          <PortfolioPills options={VIEWS} value={by} onChange={(k) => { setBy(k); setPicked(null); }} />
          <View className="items-center justify-center mt-3" style={{ height: size }}>
            <Svg width={size} height={size}>
              {arcs.map(({ s, i, start, end }) => (
                <Path key={s.label} d={donutSlicePath(center, center, innerR, outerR, start, end)} fill={colorOf(s, i)} fillOpacity={sel == null || sel === i ? 1 : 0.35} />
              ))}
            </Svg>
            <View className="absolute inset-0 items-center justify-center" style={{ pointerEvents: 'none' }}>
              <View className="items-center px-2" style={{ maxWidth: size * 0.38 }}>
                <Text className="font-mono-bold text-ink text-center text-lg">{sel != null ? `${slices[sel].pct.toFixed(1)}%` : compact(total)}</Text>
                <Text className="font-body-medium text-2xs text-muted-text uppercase tracking-wider text-center" numberOfLines={1}>
                  {sel != null ? slices[sel].label : 'Total'}
                </Text>
              </View>
            </View>
          </View>

          <View className="mt-3 pt-2 border-t border-ink/10">
            {slices.map((s, i) => (
              <Pressable
                key={s.label}
                onPress={() => setPicked((cur) => (cur === i ? null : i))}
                accessibilityRole="button"
                accessibilityLabel={`${s.label}: ${s.pct.toFixed(1)} percent`}
                className={`flex-row items-center justify-between py-2 px-1.5 rounded-lg ${sel === i ? 'bg-ink/5' : ''}`}
              >
                <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(s, i) }} />
                  <Text className="font-body-semibold text-sm text-ink flex-1" numberOfLines={1}>{s.label}</Text>
                </View>
                <View className="flex-row items-center gap-3 shrink-0">
                  <Text className="font-mono text-xs text-muted-text">{money(s.value)}</Text>
                  <Text className="font-mono-bold text-sm text-ink" style={{ minWidth: 48, textAlign: 'right' }}>{s.pct.toFixed(1)}%</Text>
                </View>
              </Pressable>
            ))}
            {sel != null && slices[sel].others ? (
              <Text className="font-body text-2xs text-muted-text mt-1 px-1.5">Others: {slices[sel].others.join(', ')}.</Text>
            ) : null}
          </View>
        </View>
      )}
    </Card>
  );
}
