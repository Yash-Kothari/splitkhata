import { createContext, useContext, useState } from 'react';

// Shared between _layout.js (which gates the whole app behind PinLockScreen
// when isLocked) and AppHeader's account menu (which offers "Lock app" to
// set isLocked back to true on demand).
const LockContext = createContext({ isLocked: false, setIsLocked: (_value) => {} });

export function LockProvider({ children }) {
  const [isLocked, setIsLocked] = useState(false);
  return <LockContext.Provider value={{ isLocked, setIsLocked }}>{children}</LockContext.Provider>;
}

export function useLock() {
  return useContext(LockContext);
}
