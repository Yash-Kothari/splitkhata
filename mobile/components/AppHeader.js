import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOutUser } from '../lib/firebase';

// Matches web's <header> in App.jsx: "Splitkhata" + a ledger badge pill
// (bg-ledger-green/10, border-ledger-green/30, text-ledger-green). Shared
// across all four tabs so switching tabs doesn't jar - web shows the same
// header shape on every ledger, just with a different badge.
export default function AppHeader({ badge }) {
  return (
    <SafeAreaView className="bg-paper" edges={['top']}>
      <View className="flex-row items-center gap-2 px-4 pt-2 pb-3 border-b border-ink/10">
        <Text className="font-display text-xl font-bold text-ink tracking-tight">Splitkhata</Text>
        <View className="px-2.5 py-1.5 rounded-xl border border-ledger-green/30 bg-ledger-green/10">
          <Text className="font-body-semibold text-2xs text-ledger-green">{badge}</Text>
        </View>
        <View className="flex-1" />
        <Pressable
          onPress={() => signOutUser()}
          hitSlop={8}
          className="px-3 py-1.5 rounded-xl border border-ink/15 bg-paper"
        >
          <Text className="font-body-semibold text-2xs text-stamp-red">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
