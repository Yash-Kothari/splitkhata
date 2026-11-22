import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
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

// Caps on how concentrated the portfolio may get. Until you save your own, the ones shown are only starting points
// (they are not advice) and raise no alerts; once saved, a breach also shows in the reminders at the top.
export default function PortfolioLimits({ evaluated, limits, saved, metrics, collapsible = false }) {
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);

  const breaches = evaluated.filter((e) => e.status === 'breach').length;

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

  function startEditing() {
    setDraft(limits.map((l) => ({ ...l, text: String(l.max) })));
    setEditing(true);
  }

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
    setEditing(false);
  }

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Limits"
        subtitle={saved ? 'Your caps on concentration' : 'Suggested starting points, not advice'}
        summary={breaches ? `${breaches} over the limit` : 'All within limits'}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        <View>
          {!editing
            ? evaluated.map((e) => (
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
              ))
            : draft.map((l) => (
                <View key={l.id} className="flex-row items-center gap-2 mb-2">
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

          {editing && addOptions.length ? (
            <View className="mb-2">
              <PickerField
                label="Add a limit"
                value=""
                options={addOptions.map(({ value, label }) => ({ value, label }))}
                onChange={(id) => {
                  const hit = addOptions.find((o) => o.value === id);
                  if (hit) setDraft((d) => [...d, { ...hit.def, text: '' }]);
                }}
              />
            </View>
          ) : null}

          <View className="flex-row gap-2 mt-1">
            {!editing ? (
              <Pressable onPress={startEditing} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
                <Text className="font-body-semibold text-xs text-ink">{saved ? 'Edit limits' : 'Set my limits'}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable onPress={handleSave} disabled={saving} className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50">
                  {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Save limits</Text>}
                </Pressable>
                <Pressable onPress={() => setEditing(false)} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
                  <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
          {!saved && !editing ? (
            <Text className="font-body text-2xs text-muted-text mt-2">
              These are placeholders to react to. Save your own and any breach will also appear in the reminders at the top.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

