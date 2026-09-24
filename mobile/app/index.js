import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { signOutUser } from '../lib/firebase';
import { reportError } from '../lib/errorReporting';
import SignInScreen from '../components/SignInScreen';
import { themeColor } from '../lib/theme';

export default function Index() {
  const { user, allowed, initializing } = useAuth();

  if (initializing) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color={themeColor('ledgerGreen', false)} />
      </View>
    );
  }

  if (user && !allowed) {
    return (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        <Text className="font-display text-xl text-ink text-center mb-2">Not an approved account</Text>
        <Text className="font-body text-sm text-muted-text text-center mb-5">
          {user.email} isn't on the household's allowed list.
        </Text>
        {/* Without a way out, picking the wrong Google account left you stuck
            here until you cleared site data or reinstalled the app. */}
        <Pressable
          onPress={() => signOutUser().catch((err) => reportError(err, 'Could not sign out'))}
          className="bg-ledger-green rounded-xl px-5 min-h-11 items-center justify-center"
        >
          <Text className="font-body-semibold text-white">Use a different account</Text>
        </Pressable>
      </View>
    );
  }

  if (user && allowed) {
    return <Redirect href="/(tabs)/household" />;
  }

  return <SignInScreen />;
}
