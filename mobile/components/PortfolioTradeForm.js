import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import PickerField from './PickerField';
import DateField from './DateField';
import { addPortfolioTrade, deletePortfolioTrade } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify, confirmAsync } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { formatCurrency, todayISO, parseAmountInput } from '../lib/utils';
import { buildTrade, formatShortDate } from '../lib/portfolio';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';
const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const num = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });

// A purchase or sale made outside the SIPs (a lump sum, a redemption). It is counted from the day after the latest
// snapshot, so the next Kite sync or CAS, which already contains it, never double-counts it.
export default function PortfolioTradeForm({ funds, navByCode, rows, trades, onClose }) {
  const [fundKey, setFundKey] = useState('');
  const [kind, setKind] = useState('sell');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [units, setUnits] = useState('');
  const [saving, setSaving] = useState(false);

  const fundOptions = useMemo(
    () => funds.map((f) => ({ value: f.key, label: `${f.short || f.name}${f.group === 'other' ? ' (other)' : ''}` })),
    [funds],
  );
  const held = rows.find((r) => r.key === fundKey)?.units ?? null;
  const shortOf = (key) => funds.find((f) => f.key === key)?.short || key;

  const built = useMemo(() => {
    if (!fundKey && !amount && !units) return null;
    return buildTrade({
      fundKey,
      kind,
      date,
      amount: parseAmountInput(amount),
      units: units.trim() ? Number(units.replace(/,/g, '')) : null,
      funds,
      navByCode,
      heldUnits: held,
      today: todayISO(),
    });
  }, [fundKey, kind, date, amount, units, funds, navByCode, held]);

  async function handleSave() {
    if (!built?.ok) {
      notify('Check the trade', built?.error || 'Pick a fund and enter the amount.');
      return;
    }
    setSaving(true);
    const outcome = await settleOrHandOff(addPortfolioTrade(built.trade), (err) => reportError(err, 'The trade did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not save', outcome.error?.message || String(outcome.error));
      return;
    }
    setAmount('');
    setUnits('');
  }

  async function handleRemove(t) {
    const ok = await confirmAsync({
      title: 'Remove this trade?',
      message: `${t.kind === 'sell' ? 'Sold' : 'Bought'} ${num(t.units)} units of ${shortOf(t.fundKey)} on ${formatShortDate(t.date)}. The fund's units go back to what they were without it.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await deletePortfolioTrade(t.id);
    } catch (err) {
      reportError(err, 'Could not remove the trade');
    }
  }

  const sale = kind === 'sell';

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Record a trade</Text>
      <Text className="font-body text-xs text-muted-text mb-3">
        A purchase or sale outside your SIPs. It updates the units until your next sync, which already includes it.
      </Text>

      <View className="flex-row flex-wrap" style={{ gap: 12 }}>
        <View style={{ width: '100%' }}>
          <PickerField label="Fund" value={fundKey} options={fundOptions} onChange={setFundKey} />
        </View>
        <View style={{ width: '47%' }}>
          <Text className={label}>Type</Text>
          <View className="flex-row gap-1.5">
            {[
              ['sell', 'Sold'],
              ['buy', 'Bought'],
            ].map(([k, text]) => (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                className={`flex-1 min-h-11 rounded-xl items-center justify-center border ${kind === k ? 'bg-ledger-green border-ledger-green' : 'border-ink/15 bg-paper'}`}
              >
                <Text className={`font-body-semibold text-sm ${kind === k ? 'text-white' : 'text-ink'}`}>{text}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ width: '47%' }}>
          <Text className={label}>Date</Text>
          <DateField value={date} onChange={setDate} className={input} />
        </View>
        <View style={{ width: '47%' }}>
          <Text className={label}>Amount (₹)</Text>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="125000" className={input} />
        </View>
        <View style={{ width: '47%' }}>
          <Text className={label}>Units (optional)</Text>
          <TextInput value={units} onChangeText={setUnits} keyboardType="decimal-pad" placeholder="exact units" className={input} />
        </View>
      </View>

      {built ? (
        <Text className={`font-body text-xs mt-2 ${built.ok ? 'text-muted-text' : 'text-stamp-red'}`}>
          {built.ok
            ? `${sale ? 'Sells' : 'Buys'} ${num(built.trade.units)} units for ${formatCurrency(built.trade.amount)}${built.nav ? ` (NAV ${built.nav.value} on ${formatShortDate(built.nav.date)})` : ''}. Type the units from your statement for an exact figure.`
            : built.error}
        </Text>
      ) : null}

      <View className="flex-row gap-2 mt-3">
        <Pressable
          onPress={handleSave}
          disabled={saving || !built?.ok}
          className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
        >
          {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Save trade</Text>}
        </Pressable>
        <Pressable onPress={onClose} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
          <Text className="font-body-semibold text-xs text-ink">Close</Text>
        </Pressable>
      </View>

      {trades.length ? (
        <View className="mt-4 pt-3 border-t border-ink/10">
          <Text className={label}>Recorded trades</Text>
          {trades.slice(0, 8).map((t) => (
            <View key={t.id} className="flex-row items-center justify-between gap-3 py-1.5">
              <View className="flex-1 min-w-0">
                <Text className="font-body text-sm text-ink" numberOfLines={1}>
                  {t.kind === 'sell' ? 'Sold' : 'Bought'} · {shortOf(t.fundKey)}
                </Text>
                <Text className="font-body text-2xs text-muted-text">
                  {formatShortDate(t.date)} · {num(t.units)} units · {formatCurrency(t.amount)}
                </Text>
              </View>
              <Pressable onPress={() => handleRemove(t)} accessibilityRole="button" accessibilityLabel="Remove trade" className="px-2 py-1">
                <Text className="font-body-semibold text-xs text-stamp-red">Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
