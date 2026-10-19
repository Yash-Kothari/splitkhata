import { View, Text, ActivityIndicator, Pressable, Platform } from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { themeColor } from '../lib/theme';

// What the app shows while it works out whether you are signed in. Normally a spinner for a blink;
// if that takes unusually long it says so instead of staying blank, because a blank screen looks
// exactly like a broken app.
export default function StartupWait() {
  const { slowInit } = useAuth();
  return (
    <View className="flex-1 items-center justify-center bg-paper px-8">
      <ActivityIndicator color={themeColor('ledgerGreen', false)} />
      {slowInit ? (
        <>
          <Text className="font-body-semibold text-sm text-ink text-center mt-4">Still starting up...</Text>
          <Text className="font-body text-xs text-muted-text text-center mt-1">
            This is taking longer than usual. Check your connection, and that nothing is blocking firebaseapp.com or google.com, then try again.
          </Text>
          {Platform.OS === 'web' ? (
            <Pressable onPress={() => window.location.reload()} className="mt-4 px-4 min-h-10 rounded-xl border border-ink/15 items-center justify-center">
              <Text className="font-body-semibold text-sm text-ink">Reload</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
