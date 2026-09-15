import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

if (typeof window !== 'undefined') window.__connBannerMounts = (window.__connBannerMounts || 0) + 1;

export default function ConnectionBanner() {
  const [offline, setOffline] = useState(false);
  const [raw, setRaw] = useState('no-event-yet');

  useEffect(() => {
    NetInfo.fetch().then((state) => setRaw('fetch:' + JSON.stringify(state)));
    return NetInfo.addEventListener((state) => {
      setRaw('event:' + JSON.stringify(state));
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
  }, []);

  return (
    <View className="px-4 py-2 bg-mustard/20 border-b border-mustard/40">
      <Text className="font-body-medium text-xs text-ink text-center">
        DEBUG offline={String(offline)} mounts={typeof window !== 'undefined' ? window.__connBannerMounts : '?'} raw={raw}
      </Text>
    </View>
  );
}
