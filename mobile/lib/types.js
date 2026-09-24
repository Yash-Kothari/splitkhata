// JSDoc-only type definitions (D-2) - no runtime code. These document the
// three core Firestore-backed shapes the app passes around everywhere:
// ledger entries, credit cards, and card transactions. Reference a type from
// another file with `@typedef {import('./types').Entry} Entry` (or the
// relative path from that file), then use it in `@param`/`@returns` JSDoc.
// Kept intentionally loose (mostly optional fields) to match reality: a
// Firestore doc only ever has the fields it was written with, and years of
// schema evolution (see resolveCardParams, getQuarterStartingSpend, etc.)
// mean older docs are legitimately missing newer fields.

/**
 * A row in the `expenses` collection - a single ledger entry, on either the
 * household or a trip's travel ledger.
 * @typedef {Object} Entry
 * @property {string} [id]
 * @property {number} amount
 * @property {string} payer
 * @property {string} category
 * @property {boolean} split
 * @property {'shared'|'owed'|'personal'|'custom'|'settlement'} splitType
 * @property {string|null} [owedBy] - only for splitType 'owed'
 * @property {string[]|null} [splitAmong] - a subset of members, for splitType 'shared'; null = everyone
 * @property {Object<string, number>|null} [splitShares] - member -> share count, for splitType 'custom'
 * @property {string} [note]
 * @property {string} date - YYYY-MM-DD
 * @property {'household'|'travel'} ledger
 * @property {string} [tripName] - set when ledger is 'travel'
 * @property {string|null} [paymentMethod] - a payment instrument's label, or a bare method name for legacy entries
 * @property {string|null} [paymentInstrumentId]
 * @property {string|null} [paymentType] - the resolved instrument's type (see INSTRUMENT_TYPES)
 * @property {number|null} [localAmount] - travel-only, the amount in the trip's local currency
 * @property {number|null} [rewardPoints] - travel-only
 * @property {boolean} [isRecurring] - created by a recurring rule, not typed in by hand
 * @property {string} [recurringRuleId] - which rule created this entry, when isRecurring is true
 * @property {string} [deviceName] - who/what device saved this entry
 * @property {string|null} [cardTransactionId] - set when a matching CardTransaction was created alongside this entry
 * @property {boolean} [isTripRollup] - a synthetic household-ledger line representing a trip's net settlement
 * @property {string} [rolledUpEntryId]
 * @property {*} [createdAt] - a Firestore Timestamp server-side, or an ISO string once read back
 */

/**
 * A row in the `creditCards` collection.
 * @typedef {Object} Card
 * @property {string} [id]
 * @property {string} name
 * @property {string} rewardStrategy - a CARD_REWARD_STRATEGIES id (e.g. 'hdfc_diners_slab_milestone')
 * @property {number} billingCycleDay - 1-31, clamped per-month by daysInMonth
 * @property {Array<{effectiveFrom: string, params: Object}>} [strategyParamsHistory] - rule-version history, resolved by date via resolveStrategyParamsForDate
 * @property {Object<string, number>} [quarterlyStartingSpend] - quarterStart ('YYYY-QN') -> starting spend, for a card added mid-quarter
 * @property {Object<string, number>} [annualStartingSpend] - periodStart (YYYY-MM-DD) -> starting spend, for a card added mid-year
 * @property {number} [quarterlyMilestoneStartingSpend] - legacy single-field fallback, see getQuarterStartingSpend
 * @property {string} [quarterlyMilestoneStartingQuarter] - which quarter the legacy field above belongs to
 * @property {number} [annualMilestoneStartingSpend] - legacy single-field fallback, see getAnnualStartingSpend
 * @property {*} [createdAt] - a Firestore Timestamp server-side, or an ISO string / has a .toDate() once read back
 */

/**
 * A row in the `cardTransactions` collection - one purchase (or refund, as a
 * negative amount) on a tracked card, optionally linked back to the Entry it
 * was created alongside.
 * @typedef {Object} CardTransaction
 * @property {string} [id]
 * @property {string} cardId
 * @property {number} amount - negative for a refund
 * @property {string} date - YYYY-MM-DD
 * @property {string} [description]
 * @property {string|null} [linkedEntryId] - the Entry this was created alongside, if any
 * @property {string} [category] - strategy-specific category key (see CARD_STRATEGY_DEFAULTS), not the Entry's free-text category
 * @property {string} [channel] - strategy-specific, e.g. SBI's 'online'|'offline'
 * @property {boolean} [isBonusEligible] - strategy-specific, e.g. HSBC Live+/SuperMoney bonus pools
 * @property {*} [createdAt] - a Firestore Timestamp server-side, or an ISO string once read back
 */

export {};
