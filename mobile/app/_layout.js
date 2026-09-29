import '../global.css';
import { useEffect } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, ThemeProvider, DefaultTheme, DarkTheme } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
// Each @expo-google-fonts/X package's own root index.js is a barrel that
// eagerly `require()`s every weight and italic variant as a static asset
// (18 files for fraunces, 18 for inter, 14 for ibm-plex-mono) - Metro bundles
// all of them for the web build the moment anything imports from the
// package root, even though only 8 specific weights are ever named in
// useFonts below. That's ~9MB of unused .ttf files shipped on every web
// deploy (P2-1). Each weight's own subfolder (e.g.
// '@expo-google-fonts/inter/400Regular') has its own minimal index.js
// exporting just that one font under the same name - importing from there
// instead cuts the unused ~7.7MB without changing anything else.
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces/500Medium';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono/700Bold';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../lib/AuthContext';
import { LockProvider } from '../lib/LockContext';
import { JumpProvider } from '../lib/JumpContext';
import { SettingsModalProvider, useSettingsModal } from '../lib/SettingsModalContext';
import ConnectionBanner from '../components/ConnectionBanner';
import SettingsModal from '../components/SettingsModal';
import { getStoredColorScheme, hydrateMemoryStorage, setNativeStorageWriter } from '../lib/utils';
import { reportError } from '../lib/errorReporting';
import { themeColor } from '../lib/theme';

// The one place lib/utils.js's native-storage hooks get wired to a real
// store - utils.js itself stays import-free (see hydrateMemoryStorage's own
// comment) so the Node test suite can exercise it with no RN environment.
const NATIVE_STORAGE_KEY = 'splitkhata_local_storage';

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

// Reads the shared open/close flag so <SettingsModal> itself stays a plain
// visible/onClose component with no context awareness of its own.
function RootSettingsModal() {
  const { visible, close } = useSettingsModal();
  return <SettingsModal visible={visible} onClose={close} />;
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
  // pick up the right theme instead of only screens past auth. On native,
  // that preference has to be read from AsyncStorage first (localStorage
  // doesn't exist there - see lib/utils.js) before getStoredColorScheme has
  // anything to return; on web localStorage is already synchronous, so this
  // resolves immediately either way.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (Platform.OS !== 'web') {
        setNativeStorageWriter((data) => {
          AsyncStorage.setItem(NATIVE_STORAGE_KEY, JSON.stringify(data)).catch((err) => reportError(err, 'Could not save a device setting'));
        });
        try {
          const raw = await AsyncStorage.getItem(NATIVE_STORAGE_KEY);
          if (raw) hydrateMemoryStorage(JSON.parse(raw));
        } catch (err) {
          reportError(err, 'Could not load saved device settings');
        }
      }
      if (!cancelled) setColorScheme(getStoredColorScheme());
    }
    init();
    return () => {
      cancelled = true;
    };
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
            <SettingsModalProvider>
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
              {/* One instance for the whole app, not one per tab - see
                  SettingsModalContext for why this used to be up to 4. */}
              <RootSettingsModal />
            </SettingsModalProvider>
          </JumpProvider>
        </LockProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
