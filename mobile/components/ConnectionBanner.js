import { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { subscribeToReportedErrors, clearReportedError } from '../lib/errorReporting';
import { subscribeToPendingWrites } from '../lib/firebase';

// RN port of web's ConnectionState (src/components/ConnectionState.jsx).
// Originally scoped to just the "offline" case - Firestore's
// persistentLocalCache (lib/firebase.js) already serves cached reads and
// queues writes for automatic sync while offline with zero code here, so the
// only thing actually missing on mobile was telling the user that's
// happening instead of leaving them to guess whether a save silently
// worked. Web's transient "Syncing with database..." state isn't worth
// replicating - it resolves in a frame off the same local cache and was
// never really visible in practice.
//
// Now also the single visible surface for load/save/delete failures (see
// lib/errorReporting.js) - every subscription and write across this app used
// to just console.warn and show nothing, which on a real phone is
// indistinguishable from success. Offline still takes priority over an error
// message when both are true, since "you're offline" is the more useful and
// more likely explanation.
//
// Deliberately keys off isConnected alone, not isInternetReachable -
// isConnected mirrors navigator.onLine on web (the same signal web's own
// ConnectionState trusts) and the OS-level adapter state on native.
// isInternetReachable comes from NetInfo's own ping-based probe, which
// reported false here even on a genuinely online connection (confirmed via
// a live debug build against the deployed site) - almost certainly the
// probe's target getting blocked by a CSP/sandbox/proxy, not a real outage.
// Using it would show "Offline" to plenty of actually-online users.
export default function ConnectionBanner() {
  const [offline, setOffline] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorHistory, setErrorHistory] = useState([]);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
  }, []);

  useEffect(() => subscribeToPendingWrites(setPendingWrites), []);

  useEffect(
    () =>
      subscribeToReportedErrors((message, history) => {
        setErrorMessage(message);
        setErrorHistory(history || []);
        if (!message) setShowAllErrors(false);
      }),
    [],
  );
  const olderErrors = errorHistory.slice(1);

  if (offline) {
    const pendingSuffix = pendingWrites > 0 ? ` (${pendingWrites} change${pendingWrites === 1 ? '' : 's'} waiting to sync)` : '';
    return (
      <View className="px-4 py-2 bg-mustard/20 border-b border-mustard/40">
        <Text className="font-body-medium text-xs text-ink text-center">
          {/* The phone app caches in memory only (lib/firebase.js), so queued
              changes survive only while it stays open - the website keeps them. */}
          {Platform.OS === 'web'
            ? `Offline - changes will sync when you reconnect${pendingSuffix}`
            : `Offline - keep the app open until you're back online, or unsynced changes are lost${pendingSuffix}`}
        </Text>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View className="px-4 py-2 bg-stamp-red/10 border-b border-stamp-red/30">
        <View className="flex-row items-center justify-center gap-3">
          <Text className="font-body-medium text-xs text-stamp-red text-center flex-shrink">
            {errorMessage}
            {errorHistory[0]?.count > 1 ? ` (×${errorHistory[0].count})` : ''}
          </Text>
          {olderErrors.length > 0 && (
            <Pressable onPress={() => setShowAllErrors((v) => !v)} hitSlop={8}>
              <Text className="font-body-semibold text-xs text-stamp-red underline">
                {showAllErrors ? 'Hide' : `+${olderErrors.length} more`}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={clearReportedError} hitSlop={8}>
            <Text className="font-body-semibold text-xs text-stamp-red underline">Dismiss</Text>
          </Pressable>
        </View>
        {showAllErrors &&
          olderErrors.map((e) => (
            <Text key={`${e.at}-${e.message}`} className="font-body text-2xs text-stamp-red text-center mt-1">
              {e.message}
              {e.count > 1 ? ` (×${e.count})` : ''}
            </Text>
          ))}
      </View>
    );
  }

  if (pendingWrites > 0) {
    return (
      <View className="px-4 py-2 bg-mustard/10 border-b border-mustard/30">
        <Text className="font-body-medium text-xs text-ink/70 text-center">
          Syncing {pendingWrites} change{pendingWrites === 1 ? '' : 's'}...
        </Text>
      </View>
    );
  }

  return null;
}
