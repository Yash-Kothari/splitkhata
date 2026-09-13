import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOutUser } from '../lib/firebase';
import SettingsModal from './SettingsModal';

// Matches web's <header> in App.jsx: "Splitkhata" + a ledger badge pill
// (bg-ledger-green/10, border-ledger-green/30, text-ledger-green). Shared
// across all four tabs so switching tabs doesn't jar - web shows the same
// header shape on every ledger, just with a different badge. Also owns the
// Settings entry point, since web's ⚙️ button lives in this same header,
// reachable from every ledger.
export default function AppHeader({ badge }) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <SafeAreaView className="bg-paper" edges={['top']}>
      <View className="flex-row items-center gap-1.5 px-4 pt-2 pb-3 border-b border-ink/10">
        <View className="flex-row items-center gap-1.5 flex-shrink" style={{ flexShrink: 1 }}>
          <Text className="font-display text-xl text-ink tracking-tight" numberOfLines={1}>
            Splitkhata
          </Text>
          <View className="px-2 py-1.5 rounded-xl border border-ledger-green/30 bg-ledger-green/10 flex-shrink" style={{ flexShrink: 1 }}>
            <Text className="font-body-semibold text-2xs text-ledger-green" numberOfLines={1}>
              {badge}
            </Text>
          </View>
        </View>
        <View className="flex-1" />
        <Pressable
          onPress={() => setShowSettings(true)}
          hitSlop={8}
          className="px-2 py-1.5 rounded-xl border border-ink/15 bg-paper shrink-0"
        >
          <Text className="font-body-semibold text-2xs text-ink">⚙️</Text>
        </Pressable>
        <Pressable
          onPress={() => signOutUser()}
          hitSlop={8}
          className="px-2.5 py-1.5 rounded-xl border border-ink/15 bg-paper shrink-0"
        >
          <Text className="font-body-semibold text-2xs text-stamp-red">Sign out</Text>
        </Pressable>
      </View>

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </SafeAreaView>
  );
}
