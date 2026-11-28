import { View, Text } from 'react-native';
import { FoldCard, Line, Note, Heading, HISTORY_NEEDED } from './PortfolioRows';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { formatShortDate, ownerOf } from '../lib/portfolio';
import { realisedGains, computeTax, TAX } from '../lib/portfolioLedger';
import { gainClass } from './PortfolioSummary';

function Person({ name, r, slabPct }) {
  const { money, signed } = usePortfolioPrivacy();
  const tax = computeTax(r.buckets, slabPct);
  const rows = [
    ['Equity, Long Term', r.buckets.equityLT],
    ['Equity, Short Term', r.buckets.equityST],
    ['Other Funds, Long Term', r.buckets.otherLT],
    ['Taxed at Slab Rate', r.buckets.slab],
  ].filter(([, v]) => Math.abs(v) >= 0.5);
  return (
    <View className="mb-2">
      {name ? <Heading>{name}</Heading> : null}
      <Text className="font-body text-sm text-ink">
        {money(r.exemptionUsed)} of the {money(TAX.exemption)} tax-free long-term gain used
      </Text>
      <View className="h-2 rounded-full bg-ink/10 mt-1 mb-1 overflow-hidden">
        <View className="h-full rounded-full bg-ledger-green" style={{ width: `${(r.exemptionUsed / TAX.exemption) * 100}%` }} />
      </View>
      <Text className="font-body text-xs text-muted-text">{money(r.exemptionLeft)} left until 31 March.</Text>
      {rows.map(([k, v]) => (
        <Line key={k} label={k} value={signed(v)} tone={gainClass(v)} />
      ))}
      <Line strong label="Estimated Tax So Far" value={money(tax)} />
      {r.sales.slice(0, 6).map((s) => (
        <Line key={`${s.key}${s.date}${s.units}`} label={s.short} sub={`Redeemed ${formatShortDate(s.date)}`} value={money(s.amount)} valueSub={`${signed(s.gain)} gain`} />
      ))}
      {r.estimated ? <Note tone="text-mustard">Some figures rest on estimated entries after the statement date.</Note> : null}
      {r.oldLots ? <Note tone="text-mustard">Units bought before February 2018 are not grandfathered here, so their gain may be overstated.</Note> : null}
      {r.missing.length ? <Note tone="text-mustard">Not counted (no history): {r.missing.join(', ')}.</Note> : null}
    </View>
  );
}

// This financial year's realised gains and how much of the yearly tax-free long-term gain is used, per person (the
// exemption is each person's own).
export default function PortfolioGains({ funds, owners, ledgers, taxClassFor, slabPct, today, collapsible = false }) {
  const { money } = usePortfolioPrivacy();
  const people = owners
    .map((owner) => ({ owner, r: realisedGains({ funds, ledgers, taxClassOf: taxClassFor, owner, today }) }))
    .filter(({ owner }) => funds.some((f) => ownerOf(f) === owner && ledgers[f.key]));
  const first = people[0]?.r;
  return (
    <FoldCard
      title="Gains This Year"
      subtitle={first ? `Financial year ${first.fy.label}` : 'Realised gains and the tax-free limit'}
      summary={first ? `${money(first.exemptionLeft)} tax-free gain left` : 'Needs transaction history'}
      collapsible={collapsible}
    >
      {people.length === 0 ? (
        <Note>{HISTORY_NEEDED}</Note>
      ) : (
        <View>
          {people.map(({ owner, r }) => (
            <Person key={owner} name={people.length > 1 ? owner : null} r={r} slabPct={slabPct} />
          ))}
          <Note>Mutual funds only: gains on shares you sold directly also use this limit. Tax is an estimate with 4% cess, before surcharge.</Note>
        </View>
      )}
    </FoldCard>
  );
}
