import { View, Text, useWindowDimensions } from 'react-native';
import Card from './Card';
import { formatCurrency } from '../lib/utils';
import { formatShortDate } from '../lib/portfolio';

export const gainClass = (n) => (n > 0 ? 'text-ledger-green' : n < 0 ? 'text-stamp-red' : 'text-muted-text');
export const arrowOf = (n) => (n > 0 ? '▲ ' : n < 0 ? '▼ ' : '');
// "+₹1,234.00" / "-₹1,234.00": formatCurrency carries the minus, the plus is added here.
export const signedCurrency = (n) => `${n > 0 ? '+' : ''}${formatCurrency(n)}`;
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
  return (
    <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5" style={{ flexGrow: 1, flexBasis: stacked ? '100%' : '47%' }}>
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">{label}</Text>
      <Text className={`font-mono-bold text-lg ${gainClass(amount)}`} numberOfLines={1}>{signedCurrency(amount)}</Text>
      <PnlChip pct={pct} />
    </View>
  );
}

// Headline numbers: what it is worth now, what you put in, and how it did overall and on the last trading day.
export default function PortfolioSummary({ portfolio }) {
  const { total, byGroup, navDate, rows } = portfolio;
  const { width } = useWindowDimensions();
  const stacked = width < 560;
  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Portfolio</Text>
      <Text className="font-body text-xs text-muted-text mb-3">
        NAVs as of {formatShortDate(navDate)} · {rows.length} funds
      </Text>

      <View className="rounded-xl bg-ledger-green/10 px-3.5 py-2.5 mb-2">
        <Text className="font-body-semibold text-2xs text-ledger-green uppercase tracking-wider">Current value</Text>
        <Text className="font-mono-bold text-ledger-green text-2xl">{formatCurrency(total.value)}</Text>
        <Text className="font-body text-2xs text-muted-text mt-0.5">
          Invested <Text className="font-mono-bold text-ink">{formatCurrency(total.cost)}</Text>
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Tile label="Total P&L" amount={total.pnl} pct={total.pnlPct} stacked={stacked} />
        <Tile label="Day change" amount={total.day} pct={total.dayPct} stacked={stacked} />
      </View>

      <View className="mt-3 pt-3 border-t border-ink/10">
        {[
          ['Zerodha', byGroup.zerodha],
          ['Other funds', byGroup.other],
        ]
          .filter(([, g]) => g.count > 0)
          .map(([label, g]) => (
            <View key={label} className="flex-row items-center justify-between gap-3 py-1">
              <Text className="font-body text-sm text-ink flex-1">{label}</Text>
              <Text className="font-mono text-sm text-ink">{formatCurrency(g.value)}</Text>
              <Text className={`font-mono text-xs w-16 text-right ${gainClass(g.pnlPct)}`}>{signedPct(g.pnlPct)}</Text>
            </View>
          ))}
      </View>
    </Card>
  );
}
