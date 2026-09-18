import { TextInput, Platform } from 'react-native';

// The old web app used a real <input type="date"> - this rewrite shipped a
// raw text field with a "2026-08-24" placeholder everywhere instead, which
// on the website (this app's production build) reads as a regression:
// no calendar picker, no format validation, easy to mistype. React Native's
// TextInput has no way to become a native date input, so on web this drops
// down to a literal DOM <input> - valid here because react-native-web's
// renderer is plain react-dom, and this branch never runs on native (where
// TextInput's normal behavior is unchanged, pending a real native
// date-picker library, which is a separate, native-only piece of work).
// The value format ('YYYY-MM-DD') already matches <input type="date"> input
// exactly, so no conversion is needed either way.
export default function DateField({ value, onChange, className, placeholder }) {
  if (Platform.OS === 'web') {
    return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} className={className} />;
  }
  return <TextInput value={value} onChangeText={onChange} placeholder={placeholder || '2026-08-24'} className={className} />;
}
