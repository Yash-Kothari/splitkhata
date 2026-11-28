import { View, Text, Pressable, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { formatCurrency } from '../lib/utils';

// The entries behind one slice of a spend chart (a category, a payment method), biggest first: the biggest one called out,
// then the rest. `detail` is the second line under each entry's note; `budgetStatus` adds the category's budget bar.
export default function SpendDrilldownModal({ title, period, entries, currency = 'INR', detail, budgetStatus = null, emptyText, onClose }) {
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
              <Text className="font-display text-base text-ink" numberOfLines={1}>{title}</Text>
              <Text className="font-body text-xs text-muted-text">
                {period} · {formatCurrency(total, currency)} total
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close" className="w-8 h-8 rounded-full border border-ink/15 bg-paper items-center justify-center shrink-0">
              <Text className="font-body-semibold text-ink">✕</Text>
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
                    <Text className="font-body text-xs text-muted-text">{detail(biggest)}</Text>
                  </View>
                  <Text className="font-mono-bold text-sm text-ink shrink-0">{formatCurrency(biggest.amount, currency)}</Text>
                </View>
              </View>
            )}

            {entries.slice(1).map((entry) => (
              <View key={entry.id} className="flex-row items-center justify-between gap-3 py-1">
                <View className="flex-1 min-w-0">
                  <Text className="font-body text-sm text-ink" numberOfLines={1}>{entry.note || 'No note'}</Text>
                  <Text className="font-body text-xs text-muted-text">{detail(entry)}</Text>
                </View>
                <Text className="font-mono text-sm text-ink shrink-0">{formatCurrency(entry.amount, currency)}</Text>
              </View>
            ))}

            {entries.length === 0 && <Text className="font-body text-sm text-muted-text text-center py-6">{emptyText}</Text>}
            {/* Room under the last row so it is not flush with the sheet's edge when scrolled to the end. */}
            <View style={{ height: 4 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
