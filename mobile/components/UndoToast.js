import { View, Text, Pressable } from 'react-native';

// Shared by household.js/travel.js/payments.js (EntryList's delete) and
// cards.js (its own transaction delete) - rendered as a sibling of the
// screen's ScrollView so position:absolute is scoped to the viewport, not
// the scrollable content.
export default function UndoToast({ pendingDeleteList, getLabel, onUndo }) {
  if (pendingDeleteList.length === 0) return null;
  return (
    <View className="absolute left-4 right-4 bottom-24" style={{ gap: 8 }}>
      {pendingDeleteList.map(({ item }) => (
        <View key={item.id} className="flex-row items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3">
          <Text className="flex-1 font-body text-sm text-paper" numberOfLines={1}>
            {getLabel(item)}
          </Text>
          <Pressable onPress={() => onUndo(item.id)} hitSlop={8}>
            <Text className="font-body-semibold text-sm text-ledger-green underline">Undo</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
