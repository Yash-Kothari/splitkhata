import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import PortfolioShell from './PortfolioShell';
import { savePortfolioTargets } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { ASSETS, checkTargets } from '../lib/portfolioInsights';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper';

function Row({ label, value, onChange }) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="font-body text-sm text-ink flex-1">{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" aria-label={`${label} in percent`} className={input} style={{ width: 80, textAlign: 'right' }} />
      <Text className="font-body text-xs text-muted-text">%</Text>
    </View>
  );
}

// Settings page: the asset mix you are aiming for, and the slab rate the tax estimates use.
export default function PortfolioTargets({ targets, slabPct }) {
  const [mix, setMix] = useState(() => Object.fromEntries(ASSETS.map(([k]) => [k, targets?.[k] != null ? String(targets[k]) : ''])));
  const [slab, setSlab] = useState(String(slabPct));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const sum = ASSETS.reduce((a, [k]) => a + (Number(mix[k]) || 0), 0);

  async function handleSave() {
    const checked = checkTargets(mix, slab);
    if (!checked.ok) {
      notify('Check the numbers', checked.error);
      return;
    }
    setSaving(true);
    const outcome = await settleOrHandOff(savePortfolioTargets(checked), (err) => reportError(err, 'The targets did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not save', outcome.error?.message || String(outcome.error));
      return;
    }
    setDone(true);
  }

  return (
    <PortfolioShell variant="settings" title="Targets & Tax" subtitle="The asset mix you are aiming for (leave all blank for none), and your income-tax slab rate for the tax estimates.">
      {ASSETS.map(([k, label]) => (
        <Row key={k} label={label} value={mix[k]} onChange={(t) => { setMix((m) => ({ ...m, [k]: t })); setDone(false); }} />
      ))}
      <Text className={`font-body text-xs ${sum === 0 || Math.abs(sum - 100) < 0.01 ? 'text-muted-text' : 'text-stamp-red'}`}>Total {Math.round(sum * 10) / 10}%</Text>
      <Row label="Tax Slab Rate" value={slab} onChange={(t) => { setSlab(t); setDone(false); }} />
      <View className="flex-row items-center gap-2">
        <Pressable onPress={handleSave} disabled={saving} className="min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50">
          {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Save Targets</Text>}
        </Pressable>
        {done ? <Text className="font-body text-xs text-ledger-green">Saved.</Text> : null}
      </View>
    </PortfolioShell>
  );
}
