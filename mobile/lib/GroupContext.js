import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeToMyGroups, setTenant } from './firebase';
import { useAuth } from './AuthContext';
import { IS_SHARED_EDITION } from './edition';
import { reportError } from './errorReporting';

// Shared edition only: every group (and direct ledger) the signed-in account belongs to, and which one
// is open. Opening a group points all the data calls in lib/firebase.js at it (setTenant); the Personal
// tab reads every group without opening any. The admin edition has no groups, so this provides nothing.
const GroupContext = createContext({
  groups: null, // null while loading
  activeGroup: null,
  activeGroupId: null,
  selectGroup: (_id) => {},
});

export function GroupProvider({ children }) {
  const { user, allowed } = useAuth();
  const email = IS_SHARED_EDITION && allowed ? String(user?.email || '').toLowerCase() : '';
  // Kept with the email they were loaded for, so a different account never briefly sees the previous one's list.
  const [loaded, setLoaded] = useState({ email: '', groups: null });
  const [groupId, setGroupId] = useState(null);

  useEffect(() => {
    if (!email) return undefined;
    return subscribeToMyGroups(
      email,
      (list) => setLoaded({ email, groups: list }),
      (err) => reportError(err, 'Could not load your groups'),
    );
  }, [email]);

  const groups = loaded.email === email && email ? loaded.groups : null;
  const activeGroup = groups?.find((g) => g.id === groupId) || null;

  const selectGroup = useCallback((id) => {
    setTenant(id);
    setGroupId(id);
  }, []);

  const value = useMemo(
    () => ({ groups, activeGroup, activeGroupId: activeGroup?.id || null, selectGroup }),
    [groups, activeGroup, selectGroup],
  );
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup() {
  return useContext(GroupContext);
}
