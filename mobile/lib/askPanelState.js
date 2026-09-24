import { useEffect, useState } from 'react';

// Whether the floating Ask panel is open. The panel lives above every tab in
// the tabs layout, while each screen renders its own Undo toast in the same
// bottom corner - so the toast was hidden behind the open panel. A tiny
// module-level store (like lib/errorReporting.js) lets the toast move out of
// the way without threading props through every screen.
let askPanelOpen = false;
let listeners = [];

export function setAskPanelOpen(open) {
  if (askPanelOpen === open) return;
  askPanelOpen = open;
  listeners.forEach((listener) => listener(open));
}

export function useAskPanelOpen() {
  const [open, setOpen] = useState(askPanelOpen);
  useEffect(() => {
    listeners.push(setOpen);
    setOpen(askPanelOpen);
    return () => {
      listeners = listeners.filter((l) => l !== setOpen);
    };
  }, []);
  return open;
}
