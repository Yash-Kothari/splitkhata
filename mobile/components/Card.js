import { View } from 'react-native';

// Matches web's .panel-card (src/styles.css): border-ink/10, rounded-2xl
// (1rem), bg-paper-card, plus a soft floating shadow - NativeWind's Tailwind
// shadow-* utilities aren't reliable across RN/iOS, so the shadow is applied
// as real RN shadow props instead of a className.
export const cardShadow = {
  shadowColor: '#24304A',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.12,
  shadowRadius: 10,
  elevation: 3,
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
