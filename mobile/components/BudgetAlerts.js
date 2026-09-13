import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { groupByCategory, computeBudgetAlerts, formatCurrency } from '../lib/utils';
import { cardShadow } from './Card';

export default function BudgetAlerts({ entries, ledger, month = null, budgets = {} }) {
  const alerts = useMemo(() => {
    if (!budgets || Object.keys(budgets).length === 0) return [];
    const totals = groupByCategory(entries, month, ledger);
    return computeBudgetAlerts(totals, budgets);
  }, [entries, ledger, month, budgets]);

  if (alerts.length === 0) return null;

  return (
    <View
      style={cardShadow}
      className="rounded-2xl bg-paper-card border border-ink/10 border-l-4 border-l-stamp-red/60 p-4 mb-4"
    >
      <Text className="font-display text-sm font-bold text-ink mb-3">⚠️ Budget Alerts</Text>
      <View className="gap-3">
        {alerts.map((a) => (
          <View key={a.category}>
            <View className="flex-row items-center justify-between mb-1">
              <Text className="font-body-medium text-sm text-ink">{a.category}</Text>
              <Text className="font-body text-xs text-muted-text">{Math.round(a.pctUsed * 100)}%</Text>
            </View>
            <View className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
              <View
                className={`h-full rounded-full ${a.status === 'over' ? 'bg-stamp-red' : 'bg-mustard'}`}
                style={{ width: `${Math.min(a.pctUsed * 100, 100)}%` }}
              />
            </View>
            <Text className="font-body text-2xs text-muted-text mt-1">
              {formatCurrency(a.spent)} of {formatCurrency(a.limit)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
