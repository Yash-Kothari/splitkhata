import { View, Text, Pressable } from 'react-native';

// A row of equal-width choices (a range, a view). One look for every Portfolio card that needs one.
export default function PortfolioPills({ options, value, onChange }) {
  return (
    <View className="flex-row gap-1.5">
      {options.map(([key, text]) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          accessibilityRole="button"
          aria-selected={value === key}
          className={`flex-1 min-h-9 rounded-xl items-center justify-center border px-1 ${value === key ? 'bg-ledger-green border-ledger-green' : 'border-ink/15 bg-paper'}`}
        >
          <Text className={`font-body-semibold text-xs ${value === key ? 'text-white' : 'text-ink'}`} numberOfLines={1}>{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}
