import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { computePaymentReminder, formatCurrency } from '../lib/utils';
import { cardShadow } from './Card';

export default function PaymentReminderBanner({ entries, dbMembers, config }) {
  const reminder = useMemo(
    () => computePaymentReminder(entries, 'household', dbMembers, config),
    [entries, dbMembers, config],
  );

  if (!reminder) return null;

  return (
    <View
      style={cardShadow}
      className="rounded-2xl bg-paper-card border border-ink/10 border-l-4 border-l-mustard/60 p-4 mb-4"
    >
      <Text className="font-display text-sm text-ink mb-1">⏰ Payment Reminder</Text>
      <Text className="font-body text-sm text-ink">
        <Text className="font-body-semibold">{reminder.debtor}</Text> owes{' '}
        <Text className="font-body-semibold">{reminder.creditor}</Text> {formatCurrency(reminder.amount)}
      </Text>
      {reminder.daysSince != null && (
        <Text className="font-body text-2xs text-muted-text mt-0.5">
          Unsettled for {reminder.daysSince} day{reminder.daysSince === 1 ? '' : 's'}
        </Text>
      )}
    </View>
  );
}
