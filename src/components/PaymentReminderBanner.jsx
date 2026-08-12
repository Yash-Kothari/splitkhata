import { useMemo } from 'react';
import { computePaymentReminder, formatCurrency } from '../utils';

// Purely presentational over computePaymentReminder - renders nothing when
// the balance is settled, reminders are off, or the amount owed hasn't
// crossed the configured threshold yet. Household-only: a two-person
// balance is what "who owes who" means in practice, not a trip's running
// total. daysSince is shown as context, not the trigger - the reminder
// fires on amount, not on how long it's been sitting.
export default function PaymentReminderBanner({ entries, dbMembers, config }) {
  const reminder = useMemo(
    () => computePaymentReminder(entries, 'household', dbMembers, config),
    [entries, dbMembers, config],
  );

  if (!reminder) return null;

  return (
    <section className="panel-card px-4 sm:px-5 py-4 border-l-4 border-mustard/60">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-bold text-ink mb-1">⏰ Payment Reminder</h3>
          <p className="text-sm text-ink">
            <strong>{reminder.debtor}</strong> owes <strong>{reminder.creditor}</strong> {formatCurrency(reminder.amount)}
          </p>
          {reminder.daysSince != null && (
            <p className="text-2xs text-muted-text mt-0.5">
              Unsettled for {reminder.daysSince} day{reminder.daysSince === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
