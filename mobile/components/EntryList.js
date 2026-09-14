import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import EditEntryRow from './EditEntryRow';
import PickerField from './PickerField';
import { cardShadow } from './Card';
import { formatCurrency, formatMonthLabel } from '../lib/utils';

function formatShortDate(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

// RN port of web's EntryList.jsx - shared by Household, Payments (Payment
// History) and Travel (trip passbook). Renders with plain map() inside a
// View rather than its own FlatList, since it's always used inside a
// screen-level ScrollView alongside other cards (Balance/Add Entry/etc) -
// nesting a virtualized FlatList inside a ScrollView is unreliable in RN.
//
// pendingDeletes/onDelete are owned by the parent screen (via
// lib/useUndoDelete), not this component - the undo toast needs to render
// as a sibling of the screen's own ScrollView to behave like a real
// viewport-fixed overlay, which this component can't do on its own since
// it's rendered *inside* that ScrollView.
export default function EntryList({
  title = 'Passbook Entries',
  emptyMessage = 'No entries recorded yet. Add your first expense above!',
  entries,
  selectedMonth = 'all',
  onMonthChange,
  availableMonths = [],
  ledger = 'household',
  categories = [],
  members = [],
  dbPaymentMethods = [],
  currentCurrency = 'INR',
  pendingDeletes = {},
  onDelete,
  onSaveError,
}) {
  const isTravel = ledger === 'travel';
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);

  const filtered = useMemo(() => {
    const list = entries || [];
    const term = searchTerm.trim().toLowerCase();
    return list
      .filter((e) => {
        if (pendingDeletes[e.id]) return false;
        if (!isTravel && selectedMonth !== 'all' && e.date?.slice(0, 7) !== selectedMonth) return false;
        if (!term) return true;
        const matchNote = e.note?.toLowerCase().includes(term);
        const matchCat = e.category?.toLowerCase().includes(term);
        const matchPayer = e.payer?.toLowerCase().includes(term);
        const matchAmount = String(e.amount).includes(term) || String(e.localAmount ?? '').includes(term);
        return matchNote || matchCat || matchPayer || matchAmount;
      })
      .sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      });
  }, [entries, searchTerm, selectedMonth, isTravel, pendingDeletes]);

  const loading = entries === null;

  return (
    <View className="mx-4 mb-4 rounded-2xl" style={cardShadow}>
      <View className="rounded-t-2xl border border-b-0 border-ink/10 bg-paper-card px-4 pt-4 pb-3">
        <View className="flex-col sm:flex-row sm:items-center sm:justify-between" style={{ gap: 12 }}>
          <View>
            <Text className="font-display text-lg text-ink">
              {title}
              {!isTravel ? ` (${selectedMonth === 'all' ? 'All Months' : formatMonthLabel(selectedMonth)})` : ''}
            </Text>
            <Text className="font-body text-xs text-muted-text mt-0.5">
              {loading ? '' : `${filtered.length} ${filtered.length === 1 ? 'transaction' : 'transactions'} recorded`}
            </Text>
          </View>

          <View className="flex-col sm:flex-row sm:items-center" style={{ gap: 8 }}>
            {!isTravel && availableMonths.length > 0 && onMonthChange && (
              <PickerField
                label="Month"
                value={selectedMonth}
                options={[{ value: 'all', label: 'All Months' }, ...availableMonths.map((m) => ({ value: m, label: formatMonthLabel(m) }))]}
                onChange={onMonthChange}
              />
            )}

            {!loading && (entries || []).length > 0 && (
              <TextInput
                value={searchTerm}
                onChangeText={setSearchTerm}
                placeholder="Search entries..."
                className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper shadow-2xs w-full sm:w-48"
              />
            )}
          </View>
        </View>
      </View>

      {loading ? (
        <View className="items-center py-10 border border-t-0 border-ink/10 bg-paper-card rounded-b-2xl">
          <ActivityIndicator color="#3D7068" />
        </View>
      ) : filtered.length === 0 ? (
        <View className="items-center py-10 border-2 border-dashed border-t-0 border-ink/20 rounded-b-2xl bg-paper/50 px-4">
          <Text className="font-body text-sm text-muted-text text-center">
            {(entries || []).length === 0 ? emptyMessage : 'No entries match your search.'}
          </Text>
        </View>
      ) : (
        filtered.map((item, index) => {
          const isLast = index === filtered.length - 1;

          if (editingId === item.id) {
            return (
              <EditEntryRow
                key={item.id}
                entry={item}
                categories={categories}
                members={members}
                dbPaymentMethods={dbPaymentMethods}
                ledger={ledger}
                currentCurrency={currentCurrency}
                tripEntries={isTravel ? entries : []}
                onCancel={() => setEditingId(null)}
                onSaved={() => setEditingId(null)}
                onSaveError={(err) => {
                  onSaveError?.(err);
                }}
              />
            );
          }

          const isSettlement = item.splitType === 'settlement';
          const hasPoints = (isTravel || item.isTripRollup || isSettlement) && Number(item.rewardPoints || 0) !== 0;
          const isCashPool = isTravel && !item.split && item.paymentMethod === 'Cash';

          return (
            <View
              key={item.id}
              className={`bg-paper-card border-l border-r border-b border-ink/10 px-4 py-3 ${
                isLast ? 'rounded-b-2xl' : ''
              }`}
            >
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-baseline justify-between gap-2">
                    <View className="flex-row items-baseline flex-wrap gap-1.5 flex-1">
                      {item.amount ? (
                        <Text className="font-mono-bold text-base text-ink">{formatCurrency(item.amount, 'INR')}</Text>
                      ) : null}
                      {isTravel && item.localAmount != null && (
                        <Text className="font-mono text-xs text-muted-text">
                          ({formatCurrency(item.localAmount, currentCurrency)})
                        </Text>
                      )}
                      {hasPoints ? (
                        <Text
                          className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                            item.rewardPoints > 0 ? 'bg-mustard/20 text-mustard' : 'bg-ledger-green/15 text-ledger-green'
                          }`}
                        >
                          💳 {item.rewardPoints > 0 ? `-${item.rewardPoints}` : `+${Math.abs(item.rewardPoints)}`} pts
                        </Text>
                      ) : null}
                    </View>
                    <Text className="font-body-medium text-xs text-muted-text bg-paper border border-ink/10 rounded px-2 py-0.5">
                      {formatShortDate(item.date)}
                    </Text>
                  </View>

                  {isSettlement ? (
                    <View className="mt-1.5 flex-row">
                      <Text className="font-body-medium text-xs text-ledger-green bg-ledger-green/15 rounded px-1.5 py-0.5">
                        ⇄ {item.payer} paid {item.owedBy}
                      </Text>
                    </View>
                  ) : (
                    <View className="flex-row flex-wrap items-center gap-1.5 mt-1.5">
                      <Text className="font-body-semibold text-xs text-ink bg-paper-card border border-ink/10 rounded px-2 py-0.5">
                        {item.category}
                      </Text>
                      <Text className="font-body text-xs text-muted-text">
                        Paid by <Text className="font-body-semibold text-ink">{item.payer}</Text>
                      </Text>
                      {!item.split && (
                        <Text
                          className={`font-body-medium text-xs rounded px-1.5 py-0.5 ${
                            isCashPool ? 'bg-slate-500/15 text-slate-600' : 'bg-mustard/20 text-mustard'
                          }`}
                        >
                          {isCashPool ? 'Cash Pool' : 'Personal'}
                        </Text>
                      )}
                      {item.splitType === 'owed' && item.owedBy && (
                        <Text className="font-body-medium text-xs text-ledger-green bg-ledger-green/15 rounded px-1.5 py-0.5">
                          {item.owedBy} owes full amount
                        </Text>
                      )}
                      {item.paymentMethod && (
                        <Text className="font-body text-xs text-muted-text">
                          via <Text className="font-body-semibold text-ink">{item.paymentMethod}</Text>
                        </Text>
                      )}
                    </View>
                  )}

                  {item.note ? (
                    <Text numberOfLines={1} className="font-body text-xs text-muted-text mt-1">
                      {item.note}
                    </Text>
                  ) : null}
                </View>

                <View className="flex-row items-center gap-1 shrink-0">
                  <Pressable
                    onPress={() => setEditingId(item.id)}
                    hitSlop={8}
                    className="min-w-8 min-h-8 items-center justify-center rounded-lg"
                  >
                    <Text className="font-body-semibold text-xs text-muted-text">✎</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onDelete?.(item)}
                    hitSlop={8}
                    className="min-w-8 min-h-8 items-center justify-center rounded-lg"
                  >
                    <Text className="font-body-semibold text-xs text-stamp-red/70">✕</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
