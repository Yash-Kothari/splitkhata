import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { formatCurrency } from './utils';
import { formatRupeesCompact } from './portfolio';
import { getJSON, setJSON } from './deviceStore';

// "Hide amounts": one switch for the whole Portfolio tab, for showing the screen to someone or using it in public.
// Rupee amounts and units become dots; percentages stay, since they say nothing about how much you hold. The choice is
// remembered on this device only. Components format every amount through this hook instead of formatCurrency.
const KEY = 'portfolio_hide_amounts';
const DOTS = '••••••';

const PrivacyContext = createContext({
  hidden: false,
  toggle: () => {},
  money: (n) => formatCurrency(n),
  signed: (n) => `${n > 0 ? '+' : ''}${formatCurrency(n)}`,
  compact: (n) => formatRupeesCompact(n),
  units: (text) => text,
});

export function PortfolioPrivacyProvider({ children }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJSON(KEY, false).then((stored) => {
      if (!cancelled) setHidden(Boolean(stored));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !hidden;
    setHidden(next);
    setJSON(KEY, next);
  }, [hidden]);

  const value = useMemo(
    () => ({
      hidden,
      toggle,
      money: (n) => (hidden ? `₹ ${DOTS}` : formatCurrency(n)),
      signed: (n) => (hidden ? `${n > 0 ? '+' : n < 0 ? '-' : ''}₹ ${DOTS}` : `${n > 0 ? '+' : ''}${formatCurrency(n)}`),
      compact: (n) => (hidden ? DOTS : formatRupeesCompact(n)),
      units: (text) => (hidden ? DOTS : text),
    }),
    [hidden, toggle],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePortfolioPrivacy() {
  return useContext(PrivacyContext);
}
