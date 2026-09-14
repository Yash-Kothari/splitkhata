import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';
import { subscribeToPinConfig } from '../../lib/firebase';
import { useLock } from '../../lib/LockContext';
import PinLockScreen from '../../components/PinLockScreen';
import AskQuestion from '../../components/AskQuestion';

// A plain color-change on the emoji (the old behavior) is subtle enough
// that it wasn't reading as "this is the selected tab" - a filled pill
// behind the icon makes the active tab unambiguous at a glance, matching
// the kind of selected-state affordance modern tab bars use.
function TabIcon({ emoji, focused }) {
  return (
    <View
      style={{
        width: 44,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(61,112,104,0.15)' : 'transparent',
      }}
    >
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
    </View>
  );
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
      <View style={{ flex: 1 }}>
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
            options={{ title: 'Payments', tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} /> }}
          />
          <Tabs.Screen
            name="household"
            options={{ title: 'Household', tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} /> }}
          />
          <Tabs.Screen
            name="travel"
            options={{ title: 'Travel', tabBarIcon: ({ focused }) => <TabIcon emoji="✈️" focused={focused} /> }}
          />
          <Tabs.Screen
            name="cards"
            options={{ title: 'Cards', tabBarIcon: ({ focused }) => <TabIcon emoji="💳" focused={focused} /> }}
          />
        </Tabs>
        <AskQuestion />
      </View>
    </PinGate>
  );
}
