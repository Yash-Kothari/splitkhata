import { Alert, Platform } from 'react-native';

// react-native-web's Alert.alert is an empty function, so on the website
// every confirm silently did nothing (member and card deletes never ran) and
// every error pop-up was swallowed. All confirms and error messages go
// through here instead, which uses the browser's own dialogs on web.
export function notify(title, message) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

// Resolves true only when the user explicitly confirms.
export function confirmAsync({ title, message, confirmLabel = 'Delete', destructive = true }) {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
