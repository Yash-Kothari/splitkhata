/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // App is intentionally light-only (userInterfaceStyle: "light" in
  // app.json) - 'class' (vs Tailwind's default 'media') is what
  // react-native-css-interop's web runtime needs to sync color scheme
  // without throwing "Cannot manually set color scheme" on web.
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
      colors: {
        ink: '#24304A',
        paper: '#F2ECDD',
        'paper-card': '#EDE4CE',
        'stamp-red': '#A63D40',
        'ledger-green': '#3D7068',
        mustard: '#C98A2C',
        'muted-text': '#5C6478',
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
