import { View } from 'react-native';

// Matches web's .panel-card (src/styles.css): border-ink/10, rounded-2xl
// (1rem), bg-paper-card, plus a soft floating shadow - web's actual value is
// `0 10px 30px -20px rgba(36,48,74,0.25)` (a negative spread pulls the
// shadow's footprint in before the blur softens it, so it reads as a
// contained halo rather than a strongly offset drop shadow). RN has no
// spread-radius equivalent, so this is tuned by eye to the same soft,
// close-in look rather than translated value-for-value.
export const cardShadow = {
  shadowColor: '#24304A',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.16,
  shadowRadius: 20,
  elevation: 4,
};

export default function Card({ children, className = '', style, noShadow = false, ...props }) {
  return (
    <View
      className={`rounded-2xl bg-paper-card border border-ink/10 ${className}`}
      style={[noShadow ? null : cardShadow, style]}
      {...props}
    >
      {children}
    </View>
  );
}
