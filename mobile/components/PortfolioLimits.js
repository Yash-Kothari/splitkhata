import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
import PortfolioShell from './PortfolioShell';
import PickerField from './PickerField';
import { savePortfolioLimits } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { parseAmountInput } from '../lib/utils';
import { limitLabel } from '../lib/portfolio';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper';
const BAR = { ok: 'bg-ledger-green', near: 'bg-mustard', breach: 'bg-stamp-red' };
const TEXT = { ok: 'text-ledger-green', near: 'text-mustard', breach: 'text-stamp-red' };
const WORD = { ok: 'Within', near: 'Close to', breach: 'Over' };

// The limits as bars, read-only: where each stands against its cap. Changing a cap is a setting, so it lives in
// Settings (see PortfolioLimitsEditor) and this card only points there.
export default function PortfolioLimits({ evaluated, saved, collapsible = false, defaultOpen = false, onEdit }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const isOpen = !collapsible || openState;
  const breaches = evaluated.filter((e) => e.status === 'breach').length;

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Limits"
        subtitle={saved ? 'Your caps on concentration' : 'Suggested starting points'}
        summary={breaches ? `${breaches} over the limit` : 'All within limits'}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        <View>
          {evaluated.map((e) => (
            <View key={e.id} className="mb-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="font-body text-sm text-ink flex-1" numberOfLines={1}>
                  {e.label}
                  {e.detail ? ` · ${e.detail}` : ''}
                </Text>
                <Text className={`font-mono-bold text-xs ${TEXT[e.status]}`}>
                  {e.value.toFixed(1)}% of {Number(e.max)}%
                </Text>
              </View>
              <View className="h-2 rounded-full bg-ink/10 mt-1 overflow-hidden">
                <View className={`h-full rounded-full ${BAR[e.status]}`} style={{ width: `${Math.min(100, e.usage * 100)}%` }} />
              </View>
              <Text className={`font-body text-2xs mt-0.5 ${TEXT[e.status]}`}>
                {WORD[e.status]} the limit{e.status === 'breach' ? ` by ${(e.value - Number(e.max)).toFixed(1)} points` : ''}
              </Text>
            </View>
          ))}
          <Pressable onPress={onEdit} className="self-start min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-xs text-ink">{saved ? 'Change Limits' : 'Set My Limits'}</Text>
          </Pressable>
          {!saved ? (
            <Text className="font-body text-2xs text-muted-text mt-2">
              These are placeholders, not advice, and raise no alerts. Set your own and any breach also shows in the reminders on Overview.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

// Settings page for the caps: the amount for each, add or remove one, then save.
export function PortfolioLimitsEditor({ limits, saved, metrics, variant = 'settings' }) {
  const [draft, setDraft] = useState(() => limits.map((l) => ({ ...l, text: String(l.max) })));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const addOptions = useMemo(() => {
    const have = new Set(draft.map((l) => l.id));
    const all = [
      { id: 'adani', metric: 'adani' },
      ...Object.keys(metrics.byAmc).map((n) => ({ id: `amc-${n}`, metric: 'amc', name: n })),
      ...Object.keys(metrics.byCategory).map((n) => ({ id: `cat-${n}`, metric: 'category', name: n })),
      { id: 'stock', metric: 'stock' },
      { id: 'fund', metric: 'fund' },
    ];
    return all.filter((l) => !have.has(l.id)).map((l) => ({ value: l.id, label: limitLabel(l), def: l }));
  }, [draft, metrics]);

  async function handleSave() {
    const items = [];
    for (const l of draft) {
      const max = parseAmountInput(l.text);
      if (!max || max <= 0 || max > 100) {
        notify('Check the limits', `Enter a percentage between 0 and 100 for ${limitLabel(l)}.`);
        return;
      }
      const { text: _t, ...rest } = l;
      items.push({ ...rest, max });
    }
    setSaving(true);
    const outcome = await settleOrHandOff(savePortfolioLimits(items), (err) => reportError(err, 'The limits did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not save', outcome.error?.message || String(outcome.error));
      return;
    }
    setDone(true);
  }

  return (
    <PortfolioShell
      variant={variant}
      title="Limits"
      subtitle={`Caps on how concentrated the portfolio may get. ${saved ? 'Any breach shows in the reminders on Overview.' : 'These are starting points, not advice. Save to turn on alerts.'}`}
    >
      {draft.map((l) => (
        <View key={l.id} className="flex-row items-center gap-2">
          <Text className="font-body text-sm text-ink flex-1" numberOfLines={1}>{limitLabel(l)}</Text>
          <TextInput
            value={l.text}
            onChangeText={(t) => setDraft((d) => d.map((x) => (x.id === l.id ? { ...x, text: t } : x)))}
            keyboardType="decimal-pad"
            aria-label={`Limit for ${limitLabel(l)} in percent`}
            className={input}
            style={{ width: 80, textAlign: 'right' }}
          />
          <Text className="font-body text-xs text-muted-text">%</Text>
          <Pressable
            onPress={() => setDraft((d) => d.filter((x) => x.id !== l.id))}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${limitLabel(l)}`}
            className="px-2 py-1"
          >
            <Text className="font-body-semibold text-xs text-stamp-red">✕</Text>
          </Pressable>
        </View>
      ))}

      {addOptions.length ? (
        <PickerField
          label="Add a Limit"
          value=""
          options={addOptions.map(({ value, label }) => ({ value, label }))}
          onChange={(id) => {
            const hit = addOptions.find((o) => o.value === id);
            if (hit) setDraft((d) => [...d, { ...hit.def, text: '' }]);
          }}
        />
      ) : null}

      <View className="flex-row items-center gap-2">
        <Pressable onPress={handleSave} disabled={saving} className="min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50">
          {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Save Limits</Text>}
        </Pressable>
        {done ? <Text className="font-body text-xs text-ledger-green">Saved.</Text> : null}
      </View>
    </PortfolioShell>
  );
}
