import { createContext, useContext, useState } from 'react';

// Global Search can point at an entry from any ledger/trip/month - since
// mobile's screens are separate route files (not one big conditional render
// like web's App.jsx), this is how the search modal tells the target screen
// what to select once it's navigated there. Mirrors web's handleJumpToEntry
// in App.jsx, just split across a shared context instead of local state.
const JumpContext = createContext({ pendingJump: null, setPendingJump: (_value) => {} });

export function JumpProvider({ children }) {
  const [pendingJump, setPendingJump] = useState(null);
  return <JumpContext.Provider value={{ pendingJump, setPendingJump }}>{children}</JumpContext.Provider>;
}

export function useJump() {
  return useContext(JumpContext);
}
