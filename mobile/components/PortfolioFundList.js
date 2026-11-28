import { memo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Card from './Card';
import { formatShortDate, ownersOf, isStock } from '../lib/portfolio';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { arrowOf, gainClass, signedPct } from './PortfolioSummary';

const num = (n, d = 3) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });

const FundRow = memo(function FundRow({ r }) {
  const { money, signed, units } = usePortfolioPrivacy();
  const [open, setOpen] = useState(false);
  const stock = isStock(r);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${money(r.value)}`}
      className="py-2.5 border-b border-ink/10"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 min-w-0">
          <Text className="font-body-semibold text-sm text-ink" numberOfLines={2}>{r.name}</Text>
          <View className="flex-row items-center gap-1.5 mt-0.5 flex-wrap">
            <Text className="font-body text-2xs text-muted-text">
              {stock ? `${r.sector || 'Stock'} · Price ${formatShortDate(r.navDate)}` : `${r.amc} · NAV ${formatShortDate(r.navDate)}`}
            </Text>
            {stock ? (
              <View className="px-1.5 py-0.5 rounded bg-mustard/20">
                <Text className="font-mono text-2xs text-mustard">price at import</Text>
              </View>
            ) : null}
            {r.estimated ? (
              <View className="px-1.5 py-0.5 rounded bg-mustard/20">
                <Text className="font-mono text-2xs text-mustard">{stock ? 'incl. trades' : 'units est.'}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View className="items-end shrink-0">
          <Text className="font-mono-bold text-sm text-ink">{money(r.value)}</Text>
          {stock ? null : (
            <Text className={`font-mono text-2xs ${gainClass(r.day)}`}>
              {arrowOf(r.day)}
              {signed(r.day)} today
            </Text>
          )}
          <Text className={`font-mono text-2xs ${gainClass(r.pnl)}`}>
            {signed(r.pnl)} ({signedPct(r.pnlPct)})
          </Text>
        </View>
      </View>
      {open ? (
        <View className="mt-2 rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5">
          {[
            [stock ? 'Shares' : 'Units', units(num(r.units))],
            ['Average Cost', money(r.avgCost)],
            [stock ? 'Price' : 'Latest NAV', stock ? `₹${Number(r.nav).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : `₹${r.nav}`],
            ['Share of Portfolio', `${r.share.toFixed(1)}%`],
            [stock ? 'Shares From' : 'Units From', `${formatShortDate(r.snapshotDate)} ${stock ? 'import' : 'snapshot'}${r.estimated ? (stock ? ' + recorded trades' : ` + ${r.sipDays} SIP days`) : ''}`],
          ].map(([k, v]) => (
            <View key={k} className="flex-row justify-between gap-3 py-0.5">
              <Text className="font-body text-xs text-muted-text">{k}</Text>
              <Text className="font-mono text-xs text-ink">{v}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
});

function Group({ title, rows, total }) {
  const { money } = usePortfolioPrivacy();
  if (rows.length === 0) return null;
  return (
    <View className="mb-2">
      <View className="flex-row items-center justify-between gap-3 mb-1">
        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">{title}</Text>
        <Text className="font-mono-bold text-xs text-ink">{money(total.value)}</Text>
      </View>
      {rows.map((r) => (
        <FundRow key={r.key} r={r} />
      ))}
    </View>
  );
}

// Passbook-style rows, largest first, grouped by where the units are held (and, when more than one person is in view, whose they
// are). Tap a row for units and average cost.
export default function PortfolioFundList({ portfolio, view = null, onTrade }) {
  const { rows } = portfolio;
  const people = ownersOf(rows);
  const multi = people.length > 1;
  const sum = (list) => ({ value: list.reduce((a, r) => a + r.value, 0) });
  return (
    <Card className="p-4 mb-4">
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-1">
          <Text className="font-display text-lg text-ink">{view ? `${view}'s Funds` : multi ? 'All Funds' : 'Your Funds'}</Text>
          <Text className="font-body text-xs text-muted-text">Tap a fund for units and average cost</Text>
        </View>
        <Pressable onPress={onTrade} accessibilityRole="button" className="min-h-8 px-3 rounded-lg border border-ink/15 bg-paper items-center justify-center">
          <Text className="font-body-semibold text-xs text-ink">＋ Record a Trade</Text>
        </Pressable>
      </View>
      {people.flatMap((who) =>
        [
          ['zerodha', false, 'Zerodha'],
          ['other', false, 'Other Funds'],
          ['zerodha', true, 'Stocks · Zerodha'],
          ['other', true, 'Stocks · Other'],
        ].map(([group, stocks, label]) => {
          const list = rows.filter((r) => r.owner === who && r.group === group && isStock(r) === stocks);
          return <Group key={`${who}|${group}|${stocks}`} title={multi ? `${who} · ${label}` : label} rows={list} total={sum(list)} />;
        }),
      )}
    </Card>
  );
}
