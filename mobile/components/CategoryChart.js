import { useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, Platform, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Card from './Card';
import PickerField from './PickerField';
import { MAX_DONUT_SIZE, MIN_DONUT_SIZE, OUTER_R_RATIO, INNER_R_RATIO, PAD_DEG, donutSlicePath } from './donut';
import {
  getCategoryMoMComparison,
  getCategoryEntries,
  formatMonthLabel,
  formatCurrency,
  computeBudgetStatus,
  CATEGORY_COLORS,
  DEFAULT_CATEGORIES as CATEGORIES,
} from '../lib/utils';

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
                {isTravel ? 'Whole trip' : selectedMonth === 'all' ? 'All months' : formatMonthLabel(selectedMonth)} · {formatCurrency(total, currency)} total
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
export default function CategoryChart({ entries, selectedMonth, onMonthChange, availableMonths, ledger, budgets = {}, collapsible = false }) {
  // The passbook's "All Months" choice is shared with this chart: treat it as
  // no month filter. It used to be passed through as the month 'all', which
  // matched nothing - an empty donut captioned "Invalid Date".
  const monthKey = selectedMonth === 'all' ? null : selectedMonth;
  const monthLabel = monthKey ? formatMonthLabel(monthKey) : 'all months';
  const isTravel = ledger === 'travel';
  const data = useMemo(
    () => getCategoryMoMComparison(entries, isTravel ? null : monthKey, ledger).sort((a, b) => b.amount - a.amount),
    [entries, selectedMonth, ledger, isTravel],
  );
  const total = useMemo(() => data.reduce((sum, d) => sum + d.amount, 0), [data]);
  // Money received can leave a category net negative; a donut can only draw what was spent, so the
  // slices and percentages use the positive categories while the centre and legend show the net.
  const spentTotal = useMemo(() => data.reduce((sum, d) => sum + Math.max(d.amount, 0), 0), [data]);
  const currency = 'INR';
  const totalLabel = formatCurrency(total, currency);

  // On a phone the chart sits between Add Entry and the passbook, folded to a
  // one-line summary so it doesn't push the entries down a full screen.
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;
  const topSummary = data
    .slice(0, 2)
    .filter((d) => d.amount > 0)
    .map((d) => `${d.category} ${spentTotal > 0 ? Math.round((d.amount / spentTotal) * 100) : 0}%`)
    .join(', ');

  const [cardWidth, setCardWidth] = useState(0);
  const donutSize = cardWidth > 0 ? Math.max(MIN_DONUT_SIZE, Math.min(cardWidth - 32, MAX_DONUT_SIZE)) : MIN_DONUT_SIZE;
  const outerR = donutSize * OUTER_R_RATIO;
  const innerR = donutSize * INNER_R_RATIO;
  const center = donutSize / 2;

  const [selectedCategory, setSelectedCategory] = useState(null);
  const drilldownEntries = useMemo(
    () => (selectedCategory ? getCategoryEntries(entries, isTravel ? null : monthKey, ledger, selectedCategory) : []),
    [entries, isTravel, selectedMonth, ledger, selectedCategory],
  );
  const budgetStatus = useMemo(() => {
    if (!selectedCategory || !budgets?.[selectedCategory]) return null;
    const [status] = computeBudgetStatus(data, { [selectedCategory]: budgets[selectedCategory] });
    return status || null;
  }, [selectedCategory, budgets, data]);

  // Tapping a donut slice opens the drill-down on the phone. On the website
  // react-native-svg can't take a press on an SVG shape (it logs "Unknown event
  // handler" and ignores it), so there the legend rows below are the way in.
  const sliceProps = (category) => (Platform.OS === 'web' ? {} : { onPress: () => setSelectedCategory(category) });

  let cursor = 0;
  const spentTotalCount = data.filter((d) => d.amount > 0).length;
  const slices = data.filter((d) => d.amount > 0).map((entry) => {
    const rawAngle = spentTotal > 0 ? (entry.amount / spentTotal) * 360 : 0;
    const startAngle = cursor;
    const endAngle = cursor + rawAngle;
    cursor = endAngle;
    const gap = spentTotalCount > 1 ? PAD_DEG / 2 : 0;
    const inset = Math.min(gap, rawAngle / 2);
    return { entry, startAngle: startAngle + inset, endAngle: endAngle - inset };
  });

  return (
    <Card className="p-4 mb-4" onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
      <Pressable
        disabled={!collapsible}
        onPress={() => setOpenState((v) => !v)}
        className={`flex-row items-center justify-between gap-2 ${isOpen ? 'mb-3' : ''}`}
      >
        <View className="flex-1">
          <Text className="font-display text-lg text-ink">Category Breakdown</Text>
          <Text className="font-body text-xs text-muted-text" numberOfLines={1}>
            {isOpen || data.length === 0
              ? isTravel
                ? 'Spend by category'
                : 'Monthly spend & MoM comparison'
              : `${totalLabel}${topSummary ? ` · ${topSummary}` : ''}`}
          </Text>
        </View>
        {collapsible && (
          <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
            <Text className="font-body-semibold text-xs text-muted-text">{isOpen ? 'Collapse' : 'Expand'}</Text>
          </View>
        )}
        {!isTravel && isOpen && (
          <View style={{ width: 150 }}>
            <PickerField
              value={selectedMonth}
              options={[{ value: 'all', label: 'All Months' }, ...availableMonths.map((m) => ({ value: m, label: formatMonthLabel(m) }))]}
              onChange={onMonthChange}
              label="Month"
            />
          </View>
        )}
      </Pressable>

      {!isOpen ? null : data.length === 0 ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50">
          <Text className="font-body text-sm text-muted-text text-center px-4">
            {isTravel ? 'No expenses recorded yet.' : `No expenses recorded in ${monthLabel}.`}
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
                    {...sliceProps(entry.category)}
                  />
                );
              })}
            </Svg>
            <View className="absolute inset-0 items-center justify-center" style={{ pointerEvents: 'none' }}>
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
