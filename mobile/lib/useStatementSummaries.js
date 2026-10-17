import { useEffect, useRef, useState } from 'react';
import { subscribeToStatementSummaries, saveStatementSummaries } from './firebase';
import { computeStatementSummaries, diffStatementSummaries } from './utils';
import { captureException } from './sentry';

// Shadow phase of "load old statements on demand": keeps one saved summary per closed
// statement in step with the live maths, and checks that the same inputs always give the same
// answer. Nothing shows these summaries yet. Waits until the cards, transactions and confirmed
// cycles have all loaded and then stays quiet for a few seconds, so it never saves from half-loaded
// data or from the middle of an edit; in steady state it saves nothing.
export function useStatementSummaries({ ready, creditCards, cardTransactions, cardBillingCycles, today }) {
  const [stored, setStored] = useState(null);
  const saved = useRef(new Set());
  const reported = useRef(new Set());

  useEffect(() => subscribeToStatementSummaries(setStored, () => {}), []);

  useEffect(() => {
    if (!ready || stored === null) return undefined;
    const timer = setTimeout(() => {
      const live = creditCards.flatMap((card) =>
        computeStatementSummaries(
          card,
          cardTransactions.filter((t) => t.cardId === card.id),
          today,
          cardBillingCycles.filter((c) => c.cardId === card.id),
        ),
      );
      const { toWrite, drift } = diffStatementSummaries(live, stored);
      drift.forEach(({ live: l, stored: old }) => {
        const key = `${l.cardId}|${l.cycleStart}|${l.fingerprint}`;
        if (reported.current.has(key)) return;
        reported.current.add(key);
        captureException(new Error(`Statement summary drift ${l.cycleStart}: stored ${JSON.stringify([old.spend, old.bill, old.reward])} vs live ${JSON.stringify([l.spend, l.bill, l.reward])}`), 'Statement summary check');
      });
      const fresh = toWrite.filter((item) => !saved.current.has(`${item.cardId}|${item.cycleStart}|${item.fingerprint}`)).slice(0, 25);
      if (!fresh.length) return;
      fresh.forEach((item) => saved.current.add(`${item.cardId}|${item.cycleStart}|${item.fingerprint}`));
      saveStatementSummaries(fresh).catch(() => fresh.forEach((item) => saved.current.delete(`${item.cardId}|${item.cycleStart}|${item.fingerprint}`)));
    }, 4000);
    return () => clearTimeout(timer);
  }, [ready, stored, creditCards, cardTransactions, cardBillingCycles, today]);
}
