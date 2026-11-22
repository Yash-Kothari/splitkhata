import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Platform } from 'react-native';
import PortfolioShell from './PortfolioShell';
import { readClipboardText, pickTextFile } from './PortfolioImport';
import { setPortfolioBenchmark } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { parseBenchmarkInput } from '../lib/portfolio';

const input = 'font-mono text-xs text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

// ONE-OFF TOOL. The live catalog was imported before it named a benchmark, so Fund vs Nifty 50 has nothing to compare
// against. This adds just that one field: paste the benchmark (or the setup file, of which only the benchmark is read),
// see what will be saved, and confirm. Nothing else in the catalog, and none of the holdings, is touched. Delete this file
// (and its line in PortfolioSettings, parseBenchmarkInput and setPortfolioBenchmark) once the benchmark is saved.
export default function PortfolioBenchmarkTool({ benchmark, hasSetup }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const parsed = useMemo(() => (text.trim() ? parseBenchmarkInput(text) : null), [text]);

  if (!hasSetup) return null;
  if (benchmark) {
    return (
      <PortfolioShell variant="settings" title="Benchmark" subtitle="The index fund that Fund vs Nifty 50 compares your funds against.">
        <Text className="font-body text-sm text-ink">
          <Text className="font-body-semibold">{benchmark.name}</Text> <Text className="font-mono text-xs text-muted-text">({benchmark.schemeCode})</Text>
        </Text>
        {saved ? (
          <Text className="font-body text-xs text-ledger-green">
            Saved. Open Portfolio and press Check NAVs once so its prices are fetched, then Fund vs Nifty 50 fills in.
          </Text>
        ) : null}
      </PortfolioShell>
    );
  }

  async function handleConfirm() {
    if (!parsed?.ok) return;
    setSaving(true);
    const outcome = await settleOrHandOff(setPortfolioBenchmark(parsed.benchmark), (err) => reportError(err, 'The benchmark did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not save', outcome.error?.message || String(outcome.error));
      return;
    }
    setSaved(parsed.benchmark);
    setText('');
  }

  return (
    <PortfolioShell
      variant="settings"
      title="Set Benchmark"
      subtitle="One-time: names the index fund Fund vs Nifty 50 compares against. Nothing else is changed. Nothing is saved until you confirm."
    >
      {Platform.OS === 'web' ? (
        <View className="flex-row flex-wrap gap-2 mb-2">
          <Pressable
            onPress={async () => {
              const clip = await readClipboardText();
              if (clip && clip.trim()) setText(clip);
              else notify('Nothing pasted', 'The clipboard is empty, or the browser did not allow reading it. Paste into the box instead.');
            }}
            className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center"
          >
            <Text className="font-body-semibold text-xs text-ink">Paste from Clipboard</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              const content = await pickTextFile();
              if (content) setText(content);
            }}
            className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center"
          >
            <Text className="font-body-semibold text-xs text-ink">Choose File</Text>
          </Pressable>
        </View>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        placeholder='Paste { "schemeCode": "...", "name": "..." }'
        autoCapitalize="none"
        autoCorrect={false}
        className={input}
        style={{ minHeight: 72, textAlignVertical: 'top' }}
      />
      {parsed && !parsed.ok ? <Text className="font-body text-xs text-stamp-red mt-2">{parsed.error}</Text> : null}
      {parsed?.ok ? (
        <View className="mt-2 rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5">
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Will save this benchmark</Text>
          <Text className="font-body text-sm text-ink">{parsed.benchmark.name}</Text>
          <Text className="font-mono text-xs text-muted-text">Scheme {parsed.benchmark.schemeCode}</Text>
          <Text className="font-body text-xs text-muted-text mt-1">Your funds, units, SIP plan, limits and overlap data are not touched.</Text>
        </View>
      ) : null}
      <View className="flex-row mt-2">
        <Pressable
          onPress={handleConfirm}
          disabled={!parsed?.ok || saving}
          className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
        >
          {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Confirm Benchmark</Text>}
        </Pressable>
      </View>
    </PortfolioShell>
  );
}
