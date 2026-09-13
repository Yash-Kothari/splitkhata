import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { subscribeToPinConfig } from '../../lib/firebase';
import { useLock } from '../../lib/LockContext';
import PinLockScreen from '../../components/PinLockScreen';

function TabIcon({ emoji }) {
  return <Text style={{ fontSize: 20 }}>{emoji}</Text>;
}

// Gates the tabs (i.e. everything past sign-in) behind PinLockScreen when a
// PIN is configured - matches web's App.jsx, which locks by default on
// every fresh load if getPinConfig().enabled && .pin, and unlocks for the
// rest of that session once the right PIN is entered. Firestore-backed here
// instead of web's localStorage, so the very first snapshot decides whether
// to lock rather than a synchronous initial state.
function PinGate({ children }) {
  const { isLocked, setIsLocked } = useLock();
  const [pinConfig, setPinConfig] = useState(null);
  const bootstrapped = useRef(false);

  useEffect(
    () =>
      subscribeToPinConfig((cfg) => {
        setPinConfig(cfg);
        if (!bootstrapped.current) {
          bootstrapped.current = true;
          if (cfg.enabled && cfg.pin) setIsLocked(true);
        }
      }),
    [setIsLocked],
  );

  if (pinConfig === null) return null;
  if (isLocked && pinConfig.enabled && pinConfig.pin) {
    return <PinLockScreen correctPin={pinConfig.pin} onUnlock={() => setIsLocked(false)} />;
  }
  return children;
}

export default function TabsLayout() {
  return (
    <PinGate>
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#3D7068',
        tabBarInactiveTintColor: '#5C6478',
        tabBarStyle: { backgroundColor: '#F2ECDD', borderTopColor: 'rgba(36,48,74,0.1)' },
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="payments"
        options={{ title: 'Payments', tabBarIcon: () => <TabIcon emoji="💰" /> }}
      />
      <Tabs.Screen
        name="household"
        options={{ title: 'Household', tabBarIcon: () => <TabIcon emoji="🏠" /> }}
      />
      <Tabs.Screen
        name="travel"
        options={{ title: 'Travel', tabBarIcon: () => <TabIcon emoji="✈️" /> }}
      />
      <Tabs.Screen
        name="cards"
        options={{ title: 'Cards', tabBarIcon: () => <TabIcon emoji="💳" /> }}
      />
      </Tabs>
    </PinGate>
  );
}
