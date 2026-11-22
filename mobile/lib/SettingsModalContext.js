import { createContext, useContext, useState } from 'react';

// One shared "is Settings open" flag for the whole app, not one per tab.
// Each of the 4 tab screens mounts its own AppHeader, and React Navigation's
// bottom tabs never unmount an inactive screen - so a per-AppHeader
// <SettingsModal> (the old shape) meant up to 4 concurrently-mounted
// instances, each running its own ~16 Firestore listeners regardless of
// whether that tab's sheet was actually open (see P1-11). This context lets
// every AppHeader (and Cards' own empty-state CTA) share one open/close flag
// for the single <SettingsModal> rendered once at the root (app/_layout.js).
const SettingsModalContext = createContext({ visible: false, requestedTab: null, open: () => {}, close: () => {} });

export function SettingsModalProvider({ children }) {
  const [visible, setVisible] = useState(false);
  // `open('portfolioData')` lands on that Settings tab (a reminder on a screen can point at the page that fixes it);
  // `open()` or an onPress event lands on the group picker as before.
  const [requestedTab, setRequestedTab] = useState(null);
  return (
    <SettingsModalContext.Provider
      value={{
        visible,
        requestedTab,
        open: (tab) => {
          setRequestedTab(typeof tab === 'string' ? tab : null);
          setVisible(true);
        },
        close: () => setVisible(false),
      }}
    >
      {children}
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  return useContext(SettingsModalContext);
}
