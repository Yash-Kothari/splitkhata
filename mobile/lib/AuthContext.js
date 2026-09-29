import { createContext, useContext, useEffect, useState } from 'react';
import { subscribeToAuth, isAllowedUser } from './firebase';

const AuthContext = createContext({ user: null, allowed: false, initializing: true });

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

  return (
    <AuthContext.Provider value={{ user, allowed, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
