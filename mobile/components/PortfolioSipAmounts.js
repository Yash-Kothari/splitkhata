import { View, Text, TextInput, Pressable } from 'react-native';
import PickerField from './PickerField';
import { parseAmountInput } from '../lib/utils';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { DEFAULT_OWNER, ownerOf, ownersOf, isStock } from '../lib/portfolio';

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

export default function PortfolioSipAmounts({ funds: allFunds, draft, onChange }) {
  // A stock has no SIP.
  const funds = allFunds.filter((f) => !isStock(f));
  const { money } = usePortfolioPrivacy();
  const keys = Object.keys(draft);
  const nameOf = (k) => funds.find((f) => f.key === k)?.short || k;
  // With more than one person's funds, the amounts are listed under each person's name and the picker says whose a fund is.
  const people = ownersOf(funds);
  const multi = people.length > 1;
  const ownerOfKey = (k) => {
    const f = funds.find((x) => x.key === k);
    return f ? ownerOf(f) : DEFAULT_OWNER;
  };
  const options = funds
    .filter((f) => !(f.key in draft))
    .map((f) => ({ value: f.key, label: `${f.short || f.name}${f.group === 'other' ? ' (other)' : ''}${multi ? ` · ${ownerOf(f)}` : ''}` }));
  const perDay = Object.values(draftToPlan(draft)).reduce((a, b) => a + b, 0);
  const groups = multi ? people.map((who) => [who, keys.filter((k) => ownerOfKey(k) === who)]).filter(([, list]) => list.length > 0) : [[null, keys]];

  return (
    <View>
      {groups.map(([who, list]) => (
        <View key={who || 'all'}>
          {who ? <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1.5 mt-1">{who}</Text> : null}
          {list.map((k) => (
            <View key={k} className="flex-row items-center gap-2 mb-2">
              <Text className="font-body text-sm text-ink flex-1" numberOfLines={1}>{nameOf(k)}</Text>
              <TextInput
                value={draft[k]}
                onChangeText={(t) => onChange({ ...draft, [k]: t })}
                keyboardType="decimal-pad"
                placeholder="₹ a day"
                aria-label={`Rupees a day for ${nameOf(k)}${who ? `, ${who}` : ''}`}
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
        </View>
      ))}
      {options.length ? (
        <View className="mb-2">
          <PickerField label="Add a Fund" value="" options={options} onChange={(v) => onChange({ ...draft, [v]: '' })} />
        </View>
      ) : null}
      <Text className="font-body text-xs text-muted-text">
        {money(perDay)} a day, about {money((perDay * 250) / 12)} a month and {money(perDay * 250)} a year (250 trading days).
      </Text>
    </View>
  );
}
