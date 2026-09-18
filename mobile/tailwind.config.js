/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class' (vs Tailwind's default 'media') is what react-native-css-interop
  // needs to drive dark mode from an explicit in-app toggle (see
  // lib/utils.js) rather than only ever following the OS setting -
  // it's also the mode its web runtime requires to sync color scheme
  // without throwing "Cannot manually set color scheme".
  darkMode: 'class',
  theme: {
    extend: {
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
      },
      // Tailwind v3 (what mobile runs, via nativewind/preset) has no
      // shadow-2xs/shadow-xs sizes - those are v4-only. Web is on v4 and
      // uses shadow-2xs on nearly every form input/button; these match its
      // default values so the two stay in sync.
      boxShadow: {
        '2xs': '0 1px rgb(0 0 0 / 0.05)',
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      // Each resolves through the CSS variables in global.css (light by
      // default, overridden under .dark), so every existing className using
      // these names re-themes automatically - see global.css for the actual
      // color values and the reasoning behind them.
      colors: {
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        paper: 'rgb(var(--color-paper) / <alpha-value>)',
        'paper-card': 'rgb(var(--color-paper-card) / <alpha-value>)',
        'stamp-red': 'rgb(var(--color-stamp-red) / <alpha-value>)',
        'ledger-green': 'rgb(var(--color-ledger-green) / <alpha-value>)',
        mustard: 'rgb(var(--color-mustard) / <alpha-value>)',
        'muted-text': 'rgb(var(--color-muted-text) / <alpha-value>)',
      },
      // Expo Google Fonts registers each weight under its own distinct name
      // (e.g. "Inter_500Medium", not "Inter" + fontWeight) - RN doesn't
      // reliably synthesize weights for custom fonts the way CSS does, so
      // each Tailwind family here is pinned to one specific weight rather
      // than relying on a separate font-bold/font-semibold utility to pick
      // the right file.
      fontFamily: {
        display: ['Fraunces_700Bold'],
        'display-medium': ['Fraunces_500Medium'],
        body: ['Inter_400Regular'],
        'body-medium': ['Inter_500Medium'],
        'body-semibold': ['Inter_600SemiBold'],
        mono: ['IBMPlexMono_600SemiBold'],
        'mono-medium': ['IBMPlexMono_500Medium'],
        'mono-bold': ['IBMPlexMono_700Bold'],
      },
    },
  },
  plugins: [],
};
