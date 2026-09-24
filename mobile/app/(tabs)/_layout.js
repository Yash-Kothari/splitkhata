import { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs, Redirect } from 'expo-router';
import { View, Text, Platform, AppState, useWindowDimensions } from 'react-native';
import { useColorScheme } from 'nativewind';
import { subscribeToPinConfig, subscribeToRecurringRules, runRecurringGeneration } from '../../lib/firebase';
import { getMonthKey, todayISO, decideInitialLock, shouldRelockAfterBackground } from '../../lib/utils';
import { reportError } from '../../lib/errorReporting';
import { getJSON, setJSON } from '../../lib/deviceStore';
import { themeColor, themeRgba } from '../../lib/theme';
import { useLock } from '../../lib/LockContext';
import { useAuth } from '../../lib/AuthContext';
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

const PIN_LAST_KNOWN_KEY = 'splitkhata_pin_last_known';

// Gates the tabs (i.e. everything past sign-in) behind PinLockScreen when a
// PIN is configured - matches web's App.jsx, which locks by default on
// every fresh load if the PIN is enabled, and unlocks for the rest of that
// session once the right PIN is entered.
//
// Two things this used to get wrong (P0-13):
// - only the FIRST Firestore snapshot ever decided whether to lock, and an
//   empty offline-cache read was read the same as "PIN disabled" - opening
//   the app offline skipped the lock outright, permanently for that session.
// - nothing ever re-locked an unlocked session, so leaving the app open
//   (or backgrounded) defeated the PIN entirely.
// decideInitialLock/shouldRelockAfterBackground (utils.js) hold the actual
// decision logic, kept pure and tested on their own; this component is just
// the wiring: deviceStore remembers the last config this device actually
// confirmed, across relaunches, for the offline case to fail closed against.
function PinGate({ children }) {
  const { isLocked, setIsLocked } = useLock();
  const [pinConfig, setPinConfig] = useState(null);
  const [ready, setReady] = useState(false);
  const lastKnownRef = useRef(null);
  const bootstrapped = useRef(false);
  const hiddenAtRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getJSON(PIN_LAST_KNOWN_KEY, null).then((stored) => {
      if (cancelled) return;
      lastKnownRef.current = stored;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    return subscribeToPinConfig((snapshot) => {
      if (!bootstrapped.current) {
        bootstrapped.current = true;
        const decision = decideInitialLock({ lastKnown: lastKnownRef.current, snapshot });
        setPinConfig(decision.config);
        if (decision.locked) setIsLocked(true);
        if (decision.trustworthy) {
          lastKnownRef.current = decision.config;
          setJSON(PIN_LAST_KNOWN_KEY, decision.config);
        }
        return;
      }
      // After bootstrap: only a real server answer updates the remembered
      // config and last-known record - a later cache/error blip must not
      // erase what was already confirmed.
      if (snapshot.error || (snapshot.fromCache && !snapshot.exists)) return;
      const config = snapshot.enabled && (snapshot.pinHash || snapshot.legacyPin)
        ? { enabled: true, pinHash: snapshot.pinHash, legacyPin: snapshot.legacyPin }
        : null;
      setPinConfig(config);
      lastKnownRef.current = config;
      setJSON(PIN_LAST_KNOWN_KEY, config);
    });
  }, [ready, setIsLocked]);

  // Re-lock after time away, not just on the first load - a phone left
  // unlocked on a table stayed unlocked forever otherwise.
  useEffect(() => {
    if (Platform.OS === 'web') {
      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          hiddenAtRef.current = Date.now();
          return;
        }
        if (hiddenAtRef.current == null) return;
        const hiddenForMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (shouldRelockAfterBackground({ lastKnown: lastKnownRef.current, hiddenForMs, platform: 'web' })) setIsLocked(true);
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (state === 'active' && hiddenAtRef.current != null) {
        const hiddenForMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (shouldRelockAfterBackground({ lastKnown: lastKnownRef.current, hiddenForMs, platform: Platform.OS })) setIsLocked(true);
      }
    });
    return () => subscription.remove();
  }, [setIsLocked]);

  if (!ready || pinConfig === undefined) return null;
  if (isLocked && pinConfig) {
    return <PinLockScreen pinConfig={pinConfig} onUnlock={() => setIsLocked(false)} />;
  }
  return children;
}

// Creates any recurring entries that are due. The generation itself is one
// server transaction with fixed ids per rule and month (see
// runRecurringGeneration), so running it often is safe - it runs on start,
// whenever the rules change (a rule added mid-session no longer waits for a
// restart), and when the app comes back to the foreground (so a month that
// rolls over while the app stays open is caught). Only one run at a time;
// a request that arrives mid-run queues a single follow-up.
function RecurringRuleRunner() {
  const runningRef = useRef(false);
  const rerunRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    runningRef.current = true;
    try {
      await runRecurringGeneration(getMonthKey(todayISO()));
    } catch (err) {
      // Offline: transactions need the server; the next run picks it up.
      if (err?.code !== 'unavailable') reportError(err, 'Recurring expense generation failed');
    } finally {
      runningRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        run();
      }
    }
  }, []);

  useEffect(() => subscribeToRecurringRules(() => run()), [run]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') run();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [run]);

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

  // index.js used to be the only sign-in check, so signing out (or
  // reloading a deep link like /cards while signed out) left you inside an
  // empty app whose every listener failed with permission-denied - and the
  // recurring runner and PIN gate below ran signed out too.
  const { user, allowed, initializing } = useAuth();
  if (initializing) return <View className="flex-1 bg-paper" />;
  if (!user || !allowed) return <Redirect href="/" />;

  return (
    <PinGate>
      <View style={{ flex: 1 }}>
        <RecurringRuleRunner />
        <Tabs
          screenOptions={{
            headerShown: false,
            // React Navigation paints each scene with its own light-gray
            // default, which shows through as a pale band under the top nav
            // in dark mode - transparent lets the root's bg-paper win.
            sceneStyle: { backgroundColor: 'transparent' },
            tabBarActiveTintColor: themeColor('ledgerGreen', isDark),
            tabBarInactiveTintColor: themeColor('mutedText', isDark),
            tabBarStyle: {
              display: isWide ? 'none' : 'flex',
              backgroundColor: themeColor('paper', isDark),
              borderTopColor: themeRgba('ink', isDark, 0.1),
              // The default 49px can't fit the icon pill plus label on web.
              ...(Platform.OS === 'web' ? { height: 60 } : {}),
            },
            // An explicit lineHeight: the label box was exactly fontSize tall with
            // hidden overflow on web, chopping the descenders (the "y" in Payments).
            tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 15 },
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
