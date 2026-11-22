import { memo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Card from './Card';
import { formatShortDate } from '../lib/portfolio';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { arrowOf, gainClass, signedPct } from './PortfolioSummary';

const num = (n, d = 3) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });

const FundRow = memo(function FundRow({ r }) {
  const { money, signed, units } = usePortfolioPrivacy();
  const [open, setOpen] = useState(false);
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
            <Text className="font-body text-2xs text-muted-text">{r.amc} · NAV {formatShortDate(r.navDate)}</Text>
            {r.estimated ? (
              <View className="px-1.5 py-0.5 rounded bg-mustard/20">
                <Text className="font-mono text-2xs text-mustard">units est.</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View className="items-end shrink-0">
          <Text className="font-mono-bold text-sm text-ink">{money(r.value)}</Text>
          <Text className={`font-mono text-2xs ${gainClass(r.day)}`}>
            {arrowOf(r.day)}
            {signed(r.day)} today
          </Text>
          <Text className={`font-mono text-2xs ${gainClass(r.pnl)}`}>
            {signed(r.pnl)} ({signedPct(r.pnlPct)})
          </Text>
        </View>
      </View>
      {open ? (
        <View className="mt-2 rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5">
          {[
            ['Units', units(num(r.units))],
            ['Average cost', money(r.avgCost)],
            ['Latest NAV', `₹${r.nav}`],
            ['Share of portfolio', `${r.share.toFixed(1)}%`],
            ['Units from', `${formatShortDate(r.snapshotDate)} snapshot${r.estimated ? ` + ${r.sipDays} SIP days` : ''}`],
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

// Passbook-style rows, largest first, grouped by where the units are held. Tap a row for units and average cost.
export default function PortfolioFundList({ portfolio }) {
  const { rows, byGroup } = portfolio;
  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Your funds</Text>
      <Text className="font-body text-xs text-muted-text mb-2">Tap a fund for units and average cost</Text>
      <Group title="Zerodha" rows={rows.filter((r) => r.group === 'zerodha')} total={byGroup.zerodha} />
      <Group title="Other funds" rows={rows.filter((r) => r.group === 'other')} total={byGroup.other} />
    </Card>
  );
}
