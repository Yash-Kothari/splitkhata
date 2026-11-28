import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Platform } from 'react-native';
import PortfolioShell from './PortfolioShell';
import PortfolioPills from './PortfolioPills';
import DateField from './DateField';
import { importPortfolioSnapshot } from '../lib/firebase';
import { settleOrHandOff } from '../lib/saveHandoff';
import { notify } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';
import { todayISO } from '../lib/utils';
import { parseImport, diffForPreview, buildImportWrites, DEFAULT_OWNER } from '../lib/portfolio';
import { parseTransactions } from '../lib/portfolioLedger';
import { parseFundInfo } from '../lib/portfolioInsights';
import PortfolioExtraImport from './PortfolioExtraImport';

const input = 'font-mono text-xs text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

const units = (n) => (n == null ? '-' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

// Website only: a phone pastes with a long press in the box (and has no file picker without a new dependency).
// Both resolve to the text, or null when the browser refuses or the user cancels.
async function readClipboardText() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

function pickTextFile() {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = '.json,.txt,application/json,text/plain';
    el.onchange = () => {
      const file = el.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    el.click();
  });
}

// Paste what you were given, see exactly what will change, then confirm. This is the only way holdings reach the
// database: the signed-in user presses Confirm here (see docs/PORTFOLIO.md).
export default function PortfolioImport({ funds, existing = {}, people = [DEFAULT_OWNER], heldKeys = null, snapshots, navByCode, sipPlan, sipSchedule = null, trades = [], variant = 'settings', onClose }) {
  const [text, setText] = useState('');
  // null until you tap a name: then the file says whose it is (a setup file names its owner), else the default person.
  const [chosen, setChosen] = useState(null);
  const [asOf, setAsOf] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [imported, setImported] = useState(null);

  const today = todayISO();
  // A transaction history or a fund-details file, told apart by its `source`; anything else is a holdings file.
  const extra = useMemo(() => {
    let json;
    try {
      json = JSON.parse(text.trim());
    } catch {
      return null;
    }
    const list = existing.catalog?.funds || funds;
    if (json?.source === 'transactions') return { kind: 'transactions', parsed: parseTransactions(json, { funds: list, owner: chosen, people, today }) };
    if (json?.source === 'fundinfo') return { kind: 'fundinfo', parsed: parseFundInfo(json, { funds: list }) };
    return null;
  }, [text, existing.catalog, funds, chosen, people, today]);
  const extraPreview = useMemo(
    () =>
      extra?.kind === 'transactions' && extra.parsed.ok
        ? diffForPreview({ funds, snapshots, navByCode, sipPlan, sipSchedule, trades, next: extra.parsed.positions, asOf: extra.parsed.asOf })
        : [],
    [extra, funds, snapshots, navByCode, sipPlan, sipSchedule, trades],
  );
  const parsed = useMemo(
    () => (text.trim() && !extra ? parseImport(text, { catalog: existing.catalog || (funds.length ? { funds } : null), asOfDefault: asOf, today, owner: chosen, people, heldKeys }) : null),
    [text, extra, asOf, funds, existing.catalog, chosen, people, heldKeys, today],
  );
  const shownOwner = chosen || (parsed?.ok ? parsed.payload.owner : DEFAULT_OWNER);
  const preview = useMemo(() => {
    if (!parsed?.ok) return [];
    const p = parsed.payload;
    return diffForPreview({
      funds: parsed.funds,
      snapshots,
      navByCode,
      sipPlan: p.sipPlan || sipPlan,
      sipSchedule: p.sipPlan ? null : sipSchedule,
      trades,
      next: p.positions,
      asOf: p.asOf,
    });
  }, [parsed, snapshots, navByCode, sipPlan, sipSchedule, trades]);

  async function handlePaste() {
    const clip = await readClipboardText();
    if (clip && clip.trim()) setText(clip);
    else notify('Nothing pasted', 'The clipboard is empty, or the browser did not allow reading it. Paste into the box instead.');
  }

  async function handlePickFile() {
    const content = await pickTextFile();
    if (content) setText(content);
  }

  async function handleConfirm() {
    if (!parsed?.ok) return;
    const built = buildImportWrites({ payload: parsed.payload, existing: { ...existing, catalog: existing.catalog || (funds.length ? { funds } : null) } });
    if (!built.ok) {
      notify('Could not import', built.error);
      return;
    }
    setSaving(true);
    const outcome = await settleOrHandOff(importPortfolioSnapshot(built.writes), (err) => reportError(err, 'The portfolio import did not save'));
    setSaving(false);
    if (outcome.status === 'error') {
      notify('Could not import', outcome.error?.message || String(outcome.error));
      return;
    }
    setImported(`${Object.keys(parsed.payload.positions).length} holdings for ${parsed.payload.owner} as of ${parsed.payload.asOf}`);
    setText('');
    setChosen(null);
    onClose?.();
  }

  const p = parsed?.ok ? parsed.payload : null;

  return (
    <PortfolioShell
      variant={variant}
      title="Update Holdings"
      subtitle="Paste the setup file the first time, then the holdings, transaction history or fund details file Claude makes. Nothing is saved until you confirm."
    >
      {people.length > 1 ? (
        <View>
          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Whose Holdings</Text>
          <PortfolioPills options={people.map((name) => [name, name])} value={shownOwner} onChange={setChosen} />
        </View>
      ) : null}

      <View>
        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Holdings As Of</Text>
        <View style={{ maxWidth: 200 }}>
          <DateField value={asOf} onChange={setAsOf} className={input} />
        </View>
      </View>

      {Platform.OS === 'web' ? (
        <View className="flex-row flex-wrap gap-2 mb-2">
          <Pressable onPress={handlePaste} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-xs text-ink">Paste from Clipboard</Text>
          </Pressable>
          <Pressable onPress={handlePickFile} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-xs text-ink">Choose File</Text>
          </Pressable>
        </View>
      ) : null}

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
            Will save {plural(Object.keys(p.positions).length, 'holding')} for {p.owner} from {p.source}, as of {p.asOf}
          </Text>
          {p.catalog ? (
            <Text className="font-body text-xs text-ink">
              Fund list: {plural(p.catalog.funds.length, 'fund')} for {p.owner}
              {parsed.summary.replacedFunds > 0 ? `, replacing ${parsed.summary.replacedFunds} they have now` : ''}
              {parsed.summary.keptOtherFunds > 0 ? `. The other ${plural(parsed.summary.keptOtherFunds, 'fund')} ${parsed.summary.keptOtherFunds === 1 ? 'is' : 'are'} kept as ${parsed.summary.keptOtherFunds === 1 ? 'it is' : 'they are'}` : ''}
            </Text>
          ) : null}
          {parsed.summary.dropped?.length ? (
            <Text className="font-body text-xs text-mustard">Will leave the fund list (not in this file): {parsed.summary.dropped.join(', ')}</Text>
          ) : null}
          {Object.keys(p.prices || {}).length ? (
            <Text className="font-body text-xs text-ink">Prices: {plural(Object.keys(p.prices).length, 'stock')}, as of {p.asOf} (a stock is priced at each import)</Text>
          ) : null}
          {parsed.summary.removed?.length ? (
            <Text className="font-body text-xs text-mustard">Will be set to zero (not in this list, so sold): {parsed.summary.removed.join(', ')}</Text>
          ) : null}
          {p.overlap ? <Text className="font-body text-xs text-ink">Overlap data: {p.overlap.asOf || 'included'}, added to what is stored</Text> : null}
          {p.sipPlan ? <Text className="font-body text-xs text-ink">SIP plan: {Object.keys(p.sipPlan).length} {Object.keys(p.sipPlan).length === 1 ? 'fund' : 'funds'} for {p.owner}, from {p.asOf}</Text> : null}
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

      {extra ? (
        <PortfolioExtraImport
          kind={extra.kind}
          parsed={extra.parsed}
          preview={extraPreview}
          state={existing.state}
          onDone={(message) => {
            setImported(message);
            setText('');
            setChosen(null);
          }}
        />
      ) : null}

      <View className="flex-row gap-2 mt-3">
        {extra ? null : (
          <Pressable
            onPress={handleConfirm}
            disabled={!p || saving}
            className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
          >
            {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Confirm Import</Text>}
          </Pressable>
        )}
        {text ? (
          <Pressable onPress={() => setText('')} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-xs text-ink">Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {imported && !text ? <Text className="font-body text-xs text-ledger-green">Imported {imported}.</Text> : null}
    </PortfolioShell>
  );
}
