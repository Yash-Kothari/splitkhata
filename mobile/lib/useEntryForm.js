import { useEffect, useMemo, useState } from 'react';
import {
  buildPaymentInstruments,
  checkCustomSharesTotal,
  computeFifoCashAmount,
  formatFifoBreakdownSummary,
  getLastEntryDefaults,
  isCashPaid,
  isStatementOnlyCard,
  isValidISODate,
  isWithdrawalEntry,
  parseAmountInput,
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

  const [amount, setAmount] = useState(entry ? String(entry.amount ?? '') : '');
  const [localAmount, setLocalAmount] = useState(entry?.localAmount != null ? String(entry.localAmount) : '');
  const [rewardPoints, setRewardPoints] = useState(entry?.rewardPoints != null ? String(entry.rewardPoints) : '');

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
  // points are their own manual Reward Points field, separate from the card's,
  // and a travel booking's accelerated points are entered on the Cards tab.
  const selectedCard = selectedInstrument?.cardId ? creditCards.find((c) => c.id === selectedInstrument.cardId) : null;
  const bookingKind =
    !isTravel && selectedCard && !isStatementOnlyCard(selectedCard)
      ? { hsbc_premier_flat_capped: 'travel_with_points', hdfc_diners_slab_milestone: 'smartbuy' }[selectedCard.rewardStrategy] || null
      : null;
  const showTravelMultiplier = bookingKind != null;
  const effectiveTravelMultiplier = showTravelMultiplier ? travelMultiplier.trim() : '';
  const selectedCardId = selectedCard?.id;

  // A card whose statement is already closed (backdated entries): keep the
  // entry but don't add a transaction to that card, so its cycle totals and
  // rewards stay as they were. Only offered for a tracked card.
  const [skipCardTracking, setSkipCardTracking] = useState(Boolean(entry?.skipCardTracking));
  const canSkipCard = Boolean(selectedCard) && !isStatementOnlyCard(selectedCard);
  const cardSkipped = canSkipCard && skipCardTracking;

  // Cash purchases on a trip are priced from the ATM withdrawals, oldest first.
  const tripWithdrawals = useMemo(() => tripEntries.filter(isWithdrawalEntry), [tripEntries]);
  const otherCashEntries = useMemo(() => tripEntries.filter(isCashPaid), [tripEntries]);
  const entryId = entry?.id ?? null;
  const entryCreatedAt = entry?.createdAt ?? null;
  const fifoResult = useMemo(() => {
    const parsedLocal = parseAmountInput(localAmount);
    if (!parsedLocal || parsedLocal <= 0) return null;
    return computeFifoCashAmount(tripWithdrawals, otherCashEntries, { id: entryId, date, createdAt: entryCreatedAt, localAmount: parsedLocal });
  }, [tripWithdrawals, otherCashEntries, date, localAmount, entryId, entryCreatedAt]);
  const fifoBreakdownText = useMemo(
    () => (fifoResult ? formatFifoBreakdownSummary(fifoResult.breakdown, currentCurrency) : ''),
    [fifoResult, currentCurrency],
  );
  const amountLocked = isTravel && selectedInstrument?.type === 'cash' && fifoResult != null;

  // Rarely-used fields (tags, reward points, and Add's multi-month) sit behind
  // one toggle; they open by themselves when one has a value so it's never hidden.
  const [moreToggle, setMoreToggle] = useState(null);
  const moreOpen = moreToggle ?? Boolean(tagsText.trim() || rewardPoints.trim() || extraMoreOpen);

  const customSharesCheck = checkCustomSharesTotal(customShares, parseAmountInput(amount) || 0, splitMode);
  const customSplitInvalid = splitType === 'custom' && !customSharesCheck.ok;

  // Shown under each field and block saving - bad input used to either save
  // wrong ("1,200" as ₹1, a typed date that no month view could find) or make
  // the button silently do nothing. 0 is a valid amount: a stay paid entirely
  // with reward points still gets logged (with its points).
  const amountInvalid = amount !== '' && parseAmountInput(amount) == null;
  const localAmountInvalid = isTravel && localAmount !== '' && !(parseAmountInput(localAmount) > 0);
  const pointsInvalid = hasPoints && rewardPoints !== '' && parseAmountInput(rewardPoints, { allowNegative: true }) == null;
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
    localAmount, setLocalAmount,
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
    skipCardTracking, setSkipCardTracking, canSkipCard, cardSkipped,
    fifoResult, fifoBreakdownText, amountLocked,
    moreOpen, setMoreToggle,
    amountInvalid, localAmountInvalid, pointsInvalid, dateInvalid, inputInvalid,
  };
}
