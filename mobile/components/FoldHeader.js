import { View, Text, Pressable } from 'react-native';

// The header of a chart card that folds on a phone: title, a one-line subtitle (replaced by
// `summary` while folded, so the figure that matters is still visible) and an Expand / Collapse
// button. With `collapsible` off (wide screens) it is just a title and subtitle.
export default function FoldHeader({ title, subtitle, summary, collapsible = false, open = true, onToggle, children = null }) {
  return (
    <Pressable
      disabled={!collapsible}
      onPress={onToggle}
      className={`flex-row items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}
    >
      <View className="flex-1">
        <Text className="font-display text-lg text-ink">{title}</Text>
        <Text className="font-body text-xs text-muted-text" numberOfLines={1}>
          {open || !summary ? subtitle : summary}
        </Text>
      </View>
      {collapsible && (
        <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          <Text className="font-body-semibold text-xs text-muted-text">{open ? 'Collapse' : 'Expand'}</Text>
        </View>
      )}
      {children}
    </Pressable>
  );
}
