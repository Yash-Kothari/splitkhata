import { View, Text, TextInput, Pressable } from 'react-native';
import PickerField from './PickerField';
import { parseAmountInput } from '../lib/utils';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper';

// Rupees a day per fund, shared by the SIP editor and the what-if card. `draft` is { [fundKey]: 'text' } so a half-typed
// number is never lost; use `draftToPlan` for the numbers.
export function planToDraft(plan) {
  const out = {};
  for (const [k, v] of Object.entries(plan || {})) if (Number(v) > 0) out[k] = String(v);
  return out;
}

export function draftToPlan(draft) {
  const out = {};
  for (const [k, text] of Object.entries(draft || {})) {
    const n = parseAmountInput(text);
    if (n && n > 0) out[k] = n;
  }
  return out;
}

export default function PortfolioSipAmounts({ funds, draft, onChange }) {
  const { money } = usePortfolioPrivacy();
  const keys = Object.keys(draft);
  const nameOf = (k) => funds.find((f) => f.key === k)?.short || k;
  const options = funds
    .filter((f) => !(f.key in draft))
    .map((f) => ({ value: f.key, label: `${f.short || f.name}${f.group === 'other' ? ' (other)' : ''}` }));
  const perDay = Object.values(draftToPlan(draft)).reduce((a, b) => a + b, 0);

  return (
    <View>
      {keys.map((k) => (
        <View key={k} className="flex-row items-center gap-2 mb-2">
          <Text className="font-body text-sm text-ink flex-1" numberOfLines={1}>{nameOf(k)}</Text>
          <TextInput
            value={draft[k]}
            onChangeText={(t) => onChange({ ...draft, [k]: t })}
            keyboardType="decimal-pad"
            placeholder="₹ a day"
            aria-label={`Rupees a day for ${nameOf(k)}`}
            className={input}
            style={{ width: 110, textAlign: 'right' }}
          />
          <Pressable
            onPress={() => {
              const { [k]: _gone, ...rest } = draft;
              onChange(rest);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${nameOf(k)}`}
            className="px-2 py-1"
          >
            <Text className="font-body-semibold text-xs text-stamp-red">✕</Text>
          </Pressable>
        </View>
      ))}
      {options.length ? (
        <View className="mb-2">
          <PickerField label="Add a fund" value="" options={options} onChange={(v) => onChange({ ...draft, [v]: '' })} />
        </View>
      ) : null}
      <Text className="font-body text-xs text-muted-text">
        {money(perDay)} a day, about {money((perDay * 250) / 12)} a month and {money(perDay * 250)} a year (250 trading days).
      </Text>
    </View>
  );
}
