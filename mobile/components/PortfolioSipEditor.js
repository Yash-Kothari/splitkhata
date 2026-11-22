import { useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import DateField from './DateField';
import PortfolioSipAmounts, { planToDraft, draftToPlan } from './PortfolioSipAmounts';
import { saveSipSchedule } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { todayISO, isValidISODate } from '../lib/utils';
import { applySipChange, sipPlanAt, formatShortDate } from '../lib/portfolio';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

// Edit the daily SIP plan in the app. A change applies from the date you pick, so earlier days keep the plan they ran
// under and the units estimated for them do not move.
export default function PortfolioSipEditor({ funds, schedule, onClose }) {
  const today = todayISO();
  const [draft, setDraft] = useState(() => planToDraft(sipPlanAt(schedule, today)));
  const [from, setFrom] = useState(today);
  const [saving, setSaving] = useState(false);
  const earlier = useMemo(() => schedule.filter((e) => e.from !== '0000-01-01').slice(-3), [schedule]);

  async function handleSave() {
    if (!isValidISODate(from)) {
      notify('Check the date', 'Use a date like 2026-11-23.');
      return;
    }
    const plan = draftToPlan(draft);
    if (Object.keys(plan).length === 0) {
      notify('Nothing to save', 'Add at least one fund with a daily amount, or close this form to keep the current plan.');
      return;
    }
    setSaving(true);
    const outcome = await settleOrHandOff(saveSipSchedule(applySipChange(schedule, from, plan)), (err) => reportError(err, 'The SIP plan did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not save', outcome.error?.message || String(outcome.error));
      return;
    }
    onClose();
  }

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Edit SIP plan</Text>
      <Text className="font-body text-xs text-muted-text mb-3">
        Rupees bought per trading day in each fund. The new plan applies from the date below; earlier days keep the old one.
      </Text>

      <PortfolioSipAmounts funds={funds} draft={draft} onChange={setDraft} />

      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mt-3 mb-1">Applies from</Text>
      <View style={{ maxWidth: 200 }}>
        <DateField value={from} onChange={setFrom} className={input} />
      </View>

      {earlier.length ? (
        <Text className="font-body text-2xs text-muted-text mt-2">
          Earlier changes: {earlier.map((e) => `${formatShortDate(e.from)} (${Object.keys(e.plan).length} funds)`).join(', ')}.
        </Text>
      ) : null}

      <View className="flex-row gap-2 mt-3">
        <Pressable onPress={handleSave} disabled={saving} className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50">
          {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Save plan</Text>}
        </Pressable>
        <Pressable onPress={onClose} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
          <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
        </Pressable>
      </View>
    </Card>
  );
}
