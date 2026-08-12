import { useState, useEffect, useMemo } from 'react';
import { addExpense, addExpensesBatch, generateStructured, extractReceiptFromImage } from '../firebase';
import {
  getLedgerCategories,
  DEFAULT_PERSONS as PERSONS,
  todayISO,
  addMonthsToDateISO,
  splitAmountEvenly,
  computeFifoCashAmount,
  formatFifoBreakdownSummary,
  buildCategorySuggestionPrompt,
  buildCategorySuggestionSchema,
  buildQuickAddPrompt,
  buildQuickAddSchema,
  buildReceiptExtractionPrompt,
  buildReceiptExtractionSchema,
} from '../utils';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that image file.'));
    reader.readAsDataURL(file);
  });
}

export default function AddEntryForm({
  deviceName,
  onSaveError,
  ledger = 'household',
  tripName = '',
  dbCategories,
  dbMembers = [],
  currentCurrency = 'INR',
  dbPaymentMethods = [],
  tripEntries = [],
}) {
  const categories = dbCategories && dbCategories.length > 0
    ? dbCategories
    : getLedgerCategories(ledger);

  const membersList = dbMembers && dbMembers.length > 0 ? dbMembers : PERSONS;
  const paymentMethodsList = dbPaymentMethods && dbPaymentMethods.length > 0 ? dbPaymentMethods : ['Cash'];

  const [amount, setAmount] = useState('');
  const [localAmount, setLocalAmount] = useState('');
  const [rewardPoints, setRewardPoints] = useState('');
  const [payer, setPayer] = useState(deviceName || membersList[0]);
  const [category, setCategory] = useState(categories[0] || 'Groceries');
  const [splitType, setSplitType] = useState('shared');
  const [owedBy, setOwedBy] = useState(() => membersList.find((person) => person !== (deviceName || membersList[0])) || '');
  const [splitAmong, setSplitAmong] = useState(membersList);
  const [paymentMethod, setPaymentMethod] = useState(paymentMethodsList[0] || 'Cash');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [pendingSaves, setPendingSaves] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [splitAcrossMonths, setSplitAcrossMonths] = useState(false);
  const [monthsCount, setMonthsCount] = useState(6);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddStatus, setQuickAddStatus] = useState({ state: 'idle', error: '' });
  const [suggestingCategory, setSuggestingCategory] = useState(false);
  const [categorySuggestError, setCategorySuggestError] = useState('');
  const [receiptStatus, setReceiptStatus] = useState({ state: 'idle', error: '' });

  const tripWithdrawals = useMemo(() => tripEntries.filter((e) => e.isWithdrawal), [tripEntries]);
  const otherCashEntries = useMemo(
    () => tripEntries.filter((e) => !e.isWithdrawal && e.paymentMethod === 'Cash'),
    [tripEntries],
  );
  // FIFO-priced against the trip's withdrawal queue, using whatever's been
  // typed so far - null (not yet computable) until Local Amount has a
  // value the known withdrawals can actually cover.
  const fifoResult = useMemo(() => {
    const parsedLocal = parseFloat(localAmount);
    if (!parsedLocal || parsedLocal <= 0) return null;
    return computeFifoCashAmount(tripWithdrawals, otherCashEntries, { id: null, date, createdAt: null, localAmount: parsedLocal });
  }, [tripWithdrawals, otherCashEntries, date, localAmount]);
  const fifoBreakdownText = useMemo(
    () => (fifoResult ? formatFifoBreakdownSummary(fifoResult.breakdown, currentCurrency) : ''),
    [fifoResult, currentCurrency],
  );

  useEffect(() => {
    if (categories.length && !categories.includes(category)) {
      setCategory(categories[0]);
    }
  }, [ledger, categories, category]);

  // Default the payer to this device's identity, but only when the identity
  // itself changes (or the member list changes) — not on every payer edit,
  // otherwise manually picking a different payer gets immediately overwritten.
  useEffect(() => {
    if (deviceName && membersList.includes(deviceName)) {
      setPayer(deviceName);
    } else {
      setPayer((prev) => (membersList.includes(prev) ? prev : membersList[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceName, membersList]);

  useEffect(() => {
    if (!owedBy || owedBy === payer || !membersList.includes(owedBy)) {
      setOwedBy(membersList.find((person) => person !== payer) || '');
    }
  }, [membersList, owedBy, payer]);

  // Resets to "everyone" whenever the *set* of available members actually
  // changes (switching trips, a guest added/removed) - keyed on the joined
  // names rather than the membersList array itself, since that's a fresh
  // array reference from the parent on every render regardless of whether
  // its contents changed, which would otherwise wipe out a manually
  // narrowed selection while just typing elsewhere in the form.
  const membersKey = membersList.join('|');
  useEffect(() => {
    setSplitAmong(membersList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersKey]);

  function toggleSplitAmong(name) {
    setSplitAmong((prev) => {
      if (prev.includes(name)) {
        const next = prev.filter((p) => p !== name);
        return next.length > 0 ? next : prev;
      }
      return [...prev, name];
    });
  }

  // Pre-fills the form from a casual sentence - never submits on its own.
  // The user still reviews every field (amount, category, payer, ...) and
  // clicks Add to Ledger themselves, same as if they'd typed it all by hand.
  async function handleQuickAdd() {
    const text = quickAddText.trim();
    if (!text) return;
    setQuickAddStatus({ state: 'loading', error: '' });
    try {
      const schema = buildQuickAddSchema({
        categories,
        members: membersList,
        paymentMethods: paymentMethodsList,
        isTravel: ledger === 'travel',
      });
      const prompt = buildQuickAddPrompt(text, { members: membersList, today: todayISO() });
      const parsed = await generateStructured(prompt, schema);

      setAmount(String(parsed.amount ?? ''));
      if (parsed.category && categories.includes(parsed.category)) setCategory(parsed.category);
      if (parsed.payer && membersList.includes(parsed.payer)) setPayer(parsed.payer);
      if (parsed.splitType) setSplitType(parsed.splitType);
      if (parsed.splitType === 'owed' && parsed.owedBy && membersList.includes(parsed.owedBy)) {
        setOwedBy(parsed.owedBy);
      }
      if (parsed.note) setNote(parsed.note);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '')) setDate(parsed.date);
      if (ledger === 'travel' && parsed.paymentMethod && paymentMethodsList.includes(parsed.paymentMethod)) {
        setPaymentMethod(parsed.paymentMethod);
      }

      setQuickAddStatus({ state: 'done', error: '' });
      setQuickAddText('');
    } catch (err) {
      setQuickAddStatus({ state: 'error', error: err?.message || 'Could not parse that.' });
    }
  }

  // Fills in amount/category/date/note from a photo - same "review before
  // submitting" pattern as Quick Add above, not an auto-save. Payer and
  // split type are left alone since a receipt can't tell you who paid or
  // how you're splitting it.
  async function handleReceiptFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReceiptStatus({ state: 'loading', error: '' });
    try {
      const base64 = await fileToBase64(file);
      const parsed = await extractReceiptFromImage(
        base64,
        file.type || 'image/jpeg',
        buildReceiptExtractionPrompt(categories, todayISO()),
        buildReceiptExtractionSchema(categories),
      );

      if (parsed.amount) setAmount(String(parsed.amount));
      if (parsed.category && categories.includes(parsed.category)) setCategory(parsed.category);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '')) setDate(parsed.date);
      if (parsed.note) setNote(parsed.note);

      setReceiptStatus({ state: 'done', error: '' });
    } catch (err) {
      setReceiptStatus({ state: 'error', error: err?.message || 'Could not read that receipt.' });
    }
  }

  async function handleSuggestCategory() {
    if (!note.trim()) return;
    setSuggestingCategory(true);
    setCategorySuggestError('');
    try {
      const result = await generateStructured(
        buildCategorySuggestionPrompt(note.trim(), categories),
        buildCategorySuggestionSchema(categories),
      );
      if (result.category && categories.includes(result.category)) setCategory(result.category);
    } catch (err) {
      setCategorySuggestError(err?.message || 'Could not suggest a category.');
    } finally {
      setSuggestingCategory(false);
    }
  }

  useEffect(() => {
    if (paymentMethodsList.length && !paymentMethodsList.includes(paymentMethod)) {
      setPaymentMethod(paymentMethodsList[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethodsList]);

  // Auto-price a cash purchase's INR cost from its local amount, using the
  // trip's withdrawal queue in FIFO order (see computeFifoCashAmount) -
  // saves working out which withdrawal funded it and at what rate by hand.
  useEffect(() => {
    if (ledger !== 'travel' || paymentMethod !== 'Cash' || fifoResult == null) return;
    setAmount(fifoResult.amount.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fifoResult, paymentMethod, ledger]);

  function handleSubmit(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;

    const trimmedNote = note.trim();
    const months = splitAcrossMonths ? Math.max(2, Math.min(36, Math.round(monthsCount) || 2)) : 1;
    const parsedLocal = ledger === 'travel' && localAmount ? parseFloat(localAmount) : null;
    const parsedPoints = ledger === 'travel' && rewardPoints ? parseFloat(rewardPoints) : null;
    // Only stored as a real subset when it actually IS one - every entry
    // that predates this field has no splitAmong at all, and computeBalance
    // already treats "no splitAmong" as "everyone", so there's no reason to
    // write out the full member list when nothing was narrowed down.
    const effectiveSplitAmong = splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < membersList.length
      ? splitAmong
      : null;

    // Firestore's offline cache queues this write locally and syncs it in
    // the background - the entry is durable even if this tab closes before
    // that sync finishes. Don't make the next entry wait on the server
    // round-trip: fire the write and reset the form immediately, and only
    // surface a problem later (via onSaveError) if it actually fails.
    let writePromise;
    if (months > 1) {
      const installmentAmounts = splitAmountEvenly(parsed, months);
      const installments = Array.from({ length: months }, (_, i) => ({
        amount: installmentAmounts[i],
        payer,
        category,
        split: splitType !== 'personal',
        splitType,
        owedBy: splitType === 'owed' ? owedBy : null,
        splitAmong: effectiveSplitAmong,
        note: trimmedNote ? `${trimmedNote} (${i + 1}/${months})` : `Installment ${i + 1}/${months}`,
        date: addMonthsToDateISO(date, i),
        ledger,
        tripName: ledger === 'travel' ? tripName : '',
        paymentMethod: ledger === 'travel' ? paymentMethod : null,
        localAmount: null,
        rewardPoints: null,
      }));
      writePromise = addExpensesBatch(installments);
    } else {
      writePromise = addExpense({
        amount: parsed,
        payer,
        category,
        split: splitType !== 'personal',
        splitType,
        owedBy: splitType === 'owed' ? owedBy : null,
        splitAmong: effectiveSplitAmong,
        note: trimmedNote,
        date,
        ledger,
        tripName: ledger === 'travel' ? tripName : '',
        paymentMethod: ledger === 'travel' ? paymentMethod : null,
        localAmount: parsedLocal,
        rewardPoints: parsedPoints,
      });
    }

    setPendingSaves((n) => n + 1);
    writePromise
      .catch((err) => onSaveError?.(err))
      .finally(() => setPendingSaves((n) => n - 1));

    setAmount('');
    setLocalAmount('');
    setRewardPoints('');
    setNote('');
    setDate(todayISO());
    setSplitAcrossMonths(false);
    setMonthsCount(6);
    setSplitAmong(membersList);
    setQuickAddStatus({ state: 'idle', error: '' });
  }

  // Once the trip's withdrawals fully cover this Local Amount, a Cash
  // entry's INR cost is derived (FIFO), not entered - locking it stops
  // someone from typing a number that doesn't match, which the auto-fill
  // would otherwise silently overwrite the next time Local Amount changes.
  const amountLocked = ledger === 'travel' && paymentMethod === 'Cash' && fifoResult != null;

  const inputClass =
    'w-full h-11 px-3.5 text-sm sm:text-base rounded-xl border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs transition-all flex items-center';

  const selectClass =
    `${inputClass} appearance-none bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2324304A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")] bg-[length:1.1rem_1.1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9`;

  const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-muted-text mb-1.5';

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between min-h-11 text-left font-display text-lg font-bold text-ink hover:text-ledger-green transition-colors"
        aria-expanded={expanded}
      >
        <span>
          Add Entry {ledger === 'travel' && tripName ? `(${tripName})` : ''}
        </span>
        <span className="text-muted-text text-xs sm:text-sm font-sans font-semibold px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          {expanded ? 'Collapse' : 'Expand'}
        </span>
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="rounded-xl border border-ledger-green/20 bg-ledger-green/5 px-3.5 py-3">
            <label htmlFor="quickAdd" className={labelClass}>
              ✨ Quick Add - describe it in a sentence
            </label>
            <div className="flex gap-2">
              <input
                id="quickAdd"
                type="text"
                value={quickAddText}
                onChange={(e) => setQuickAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleQuickAdd();
                  }
                }}
                className={inputClass}
                placeholder="e.g. 1200 dinner with Kruti last night"
              />
              <button
                type="button"
                onClick={handleQuickAdd}
                disabled={!quickAddText.trim() || quickAddStatus.state === 'loading'}
                className="shrink-0 h-11 px-4 rounded-xl bg-ledger-green text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
              >
                {quickAddStatus.state === 'loading' ? '...' : 'Parse'}
              </button>
            </div>
            {quickAddStatus.state === 'done' && (
              <p className="text-xs text-ledger-green mt-1.5">Filled in below - review and Add to Ledger.</p>
            )}
            {quickAddStatus.state === 'error' && (
              <p className="text-xs text-stamp-red mt-1.5">{quickAddStatus.error}</p>
            )}
          </div>

          <div className="rounded-xl border border-ledger-green/20 bg-ledger-green/5 px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="receiptFile" className="text-xs font-semibold uppercase tracking-wider text-muted-text cursor-pointer">
                📷 Scan a receipt to auto-fill
              </label>
              <label
                htmlFor="receiptFile"
                className="cursor-pointer shrink-0 h-9 px-3.5 rounded-xl bg-ledger-green text-white font-semibold text-xs disabled:opacity-50 hover:bg-ledger-green/90 transition-colors flex items-center justify-center"
              >
                {receiptStatus.state === 'loading' ? 'Reading...' : 'Take Photo'}
              </label>
              <input
                id="receiptFile"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleReceiptFile}
                disabled={receiptStatus.state === 'loading'}
                className="hidden"
              />
            </div>
            {receiptStatus.state === 'done' && (
              <p className="text-xs text-ledger-green mt-1.5">Filled in below - review and Add to Ledger.</p>
            )}
            {receiptStatus.state === 'error' && (
              <p className="text-xs text-stamp-red mt-1.5">{receiptStatus.error}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="amount" className={labelClass}>
                Amount (₹){ledger === 'travel' ? ' - real cost' : ''}
              </label>
              <input
                id="amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                required
                readOnly={amountLocked}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputClass} font-mono font-bold ${amountLocked ? 'bg-paper/60 text-muted-text cursor-not-allowed' : ''}`}
                placeholder="0.00"
                title={amountLocked ? fifoBreakdownText : undefined}
              />
            </div>

            {ledger === 'travel' && (
              <div>
                <label htmlFor="localAmount" className={labelClass}>
                  Local Amount ({currentCurrency})
                </label>
                <input
                  id="localAmount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={localAmount}
                  onChange={(e) => setLocalAmount(e.target.value)}
                  className={`${inputClass} font-mono font-bold`}
                  placeholder="Optional"
                />
              </div>
            )}

            {ledger === 'travel' && (
              <div>
                <label htmlFor="rewardPoints" className={labelClass}>
                  Reward Points (+ spent / − earned)
                </label>
                <input
                  id="rewardPoints"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={rewardPoints}
                  onChange={(e) => setRewardPoints(e.target.value)}
                  className={`${inputClass} font-mono font-bold`}
                  placeholder="Optional"
                />
              </div>
            )}

            <div>
              <label htmlFor="split" className={labelClass}>
                Split Type
              </label>
              <select
                id="split"
                value={splitType}
                onChange={(e) => setSplitType(e.target.value)}
                className={selectClass}
              >
                <option value="shared">Split</option>
                <option value="owed">Owed</option>
                <option value="personal">Personal</option>
              </select>
            </div>

            <div>
              <label htmlFor="payer" className={labelClass}>
                Who Paid
              </label>
              <select
                id="payer"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
                className={selectClass}
              >
                {membersList.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {splitType === 'owed' && (
              <div>
                <label htmlFor="owedBy" className={labelClass}>
                  Who Owes the Full Amount
                </label>
                <select
                  id="owedBy"
                  value={owedBy}
                  onChange={(e) => setOwedBy(e.target.value)}
                  className={selectClass}
                  required
                >
                  {membersList.filter((person) => person !== payer).map((person) => (
                    <option key={person} value={person}>{person}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="category" className={`${labelClass} mb-0`}>
                  Category
                </label>
                {note.trim() && (
                  <button
                    type="button"
                    onClick={handleSuggestCategory}
                    disabled={suggestingCategory}
                    className="text-xs font-semibold text-ledger-green hover:text-ledger-green/80 disabled:opacity-50"
                  >
                    {suggestingCategory ? 'Suggesting...' : '✨ Suggest'}
                  </button>
                )}
              </div>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectClass}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {categorySuggestError && (
                <p className="text-xs text-stamp-red mt-1">{categorySuggestError}</p>
              )}
            </div>

            {ledger === 'travel' && (
              <div>
                <label htmlFor="paymentMethod" className={labelClass}>
                  Payment Method
                </label>
                <select
                  id="paymentMethod"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={selectClass}
                >
                  {paymentMethodsList.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="date" className={labelClass}>
                Date
              </label>
              <input
                id="date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${inputClass} date-input appearance-none lg:h-12 lg:px-4`}
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="note" className={labelClass}>
                Note (optional)
              </label>
              <input
                id="note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass}
                placeholder="What was this for?"
              />
            </div>
          </div>

          {splitType === 'shared' && membersList.length > 2 && (
            <div>
              <label className={labelClass}>Split Among</label>
              <div className="flex flex-wrap gap-2">
                {membersList.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleSplitAmong(m)}
                    className={`min-h-10 px-3.5 rounded-lg border text-sm font-semibold transition-colors ${
                      splitAmong.includes(m)
                        ? 'bg-ledger-green border-ledger-green text-white'
                        : 'border-ink/15 bg-paper text-ink hover:bg-paper-card'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {splitAmong.length < membersList.length && (
                <p className="text-xs text-muted-text mt-1.5">
                  Only split between {splitAmong.join(' and ')} - not the whole trip.
                </p>
              )}
            </div>
          )}

          {ledger === 'travel' && paymentMethod === 'Cash' && splitType === 'personal' && (
            <p className="text-xs text-muted-text -mt-1.5 px-0.5">
              "Personal" here just means this won't affect the balance - it's still joint cash from the ATM withdrawal, not {payer}'s own money. That cost was already split when the withdrawal was recorded.
            </p>
          )}

          {ledger !== 'travel' && (
            <div className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={splitAcrossMonths}
                  onChange={(e) => setSplitAcrossMonths(e.target.checked)}
                  className="h-4 w-4 rounded border-ink/30 text-ledger-green focus:ring-ledger-green/40"
                />
                <span className="text-sm font-semibold text-ink">
                  Split across multiple months
                </span>
              </label>
              <p className="text-xs text-muted-text mt-1 ml-6">
                For lump-sum payments that cover several months (e.g. 6 months of WiFi) - spreads the amount evenly across one entry per month instead of inflating a single month.
              </p>

              {splitAcrossMonths && (
                <div className="mt-3 ml-6 max-w-[10rem]">
                  <label htmlFor="monthsCount" className={labelClass}>
                    Number of Months
                  </label>
                  <input
                    id="monthsCount"
                    type="number"
                    inputMode="numeric"
                    min="2"
                    max="36"
                    step="1"
                    value={monthsCount}
                    onChange={(e) => setMonthsCount(e.target.value)}
                    className={inputClass}
                  />
                  {amount && parseFloat(amount) > 0 && (
                    <p className="text-xs text-muted-text mt-1.5">
                      ~₹{(parseFloat(amount) / Math.max(2, Math.min(36, Math.round(monthsCount) || 2))).toFixed(2)} / month
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 bg-paper-card/95 backdrop-blur-xs border-t border-ink/10 sm:static sm:border-0 sm:p-0 sm:bg-transparent sm:backdrop-blur-none z-10">
            <button
              type="submit"
              disabled={!amount}
              className="w-full h-11 px-4 py-2.5 rounded-xl bg-ledger-green text-white font-semibold text-sm sm:text-base shadow-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-ledger-green/50 transition-all flex items-center justify-center gap-2"
            >
              <span>Add to Ledger</span>
              {pendingSaves > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" title="Syncing…" />
              )}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
