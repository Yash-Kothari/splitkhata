// Single source of truth for the app's palette wherever a plain color value
// is needed instead of a className - SVG props (stroke/fill), RN
// StyleSheet/inline style objects, and react-navigation's theme object can't
// consume a CSS variable, so every "#3D7068"-style literal scattered across
// components used to be typed out by hand and could quietly drift from
// global.css. These values are copied from global.css's --color-* custom
// properties (the actual source of truth for every bg-*/text-* className);
// keep the two in sync by hand if the palette ever changes.
const THEME_RGB = {
  light: {
    ink: '36,48,74',
    paper: '242,236,221',
    paperCard: '237,228,206',
    stampRed: '166,61,64',
    ledgerGreen: '61,112,104',
    mustard: '201,138,44',
    mutedText: '92,100,120',
  },
  dark: {
    ink: '237,230,211',
    paper: '26,33,48',
    paperCard: '35,44,64',
    stampRed: '226,102,106',
    ledgerGreen: '79,179,160',
    mustard: '227,169,74',
    mutedText: '147,160,184',
  },
};

function toHex(rgb) {
  return (
    '#' +
    rgb
      .split(',')
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

// The "r,g,b" triplet, for building an rgba(...) string at a given opacity.
export function themeRgb(name, isDark) {
  return THEME_RGB[isDark ? 'dark' : 'light'][name];
}

// A "#RRGGBB" string, for anything that takes a plain color (SVG stroke/
// fill, shadowColor, tintColor, backgroundColor in an inline style, etc).
export function themeColor(name, isDark) {
  return toHex(themeRgb(name, isDark));
}

// "rgba(r,g,b,alpha)", for translucent borders/dividers that used to spell
// out the RGB triplet by hand alongside the alpha value.
export function themeRgba(name, isDark, alpha) {
  return `rgba(${themeRgb(name, isDark)},${alpha})`;
}
