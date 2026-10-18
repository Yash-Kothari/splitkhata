import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Card from './Card';
import { MAX_DONUT_SIZE, MIN_DONUT_SIZE, OUTER_R_RATIO, INNER_R_RATIO, PAD_DEG, donutSlicePath } from './donut';
import { groupByPaymentMethod, formatCurrency, CATEGORY_COLORS } from '../lib/utils';

// How the money was paid - cash, each card, UPI - as a donut with a legend. It counts exactly what
// the Category Breakdown counts, so the two totals match. `collapsible` folds it to a one-line
// summary on a phone, like the Category Breakdown.
export default function PaymentMethodChart({ entries, ledger, collapsible = false }) {
  const data = useMemo(() => groupByPaymentMethod(entries, null, ledger), [entries, ledger]);
  const total = useMemo(() => data.reduce((sum, d) => sum + d.amount, 0), [data]);
  // Money received can leave a method net negative; a donut only draws what was spent, so slices and
  // percentages use the positive methods while the centre total and the legend show the net.
  const spentTotal = useMemo(() => data.reduce((sum, d) => sum + Math.max(d.amount, 0), 0), [data]);
  const spentMethods = useMemo(() => data.filter((d) => d.amount > 0), [data]);
  const totalLabel = formatCurrency(total, 'INR');
  const percent = (amount) => (spentTotal > 0 ? Math.round((amount / spentTotal) * 100) : 0);

  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;
  const topSummary = spentMethods
    .slice(0, 2)
    .map((d) => `${d.method} ${percent(d.amount)}%`)
    .join(', ');

  const [cardWidth, setCardWidth] = useState(0);
  const donutSize = cardWidth > 0 ? Math.max(MIN_DONUT_SIZE, Math.min(cardWidth - 32, MAX_DONUT_SIZE)) : MIN_DONUT_SIZE;
  const outerR = donutSize * OUTER_R_RATIO;
  const innerR = donutSize * INNER_R_RATIO;
  const center = donutSize / 2;

  const slices = spentMethods.reduce((acc, entry) => {
    const startAngle = acc.length ? acc[acc.length - 1].rawEnd : 0;
    const rawEnd = startAngle + (spentTotal > 0 ? (entry.amount / spentTotal) * 360 : 0);
    const inset = Math.min(spentMethods.length > 1 ? PAD_DEG / 2 : 0, (rawEnd - startAngle) / 2);
    acc.push({ entry, rawEnd, startAngle: startAngle + inset, endAngle: rawEnd - inset });
    return acc;
  }, []);

  return (
    <Card className="p-4 mb-4" onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
      <Pressable
        disabled={!collapsible}
        onPress={() => setOpenState((v) => !v)}
        className={`flex-row items-center justify-between gap-2 ${isOpen ? 'mb-3' : ''}`}
      >
        <View className="flex-1">
          <Text className="font-display text-lg text-ink">By Payment Method</Text>
          <Text className="font-body text-xs text-muted-text" numberOfLines={1}>
            {isOpen || data.length === 0 ? 'Spend by how it was paid' : `${totalLabel}${topSummary ? ` · ${topSummary}` : ''}`}
          </Text>
        </View>
        {collapsible && (
          <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
            <Text className="font-body-semibold text-xs text-muted-text">{isOpen ? 'Collapse' : 'Expand'}</Text>
          </View>
        )}
      </Pressable>

      {!isOpen ? null : data.length === 0 ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-10 items-center justify-center bg-paper/50">
          <Text className="font-body text-sm text-muted-text text-center px-4">No expenses recorded yet.</Text>
        </View>
      ) : (
        <>
          <View className="items-center justify-center" style={{ height: donutSize }}>
            <Svg width={donutSize} height={donutSize}>
              {slices.map(({ entry, startAngle, endAngle }, index) => (
                <Path
                  key={entry.method}
                  d={donutSlicePath(center, center, innerR, outerR, startAngle, endAngle)}
                  fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                />
              ))}
            </Svg>
            <View className="absolute inset-0 items-center justify-center" style={{ pointerEvents: 'none' }}>
              <View className="items-center px-2" style={{ maxWidth: donutSize * 0.38 }}>
                <Text className={`font-mono-bold text-ink text-center ${totalLabel.length > 12 ? 'text-xs' : totalLabel.length > 9 ? 'text-sm' : 'text-lg'}`}>
                  {totalLabel}
                </Text>
                <Text className="font-body-medium text-2xs text-muted-text uppercase tracking-wider">Total</Text>
              </View>
            </View>
          </View>

          <View className="mt-4 pt-3 border-t border-ink/10">
            <View className="flex-row items-center justify-between mb-2 px-1">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">Paid With</Text>
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">Amount</Text>
            </View>
            {data.map((entry, index) => (
              <View key={entry.method} className="flex-row items-center justify-between py-2 px-1.5">
                <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
                  <View className="flex-1 min-w-0">
                    <Text className="font-body-semibold text-sm text-ink" numberOfLines={1}>{entry.method}</Text>
                    <Text className="font-body text-2xs text-muted-text">
                      {entry.count} {entry.count === 1 ? 'entry' : 'entries'}{entry.amount > 0 ? ` · ${percent(entry.amount)}%` : ''}
                    </Text>
                  </View>
                </View>
                <Text className="font-mono-bold text-sm text-ink shrink-0">{formatCurrency(entry.amount, 'INR')}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </Card>
  );
}
