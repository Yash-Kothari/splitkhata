import { useState, useEffect, useMemo } from 'react';
import { updateExpense } from '../firebase';
import {
  DEFAULT_PERSONS as PERSONS,
  computeFifoCashAmount,
  formatFifoBreakdownSummary,
} from '../utils';

export default function EditEntryRow({
  entry,
  dbMembers = [],
  dbCategories = [],
  dbPaymentMethods = [],
  ledger = 'household',
  currentCurrency = 'INR',
  tripEntries = [],
  onCancel,
  onSaved,
  onSaveError,
}) {
  const membersList = dbMembers && dbMembers.length > 0 ? dbMembers : PERSONS;
  const categories = dbCategories && dbCategories.length > 0 ? dbCategories : [entry.category];
  const paymentMethodsList = dbPaymentMethods && dbPaymentMethods.length > 0 ? dbPaymentMethods : ['Cash'];

  const [amount, setAmount] = useState(String(entry.amount ?? ''));
  const [localAmount, setLocalAmount] = useState(entry.localAmount != null ? String(entry.localAmount) : '');
  const [rewardPoints, setRewardPoints] = useState(entry.rewardPoints != null ? String(entry.rewardPoints) : '');
  const [isWithdrawal, setIsWithdrawal] = useState(Boolean(entry.isWithdrawal));
  const [payer, setPayer] = useState(membersList.includes(entry.payer) ? entry.payer : membersList[0]);
  const [category, setCategory] = useState(categories.includes(entry.category) ? entry.category : categories[0]);
  const [splitType, setSplitType] = useState(entry.splitType || (entry.split ? 'shared' : 'personal'));
  const [owedBy, setOwedBy] = useState(
    entry.owedBy && membersList.includes(entry.owedBy)
      ? entry.owedBy
      : membersList.find((p) => p !== payer) || ''
  );
  const [paymentMethod, setPaymentMethod] = useState(
    entry.paymentMethod && paymentMethodsList.includes(entry.paymentMethod)
      ? entry.paymentMethod
      : paymentMethodsList[0] || 'Cash'
  );
  const [date, setDate] = useState(entry.date || '');
  const [note, setNote] = useState(entry.note || '');
  const [saving, setSaving] = useState(false);
  const [slowSave, setSlowSave] = useState(false);

  const isSettlement = entry.splitType === 'settlement';

  const tripWithdrawals = useMemo(() => tripEntries.filter((e) => e.isWithdrawal), [tripEntries]);
  const otherCashEntries = useMemo(
    () => tripEntries.filter((e) => !e.isWithdrawal && e.paymentMethod === 'Cash'),
    [tripEntries],
  );
  // FIFO-priced against the trip's withdrawal queue (see
  // computeFifoCashAmount) - excludes this entry itself via its own id, so
  // editing it doesn't count it as "prior" spend against its own position
  // in the queue.
  const fifoResult = useMemo(() => {
    const parsedLocal = parseFloat(localAmount);
    if (!parsedLocal || parsedLocal <= 0) return null;
    return computeFifoCashAmount(tripWithdrawals, otherCashEntries, {
      id: entry.id,
      date,
      createdAt: entry.createdAt,
      localAmount: parsedLocal,
    });
  }, [tripWithdrawals, otherCashEntries, date, localAmount, entry.id, entry.createdAt]);
  const amountLocked = ledger === 'travel' && paymentMethod === 'Cash' && fifoResult != null;
  const fifoBreakdownText = useMemo(
    () => (fifoResult ? formatFifoBreakdownSummary(fifoResult.breakdown, currentCurrency) : ''),
    [fifoResult, currentCurrency],
  );

  // Same auto-pricing as AddEntryForm - if the payment method here is (or
  // gets changed to) Cash and the withdrawal queue fully covers this Local
  // Amount, keep the locked Amount field in sync instead of leaving it
  // stuck at whatever it was before the edit.
  useEffect(() => {
    if (ledger !== 'travel' || paymentMethod !== 'Cash' || fifoResult == null) return;
    setAmount(fifoResult.amount.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fifoResult, paymentMethod, ledger]);

  const inputClass =
    'w-full h-10 px-3 text-sm rounded-lg border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40';
  const selectClass = `${inputClass} appearance-none`;
  const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-text mb-1';

  async function handleSave(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;

    setSaving(true);
    // Same reasoning as AddEntryForm - the write can outlast a quick tap on
    // a slow connection even though the change already applied locally.
    const slowTimer = setTimeout(() => setSlowSave(true), 2500);
    try {
      if (isSettlement) {
        // Settlements only allow correcting amount/date/note - who paid whom
        // and the splitType are fixed by how the settlement was recorded.
        await updateExpense(entry.id, {
          amount: parsed,
          note: note.trim(),
          date,
        });
      } else {
        await updateExpense(entry.id, {
          amount: parsed,
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          note: note.trim(),
          date,
          paymentMethod: ledger === 'travel' ? paymentMethod : null,
          localAmount: ledger === 'travel' && localAmount ? parseFloat(localAmount) : null,
          rewardPoints: ledger === 'travel' && rewardPoints ? parseFloat(rewardPoints) : null,
          isWithdrawal: ledger === 'travel' ? isWithdrawal : false,
        });
      }
      onSaved?.();
    } catch (err) {
      onSaveError?.(err);
    } finally {
      clearTimeout(slowTimer);
      setSaving(false);
      setSlowSave(false);
    }
  }

  if (isSettlement) {
    return (
      <li className="py-3.5 px-2 rounded-md bg-paper/60 border border-ledger-green/30">
        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-sm text-ink">
            <span className="font-semibold text-stamp-red">{entry.payer}</span>
            {' paid '}
            <span className="font-semibold text-ledger-green">{entry.owedBy}</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor={`edit-amount-${entry.id}`} className={labelClass}>
                Amount ({ledger === 'travel' ? currentCurrency : '₹'})
              </label>
              <input
                id={`edit-amount-${entry.id}`}
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputClass} font-mono font-bold`}
              />
            </div>
            <div>
              <label htmlFor={`edit-date-${entry.id}`} className={labelClass}>
                Date
              </label>
              <input
                id={`edit-date-${entry.id}`}
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${inputClass} date-input appearance-none`}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor={`edit-note-${entry.id}`} className={labelClass}>
                Note (optional)
              </label>
              <input
                id={`edit-note-${entry.id}`}
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !amount}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
            >
              {saving ? (slowSave ? 'Still saving…' : 'Saving...') : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-ink/15 text-ink font-semibold text-xs sm:text-sm hover:bg-ink/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="py-3.5 px-2 rounded-md bg-paper/60 border border-ledger-green/30">
      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor={`edit-amount-${entry.id}`} className={labelClass}>
              Amount (₹){ledger === 'travel' ? ' - real cost' : ''}
            </label>
            <input
              id={`edit-amount-${entry.id}`}
              type="number"
              inputMode="decimal"
              min="0.01"
              step="any"
              required
              readOnly={amountLocked}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${inputClass} font-mono font-bold ${amountLocked ? 'bg-paper/60 text-muted-text cursor-not-allowed' : ''}`}
              title={amountLocked ? fifoBreakdownText : undefined}
            />
          </div>

          {ledger === 'travel' && (
            <div>
              <label htmlFor={`edit-localamount-${entry.id}`} className={labelClass}>
                Local Amount ({currentCurrency})
              </label>
              <input
                id={`edit-localamount-${entry.id}`}
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
              <label htmlFor={`edit-rewardpoints-${entry.id}`} className={labelClass}>
                Reward Points (+ spent / − earned)
              </label>
              <input
                id={`edit-rewardpoints-${entry.id}`}
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
            <label htmlFor={`edit-split-${entry.id}`} className={labelClass}>
              Split Type
            </label>
            <select
              id={`edit-split-${entry.id}`}
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
            <label htmlFor={`edit-payer-${entry.id}`} className={labelClass}>
              Who Paid
            </label>
            <select
              id={`edit-payer-${entry.id}`}
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
              <label htmlFor={`edit-owedby-${entry.id}`} className={labelClass}>
                Who Owes Full Amount
              </label>
              <select
                id={`edit-owedby-${entry.id}`}
                value={owedBy}
                onChange={(e) => setOwedBy(e.target.value)}
                className={selectClass}
                required
              >
                {membersList.filter((p) => p !== payer).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor={`edit-category-${entry.id}`} className={labelClass}>
              Category
            </label>
            <select
              id={`edit-category-${entry.id}`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={selectClass}
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {ledger === 'travel' && (
            <div>
              <label htmlFor={`edit-paymentmethod-${entry.id}`} className={labelClass}>
                Payment Method
              </label>
              <select
                id={`edit-paymentmethod-${entry.id}`}
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
            <label htmlFor={`edit-date-${entry.id}`} className={labelClass}>
              Date
            </label>
            <input
              id={`edit-date-${entry.id}`}
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputClass} date-input appearance-none`}
            />
          </div>

          {ledger === 'travel' && (
            <div className="col-span-2 sm:col-span-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isWithdrawal}
                  onChange={(e) => setIsWithdrawal(e.target.checked)}
                  className="h-4 w-4 rounded border-ink/30 text-ledger-green focus:ring-ledger-green/40"
                />
                <span className="text-sm font-semibold text-ink">
                  Cash withdrawal (exclude from spend totals)
                </span>
              </label>
            </div>
          )}

          <div className="col-span-2 sm:col-span-3">
            <label htmlFor={`edit-note-${entry.id}`} className={labelClass}>
              Note (optional)
            </label>
            <input
              id={`edit-note-${entry.id}`}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
              placeholder="What was this for?"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !amount}
            className="flex-1 sm:flex-none h-9 px-4 rounded-lg bg-ledger-green text-white font-semibold text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
          >
            {saving ? (slowSave ? 'Still saving…' : 'Saving...') : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-ink/15 text-ink font-semibold text-xs sm:text-sm hover:bg-ink/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}
