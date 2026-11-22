import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Card from './Card';
import DateField from './DateField';
import { importPortfolioSnapshot } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { todayISO } from '../lib/utils';
import { parseImport, diffForPreview } from '../lib/portfolio';

const input = 'font-mono text-xs text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

const units = (n) => (n == null ? '-' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

// Paste what you were given, see exactly what will change, then confirm. This is the only way holdings reach the
// database: the signed-in user presses Confirm here (see docs/PORTFOLIO.md).
export default function PortfolioImport({ funds, snapshots, navByCode, sipPlan, onClose }) {
  const [text, setText] = useState('');
  const [asOf, setAsOf] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const today = todayISO();
  const parsed = useMemo(
    () => (text.trim() ? parseImport(text, { catalog: funds.length ? { funds } : null, asOfDefault: asOf, today }) : null),
    [text, asOf, funds, today],
  );
  const preview = useMemo(() => {
    if (!parsed?.ok) return [];
    const p = parsed.payload;
    return diffForPreview({
      funds: p.catalog?.funds || funds,
      snapshots,
      navByCode,
      sipPlan: p.sipPlan || sipPlan,
      next: p.positions,
      asOf: p.asOf,
    });
  }, [parsed, funds, snapshots, navByCode, sipPlan]);

  async function handleConfirm() {
    if (!parsed?.ok) return;
    setSaving(true);
    const outcome = await settleOrHandOff(importPortfolioSnapshot(parsed.payload), (err) => reportError(err, 'The portfolio import did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not import', outcome.error?.message || String(outcome.error));
      return;
    }
    onClose();
  }

  const p = parsed?.ok ? parsed.payload : null;

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Import snapshot</Text>
      <Text className="font-body text-xs text-muted-text mb-3">
        Paste the holdings file Claude made from Kite (or your setup / CAS file). Nothing is saved until you confirm.
      </Text>

      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Holdings as of</Text>
      <View className="mb-3" style={{ maxWidth: 200 }}>
        <DateField value={asOf} onChange={setAsOf} className={input} />
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={6}
        placeholder="Paste JSON here"
        autoCapitalize="none"
        autoCorrect={false}
        className={input}
        style={{ minHeight: 120, textAlignVertical: 'top' }}
      />

      {parsed && !parsed.ok ? <Text className="font-body text-xs text-stamp-red mt-2">{parsed.error}</Text> : null}

      {p ? (
        <View className="mt-3 rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
            Will save {Object.keys(p.positions).length} holdings from {p.source}, as of {p.asOf}
          </Text>
          {p.catalog ? <Text className="font-body text-xs text-ink">Fund list: {p.catalog.funds.length} funds</Text> : null}
          {p.overlap ? <Text className="font-body text-xs text-ink">Overlap data: {p.overlap.asOf || 'included'}</Text> : null}
          {p.sipPlan ? <Text className="font-body text-xs text-ink">SIP plan: {Object.keys(p.sipPlan).length} funds</Text> : null}
          {parsed.warnings.map((w) => (
            <Text key={w} className="font-body text-xs text-mustard mt-1">{w}</Text>
          ))}
          {preview.map((r) => (
            <View key={r.key} className="flex-row items-center justify-between gap-3 py-1 border-t border-ink/10 mt-1">
              <Text className="font-body text-xs text-ink flex-1" numberOfLines={1}>{r.name}</Text>
              <Text className="font-mono text-xs text-muted-text">{r.isNew ? 'new' : units(r.prevUnits)}</Text>
              <Text className="font-mono text-xs text-muted-text">→</Text>
              <Text className="font-mono-bold text-xs text-ink">{units(r.nextUnits)}</Text>
              {r.drift != null ? (
                <Text className={`font-mono text-2xs ${Math.abs(r.drift) < 0.5 ? 'text-muted-text' : r.drift > 0 ? 'text-ledger-green' : 'text-stamp-red'}`}>
                  {r.drift > 0 ? '+' : ''}
                  {units(Math.round(r.drift * 1000) / 1000)} vs estimate
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View className="flex-row gap-2 mt-3">
        <Pressable
          onPress={handleConfirm}
          disabled={!p || saving}
          className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
        >
          {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Confirm import</Text>}
        </Pressable>
        <Pressable onPress={onClose} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
          <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
        </Pressable>
      </View>
    </Card>
  );
}
