import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { importPortfolioHistory, savePortfolioFundInfo } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { buildHistoryWrites } from '../lib/portfolioLedger';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The preview and Confirm for the two other files the import box accepts: a transaction history and fund details.
// `parsed` is the result of parseTransactions or parseFundInfo.
export default function PortfolioExtraImport({ kind, parsed, preview = [], state = null, onDone }) {
  const [saving, setSaving] = useState(false);
  if (!parsed.ok) return <Text className="font-body text-xs text-stamp-red mt-2">{parsed.error}</Text>;
  const isHistory = kind === 'transactions';

  async function handleConfirm() {
    setSaving(true);
    const write = isHistory ? importPortfolioHistory(buildHistoryWrites({ parsed, state })) : savePortfolioFundInfo(parsed.funds);
    const outcome = await settleOrHandOff(write, (err) => reportError(err, 'The portfolio import did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not import', outcome.error?.message || String(outcome.error));
      return;
    }
    onDone(isHistory ? `history for ${plural(parsed.histories.length, 'fund')} for ${parsed.owner} as of ${parsed.asOf}` : `details for ${plural(parsed.names.length, 'fund')} as of ${parsed.asOf}`);
  }

  return (
    <View>
      <View className="mt-3 rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5">
        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
          {isHistory
            ? `Will save the full history of ${plural(parsed.histories.length, 'fund')} for ${parsed.owner}, as of ${parsed.asOf}`
            : `Will save details for ${plural(parsed.names.length, 'fund')}, as of ${parsed.asOf}`}
        </Text>
        {isHistory ? (
          <View>
            <Text className="font-body text-xs text-ink">Replaces any history already stored for these funds, and sets their units to what it ends on.</Text>
            {parsed.histories.map((h) => {
              const diff = preview.find((r) => r.key === h.key);
              return (
                <View key={h.key} className="flex-row items-center justify-between gap-3 py-1 border-t border-ink/10 mt-1">
                  <Text className="font-body text-xs text-ink flex-1" numberOfLines={1}>{h.short}</Text>
                  <Text className="font-mono text-2xs text-muted-text">{h.count} {h.count === 1 ? 'entry' : 'entries'}</Text>
                  <Text className="font-mono-bold text-xs text-ink">{h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</Text>
                  {diff?.drift != null && Math.abs(diff.drift) >= 0.001 ? (
                    <Text className="font-mono text-2xs text-mustard">{diff.drift > 0 ? '+' : ''}{diff.drift.toFixed(3)} vs estimate</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <Text className="font-body text-xs text-ink">{parsed.names.join(', ')}</Text>
        )}
      </View>
      <Pressable onPress={handleConfirm} disabled={saving} className="self-start mt-3 min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50">
        {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Confirm Import</Text>}
      </Pressable>
    </View>
  );
}
