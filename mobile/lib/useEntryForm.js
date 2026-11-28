import { useEffect, useMemo, useState } from 'react';
import {
  buildPaymentInstruments,
  checkCustomSharesTotal,
  computeFifoCashAmount,
  formatFifoBreakdownSummary,
  getLastEntryDefaults,
  isCashPaid,
  isPointsCard,
  isStatementOnlyCard,
  isValidISODate,
  inferCardRewardFields,
  netEntryPoints,
  parsePointsField,
  previewTransactionReward,
  resolveStrategyParamsForDate,
  splitEntryPoints,
  isWithdrawalEntry,
  localCurrencyOf,
  parseAmountInput,
  parseSignedAmountInput,
  resolveInstrument,
  todayISO,
} from './utils';

// The state and rules shared by Add Entry and Edit Entry, so the two forms
// can't drift apart: the same fields, the same defaults logic, the same
// validation. `entry` present = editing that entry; absent = adding a new one.
// Saving stays with each form (add creates, edit updates and re-syncs the card).
export function useEntryForm({
  entry = null,
  ledger = 'household',
  categories,
  members,
  instruments: instrumentsProp,
  creditCards = [],
  cardTransactions = [],
  currentCurrency = 'INR',
  tripCurrencies = null,
  tripEntries = [],
  recentEntries = [],
  deviceName,
  extraMoreOpen = false,
}) {
  const isEdit = Boolean(entry);
  const isTravel = ledger === 'travel';
  // Points live on travel entries, and on a trip line in Payments (Add to Main
  // Ledger carries the points owed). The field shows for any entry that already
  // has some so saving never drops them.
  const hasPoints = isTravel || entry?.rewardPoints != null;

  // Cash, UPI, bank accounts and tracked cards as one list - picking a card
  // links the entry to a card transaction when it is saved.
  const instruments = useMemo(
    () => (instrumentsProp && instrumentsProp.length ? instrumentsProp : buildPaymentInstruments([{ name: 'Cash' }], creditCards)),
    [instrumentsProp, creditCards],
  );
  const paymentMethodOptions = instruments.map((i) => i.label);

  // A refund / money received is stored as a minus, but typed and shown as a plain positive number
  // with the Refund / Reversal box ticked (same wording as a card transaction) - nobody wants to type
  // a minus on a phone keypad.
  // Typing a leading "-" by hand switches it on too. Settlements are transfers, never refunds.
  const [refund, setRefund] = useState(entry ? Number(entry.amount) < 0 || Number(entry.localAmount) < 0 : false);
  const unsigned = (v) => (v == null ? '' : String(Math.abs(Number(v))));
  const [amount, setAmount] = useState(entry ? unsigned(entry.amount ?? '') : '');
  const [localAmount, setLocalAmount] = useState(entry?.localAmount != null ? unsigned(entry.localAmount) : '');
  const isRefund = (refund || /^\s*-/.test(amount)) && entry?.splitType !== 'settlement';
  const amountValue = parseSignedAmountInput(amount, isRefund);
  const localValue = parseSignedAmountInput(localAmount, isRefund);
  // Points redeemed on a trip entry paid with a points card live on the card line too, so the form starts from both: the entry's
  // saved number and what its card line says (see splitEntryPoints).
  const linkedPointsTxn = entry?.cardTransactionId ? cardTransactions.find((t) => t.id === entry.cardTransactionId) : null;
  // A Travel purchase has two boxes, Points Earned and Points Redeemed. A points settlement or a trip total moved to the main
  // ledger is a single transfer of points, so it keeps one signed Reward Points box.
  const pointsFields = isTravel && entry?.splitType !== 'settlement' && !entry?.isTripRollup;
  const [startPoints] = useState(() => splitEntryPoints(entry?.rewardPoints ?? null, linkedPointsTxn?.pointsRedeemed));
  const [pointsEarned, setPointsEarned] = useState(pointsFields && startPoints.earned != null ? String(startPoints.earned) : '');
  const [pointsRedeemed, setPointsRedeemed] = useState(pointsFields && startPoints.redeemed != null ? String(startPoints.redeemed) : '');
  const [rewardPoints, setRewardPoints] = useState(!pointsFields && entry?.rewardPoints != null ? String(entry.rewardPoints) : '');

  // Who paid and how. Editing: what the entry has. Adding: what the user picked,
  // else what the last entry on this ledger used (a stretch of entries on one
  // card / by one person), else the device's person and the first method.
  // Derived, so entries arriving late update the default but never override a pick.
  const lastEntry = useMemo(() => (isEdit ? null : getLastEntryDefaults(recentEntries)), [isEdit, recentEntries]);
  const [payerChoice, setPayer] = useState(entry ? entry.payer : null);
  const payer =
    [payerChoice, lastEntry?.payer, deviceName].find((p) => p && (members.includes(p) || p === entry?.payer)) || members[0];
  const [paymentChoice, setPaymentMethod] = useState(
    entry ? resolveInstrument(instruments, entry)?.label || entry.paymentMethod || '' : null,
  );
  // An old entry may have no payment method at all - keep that as-is rather
  // than silently stamping "Cash" on save.
  const paymentMethod = isEdit
    ? paymentChoice
    : [paymentChoice, lastEntry?.paymentMethod].find((m) => m && paymentMethodOptions.includes(m)) || paymentMethodOptions[0] || 'Cash';
  const selectedInstrument = instruments.find((i) => i.label === paymentMethod) || null;

  const [category, setCategory] = useState(entry?.category ?? (categories[0] || 'Groceries'));
  const [splitType, setSplitType] = useState(entry ? entry.splitType || (entry.split ? 'shared' : 'personal') : 'shared');
  const [owedBy, setOwedBy] = useState(entry?.owedBy || '');
  // Who an even split is between. Editing: what the entry has. Adding: what the
  // user picked, else who the last shared entry was split among (so a trip's two
  // of three people stay selected from one entry to the next), else everyone.
  // Derived like payer above; setSplitAmong(null) goes back to that default.
  const [splitAmongChoice, setSplitAmong] = useState(null);
  const knownMembers = (list) => (list || []).filter((m) => members.includes(m));
  const splitAmong = (() => {
    const picked = knownMembers(splitAmongChoice);
    if (picked.length > 0) return picked;
    if (isEdit) return entry.splitAmong?.length ? entry.splitAmong : members;
    // The Split Among chips only show for 3+ people, so nothing hidden is remembered for two.
    if (members.length <= 2) return members;
    const remembered = knownMembers(lastEntry?.splitAmong);
    return remembered.length > 0 ? remembered : members;
  })();
  const [customShares, setCustomShares] = useState(() =>
    Object.fromEntries(Object.entries(entry?.splitShares || {}).map(([k, v]) => [k, String(v)])),
  );
  const [splitMode, setSplitMode] = useState(entry?.splitMode === 'ratio' ? 'ratio' : 'amount');
  const [date, setDate] = useState(entry?.date ?? todayISO());
  const [note, setNote] = useState(entry?.note || '');
  const [tagsText, setTagsText] = useState((entry?.tags || []).join(', '));

  // The card transaction this entry created. If it's been marked a Travel with
  // Points / SmartBuy booking (here, or by hand in the Cards tab), the box
  // starts on its multiplier, so saving never silently drops the booking.
  const linkedCardTxn = entry?.cardTransactionId ? cardTransactions.find((t) => t.id === entry.cardTransactionId) : null;
  const wasBooking = linkedCardTxn?.category === 'travel_bonus' || linkedCardTxn?.category === 'smartbuy_hotel';
  const [initialTravelMultiplier] = useState(() => (wasBooking && linkedCardTxn?.travelMultiplier ? String(linkedCardTxn.travelMultiplier) : ''));
  const [travelMultiplier, setTravelMultiplier] = useState(initialTravelMultiplier);

  // On a household entry paid with an HSBC Premier or Diners card, a portal
  // booking (Travel with Points / SmartBuy) earns accelerated points at a
  // multiplier that varies per booking (Premier's runs 2X-12X) - so it's typed
  // here, and typing one is what marks the entry as a booking, whatever its
  // category is called. Blank = a normal purchase (a category literally named
  // "Travel with Points" / "SmartBuy" also counts as a booking, at base points
  // until a multiplier is entered). Travel-ledger entries never do this: their
  // points are the form's own Points Earned / Points Redeemed boxes,
  // and a travel booking's accelerated points are entered on the Cards tab.
  const selectedCard = selectedInstrument?.cardId ? creditCards.find((c) => c.id === selectedInstrument.cardId) : null;
  const bookingKind =
    !isTravel && selectedCard && !isStatementOnlyCard(selectedCard)
      ? { hsbc_premier_flat_capped: 'travel_with_points', hdfc_diners_slab_milestone: 'smartbuy' }[selectedCard.rewardStrategy] || null
      : null;
  const showTravelMultiplier = bookingKind != null;
  const effectiveTravelMultiplier = showTravelMultiplier ? travelMultiplier.trim() : '';
  const selectedCardId = selectedCard?.id;

  // Points on a Travel entry paid with a points card: what is redeemed comes off the card's points. Paid fully with points means
  // no money (an amount of ₹0), which leaves a points-out record on the card and nothing on its bill (see
  // buildPointsRedemptionTxn). What is earned is only recorded on the entry, because the card works out its own earnings.
  const canRedeem = isTravel && Boolean(selectedCard) && isPointsCard(selectedCard) && !isStatementOnlyCard(selectedCard);
  const earnedValue = pointsFields ? parsePointsField(pointsEarned) : null;
  const redeemedValue = pointsFields ? parsePointsField(pointsRedeemed) : null;
  const earnedInvalid = Number.isNaN(earnedValue);
  // A card only deals in whole points.
  const redeemedInvalid = Number.isNaN(redeemedValue) || (canRedeem && redeemedValue != null && !Number.isInteger(redeemedValue));
  const cardRedeemed = canRedeem && !redeemedInvalid ? redeemedValue : null;
  // An entry saved by the old Redeem points mode holds what the booking was worth as its amount. It stays a redemption until
  // that amount is changed, so editing a note never puts the worth on the card's bill.
  const savedWorth = entry?.paidWithPoints === true && Number(entry.amount) > 0 ? Number(entry.amount) : null;
  const worthUnchanged = savedWorth != null && amountValue === savedWorth;
  const asRedemption = cardRedeemed != null && (amountValue === 0 || worthUnchanged);

  // A card whose statement is already closed (backdated entries): keep the
  // entry but don't add a transaction to that card, so its cycle totals and
  // rewards stay as they were. Only offered for a tracked card.
  const [skipCardTracking, setSkipCardTracking] = useState(Boolean(entry?.skipCardTracking));
  const canSkipCard = Boolean(selectedCard) && !isStatementOnlyCard(selectedCard);
  // A redemption has no statement amount to leave out, so the skip never applies to it.
  const cardSkipped = canSkipCard && skipCardTracking && !asRedemption;

  // Which of the trip's currencies the local amount is in. Editing: what the entry has. Adding: what
  // was picked, else what the last entry used, else the trip's main currency. Derived, like payer above.
  const baseCurrencies = tripCurrencies && tripCurrencies.length ? tripCurrencies : [currentCurrency];
  // An entry keeps its own currency even if the trip's list no longer has it.
  const entryOwnCurrency = entry?.localCurrency;
  const currencyOptions = entryOwnCurrency && !baseCurrencies.includes(entryOwnCurrency) ? [...baseCurrencies, entryOwnCurrency] : baseCurrencies;
  const [currencyChoice, setLocalCurrency] = useState(entry ? localCurrencyOf(entry, currentCurrency) : null);
  const localCurrency = [currencyChoice, isEdit ? null : lastEntry?.localCurrency].find((c) => c && currencyOptions.includes(c)) || currentCurrency;
  // An ATM withdrawal's currency is the one its cash record was saved with - not editable here.
  const currencyLocked = isEdit && isWithdrawalEntry(entry);

  // Cash purchases on a trip are priced from the ATM withdrawals, oldest first - each currency is its
  // own pool, so a purchase in one currency only ever draws on withdrawals in that same currency.
  const tripWithdrawals = useMemo(
    () => tripEntries.filter((e) => isWithdrawalEntry(e) && localCurrencyOf(e, currentCurrency) === localCurrency),
    [tripEntries, localCurrency, currentCurrency],
  );
  const otherCashEntries = useMemo(
    () => tripEntries.filter((e) => isCashPaid(e) && localCurrencyOf(e, currentCurrency) === localCurrency),
    [tripEntries, localCurrency, currentCurrency],
  );
  const entryId = entry?.id ?? null;
  const entryCreatedAt = entry?.createdAt ?? null;
  const fifoResult = useMemo(() => {
    // A refund does not use up any ATM withdrawal.
    if (isRefund) return null;
    const parsedLocal = parseAmountInput(localAmount);
    if (!parsedLocal || parsedLocal <= 0) return null;
    return computeFifoCashAmount(tripWithdrawals, otherCashEntries, { id: entryId, date, createdAt: entryCreatedAt, localAmount: parsedLocal });
  }, [tripWithdrawals, otherCashEntries, date, localAmount, entryId, entryCreatedAt, isRefund]);
  const fifoBreakdownText = useMemo(
    () => (fifoResult ? formatFifoBreakdownSummary(fifoResult.breakdown, localCurrency) : ''),
    [fifoResult, localCurrency],
  );
  const amountLocked = isTravel && selectedInstrument?.type === 'cash' && fifoResult != null;

  // Rarely-used fields (tags, reward points, and Add's multi-month) sit behind
  // one toggle; they open by themselves when one has a value so it's never hidden.
  const [moreToggle, setMoreToggle] = useState(null);
  const moreOpen = moreToggle ?? Boolean(tagsText.trim() || rewardPoints.trim() || extraMoreOpen);

  const customSharesCheck = checkCustomSharesTotal(customShares, Math.abs(amountValue || 0), splitMode);
  const customSplitInvalid = splitType === 'custom' && !customSharesCheck.ok;

  // Shown under each field and block saving - bad input used to either save
  // wrong ("1,200" as ₹1, a typed date that no month view could find) or make
  // the button silently do nothing. 0 is a valid amount: a stay paid entirely
  // with reward points still gets logged (with its points).
  const amountInvalid = amount !== '' && amountValue == null;
  const localAmountInvalid = isTravel && localAmount !== '' && !(Math.abs(localValue || 0) > 0);
  const pointsInvalid = pointsFields
    ? earnedInvalid || redeemedInvalid
    : hasPoints && rewardPoints !== '' && parseAmountInput(rewardPoints, { allowNegative: true }) == null;
  // What is saved as the entry's points: redeemed minus earned (positive = spent), or the single signed box.
  const pointsValue = pointsFields
    ? pointsInvalid ? null : netEntryPoints(earnedValue, redeemedValue)
    : hasPoints && rewardPoints.trim() ? parseAmountInput(rewardPoints, { allowNegative: true }) : null;
  // What this purchase would earn on the card, offered as a tap-to-use suggestion and never filled in by itself.
  const suggestion =
    canRedeem && amountValue > 0 && !asRedemption && isValidISODate(date)
      ? previewTransactionReward(selectedCard, cardTransactions.filter((t) => t.id !== entry?.cardTransactionId), {
          date,
          amount: amountValue,
          ...inferCardRewardFields(selectedCard, category, resolveStrategyParamsForDate(selectedCard.strategyParamsHistory, date), null, { bookings: false }),
        })
      : null;
  const suggestedEarned = Math.round(suggestion?.earned ?? suggestion?.estimated ?? 0) || null;
  const dateInvalid = !isValidISODate(date);
  const inputInvalid = amountInvalid || localAmountInvalid || pointsInvalid || dateInvalid;

  useEffect(() => {
    if (!isEdit && categories.length && !categories.includes(category)) setCategory(categories[0]);
  }, [ledger, categories.join('|')]);

  useEffect(() => {
    if (!owedBy || owedBy === payer || !members.includes(owedBy)) {
      setOwedBy(members.find((p) => p !== payer) || '');
    }
  }, [members.join('|'), owedBy, payer]);

  useEffect(() => {
    if (!isTravel || selectedInstrument?.type !== 'cash' || fifoResult == null) return;
    setAmount(fifoResult.amount.toString());
  }, [fifoResult, paymentMethod, isTravel]);

  function toggleSplitAmong(name) {
    if (splitAmong.includes(name)) {
      const next = splitAmong.filter((p) => p !== name);
      if (next.length > 0) setSplitAmong(next);
    } else {
      setSplitAmong([...splitAmong, name]);
    }
  }

  // An owned card/account says who paid most of the time - fill it in, but
  // leave Who Paid editable (e.g. paying with the other person's card).
  function handlePaymentMethodChange(label) {
    setPaymentMethod(label);
    const owner = instruments.find((i) => i.label === label)?.owner;
    if (owner && members.includes(owner)) setPayer(owner);
  }

  return {
    isEdit,
    isTravel,
    hasPoints,
    instruments,
    paymentMethodOptions,
    amount, setAmount,
    refund, setRefund, isRefund, amountValue, localValue,
    localAmount, setLocalAmount,
    localCurrency, setLocalCurrency, currencyOptions, currencyLocked,
    rewardPoints, setRewardPoints,
    payer, setPayer,
    paymentMethod, setPaymentMethod, handlePaymentMethodChange,
    selectedInstrument,
    category, setCategory,
    splitType, setSplitType,
    owedBy, setOwedBy,
    splitAmong, setSplitAmong, toggleSplitAmong,
    customShares, setCustomShares, customSplitInvalid,
    splitMode, setSplitMode,
    date, setDate,
    note, setNote,
    tagsText, setTagsText,
    travelMultiplier, setTravelMultiplier, initialTravelMultiplier, wasBooking,
    selectedCard, selectedCardId, bookingKind, showTravelMultiplier, effectiveTravelMultiplier,
    skipCardTracking, setSkipCardTracking, canSkipCard: canSkipCard && !asRedemption, cardSkipped,
    canRedeem, asRedemption, cardRedeemed, pointsValue, pointsFields, savedWorth: worthUnchanged ? savedWorth : null,
    pointsEarned, setPointsEarned, pointsRedeemed, setPointsRedeemed, earnedInvalid, redeemedInvalid, suggestedEarned,
    fifoResult, fifoBreakdownText, amountLocked,
    moreOpen, setMoreToggle,
    amountInvalid, localAmountInvalid, pointsInvalid, dateInvalid, inputInvalid,
  };
}
