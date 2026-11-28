import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Card from './Card';
import FoldHeader from './FoldHeader';

// Pieces the Portfolio analysis cards share: the folding card, a label / value line and a caption.
export function FoldCard({ title, subtitle, summary, collapsible = false, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = !collapsible || open;
  return (
    <Card className="p-4 mb-4">
      <FoldHeader title={title} subtitle={subtitle} summary={summary} collapsible={collapsible} open={isOpen} onToggle={() => setOpen((v) => !v)} />
      {isOpen ? <View>{children}</View> : null}
    </Card>
  );
}

export function Line({ label, sub, value, valueSub, tone = 'text-ink', valueTone = 'text-muted-text', strong = false }) {
  return (
    <View className="flex-row items-start justify-between gap-3 py-1.5 border-b border-ink/10">
      <View className="flex-1 min-w-0">
        <Text className={`${strong ? 'font-body-semibold' : 'font-body'} text-sm text-ink`} numberOfLines={2}>{label}</Text>
        {sub ? <Text className="font-body text-2xs text-muted-text">{sub}</Text> : null}
      </View>
      <View className="items-end shrink-0">
        <Text className={`font-mono-bold text-sm ${tone}`}>{value}</Text>
        {valueSub ? <Text className={`font-mono text-2xs ${valueTone}`}>{valueSub}</Text> : null}
      </View>
    </View>
  );
}

export function Note({ children, tone = 'text-muted-text' }) {
  return <Text className={`font-body text-2xs mt-2 ${tone}`}>{children}</Text>;
}

export function Heading({ children }) {
  return <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mt-3 mb-1">{children}</Text>;
}

// A long list of funds, cut to the first few until asked for. A name held in two places gets "(other)" on the second.
export function FundLines({ items, first = 6, render }) {
  const [all, setAll] = useState(false);
  const twice = new Set(items.map((i) => i.short).filter((s, n, list) => list.indexOf(s) !== n));
  const named = items.map((i) => (twice.has(i.short) && i.group === 'other' ? { ...i, short: `${i.short} (other)` } : i));
  return (
    <View>
      {(all ? named : named.slice(0, first)).map(render)}
      {named.length > first ? (
        <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button" className="self-start mt-2 min-h-8 px-3 rounded-lg border border-ink/15 bg-paper items-center justify-center">
          <Text className="font-body-semibold text-xs text-ink">{all ? 'Show Fewer' : `Show All ${named.length}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const HISTORY_NEEDED = 'This needs your transaction history. Give Claude a detailed CAS (all years), then paste the file it makes in Settings → Portfolio → Import & Export.';
