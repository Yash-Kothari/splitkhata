import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Small per-device key-value store used for state that must survive a
// relaunch but has no business living in Firestore (the PIN gate's last
// known lock state, later the appearance preference). AsyncStorage on
// native, localStorage on web - both can throw (private browsing, storage
// quota, a cold AsyncStorage native module), so every call is wrapped and
// a failure just means "nothing was remembered," never a crash.
export async function getJSON(key, fallback = null) {
  try {
    const raw = Platform.OS === 'web' ? window.localStorage.getItem(key) : await AsyncStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function setJSON(key, value) {
  try {
    const raw = JSON.stringify(value);
    if (Platform.OS === 'web') window.localStorage.setItem(key, raw);
    else await AsyncStorage.setItem(key, raw);
  } catch {
    // Best-effort - a device with no writable storage just never remembers.
  }
}
