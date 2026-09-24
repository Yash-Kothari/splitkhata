import '../global.css';
import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, ThemeProvider, DefaultTheme, DarkTheme } from 'expo-router';
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
import { reportError } from '../lib/errorReporting';
import { themeColor } from '../lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

// expo-router renders this in place of the route tree when anything below
// throws while rendering - without it a single bad render blanked the whole
// app (white screen on web, crash on native) with no way back but a reload.
export function ErrorBoundary({ error, retry }) {
  useEffect(() => {
    reportError(error, 'Something crashed');
  }, [error]);
  return (
    <View className="flex-1 items-center justify-center bg-paper px-8">
      <Text className="font-display text-xl text-ink mb-2">Something went wrong</Text>
      <Text className="font-body text-sm text-muted-text text-center mb-4">{error?.message}</Text>
      <Pressable onPress={retry} className="bg-ledger-green rounded-xl px-5 min-h-11 items-center justify-center">
        <Text className="font-body-semibold text-white">Try again</Text>
      </Pressable>
    </View>
  );
}

// React Navigation paints screens with its own light-gray default
// (rgb(242,242,242)), which showed through as a pale band behind the top nav
// in dark mode - these match global.css's --color-paper tokens instead.
const LIGHT_NAV_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: themeColor('paper', false), card: themeColor('paper', false) },
};
const DARK_NAV_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: themeColor('paper', true), card: themeColor('paper', true) },
};

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

  const navTheme = colorScheme === 'dark' ? DARK_NAV_THEME : LIGHT_NAV_THEME;

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
                <ThemeProvider value={navTheme}>
                  <Stack screenOptions={{ headerShown: false }} />
                </ThemeProvider>
              </View>
            </View>
          </JumpProvider>
        </LockProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
