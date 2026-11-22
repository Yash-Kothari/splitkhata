import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import Card from './Card';
import { formatShortDate } from '../lib/portfolio';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

export const gainClass = (n) => (n > 0 ? 'text-ledger-green' : n < 0 ? 'text-stamp-red' : 'text-muted-text');
export const arrowOf = (n) => (n > 0 ? '▲ ' : n < 0 ? '▼ ' : '');
export const signedPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

function PnlChip({ pct }) {
  const box = pct > 0 ? 'bg-ledger-green/15' : pct < 0 ? 'bg-stamp-red/15' : 'bg-ink/5';
  return (
    <View className={`self-start px-1.5 py-0.5 rounded mt-1 ${box}`}>
      <Text className={`font-mono text-2xs ${gainClass(pct)}`}>
        {arrowOf(pct)}
        {signedPct(pct)}
      </Text>
    </View>
  );
}

// A lakh-crore amount with paise does not fit half a phone screen, so on a phone each tile gets its own row
// instead of wrapping the figure over two lines.
function Tile({ label, amount, pct, stacked }) {
  const { signed } = usePortfolioPrivacy();
  return (
    <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5" style={{ flexGrow: 1, flexBasis: stacked ? '100%' : '47%' }}>
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">{label}</Text>
      <Text className={`font-mono-bold text-lg ${gainClass(amount)}`} numberOfLines={1}>{signed(amount)}</Text>
      <PnlChip pct={pct} />
    </View>
  );
}

// Headline numbers: what it is worth now, what you put in, and how it did overall and on the last trading day.
export default function PortfolioSummary({ portfolio, view = null }) {
  const { total, byGroup, byKind, byOwner, navDate, rows } = portfolio;
  const hasStocks = byKind?.stocks?.count > 0;
  const people = Object.keys(byOwner || {});
  const { money, hidden, toggle } = usePortfolioPrivacy();
  const { width } = useWindowDimensions();
  const stacked = width < 560;
  return (
    <Card className="p-4 mb-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="font-display text-lg text-ink">{view ? `${view}'s Portfolio` : 'Portfolio'}</Text>
          <Text className="font-body text-xs text-muted-text mb-3">
            NAVs as of {formatShortDate(navDate)} · {rows.length} {hasStocks ? 'holdings' : 'funds'}
          </Text>
        </View>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={hidden ? 'Show Amounts' : 'Hide Amounts'}
          className="min-h-8 px-2.5 rounded-lg border border-ink/15 bg-paper items-center justify-center"
        >
          <Text className="font-body-semibold text-xs text-ink">{hidden ? '👁 Show Amounts' : '🙈 Hide Amounts'}</Text>
        </Pressable>
      </View>

      <View className="rounded-xl bg-ledger-green/10 px-3.5 py-2.5 mb-2">
        <Text className="font-body-semibold text-2xs text-ledger-green uppercase tracking-wider">Current Value</Text>
        <Text className="font-mono-bold text-ledger-green text-2xl">{money(total.value)}</Text>
        <Text className="font-body text-2xs text-muted-text mt-0.5">
          Invested <Text className="font-mono-bold text-ink">{money(total.cost)}</Text>
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Tile label="Total P&L" amount={total.pnl} pct={total.pnlPct} stacked={stacked} />
        <Tile label="Day Change" amount={total.day} pct={total.dayPct} stacked={stacked} />
      </View>

      <View className="mt-3 pt-3 border-t border-ink/10">
        {people.length > 1
          ? people.map((who) => (
              <View key={who} className="flex-row items-center justify-between gap-3 py-1">
                <Text className="font-body-semibold text-sm text-ink flex-1">{who}</Text>
                <Text className="font-mono-bold text-sm text-ink">{money(byOwner[who].value)}</Text>
                <Text className={`font-mono text-xs w-16 text-right ${gainClass(byOwner[who].pnlPct)}`}>{signedPct(byOwner[who].pnlPct)}</Text>
              </View>
            ))
          : null}
        {people.length > 1 ? <View className="border-t border-ink/10 my-1.5" /> : null}
        {(hasStocks
          ? [
              ['Mutual Funds', byKind.funds],
              ['Stocks', byKind.stocks],
            ]
          : [
              ['Zerodha', byGroup.zerodha],
              ['Other Funds', byGroup.other],
            ]
        )
          .filter(([, g]) => g.count > 0)
          .map(([label, g]) => (
            <View key={label} className="flex-row items-center justify-between gap-3 py-1">
              <Text className="font-body text-sm text-ink flex-1">{label}</Text>
              <Text className="font-mono text-sm text-ink">{money(g.value)}</Text>
              <Text className={`font-mono text-xs w-16 text-right ${gainClass(g.pnlPct)}`}>{signedPct(g.pnlPct)}</Text>
            </View>
          ))}
      </View>
    </Card>
  );
}
