import { Platform } from 'react-native';
import { hexToRgba } from './theme';

// One shadow, written once. react-native-web deprecated the shadowColor /
// shadowOffset / shadowOpacity / shadowRadius props (it prints a console
// warning for each) in favour of CSS boxShadow, while the phone still wants the
// native props. The web value is exactly what react-native-web used to
// generate from them (`x y blur color`), so nothing changes visually.
export function shadowStyle({ color = '#000000', x = 0, y = 0, blur = 0, opacity = 0.1, elevation = 0 }) {
  if (Platform.OS === 'web') {
    return { boxShadow: `${x}px ${y}px ${blur}px ${hexToRgba(color, opacity)}` };
  }
  return { shadowColor: color, shadowOffset: { width: x, height: y }, shadowOpacity: opacity, shadowRadius: blur, elevation };
}
