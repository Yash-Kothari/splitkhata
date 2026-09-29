import { createContext, useContext, useEffect, useState } from 'react';
import { subscribeToAuth, isAllowedUser, backfillTripIds } from './firebase';
import { reportError } from './errorReporting';

const AuthContext = createContext({ user: null, allowed: false, initializing: true });

// Runs at most once per process, the first time a real allowed user is
// signed in - guards against React re-running the effect below across
// remounts/auth-state flicker within one session. backfillTripIds has its
// own persisted settings/seed_state flag guarding it across sessions and
// devices; this is just the cheap in-memory half of that.
let backfillTriggered = false;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((u) => {
      setUser(u);
      setInitializing(false);
    });
    return unsubscribe;
  }, []);

  const allowed = isAllowedUser(user);

  // One-time migration (P1-4): tags every existing travel entry/cash
  // movement with its trip's stable id, so trip joins stop relying on the
  // trip's name (see backfillTripIds' own comment for why this is safe to
  // run silently rather than behind a manual button).
  useEffect(() => {
    if (!allowed || backfillTriggered) return;
    backfillTriggered = true;
    backfillTripIds()
      .then((summary) => {
        // null means it already ran in an earlier session - nothing to report.
        if (summary) console.log('[backfillTripIds]', summary);
      })
      .catch((err) => reportError(err, 'Could not backfill trip ids'));
  }, [allowed]);

  return (
    <AuthContext.Provider value={{ user, allowed, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
