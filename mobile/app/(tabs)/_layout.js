import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { View, Text, useWindowDimensions } from 'react-native';
import { useColorScheme } from 'nativewind';
import { subscribeToPinConfig, subscribeToRecurringRules, saveRecurringRulesToDb, addExpensesBatch } from '../../lib/firebase';
import { computeRecurringEntriesToGenerate, getMonthKey, todayISO } from '../../lib/utils';
import { reportError } from '../../lib/errorReporting';
import { useLock } from '../../lib/LockContext';
import PinLockScreen from '../../components/PinLockScreen';
import AskQuestion from '../../components/AskQuestion';
import TopNavBar from '../../components/TopNavBar';

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

// Runs at most once per app session - mirrors web's App.jsx, which was the
// only place this ever ran; mobile imported the Recurring rules UI but never
// called the generator, so a rule created on the phone only ever
// materialized if someone happened to open the web build that same month.
// The ref only ever locks true, never resets. Waits for dbRecurringRules to
// have actually loaded (an empty array on first render means "not loaded
// yet" as often as "no rules"), so it keeps re-checking until real data
// shows up.
function RecurringRuleRunner() {
  const generatedRef = useRef(false);

  useEffect(
    () =>
      subscribeToRecurringRules((rules) => {
        if (generatedRef.current || !rules.length) return;
        generatedRef.current = true;
        (async () => {
          const { toCreate, updatedRules } = computeRecurringEntriesToGenerate(rules, getMonthKey(todayISO()));
          if (toCreate.length) {
            try {
              await addExpensesBatch(toCreate);
            } catch (err) {
              reportError(err, 'Recurring expense generation failed');
              return;
            }
          }
          if (updatedRules) {
            await saveRecurringRulesToDb(updatedRules);
          }
        })();
      }),
    [],
  );

  return null;
}

export default function TabsLayout() {
  // The bottom tab bar (a phone idiom) and TopNavBar (the desktop-idiom
  // segmented control it replaces above 768px) are mutually exclusive -
  // hiding one without the other would either double up on nav or leave
  // none at all on some width.
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  // The tab bar is configured through React Navigation's own screenOptions,
  // a separate style system from NativeWind's className - it doesn't
  // re-theme on its own the way bg-paper/text-ink etc. do, so it needs the
  // current scheme read explicitly. Values match global.css's light/.dark
  // tokens for ledger-green/muted-text/paper/ink at 0.1 opacity.
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <PinGate>
      <View style={{ flex: 1 }}>
        <RecurringRuleRunner />
        <TopNavBar />
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: isDark ? '#4FB3A0' : '#3D7068',
            tabBarInactiveTintColor: isDark ? '#93A0B8' : '#5C6478',
            tabBarStyle: {
              display: isWide ? 'none' : 'flex',
              backgroundColor: isDark ? '#1A2130' : '#F2ECDD',
              borderTopColor: isDark ? 'rgba(237,230,211,0.1)' : 'rgba(36,48,74,0.1)',
            },
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
