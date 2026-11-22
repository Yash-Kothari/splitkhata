import { useState } from 'react';
import { View, Text } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';
import { formatCurrency } from '../lib/utils';

function Label({ children }) {
  return <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1.5">{children}</Text>;
}

function BarRow({ label, right, pct, sub }) {
  return (
    <View className="mb-2">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-body text-sm text-ink flex-1" numberOfLines={1}>{label}</Text>
        <Text className="font-mono text-xs text-ink">{right}</Text>
      </View>
      <View className="h-2 rounded-full bg-ink/10 mt-1 overflow-hidden">
        <View className="h-full rounded-full bg-ledger-green" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </View>
      {sub ? <Text className="font-body text-2xs text-muted-text mt-0.5">{sub}</Text> : null}
    </View>
  );
}

// Which stocks you really own several times over, and which funds repeat each other. It uses each fund's top
// disclosed holdings only, so every figure here is a floor.
export default function PortfolioOverlap({ overlap, mix, asOf, collapsible = false }) {
  const [openState, setOpenState] = useState(false);
  const isOpen = !collapsible || openState;
  if (!overlap) return null;
  const { adani, shared, pairs } = overlap;
  const topShared = shared.slice(0, 10);
  const topPairs = pairs.slice(0, 8);
  const maxStock = adani.byStock[0]?.value || 1;

  return (
    <Card className="p-4 mb-4">
      <FoldHeader
        title="Overlap"
        subtitle={`Top holdings${asOf ? `, ${asOf}` : ''}. A floor, not the full picture`}
        summary={`Adani group ${adani.pct.toFixed(1)}% of the portfolio`}
        collapsible={collapsible}
        open={isOpen}
        onToggle={() => setOpenState((v) => !v)}
      />
      {isOpen ? (
        <View>
          <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5 mb-3">
            <Label>Adani group</Label>
            <Text className="font-mono-bold text-xl text-ink">{formatCurrency(adani.total)}</Text>
            <Text className="font-body text-xs text-muted-text mb-2">{adani.pct.toFixed(1)}% of the portfolio</Text>
            {adani.byStock.map((s) => (
              <BarRow key={s.stock} label={s.name} right={formatCurrency(s.value)} pct={(s.value / maxStock) * 100} />
            ))}
            {adani.byFund.length ? (
              <Text className="font-body text-xs text-muted-text mt-1">
                By fund: {adani.byFund.map((f) => `${f.fund} ${formatCurrency(f.value)}`).join(' · ')}
              </Text>
            ) : null}
            {adani.futures.map((f) => (
              <Text key={f.name} className="font-body text-2xs text-muted-text mt-1">
                Not counted: {f.name} (about {f.weight}% of that fund, {formatCurrency(f.value)}).
              </Text>
            ))}
          </View>

          <Label>Mix by type</Label>
          <View className="mb-3">
            {mix.map((m) => (
              <BarRow key={m.label} label={m.label} right={`${m.pct.toFixed(1)}% · ${formatCurrency(m.value)}`} pct={m.pct} />
            ))}
          </View>

          <Label>Stocks you own through several funds</Label>
          <View className="mb-3">
            {topShared.map((s) => (
              <View key={s.stock} className="py-1.5 border-b border-ink/10">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="font-body-semibold text-sm text-ink flex-1" numberOfLines={1}>{s.name}</Text>
                  <Text className="font-mono text-xs text-ink">{formatCurrency(s.value)}</Text>
                  <Text className="font-mono text-2xs text-muted-text w-10 text-right">{s.pct.toFixed(1)}%</Text>
                </View>
                <Text className="font-body text-2xs text-muted-text">{s.funds.length} funds: {s.funds.join(', ')}</Text>
              </View>
            ))}
          </View>

          <Label>Funds that overlap most</Label>
          {topPairs.map((p) => (
            <BarRow key={`${p.a}|${p.b}`} label={`${p.a} + ${p.b}`} right={`${p.pct.toFixed(0)}%`} pct={(p.pct / (topPairs[0].pct || 1)) * 100} />
          ))}
          <Text className="font-body text-2xs text-muted-text mt-1">Overlap is the sum of the smaller weight for each stock two funds share.</Text>
        </View>
      ) : null}
    </Card>
  );
}
