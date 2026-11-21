import { useEffect, useMemo, useState } from 'react';
import { subscribeToGroupExpenses, subscribeToGroupMembers } from './firebase';
import { computePersonalBalances } from './utils';
import { reportError } from './errorReporting';

// Shared edition's Personal tab: listens to the entries and people of EVERY group (and one-to-one
// ledger) you are in - read-only, without opening any of them - and adds them up per person.
// Returns { loading, people, owedToMe, iOwe, net, groupData } where groupData maps group id ->
// { entries, memberDocs } (the Personal screen needs the people's names to settle up).
export function usePersonalBalances(allGroups, myEmail) {
  const [data, setData] = useState({});
  // Only groups the server already has (a group you just created is still local for a moment - see subscribeToMyGroups).
  const groups = useMemo(() => (allGroups === null ? null : allGroups.filter((g) => !g.pending)), [allGroups]);
  const key = (groups || []).map((g) => g.id).sort().join('|');

  useEffect(() => {
    if (!key) return undefined;
    const unsubs = key.split('|').flatMap((id) => [
      subscribeToGroupExpenses(
        id,
        (entries) => setData((prev) => ({ ...prev, [id]: { ...prev[id], entries } })),
        (err) => reportError(err, 'Could not load a group\'s expenses'),
      ),
      subscribeToGroupMembers(
        id,
        (memberDocs) => setData((prev) => ({ ...prev, [id]: { ...prev[id], memberDocs } })),
        (err) => reportError(err, 'Could not load a group\'s people'),
      ),
    ]);
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return useMemo(() => {
    const list = groups || [];
    const loading = groups === null || list.some((g) => !data[g.id]?.entries || !data[g.id]?.memberDocs);
    const groupsData = list.map((g) => ({ id: g.id, name: g.name, kind: g.kind, entries: data[g.id]?.entries || [], memberDocs: data[g.id]?.memberDocs || [] }));
    return { loading, groupData: data, ...computePersonalBalances(groupsData, myEmail) };
  }, [groups, data, myEmail]);
}
