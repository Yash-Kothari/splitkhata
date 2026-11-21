import { createContext, useContext, useEffect, useState } from 'react';
import { subscribeToAuth, isAllowedUser, setTenant } from './firebase';
import { IS_SHARED_EDITION } from './edition';

const AuthContext = createContext({ user: null, allowed: false, initializing: true, slowInit: false });

// How long startup may wait for "am I signed in?" before the blank screen explains itself.
const SLOW_INIT_MS = 8000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [slowInit, setSlowInit] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((u) => {
      // Shared edition: signing out (or in as someone else) must never leave the previous account's open group behind.
      if (IS_SHARED_EDITION) setTenant(null);
      setUser(u);
      setInitializing(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!initializing) return undefined;
    const timer = setTimeout(() => setSlowInit(true), SLOW_INIT_MS);
    return () => clearTimeout(timer);
  }, [initializing]);

  const allowed = isAllowedUser(user);

  return (
    <AuthContext.Provider value={{ user, allowed, initializing, slowInit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
