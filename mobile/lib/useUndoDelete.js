import { useEffect, useRef, useState } from 'react';

// How long an undo toast stays actionable before the delete actually
// commits - matches web's UNDO_WINDOW_MS in EntryList.jsx.
const UNDO_WINDOW_MS = 6000;

// Shared by household.js, travel.js, payments.js (and already hand-rolled
// once for cards.js) - the caller owns this so the toast can render as a
// sibling of its own ScrollView, positioned as a real fixed-to-viewport
// overlay. EntryList itself only needs pendingDeletes (to hide rows
// optimistically) and onDelete (to start the timer), not the toast markup -
// it's rendered inside each screen's own ScrollView, where position:
// absolute would be scoped to the scrollable content instead of the
// viewport.
export function useUndoDelete(deleteFn, onError) {
  const [pendingDeletes, setPendingDeletes] = useState({});
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function handleDelete(item) {
    const id = item.id;
    const timeoutId = setTimeout(async () => {
      try {
        await deleteFn(id);
      } catch (err) {
        onError?.(err);
      } finally {
        if (isMountedRef.current) {
          setPendingDeletes((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      }
    }, UNDO_WINDOW_MS);
    setPendingDeletes((prev) => ({ ...prev, [id]: { item, timeoutId } }));
  }

  function handleUndo(id) {
    setPendingDeletes((prev) => {
      const pending = prev[id];
      if (!pending) return prev;
      clearTimeout(pending.timeoutId);
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  return { pendingDeletes, handleDelete, handleUndo, pendingDeleteList: Object.values(pendingDeletes) };
}
