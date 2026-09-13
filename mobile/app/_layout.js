import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts, Fraunces_500Medium, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold, IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../lib/AuthContext';
import { LockProvider } from '../lib/LockContext';
import { JumpProvider } from '../lib/JumpContext';

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

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <LockProvider>
        <JumpProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </JumpProvider>
      </LockProvider>
    </AuthProvider>
  );
}
