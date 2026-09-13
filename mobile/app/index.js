import { View, Text, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import SignInScreen from '../components/SignInScreen';

export default function Index() {
  const { user, allowed, initializing } = useAuth();

  if (initializing) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#3D7068" />
      </View>
    );
  }

  if (user && !allowed) {
    return (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        <Text className="font-display text-xl text-ink text-center mb-2">Not an approved account</Text>
        <Text className="font-body text-sm text-muted-text text-center">
          {user.email} isn't on the household's allowed list.
        </Text>
      </View>
    );
  }

  if (user && allowed) {
    return <Redirect href="/(tabs)/household" />;
  }

  return <SignInScreen />;
}
