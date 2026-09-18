import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { computeMonthForecast, formatCurrency, todayISO } from '../lib/utils';
import { cardShadow } from './Card';

// "Can we afford this?" - the actual question a household budget exists to
// answer. Combines two things already computed elsewhere in the app but
// never surfaced together: recurring charges still ahead this month, and
// each budgeted category's spend-so-far projected to month-end at its
// current pace (see computeMonthForecast). Renders nothing when there's
// genuinely nothing to flag - no committed spend left and nobody on pace
// to go over - rather than a permanently-empty card.
export default function MonthForecast({ entries, recurringRules = [], budgets = {} }) {
  const forecast = useMemo(
    () => computeMonthForecast(entries, recurringRules, budgets, todayISO()),
    [entries, recurringRules, budgets],
  );

  const onTrackToExceed = forecast.categories.filter((c) => c.projectedPctUsed >= 1);
  if (forecast.remainingCommitted === 0 && onTrackToExceed.length === 0) return null;

  return (
    <View style={cardShadow} className="rounded-2xl bg-paper-card border border-ink/10 p-4 mb-4">
      <Text className="font-display text-sm text-ink mb-0.5">📅 This Month's Forecast</Text>
      <Text className="font-body text-2xs text-muted-text mb-3">
        {forecast.daysRemaining} day{forecast.daysRemaining === 1 ? '' : 's'} left this month
      </Text>

      {forecast.remainingCommitted > 0 && (
        <Text className="font-body text-sm text-ink mb-3">
          <Text className="font-body-semibold">{formatCurrency(forecast.remainingCommitted)}</Text> still due from
          recurring bills.
        </Text>
      )}

      {onTrackToExceed.length > 0 && (
        <View className="gap-2.5">
          {onTrackToExceed.map((c) => (
            <View key={c.category}>
              <Text className="font-body-medium text-sm text-ink">{c.category}</Text>
              <Text className="font-body text-2xs text-muted-text">
                On pace for {formatCurrency(c.projectedSpent)} by month-end - {formatCurrency(c.limit)} limit
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
