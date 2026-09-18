import { useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Card from './Card';
import PickerField from './PickerField';
import {
  getCategoryMoMComparison,
  getCategoryEntries,
  formatMonthLabel,
  formatCurrency,
  computeBudgetStatus,
  CATEGORY_COLORS,
  DEFAULT_CATEGORIES as CATEGORIES,
} from '../lib/utils';

// Web's donut is fluid (recharts ResponsiveContainer inside a h-56/224px
// container, outerRadius 85%) rather than a fixed pixel size - fixed at
// 190px here made mobile's chart visibly smaller than web's once the two
// charts sit side by side on a wide screen (lg:grid-cols-2). Sized from the
// card's actual measured width instead, capped at web's own 224px ceiling,
// keeping the same 0.432/0.279 outer/inner radius ratios either way.
const MAX_DONUT_SIZE = 224;
const MIN_DONUT_SIZE = 160;
const OUTER_R_RATIO = 82 / 190;
const INNER_R_RATIO = 53 / 190;
const PAD_DEG = 2;

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlicePath(cx, cy, innerR, outerR, startAngle, rawEndAngle) {
  // A sweep of exactly 360deg (a single category holding the whole total)
  // puts the arc's start and end points on the same coordinate, which SVG
  // renders as a zero-length degenerate path instead of a full ring - clamp
  // just short of a full turn so the two points stay distinct.
  const endAngle = rawEndAngle - startAngle >= 360 ? startAngle + 359.99 : rawEndAngle;
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const startInner = polarToCartesian(cx, cy, innerR, startAngle);
  const endInner = polarToCartesian(cx, cy, innerR, endAngle);
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

function CategoryDrilldownModal({ category, entries, currency, isTravel, selectedMonth, budgetStatus, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const total = entries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const biggest = entries[0];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-2.5" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper-card border border-ink/15 overflow-hidden"
          style={{ maxWidth: 420, maxHeight: Math.round(windowHeight * 0.8) }}
        >
          <View className="px-4 py-3.5 border-b border-ink/10 flex-row items-center justify-between bg-paper/60">
            <View className="flex-1 pr-2">
              <Text className="font-display text-base text-ink" numberOfLines={1}>{category}</Text>
              <Text className="font-body text-xs text-muted-text">
                {isTravel ? 'Whole trip' : formatMonthLabel(selectedMonth)} · {formatCurrency(total, currency)} total
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} className="w-8 h-8 rounded-full border border-ink/15 bg-paper items-center justify-center shrink-0">
              <Text className="font-bold text-ink">✕</Text>
            </Pressable>
          </View>

          <ScrollView className="px-4 py-4" contentContainerStyle={{ gap: 12 }}>
            {budgetStatus && (
              <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-3">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">Budget</Text>
                  <Text className="font-body text-xs text-muted-text">{Math.round(budgetStatus.pctUsed * 100)}%</Text>
                </View>
                <View className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden mb-1">
                  <View
                    className={`h-full rounded-full ${
                      budgetStatus.pctUsed >= 1 ? 'bg-stamp-red' : budgetStatus.pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green'
                    }`}
                    style={{ width: `${Math.min(budgetStatus.pctUsed * 100, 100)}%` }}
                  />
                </View>
                <Text className="font-body text-xs text-muted-text">
                  {formatCurrency(budgetStatus.spent, currency)} of {formatCurrency(budgetStatus.limit, currency)}
                </Text>
              </View>
            )}

            {biggest && (
              <View className="rounded-xl border border-ledger-green/30 bg-ledger-green/10 px-3.5 py-3">
                <Text className="font-body-semibold text-2xs uppercase tracking-wider text-ledger-green mb-1">Biggest expense</Text>
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1 min-w-0">
                    <Text className="font-body-semibold text-sm text-ink" numberOfLines={1}>{biggest.note || 'No note'}</Text>
                    <Text className="font-body text-xs text-muted-text">{biggest.date} · Paid by {biggest.payer}</Text>
                  </View>
                  <Text className="font-mono-bold text-sm text-ink shrink-0">{formatCurrency(biggest.amount, currency)}</Text>
                </View>
              </View>
            )}

            {entries.length > 1 &&
              entries.slice(1).map((entry) => (
                <View key={entry.id} className="flex-row items-center justify-between gap-3 py-1">
                  <View className="flex-1 min-w-0">
                    <Text className="font-body text-sm text-ink" numberOfLines={1}>{entry.note || 'No note'}</Text>
                    <Text className="font-body text-xs text-muted-text">{entry.date} · Paid by {entry.payer}</Text>
                  </View>
                  <Text className="font-mono text-sm text-ink shrink-0">{formatCurrency(entry.amount, currency)}</Text>
                </View>
              ))}

            {entries.length === 0 && (
              <Text className="font-body text-sm text-muted-text text-center py-6">No expenses found for this category.</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// RN port of web's CategoryChart.jsx. recharts' PieChart has no RN
// equivalent, so the donut is hand-drawn on react-native-svg (annular
// sectors via SVG arc paths) - tapping a slice or a legend row opens the
// same drilldown modal web opens on click.
export default function CategoryChart({ entries, selectedMonth, onMonthChange, availableMonths, ledger, budgets = {} }) {
  const isTravel = ledger === 'travel';
  const data = useMemo(
    () => getCategoryMoMComparison(entries, isTravel ? null : selectedMonth, ledger).sort((a, b) => b.amount - a.amount),
    [entries, selectedMonth, ledger, isTravel],
  );
  const total = useMemo(() => data.reduce((sum, d) => sum + d.amount, 0), [data]);
  const currency = 'INR';
  const totalLabel = formatCurrency(total, currency);

  const [cardWidth, setCardWidth] = useState(0);
  const donutSize = cardWidth > 0 ? Math.max(MIN_DONUT_SIZE, Math.min(cardWidth - 32, MAX_DONUT_SIZE)) : MIN_DONUT_SIZE;
  const outerR = donutSize * OUTER_R_RATIO;
  const innerR = donutSize * INNER_R_RATIO;
  const center = donutSize / 2;

  const [selectedCategory, setSelectedCategory] = useState(null);
  const drilldownEntries = useMemo(
    () => (selectedCategory ? getCategoryEntries(entries, isTravel ? null : selectedMonth, ledger, selectedCategory) : []),
    [entries, isTravel, selectedMonth, ledger, selectedCategory],
  );
  const budgetStatus = useMemo(() => {
    if (!selectedCategory || !budgets?.[selectedCategory]) return null;
    const [status] = computeBudgetStatus(data, { [selectedCategory]: budgets[selectedCategory] });
    return status || null;
  }, [selectedCategory, budgets, data]);

  let cursor = 0;
  const slices = data.map((entry) => {
    const rawAngle = total > 0 ? (entry.amount / total) * 360 : 0;
    const startAngle = cursor;
    const endAngle = cursor + rawAngle;
    cursor = endAngle;
    const gap = data.length > 1 ? PAD_DEG / 2 : 0;
    const inset = Math.min(gap, rawAngle / 2);
    return { entry, startAngle: startAngle + inset, endAngle: endAngle - inset };
  });

  return (
    <Card className="p-4 mb-4" onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
      <View className="flex-row items-center justify-between gap-2 mb-3">
        <View className="flex-1">
          <Text className="font-display text-lg text-ink">Category Breakdown</Text>
          <Text className="font-body text-xs text-muted-text">{isTravel ? 'Spend by category' : 'Monthly spend & MoM comparison'}</Text>
        </View>
        {!isTravel && (
          <View style={{ width: 150 }}>
            <PickerField
              value={selectedMonth}
              options={availableMonths.map((m) => ({ value: m, label: formatMonthLabel(m) }))}
              onChange={onMonthChange}
              label="Month"
            />
          </View>
        )}
      </View>

      {data.length === 0 ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50">
          <Text className="font-body text-sm text-muted-text text-center px-4">
            {isTravel ? 'No expenses recorded yet.' : `No expenses recorded in ${formatMonthLabel(selectedMonth)}.`}
          </Text>
        </View>
      ) : (
        <>
          <View className="items-center justify-center" style={{ height: donutSize }}>
            <Svg width={donutSize} height={donutSize}>
              {slices.map(({ entry, startAngle, endAngle }, index) => {
                const idx = CATEGORIES.indexOf(entry.category);
                const colorIndex = idx >= 0 ? idx : index;
                const color = CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length];
                return (
                  <Path
                    key={entry.category}
                    d={donutSlicePath(center, center, innerR, outerR, startAngle, endAngle)}
                    fill={color}
                    onPress={() => setSelectedCategory(entry.category)}
                  />
                );
              })}
            </Svg>
            <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
              <View className="items-center px-2" style={{ maxWidth: donutSize * 0.38 }}>
                <Text
                  className={`font-mono-bold text-ink text-center ${totalLabel.length > 12 ? 'text-xs' : totalLabel.length > 9 ? 'text-sm' : 'text-lg'}`}
                >
                  {totalLabel}
                </Text>
                <Text className="font-body-medium text-2xs text-muted-text uppercase tracking-wider">Total</Text>
              </View>
            </View>
          </View>

          <View className="mt-4 pt-3 border-t border-ink/10">
            <View className="flex-row items-center justify-between mb-2 px-1">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">Category</Text>
              <View className="flex-row items-center gap-3">
                <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">Amount</Text>
                {!isTravel && <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text" style={{ minWidth: 56, textAlign: 'right' }}>MoM %</Text>}
              </View>
            </View>

            {data.map((entry, index) => {
              const idx = CATEGORIES.indexOf(entry.category);
              const colorIndex = idx >= 0 ? idx : index;
              const color = CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length];
              const isIncreased = entry.pctChange > 0;
              const isDecreased = entry.pctChange < 0;
              return (
                <Pressable
                  key={entry.category}
                  onPress={() => setSelectedCategory(entry.category)}
                  className="flex-row items-center justify-between py-2 px-1.5 rounded-lg"
                >
                  <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
                    <Text className="font-body-semibold text-sm text-ink flex-1" numberOfLines={1}>{entry.category}</Text>
                  </View>
                  <View className="flex-row items-center gap-2 shrink-0">
                    <Text className="font-mono-bold text-sm text-ink">{formatCurrency(entry.amount, currency)}</Text>
                    {!isTravel && (
                      <View style={{ minWidth: 56, alignItems: 'flex-end' }}>
                        {entry.prevAmount > 0 ? (
                          <View className={`px-1.5 py-0.5 rounded ${isIncreased ? 'bg-stamp-red/15' : isDecreased ? 'bg-ledger-green/15' : 'bg-ink/5'}`}>
                            <Text className={`font-mono text-2xs ${isIncreased ? 'text-stamp-red' : isDecreased ? 'text-ledger-green' : 'text-muted-text'}`}>
                              {isIncreased ? '▲ +' : isDecreased ? '▼ ' : ''}{entry.pctChange}%
                            </Text>
                          </View>
                        ) : entry.isNew ? (
                          <View className="px-1.5 py-0.5 rounded bg-mustard/15">
                            <Text className="font-body-semibold text-2xs text-mustard">New</Text>
                          </View>
                        ) : (
                          <Text className="font-mono text-2xs text-muted-text">-</Text>
                        )}
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {selectedCategory && (
        <CategoryDrilldownModal
          category={selectedCategory}
          entries={drilldownEntries}
          currency={currency}
          isTravel={isTravel}
          selectedMonth={selectedMonth}
          budgetStatus={budgetStatus}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </Card>
  );
}
