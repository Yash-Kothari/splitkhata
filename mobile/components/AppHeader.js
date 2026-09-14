import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOutUser, subscribeToPinConfig } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useLock } from '../lib/LockContext';
import SettingsModal from './SettingsModal';
import GlobalSearch from './GlobalSearch';

// Matches web's <header> in App.jsx: "Splitkhata" + a ledger badge pill
// (bg-ledger-green/10, border-ledger-green/30, text-ledger-green), plus the
// 🔎 search and ⚙️ settings buttons and the account menu (User pill ->
// Lock app / Sign out). Shared across all four tabs so switching tabs
// doesn't jar - web shows the same header shape on every ledger, just with
// a different badge.
//
// showSettings/onShowSettingsChange are optional - most screens let this
// component own that state itself, but cards.js also needs to open
// Settings from its own empty-state CTA, so it can pass controlled state in
// instead of getting two separate SettingsModal instances.
export default function AppHeader({ badge, showSettings: controlledShowSettings, onShowSettingsChange }) {
  const { user } = useAuth();
  const { setIsLocked } = useLock();
  const [uncontrolledShowSettings, setUncontrolledShowSettings] = useState(false);
  const showSettings = controlledShowSettings !== undefined ? controlledShowSettings : uncontrolledShowSettings;
  const setShowSettings = onShowSettingsChange || setUncontrolledShowSettings;
  const [showSearch, setShowSearch] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [pinConfig, setPinConfig] = useState({ pin: '', enabled: false });

  useEffect(() => subscribeToPinConfig(setPinConfig), []);

  const deviceName = user?.displayName || user?.email || 'Account';

  return (
    // z-50: without an explicit z-index here, this SafeAreaView and its
    // account-menu dropdown share the implicit stacking order of the
    // screen's outer View - the ScrollView sibling below it paints later in
    // DOM order and covers the dropdown regardless of the dropdown's own
    // z-index, since that only wins stacking fights within its own local
    // context, not against unrelated siblings elsewhere in the tree.
    <SafeAreaView className="bg-paper z-50" edges={['top']} style={{ zIndex: 50 }}>
      <View className="flex-row items-center gap-1.5 px-3 sm:px-4 pt-4 sm:pt-6 pb-4 border-b border-ink/10">
        <View className="flex-row items-center gap-1.5 flex-shrink" style={{ flexShrink: 1 }}>
          <Text className="font-display text-xl sm:text-2xl text-ink tracking-tight" numberOfLines={1}>
            Splitkhata
          </Text>
          <View className="px-2.5 sm:px-3.5 py-1.5 rounded-xl border border-ledger-green/30 bg-ledger-green/10 flex-shrink" style={{ flexShrink: 1 }}>
            <Text className="font-body-semibold text-[11px] sm:text-xs tracking-wide text-ledger-green" numberOfLines={1}>
              {badge}
            </Text>
          </View>
        </View>
        <View className="flex-1" />
        <Pressable
          onPress={() => setShowSearch(true)}
          hitSlop={8}
          className="min-w-9 min-h-9 px-2 py-1.5 items-center justify-center rounded-xl border border-ink/15 bg-paper shrink-0 shadow-2xs"
        >
          <Text className="font-body-semibold text-xs text-ink">🔎</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowSettings(true)}
          hitSlop={8}
          className="min-w-9 min-h-9 flex-row items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl border border-ink/15 bg-paper shrink-0 shadow-2xs"
        >
          <Text className="font-body-semibold text-xs text-ink">⚙️</Text>
          <Text className="hidden sm:flex font-body-semibold text-xs text-ink">Settings</Text>
        </Pressable>
        <View>
          <Pressable
            onPress={() => setShowAccountMenu((v) => !v)}
            hitSlop={8}
            className="min-w-9 min-h-9 max-w-24 sm:max-w-none flex-row items-center justify-center px-2 sm:px-3 py-1.5 rounded-xl border border-ink/10 bg-paper-card shrink-0"
          >
            <Text className="hidden sm:flex font-body-medium text-xs text-muted-text">User: </Text>
            <Text className="font-body-semibold text-xs text-ink" numberOfLines={1}>{deviceName}</Text>
          </Pressable>

          {showAccountMenu && (
            <View
              className="absolute right-0 rounded-xl border border-ink/15 bg-paper-card p-2"
              style={{ top: 44, width: 176, zIndex: 30, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 8 }}
            >
              {user?.email ? (
                <Text numberOfLines={1} className="font-body text-xs text-muted-text px-2 py-1.5">{user.email}</Text>
              ) : null}
              {pinConfig.enabled && pinConfig.pin ? (
                <Pressable
                  onPress={() => {
                    setShowAccountMenu(false);
                    setIsLocked(true);
                  }}
                  className="min-h-10 rounded-lg px-3 py-2 justify-center"
                >
                  <Text className="font-body-semibold text-sm text-ink">Lock app</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  setShowAccountMenu(false);
                  signOutUser();
                }}
                className="min-h-10 rounded-lg px-3 py-2 justify-center"
              >
                <Text className="font-body-semibold text-sm text-stamp-red">Sign out</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
      <GlobalSearch visible={showSearch} onClose={() => setShowSearch(false)} />
    </SafeAreaView>
  );
}
