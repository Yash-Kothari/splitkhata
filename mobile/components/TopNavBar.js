import { useRouter, usePathname } from 'expo-router';
import { View, Pressable, Text, useWindowDimensions } from 'react-native';

const TABS = [
  { href: '/payments', label: '💰 Payments' },
  { href: '/household', label: '🏠 Household' },
  { href: '/travel', label: '✈️ Travel' },
  { href: '/cards', label: '💳 Cards' },
];

// The bottom tab bar is a phone idiom - above 768px, a top segmented
// control (matching the original website's own nav, before it was replaced
// by this app) reads better and doesn't spend the taller viewport on a bar
// glued to the bottom edge. _layout.js hides the real bottom tab bar above
// the same 768px width, so exactly one nav is ever visible.
export default function TopNavBar() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();

  if (width < 768) return null;

  return (
    // No outer max-width/centering here - the root layout (app/_layout.js)
    // already caps and centers everything at md:max-w-5xl, same as
    // AppHeader and every screen's own content.
    <View className="px-3 sm:px-4 pb-3">
      <View className="flex-row gap-1.5 p-1.5 rounded-xl bg-paper border border-ink/10">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Pressable
              key={t.href}
              onPress={() => router.push(t.href)}
              className={`flex-1 min-h-11 rounded-lg items-center justify-center ${active ? 'bg-ledger-green' : ''}`}
            >
              <Text className={`font-body-semibold text-sm ${active ? 'text-white' : 'text-muted-text'}`}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
