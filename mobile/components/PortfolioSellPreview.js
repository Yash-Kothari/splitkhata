import { useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { FoldCard, Line, Note, Heading, HISTORY_NEEDED } from './PortfolioRows';
import PickerField from './PickerField';
import PortfolioPills from './PortfolioPills';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { formatShortDate, ownerOf, ownersOf } from '../lib/portfolio';
import { previewSale, realisedGains, emptyBuckets } from '../lib/portfolioLedger';
import { parseAmountInput } from '../lib/utils';
import { gainClass } from './PortfolioSummary';

const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';
const MODES = [
  ['amount', 'Amount'],
  ['units', 'Units'],
  ['all', 'Everything'],
];
const BUCKET = { equityST: 'short term', equityLT: 'long term', otherLT: 'long term', slab: 'slab rate' };
const num = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const date = (iso) => `${formatShortDate(iso)} ${iso.slice(0, 4)}`;

// "What if I redeemed this today?": which units go (oldest first), the exit load, the gain and the extra tax. Nothing is
// recorded or sent anywhere.
export default function PortfolioSellPreview({ rows, funds, ledgers, taxClassFor, detailsFor, slabPct, today, collapsible = false }) {
  const { money, signed, units } = usePortfolioPrivacy();
  const [key, setKey] = useState('');
  const [mode, setMode] = useState('amount');
  const [text, setText] = useState('');
  const [showLots, setShowLots] = useState('few');

  const offered = rows.filter((r) => ledgers[r.key]);
  const multi = ownersOf(offered).length > 1;
  const options = offered.map((r) => ({ value: r.key, label: `${r.short || r.name}${r.group === 'other' ? ' (other)' : ''}${multi ? ` · ${ownerOf(r)}` : ''}` }));
  const row = offered.find((r) => r.key === key) || null;
  const ledger = row ? ledgers[row.key] : null;

  const result = useMemo(() => {
    if (!row || (mode !== 'all' && !text.trim())) return null;
    const owner = ownerOf(row);
    const realised = realisedGains({ funds, ledgers, taxClassOf: taxClassFor, owner, today }).buckets;
    const typed = mode === 'units' ? Number(text.replace(/,/g, '')) : parseAmountInput(text);
    return previewSale({
      ledger,
      nav: row.nav,
      units: mode === 'all' ? ledger.units : mode === 'units' ? typed : null,
      amount: mode === 'amount' ? typed : null,
      date: today,
      taxClass: taxClassFor(row),
      exitLoad: detailsFor(row).exitLoad,
      realised: realised || emptyBuckets(),
      slabPct,
    });
  }, [row, ledger, mode, text, funds, ledgers, taxClassFor, detailsFor, slabPct, today]);

  const lots = result?.ok ? (showLots === 'all' ? result.lots : result.lots.slice(0, 5)) : [];

  return (
    <FoldCard title="Sell Preview" subtitle="Tax and exit load before you redeem" summary={offered.length ? null : 'Needs transaction history'} collapsible={collapsible} defaultOpen>
      {offered.length === 0 ? (
        <Note>{HISTORY_NEEDED}</Note>
      ) : (
        <View className="gap-2.5">
          <PickerField label="Fund" value={key} options={options} onChange={(v) => { setKey(v); setShowLots('few'); }} />
          <PortfolioPills options={MODES} value={mode} onChange={(m) => { setMode(m); setText(''); }} />
          {mode !== 'all' ? (
            <TextInput
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              placeholder={mode === 'amount' ? 'Rupees to redeem' : 'Units to redeem'}
              aria-label={mode === 'amount' ? 'Rupees to redeem' : 'Units to redeem'}
              className={input}
            />
          ) : null}
          {row ? <Text className="font-body text-xs text-muted-text">Holding {units(num(ledger.units))} units, {money(ledger.units * row.nav)} at the {formatShortDate(row.navDate)} NAV.</Text> : null}
          {result && !result.ok ? <Text className="font-body text-xs text-stamp-red">{result.error}</Text> : null}
          {result?.ok ? (
            <View>
              <Line label="Redemption Value" sub={`${units(num(result.units))} units`} value={money(result.value)} />
              <Line label="Cost of Those Units" value={money(result.cost)} />
              <Line label="Gain After Exit Load" value={signed(result.gain)} tone={gainClass(result.gain)} />
              <Line label="Exit Load" value={result.exitLoadKnown ? money(result.exitLoad) : 'Not on file'} tone={result.exitLoadKnown ? 'text-ink' : 'text-mustard'} />
              <Line label="Estimated Extra Tax" value={money(result.tax)} />
              <Line strong label="Left in Hand" value={money(result.inHand)} />
              {result.nextLongTerm ? <Note tone="text-mustard">Some units are short term. The oldest of them turns long term on {date(result.nextLongTerm)}.</Note> : null}
              {!result.exitLoadKnown ? <Note tone="text-mustard">The exit load is left out. Import the fund details file to include it.</Note> : null}
              {result.estimated ? <Note tone="text-mustard">Some of these units are estimated entries after the statement date.</Note> : null}
              {result.oldLots ? <Note tone="text-mustard">Units bought before February 2018 are not grandfathered here, so their gain may be overstated.</Note> : null}
              <Heading>Units Used, Oldest First</Heading>
              {lots.map((l, i) => (
                <Line
                  key={`${l.date}-${i}`}
                  label={date(l.date)}
                  sub={`${units(num(l.units))} units · ${BUCKET[l.bucket]}${l.load > 0 ? ` · ${l.loadPct}% load` : ''}`}
                  value={signed(l.gain)}
                  tone={gainClass(l.gain)}
                />
              ))}
              {result.lots.length > 5 ? (
                <View className="mt-2">
                  <PortfolioPills options={[['few', 'First 5'], ['all', `All ${result.lots.length}`]]} value={showLots} onChange={setShowLots} />
                </View>
              ) : null}
              <Note>An estimate for this financial year with your {slabPct}% slab rate and 4% cess, before surcharge; stamp duty and STT are left out. Confirm with your statement or tax filing.</Note>
            </View>
          ) : null}
        </View>
      )}
    </FoldCard>
  );
}
