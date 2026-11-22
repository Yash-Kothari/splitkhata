import { View, Pressable, Text } from 'react-native';

// The Portfolio tab's own sections, in the same segmented style as the app's tab bar (TopNavBar), so the page is four short
// screens instead of one long scroll.
export default function PortfolioSectionNav({ sections, active, onChange }) {
  return (
    <View className="flex-row gap-1.5 p-1.5 rounded-xl bg-paper border border-ink/10 mb-4">
      {sections.map((s) => {
        const on = s.key === active;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            className={`flex-1 min-h-10 rounded-lg items-center justify-center ${on ? 'bg-ledger-green' : ''}`}
          >
            <Text className={`font-body-semibold text-xs sm:text-sm ${on ? 'text-white' : 'text-muted-text'}`}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
