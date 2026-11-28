import { View, Text, Pressable } from 'react-native';
import { FoldCard, Note } from './PortfolioRows';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';

// Where the money sits by asset class, against the targets set in Settings, now and after a year of the current SIPs at
// today's prices.
export default function PortfolioAssetMix({ mix, collapsible = false, onEdit }) {
  const { money } = usePortfolioPrivacy();
  const lead = mix.classes[0];
  return (
    <FoldCard
      title="Asset Mix"
      subtitle={mix.hasTargets ? 'Today against your targets' : 'Today, and after a year of SIPs'}
      summary={lead ? `${lead.label} ${Math.round(lead.pct)}%` : null}
      collapsible={collapsible}
      defaultOpen
    >
      {mix.classes.map((c) => (
        <View key={c.key} className="mb-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="font-body text-sm text-ink flex-1" numberOfLines={1}>{c.label}</Text>
            <Text className="font-mono-bold text-xs text-ink">
              {c.pct.toFixed(1)}%{c.target != null ? ` of ${c.target}%` : ''}
            </Text>
          </View>
          <View className="h-2 rounded-full bg-ink/10 mt-1 overflow-hidden">
            <View className="h-full rounded-full bg-ledger-green" style={{ width: `${Math.min(100, c.pct)}%` }} />
          </View>
          {c.target != null ? <View style={{ marginLeft: `${Math.min(99.5, c.target)}%`, marginTop: -8, width: 2, height: 8 }} className="bg-ink" /> : null}
          <Text className="font-body text-2xs text-muted-text mt-0.5">
            {money(c.value)}
            {c.gap != null && Math.abs(c.pct - c.target) >= 0.5 ? ` · ${money(Math.abs(c.gap))} ${c.gap > 0 ? 'under' : 'over'} target` : ''}
            {` · ${c.laterPct.toFixed(1)}% in a year`}
          </Text>
          {c.perDay != null && c.perDay >= 1 ? (
            <Text className="font-body text-2xs text-mustard">Reaching the target in a year takes {money(Math.ceil(c.perDay))} a day more, into this class only.</Text>
          ) : null}
        </View>
      ))}
      <Pressable onPress={onEdit} className="self-start min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
        <Text className="font-body-semibold text-xs text-ink">{mix.hasTargets ? 'Change Targets' : 'Set Targets'}</Text>
      </Pressable>
      <Note>The year-ahead figure adds 250 days of your SIP plan at today&apos;s prices. It is arithmetic, not a forecast.</Note>
    </FoldCard>
  );
}
