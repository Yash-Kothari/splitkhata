import { useMemo } from 'react';
import { computeCardRewardLedger, applyConfirmedRewards, getCardYearRewards, computeCardAnnualValue } from './utils';

// The Cards screen's reward numbers for the selected card. Each one walks every
// transaction on the card, and the screen re-renders on every keystroke in the
// search box and on every unrelated snapshot, so they are worked out once per
// change of the card, its transactions or the confirmed billing cycles.
export function useCardRewards(card, cardTxns, cardBillingCycles, today) {
  return useMemo(() => {
    const ledger = card
      ? computeCardRewardLedger(card, cardTxns, today)
      : { total: 0, credited: 0, pending: [], cycleRewards: {}, unit: 'inr', lumps: [] };
    // What the bank really credited (your confirmed figures) replaces the
    // calculated amounts wherever you've entered one - see applyConfirmedRewards.
    const rewards = applyConfirmedRewards(card, ledger, cardBillingCycles, today);
    return {
      ledger,
      rewards,
      yearRewards: getCardYearRewards(card, rewards.credits, today),
      annualValue: card ? computeCardAnnualValue(card, cardTxns, today, cardBillingCycles) : null,
    };
  }, [card, cardTxns, cardBillingCycles, today]);
}
