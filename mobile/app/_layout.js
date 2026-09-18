import '../global.css';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Fraunces_500Medium, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold, IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../lib/AuthContext';
import { LockProvider } from '../lib/LockContext';
import { JumpProvider } from '../lib/JumpContext';
import ConnectionBanner from '../components/ConnectionBanner';
import { getStoredColorScheme } from '../lib/utils';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    IBMPlexMono_700Bold,
  });

  const { colorScheme, setColorScheme } = useColorScheme();

  // NativeWind's own color scheme starts out following the OS, not this
  // app's per-device preference (see getStoredColorScheme) - applied once
  // up front, above sign-in, so even the sign-in screen and lock screen
  // pick up the right theme instead of only screens past auth.
  useEffect(() => {
    setColorScheme(getStoredColorScheme());
  }, [setColorScheme]);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    // Without this, useSafeAreaInsets() (React Navigation's bottom tab bar
    // included) has no context to read from and silently falls back to
    // zero insets - the tab bar was rendering flush against the bottom
    // edge with no allowance for the home indicator on notched iPhones.
    // AppHeader's own SafeAreaView happened to still get a top inset from
    // the native module's initial-frame fallback, which is why only the
    // bottom was visibly broken.
    <SafeAreaProvider>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AuthProvider>
        <LockProvider>
          <JumpProvider>
            {/* Native always fills the physical screen, so this only ever
                engages on a wide browser window (md: = 768px+) - matches
                web's own <header>/nav/<main> container (max-w-5xl mx-auto
                = 1024px). Settings/Trip Settings keep their own smaller,
                independent maxWidth (576/560px) regardless of this - web's
                own versions of those modals are ALSO capped narrower than
                the page itself, so that's correct, not a mismatch. Forms
                now lay out in a responsive flex-wrap grid (see
                AddEntryForm.js etc.) so this width actually gets used
                instead of leaving an empty gutter. */}
            <View className="flex-1 bg-paper md:items-center">
              <ConnectionBanner />
              <View className="flex-1 w-full md:max-w-5xl">
                <Stack screenOptions={{ headerShown: false }} />
              </View>
            </View>
          </JumpProvider>
        </LockProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
