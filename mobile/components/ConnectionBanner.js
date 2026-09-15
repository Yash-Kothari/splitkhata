import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

// RN port of web's ConnectionState (src/components/ConnectionState.jsx),
// scoped to just the "offline" case - Firestore's persistentLocalCache
// (lib/firebase.js) already serves cached reads and queues writes for
// automatic sync while offline with zero code here, so the only thing
// actually missing on mobile was telling the user that's happening instead
// of leaving them to guess whether a save silently worked. Web's transient
// "Syncing with database..." state isn't worth replicating - it resolves in
// a frame off the same local cache and was never really visible in practice.
export default function ConnectionBanner() {
  // isInternetReachable starts null until the first NetInfo check resolves;
  // treating null as "online" avoids a spurious flash of the banner on
  // every cold start before that first check lands.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      console.log('[ConnectionBanner debug]', JSON.stringify(state));
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
  }, []);

  if (!offline) return null;

  return (
    <View className="px-4 py-2 bg-mustard/20 border-b border-mustard/40">
      <Text className="font-body-medium text-xs text-ink text-center">
        Offline - changes will sync when you reconnect
      </Text>
    </View>
  );
}
