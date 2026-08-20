import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addCardTransaction,
  updateCardTransaction,
  deleteCardTransaction,
  saveCardBillingCycle,
} from '../firebase';
import {
  todayISO,
  formatCurrency,
  getCardCycleForDate,
  getTransactionsInCycle,
  listRecentCardCycles,
  getQuarterBounds,
  computeCardCycleReward,
  resolveStrategyParamsForDate,
  computeCardMilestoneProgress,
  getAnnualMilestoneWindow,
  computeCardCapStatus,
  applyRewardOverrides,
  previewTransactionReward,
  CARD_REWARD_STRATEGIES,
  getCardBillingCycleKey,
} from '../utils';

const UNDO_WINDOW_MS = 6000;

const inputClass =
  'w-full h-11 px-3.5 text-sm rounded-xl border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs flex items-center';
const selectClass =
  `${inputClass} appearance-none bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2324304A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")] bg-[length:1.1rem_1.1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9`;
const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-muted-text mb-1.5';

function formatReward(amount, unit) {
  return unit === 'points' ? `${Math.round(amount).toLocaleString('en-IN')} pts` : formatCurrency(amount);
}

// Matches EntryList's compact date treatment ("15 Aug") so the Cards tab
// reads consistently with the rest of the household ledger.
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// HDFC posts grocery reward points in a batch on the 1st of the month after
// the spend, not immediately - a same-month "0 points so far" on a grocery
// transaction is normal, not a missed reward.
function nextMonthFirst(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return `${nextY}-${String(nextM).padStart(2, '0')}-01`;
}

// A billing cycle is named after the month it closes in (its statement
// month), with the exact date range alongside since that's what actually
// matters for matching against a real statement.
function formatCycleMonthLabel(cycle) {
  const monthName = new Date(cycle.cycleEnd + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long' });
  const startShort = formatDate(cycle.cycleStart);
  const endShort = formatDate(cycle.cycleEnd);
  return `${monthName} (${startShort} – ${endShort})`;
}

// `invert` flips the color meaning: for a milestone, reaching 100% is the
// goal (green); for a cap, reaching 100% means no room left (red warning),
// so the color logic runs the opposite direction.
function ProgressBar({ pctUsed, invert = false }) {
  const colorClass = invert
    ? pctUsed >= 1 ? 'bg-stamp-red' : pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green/60'
    : pctUsed >= 1 ? 'bg-ledger-green' : pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green/60';
  return (
    <div className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${Math.min(pctUsed * 100, 100)}%` }}
      />
    </div>
  );
}

// Every strategy needs a different shape of "which category/channel does
// this transaction count as" - rather than showing every possible field on
// every card, the form only renders what that card's own strategy actually
// consumes (see computeCardCycleReward in utils.js for what each strategy
// reads off a transaction).
function StrategyFields({ card, draft, onChange }) {
  const strategy = card.rewardStrategy;

  if (strategy === 'hdfc_diners_slab_milestone') {
    const dinersCategories = resolveStrategyParamsForDate(card.strategyParamsHistory, todayISO()).categories || [];
    const smartbuyCategory = dinersCategories.find((c) => c.key === 'smartbuy_hotel');
    return (
      <>
        <div>
          <label className={labelClass}>Category</label>
          <select
            value={draft.category || 'regular'}
            onChange={(e) => onChange({ category: e.target.value })}
            className={selectClass}
          >
            {dinersCategories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
        {draft.category === 'smartbuy_hotel' && (
          <>
            <div>
              <label className={labelClass}>Multiplier</label>
              <input
                type="number"
                min="1"
                step="any"
                value={draft.travelMultiplier ?? ''}
                onChange={(e) => onChange({ travelMultiplier: e.target.value })}
                placeholder={String(smartbuyCategory?.multiplier ?? 10)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Points Redeemed (Optional)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={draft.pointsRedeemed ?? ''}
                onChange={(e) => onChange({ pointsRedeemed: e.target.value })}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </>
        )}
      </>
    );
  }

  if (strategy === 'sbi_two_channel_cashback') {
    return (
      <div>
        <label className={labelClass}>Category</label>
        <select
          value={draft.channel || 'online'}
          onChange={(e) => onChange({ channel: e.target.value })}
          className={selectClass}
        >
          <option value="online">Online (5%)</option>
          <option value="offline">Offline / POS (1%)</option>
          <option value="excluded">Excluded (Fuel, Gaming, Tolls, Govt, Wallet, Rent, Jewellery, Education, Utility, Insurance, Gift Shop, Railways, EMI)</option>
        </select>
      </div>
    );
  }

  if (strategy === 'hsbc_tiered_cashback_aggregate') {
    return (
      <div>
        <label className={labelClass}>Category</label>
        <select
          value={draft.channel === 'excluded' ? 'excluded' : draft.isBonusEligible ? 'eligible' : 'base'}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'excluded') onChange({ channel: 'excluded', isBonusEligible: false });
            else if (v === 'eligible') onChange({ channel: null, isBonusEligible: true });
            else onChange({ channel: null, isBonusEligible: false });
          }}
          className={selectClass}
        >
          <option value="eligible">Dining / Food Delivery / Grocery / Shopping / Utility (10%)</option>
          <option value="base">Everything Else (1.5%)</option>
          <option value="excluded">Excluded (Rent, Fuel, Insurance, Education, Government, E-Wallets, Financial Institutions, Money Transfer, Jewellery, Tolls, Gambling, Hospitals, Wholesale Clubs, International / Forex, EMI - 0%)</option>
        </select>
      </div>
    );
  }

  if (strategy === 'axis_supermoney_dual_pool') {
    return (
      <div>
        <label className={labelClass}>Category</label>
        <select
          value={draft.isBonusEligible ? 'supermoney' : 'other'}
          onChange={(e) => onChange({ isBonusEligible: e.target.value === 'supermoney' })}
          className={selectClass}
        >
          <option value="supermoney">Super.Money App UPI (3%)</option>
          <option value="other">Other UPI / Card Spend (1%)</option>
        </select>
      </div>
    );
  }

  if (strategy === 'hsbc_premier_flat_capped') {
    return (
      <>
        <div>
          <label className={labelClass}>Category</label>
          <select
            value={draft.category || 'regular'}
            onChange={(e) => onChange({ category: e.target.value })}
            className={selectClass}
          >
            <option value="regular">Regular (3%)</option>
            <option value="capped_category">Insurance / Utility / Education / Govt / Wallet / Real Estate / Jewellery / Tax / Money Transfer (3%, capped ₹1L/month)</option>
            <option value="fuel_excluded">Fuel (Excluded)</option>
            <option value="travel_bonus">Travel with Points Booking (Multiplier)</option>
          </select>
        </div>
        {draft.category === 'travel_bonus' && (
          <>
            <div>
              <label className={labelClass}>Multiplier (6-36% per the booking)</label>
              <input
                type="number"
                min="1"
                step="any"
                value={draft.travelMultiplier ?? ''}
                onChange={(e) => onChange({ travelMultiplier: e.target.value })}
                placeholder="e.g. 6"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Points Redeemed (Optional)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={draft.pointsRedeemed ?? ''}
                onChange={(e) => onChange({ pointsRedeemed: e.target.value })}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </>
        )}
      </>
    );
  }

  return null;
}

function AddCardTransactionForm({ card, cardTxns, onSaveError }) {
  const [expanded, setExpanded] = useState(true);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState({});
  const [rewardOverride, setRewardOverride] = useState('');
  const [saving, setSaving] = useState(false);

  function updateDraft(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  const parsedAmount = parseFloat(amount);
  const preview = previewTransactionReward(card, cardTxns, {
    date,
    amount: parsedAmount,
    category: draft.category ?? null,
    channel: draft.channel ?? null,
    isBonusEligible: Boolean(draft.isBonusEligible),
    travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
  });
  const calculatedReward = preview ? (preview.earned ?? preview.estimated ?? 0) : null;
  const rewardUnit = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy)?.unit || 'inr';

  async function handleSubmit(e) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      await addCardTransaction({
        cardId: card.id,
        amount: parsed,
        description: description.trim(),
        date,
        category: draft.category ?? null,
        channel: draft.channel ?? null,
        isBonusEligible: Boolean(draft.isBonusEligible),
        travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
        pointsRedeemed: draft.pointsRedeemed ? Number(draft.pointsRedeemed) : null,
        rewardOverride: rewardOverride === '' ? null : parseFloat(rewardOverride),
      });
      setAmount('');
      setDescription('');
      setDate(todayISO());
      setDraft({});
      setRewardOverride('');
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between min-h-11 text-left font-display text-lg font-bold text-ink hover:text-ledger-green transition-colors"
        aria-expanded={expanded}
      >
        <span>Add Transaction</span>
        <span className="text-muted-text text-xs sm:text-sm font-sans font-semibold px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          {expanded ? 'Collapse' : 'Expand'}
        </span>
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={labelClass}>Amount (₹)</label>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`${inputClass} font-mono font-bold`}
              />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${inputClass} date-input appearance-none`}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Zepto"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <StrategyFields card={card} draft={draft} onChange={updateDraft} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={labelClass}>Calculated Reward</label>
              <div className={`${inputClass} font-mono font-semibold text-muted-text bg-paper-card cursor-not-allowed`}>
                {calculatedReward != null ? formatReward(calculatedReward, rewardUnit) : '-'}
              </div>
            </div>
            <div>
              <label className={labelClass}>Override (optional)</label>
              <input
                type="number"
                step="any"
                value={rewardOverride}
                onChange={(e) => setRewardOverride(e.target.value)}
                placeholder={calculatedReward != null ? String(calculatedReward) : 'auto'}
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !amount}
            className="w-full min-h-11 rounded-xl bg-ledger-green text-white font-semibold text-sm disabled:opacity-50 hover:bg-ledger-green/90 transition-colors"
          >
            {saving ? 'Saving...' : 'Add Transaction'}
          </button>
        </form>
      )}
    </section>
  );
}

function TransactionRow({ txn, card, cardTxns, cycleReward, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(String(txn.amount));
  const [draftDate, setDraftDate] = useState(txn.date);
  const [draftDescription, setDraftDescription] = useState(txn.description || '');
  const [draft, setDraft] = useState({
    category: txn.category ?? null,
    channel: txn.channel ?? null,
    isBonusEligible: Boolean(txn.isBonusEligible),
    travelMultiplier: txn.travelMultiplier ?? null,
    pointsRedeemed: txn.pointsRedeemed ?? null,
  });
  const [draftRewardOverride, setDraftRewardOverride] = useState(txn.rewardOverride != null ? String(txn.rewardOverride) : '');
  const [saving, setSaving] = useState(false);

  function updateDraft(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  const perTxn = cycleReward?.perTransaction?.find((p) => p.id === txn.id);
  const isAggregate = card.rewardStrategy === 'hsbc_tiered_cashback_aggregate';

  const editPreview = editing
    ? previewTransactionReward(card, cardTxns, {
        id: txn.id,
        date: draftDate,
        amount: parseFloat(draftAmount),
        category: draft.category,
        channel: draft.channel,
        isBonusEligible: Boolean(draft.isBonusEligible),
        travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
      })
    : null;
  const editCalculatedReward = editPreview ? (editPreview.earned ?? editPreview.estimated ?? 0) : null;
  const editRewardUnit = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy)?.unit || 'inr';

  async function handleSave() {
    setSaving(true);
    try {
      await updateCardTransaction(txn.id, {
        amount: parseFloat(draftAmount) || txn.amount,
        date: draftDate,
        description: draftDescription.trim(),
        category: draft.category ?? null,
        channel: draft.channel ?? null,
        isBonusEligible: Boolean(draft.isBonusEligible),
        travelMultiplier: draft.travelMultiplier ? Number(draft.travelMultiplier) : null,
        pointsRedeemed: draft.pointsRedeemed ? Number(draft.pointsRedeemed) : null,
        rewardOverride: draftRewardOverride === '' ? null : parseFloat(draftRewardOverride),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <li className="py-3 space-y-3.5 border-t border-ink/10 first:border-t-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Amount (₹)</label>
            <input
              type="number"
              step="any"
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              className={`${inputClass} font-mono font-bold`}
            />
          </div>
          <div>
            <label className={labelClass}>Date</label>
            <input
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              className={`${inputClass} date-input appearance-none`}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Description (optional)</label>
          <input
            type="text"
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StrategyFields card={card} draft={draft} onChange={updateDraft} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Calculated Reward</label>
            <div className={`${inputClass} font-mono font-semibold text-muted-text bg-paper-card cursor-not-allowed`}>
              {editCalculatedReward != null ? formatReward(editCalculatedReward, editRewardUnit) : '-'}
            </div>
          </div>
          <div>
            <label className={labelClass}>Override (optional)</label>
            <input
              type="number"
              step="any"
              value={draftRewardOverride}
              onChange={(e) => setDraftRewardOverride(e.target.value)}
              placeholder={editCalculatedReward != null ? String(editCalculatedReward) : 'auto'}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button type="button" onClick={handleSave} disabled={saving} className="min-h-9 px-3 rounded-lg bg-ledger-green text-white text-xs font-semibold">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="min-h-9 px-3 rounded-lg border border-ink/15 text-xs font-semibold text-muted-text">
            Cancel
          </button>
        </div>
      </li>
    );
  }

  const isGroceryPosting = card.rewardStrategy === 'hdfc_diners_slab_milestone' && txn.category === 'grocery';

  return (
    <li className="py-3 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-mono font-bold text-ink text-base">{formatCurrency(txn.amount)}</span>
            {perTxn && perTxn.overridden && (
              <span className="font-mono px-1.5 py-0.2 rounded font-semibold text-xs bg-ledger-green/15 text-ledger-green" title="Manually overridden - not the calculated amount">
                💳 {formatReward(perTxn.earned, cycleReward.unit)} (edited)
              </span>
            )}
            {perTxn && !perTxn.overridden && !isAggregate && (
              <span className="font-mono px-1.5 py-0.2 rounded font-semibold text-xs bg-ledger-green/15 text-ledger-green">
                💳 +{formatReward(perTxn.earned, cycleReward.unit)}
              </span>
            )}
            {perTxn && !perTxn.overridden && isAggregate && perTxn.estimated > 0 && (
              <span className="font-mono px-1.5 py-0.2 rounded font-semibold text-xs bg-ledger-green/10 text-ledger-green/80" title="Billed on the cycle's total, not per transaction - this is only an estimate">
                💳 ~{formatReward(perTxn.estimated, 'inr')}
              </span>
            )}
            {txn.pointsRedeemed > 0 && (
              <span className="font-mono px-1.5 py-0.2 rounded font-semibold text-xs bg-mustard/20 text-mustard" title="Points redeemed toward this booking, subtracted from the account total">
                🎟 -{txn.pointsRedeemed.toLocaleString('en-IN')} pts
              </span>
            )}
          </span>
          <span className="text-xs text-muted-text shrink-0 font-medium bg-paper px-2 py-0.5 rounded border border-ink/10">
            {formatDate(txn.date)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-text truncate">
          {txn.description || 'No description'}
          {isGroceryPosting && ` · posts ${formatDate(nextMonthFirst(txn.date))}`}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <button type="button" onClick={() => setEditing(true)} className="min-h-8 min-w-8 px-2 py-1 rounded-lg text-xs font-semibold text-muted-text hover:text-ink hover:bg-ink/5 transition-colors" aria-label="Edit transaction">
          ✎
        </button>
        <button type="button" onClick={() => onDelete(txn)} className="min-h-8 min-w-8 px-2 py-1 rounded-lg text-xs font-semibold text-stamp-red/70 hover:text-stamp-red hover:bg-stamp-red/10 transition-colors" aria-label="Delete transaction">
          ✕
        </button>
      </div>
    </li>
  );
}

function BillingCycleRow({ card, cycle, transactions, cycleRecord, onSaveError }) {
  const [billDraft, setBillDraft] = useState('');
  const [pointsDraft, setPointsDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const cycleTxns = getTransactionsInCycle(transactions, card.id, cycle.cycleStart, cycle.cycleEnd);
  const expectedBill = cycleTxns.reduce((s, t) => s + t.amount, 0);
  const { totalReward: expectedReward, unit: rewardUnit } = applyRewardOverrides(
    computeCardCycleReward(card, cycleTxns, cycle.cycleStart),
    cycleTxns,
  );

  const billConfirmed = cycleRecord?.billConfirmedAt != null;
  const pointsConfirmed = cycleRecord?.pointsConfirmedAt != null;
  const amountMismatch = billConfirmed && cycleRecord.actualBillAmount != null
    ? Math.round((cycleRecord.actualBillAmount - expectedBill) * 100) / 100
    : null;
  const rewardMismatch = pointsConfirmed && cycleRecord.actualRewardCredited != null
    ? Math.round((cycleRecord.actualRewardCredited - expectedReward) * 100) / 100
    : null;

  async function confirmBill() {
    const amount = parseFloat(billDraft);
    if (!amount && amount !== 0) return;
    setSaving(true);
    try {
      await saveCardBillingCycle(card.id, cycle.cycleStart, { actualBillAmount: amount, billConfirmedAt: new Date().toISOString() });
      setBillDraft('');
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  async function confirmPoints() {
    const amount = parseFloat(pointsDraft);
    if (!amount && amount !== 0) return;
    setSaving(true);
    try {
      await saveCardBillingCycle(card.id, cycle.cycleStart, { actualRewardCredited: amount, pointsConfirmedAt: new Date().toISOString() });
      setPointsDraft('');
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 space-y-2">
      <p className="text-sm font-semibold text-ink">{formatDate(cycle.cycleStart)} – {formatDate(cycle.cycleEnd)}</p>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="space-y-0.5">
          <p className="text-muted-text">Bill</p>
          <p className="font-mono font-semibold text-ink">Expected {formatCurrency(expectedBill)}</p>
          {billConfirmed ? (
            <p className={`font-mono ${amountMismatch !== 0 ? 'text-stamp-red font-semibold' : 'text-ledger-green'}`}>
              Actual {formatCurrency(cycleRecord.actualBillAmount)}
              {amountMismatch !== 0 && ` (${amountMismatch > 0 ? '+' : ''}${formatCurrency(amountMismatch)})`}
            </p>
          ) : (
            <div className="flex gap-1.5 pt-0.5">
              <input
                type="number"
                value={billDraft}
                onChange={(e) => setBillDraft(e.target.value)}
                placeholder="Actual ₹"
                className="w-20 min-h-8 px-2 rounded-lg border border-ink/15 bg-paper text-ink text-xs focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
              />
              <button type="button" onClick={confirmBill} disabled={saving || !billDraft} className="min-h-8 px-2.5 rounded-lg bg-ledger-green text-white text-2xs font-semibold disabled:opacity-50">
                Confirm
              </button>
            </div>
          )}
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-text">Reward</p>
          <p className="font-mono font-semibold text-ink">Expected {formatReward(expectedReward, rewardUnit)}</p>
          {pointsConfirmed ? (
            <p className={`font-mono ${rewardMismatch !== 0 ? 'text-stamp-red font-semibold' : 'text-ledger-green'}`}>
              Actual {formatReward(cycleRecord.actualRewardCredited, rewardUnit)}
              {rewardMismatch !== 0 && ` (${rewardMismatch > 0 ? '+' : ''}${Math.round(rewardMismatch)})`}
            </p>
          ) : (
            <div className="flex gap-1.5 pt-0.5">
              <input
                type="number"
                value={pointsDraft}
                onChange={(e) => setPointsDraft(e.target.value)}
                placeholder="Actual"
                className="w-20 min-h-8 px-2 rounded-lg border border-ink/15 bg-paper text-ink text-xs focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
              />
              <button type="button" onClick={confirmPoints} disabled={saving || !pointsDraft} className="min-h-8 px-2.5 rounded-lg bg-ledger-green text-white text-2xs font-semibold disabled:opacity-50">
                Confirm
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CardsManager({
  creditCards = [],
  cardTransactions = [],
  cardBillingCycles = [],
  selectedCardId,
  onSelectCard,
  onShowSettings,
  onSaveError,
}) {
  const [pendingDeletes, setPendingDeletes] = useState({});
  const [txnSearch, setTxnSearch] = useState('');
  const [showMilestones, setShowMilestones] = useState(true);
  const [showCaps, setShowCaps] = useState(true);
  const [showAddTransaction, setShowAddTransaction] = useState(true);
  const [historyYear, setHistoryYear] = useState(null);
  const [historyCycleKey, setHistoryCycleKey] = useState(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const selectedCard = creditCards.find((c) => c.id === selectedCardId) || creditCards[0] || null;
  // Two cards can share a name (e.g. both partners have the same card
  // product) - only show the owner alongside the name when it's actually
  // needed to tell them apart, not on every pill.
  const cardNameCounts = creditCards.reduce((acc, c) => ({ ...acc, [c.name]: (acc[c.name] || 0) + 1 }), {});

  const cardTxns = useMemo(
    () => (selectedCard ? cardTransactions.filter((t) => t.cardId === selectedCard.id) : []),
    [cardTransactions, selectedCard],
  );

  const today = todayISO();
  const currentCycle = selectedCard ? getCardCycleForDate(today, selectedCard.billingCycleDay ?? 1) : null;
  const currentCycleTxns = currentCycle ? getTransactionsInCycle(cardTxns, selectedCard.id, currentCycle.cycleStart, currentCycle.cycleEnd) : [];
  const currentCycleReward = selectedCard
    ? applyRewardOverrides(computeCardCycleReward(selectedCard, currentCycleTxns, currentCycle.cycleStart), currentCycleTxns)
    : { totalReward: 0, unit: 'inr' };
  const currentCycleSpend = currentCycleTxns.reduce((s, t) => s + t.amount, 0);
  // Everything ever logged for this card, plus whatever balance you had
  // before you started tracking here - a running account total, not just
  // what this billing cycle will add. Uses today's active rule for the
  // whole history rather than each transaction's own rule version, the same
  // simplification the per-cycle total already makes.
  const lifetimeReward = selectedCard
    ? applyRewardOverrides(computeCardCycleReward(selectedCard, cardTxns, today), cardTxns)
    : { totalReward: 0, unit: 'inr' };
  // A SmartBuy hotel booking or Travel with Points redemption can pay with
  // points instead of just earning new ones - those redemptions have to
  // come back out of the running balance, not just the earnings side.
  const lifetimePointsRedeemed = cardTxns.reduce((s, t) => s + (t.pointsRedeemed || 0), 0);
  const lifetimeRewardTotal = (selectedCard?.startingRewardPoints || 0) + lifetimeReward.totalReward - lifetimePointsRedeemed;

  const params = selectedCard ? resolveStrategyParamsForDate(selectedCard.strategyParamsHistory, today) : {};
  const { quarterStart, quarterEnd } = getQuarterBounds(today);
  const { periodStart: annualPeriodStart, periodEnd: annualPeriodEnd } = getAnnualMilestoneWindow(
    selectedCard?.annualMilestoneAnchorMonth,
    today,
  );
  const quarterlyMilestone = params.quarterlyMilestoneTarget
    ? computeCardMilestoneProgress(cardTxns, selectedCard.id, quarterStart, quarterEnd, params.quarterlyMilestoneTarget)
    : null;
  const annualMilestone = params.annualMilestoneTarget
    ? computeCardMilestoneProgress(
        cardTxns,
        selectedCard.id,
        annualPeriodStart,
        annualPeriodEnd,
        params.annualMilestoneTarget,
        selectedCard.annualMilestoneStartingSpend,
      )
    : null;
  const capStatuses = selectedCard ? computeCardCapStatus(selectedCard, cardTxns, currentCycleTxns, today) : [];

  const filteredTxns = useMemo(() => {
    const term = txnSearch.trim().toLowerCase();
    return cardTxns
      .filter((t) => !pendingDeletes[t.id])
      .filter((t) => !term || t.description?.toLowerCase().includes(term) || String(t.amount).includes(term))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [cardTxns, txnSearch, pendingDeletes]);

  // Only cycles that could actually contain a transaction are worth
  // showing - going back further than the card's own earliest transaction
  // is just an endless list of empty months.
  const earliestTxnDate = cardTxns.length > 0 ? cardTxns.reduce((min, t) => (t.date < min ? t.date : min), cardTxns[0].date) : null;
  const pastCycles = selectedCard && earliestTxnDate
    ? listRecentCardCycles(selectedCard.billingCycleDay ?? 1, today, 60)
        .slice(1) // exclude the currently open cycle, shown separately above
        .filter((cyc) => cyc.cycleEnd > earliestTxnDate)
    : [];
  const cyclesByYear = {};
  pastCycles.forEach((cyc) => {
    const year = cyc.cycleEnd.slice(0, 4);
    (cyclesByYear[year] = cyclesByYear[year] || []).push(cyc);
  });
  const historyYears = Object.keys(cyclesByYear).sort((a, b) => b.localeCompare(a));
  const effectiveHistoryYear = historyYears.includes(historyYear) ? historyYear : historyYears[0] || null;
  const cyclesInHistoryYear = effectiveHistoryYear ? cyclesByYear[effectiveHistoryYear] : [];
  const effectiveHistoryCycleKey = cyclesInHistoryYear.some((c) => c.cycleKey === historyCycleKey)
    ? historyCycleKey
    : cyclesInHistoryYear[0]?.cycleKey || null;
  const selectedHistoryCycle = cyclesInHistoryYear.find((c) => c.cycleKey === effectiveHistoryCycleKey) || null;
  const cycleRecordFor = (cycle) => cardBillingCycles.find((c) => getCardBillingCycleKey(c.cardId, c.cycleStart) === getCardBillingCycleKey(selectedCard.id, cycle.cycleStart));

  function handleDelete(txn) {
    const timeoutId = setTimeout(async () => {
      try {
        await deleteCardTransaction(txn.id);
      } catch (err) {
        onSaveError?.(err);
      } finally {
        if (isMountedRef.current) {
          setPendingDeletes((prev) => {
            const next = { ...prev };
            delete next[txn.id];
            return next;
          });
        }
      }
    }, UNDO_WINDOW_MS);
    setPendingDeletes((prev) => ({ ...prev, [txn.id]: { txn, timeoutId } }));
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

  if (creditCards.length === 0) {
    return (
      <section className="panel-card px-4 sm:px-5 py-8 text-center space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">No cards yet</h2>
        <p className="text-sm text-muted-text max-w-sm mx-auto">
          Add your first credit card in Settings to start tracking transactions, reward points, and billing cycles.
        </p>
        <button
          type="button"
          onClick={onShowSettings}
          className="inline-flex min-h-11 px-4 items-center rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 transition-colors"
        >
          Open Settings
        </button>
      </section>
    );
  }

  const pendingDeleteList = Object.values(pendingDeletes);

  return (
    <>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
        {creditCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectCard(card.id)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              selectedCard?.id === card.id ? 'bg-ledger-green text-white shadow-xs' : 'bg-paper border border-ink/10 text-muted-text hover:text-ink'
            }`}
          >
            {card.name}{cardNameCounts[card.name] > 1 && card.owner ? ` (${card.owner})` : ''}
          </button>
        ))}
      </div>

      {selectedCard && (
        <>
          <section className="panel-card px-4 sm:px-5 py-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">{selectedCard.name}</h2>
                <p className="text-2xs text-muted-text">{selectedCard.owner ? `${selectedCard.owner}'s card` : 'Shared card'}</p>
              </div>
              <span className="text-2xs px-2.5 py-1 rounded-full bg-ledger-green/10 text-ledger-green font-semibold">
                Cycle: {currentCycle.cycleStart} – {currentCycle.cycleEnd}
              </span>
            </div>
            <div className="rounded-xl bg-ledger-green/10 px-3.5 py-2.5">
              <p className="text-2xs text-ledger-green uppercase tracking-wider font-semibold">Total reward points in account</p>
              <p className="font-mono font-bold text-ledger-green text-2xl">{formatReward(lifetimeRewardTotal, currentCycleReward.unit)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xs text-muted-text uppercase tracking-wider font-semibold">Spent so far</p>
                <p className="font-mono font-bold text-ink text-lg">{formatCurrency(currentCycleSpend)}</p>
              </div>
              <div>
                <p className="text-2xs text-muted-text uppercase tracking-wider font-semibold">Estimated reward</p>
                <p className="font-mono font-bold text-ink text-lg">{formatReward(currentCycleReward.totalReward, currentCycleReward.unit)}</p>
              </div>
            </div>
          </section>

          {(quarterlyMilestone || annualMilestone) && (
            <section className="panel-card px-4 sm:px-5 py-4">
              <button
                type="button"
                onClick={() => setShowMilestones((v) => !v)}
                className="w-full flex items-center justify-between min-h-9 text-left font-display text-sm font-bold text-ink hover:text-ledger-green transition-colors"
                aria-expanded={showMilestones}
              >
                <span>Milestone Progress</span>
                <span className="text-muted-text text-2xs font-sans font-semibold px-2 py-0.5 rounded-md bg-paper border border-ink/10">
                  {showMilestones ? 'Collapse' : 'Expand'}
                </span>
              </button>
              {showMilestones && (
                <div className="space-y-4 mt-4">
                  {quarterlyMilestone && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-ink">This quarter ({quarterStart} – {quarterEnd})</span>
                        <span className="text-muted-text">{Math.round(quarterlyMilestone.pctUsed * 100)}%</span>
                      </div>
                      <ProgressBar pctUsed={quarterlyMilestone.pctUsed} />
                      <p className="text-2xs text-muted-text">
                        {formatCurrency(quarterlyMilestone.spent)} of {formatCurrency(quarterlyMilestone.target)} - {params.quarterlyMilestoneBonus?.toLocaleString('en-IN')} bonus points at target
                      </p>
                    </div>
                  )}
                  {annualMilestone && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-ink">This year ({annualPeriodStart} – {annualPeriodEnd})</span>
                        <span className="text-muted-text">{Math.round(annualMilestone.pctUsed * 100)}%</span>
                      </div>
                      <ProgressBar pctUsed={annualMilestone.pctUsed} />
                      <p className="text-2xs text-muted-text">
                        {formatCurrency(annualMilestone.spent)} of {formatCurrency(annualMilestone.target)} - {params.annualMilestoneLabel}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {capStatuses.length > 0 && (
            <section className="panel-card px-4 sm:px-5 py-4">
              <button
                type="button"
                onClick={() => setShowCaps((v) => !v)}
                className="w-full flex items-center justify-between min-h-9 text-left font-display text-sm font-bold text-ink hover:text-ledger-green transition-colors"
                aria-expanded={showCaps}
              >
                <span>Caps Remaining</span>
                <span className="text-muted-text text-2xs font-sans font-semibold px-2 py-0.5 rounded-md bg-paper border border-ink/10">
                  {showCaps ? 'Collapse' : 'Expand'}
                </span>
              </button>
              {showCaps && (
                <div className="space-y-4 mt-4">
                  {capStatuses.map((cap) => {
                    const pctUsed = cap.capAmount ? cap.earned / cap.capAmount : 0;
                    const periodLabel = cap.capPeriod === 'day' ? 'today' : cap.capPeriod === 'cycle' ? 'this cycle' : 'this month';
                    const remainingColor = pctUsed >= 1 ? 'text-stamp-red' : pctUsed >= 0.8 ? 'text-mustard' : 'text-ledger-green';
                    return (
                      <div key={cap.key} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-ink">{cap.label}</span>
                          <span className={`font-mono font-semibold ${remainingColor}`}>{formatReward(cap.remaining, cap.unit)} left</span>
                        </div>
                        <ProgressBar pctUsed={pctUsed} invert />
                        <p className="text-2xs text-muted-text">
                          {formatReward(cap.earned, cap.unit)} of {formatReward(cap.capAmount, cap.unit)} used {periodLabel}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <AddCardTransactionForm card={selectedCard} cardTxns={cardTxns} onSaveError={onSaveError} />

          <section className="panel-card px-4 sm:px-5 py-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-display text-base font-bold text-ink">Transactions</h3>
              <input
                type="text"
                value={txnSearch}
                onChange={(e) => setTxnSearch(e.target.value)}
                placeholder="Search..."
                className="h-9 px-3 text-xs rounded-lg border border-ink/15 bg-paper text-ink placeholder:text-muted-text/70 focus:outline-none focus:ring-2 focus:ring-ledger-green/40 w-36 sm:w-48"
              />
            </div>
            {filteredTxns.length === 0 ? (
              <p className="text-sm text-muted-text text-center py-6">No transactions yet.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {filteredTxns.map((txn) => (
                  <TransactionRow
                    key={txn.id}
                    txn={txn}
                    card={selectedCard}
                    cardTxns={cardTxns}
                    cycleReward={txn.date >= currentCycle.cycleStart && txn.date < currentCycle.cycleEnd ? currentCycleReward : null}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            )}
          </section>

          {pastCycles.length > 0 && (
            <section className="panel-card px-4 sm:px-5 py-4 space-y-3">
              <h3 className="font-display text-base font-bold text-ink">Billing Cycle History</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Year</label>
                  <select
                    value={effectiveHistoryYear || ''}
                    onChange={(e) => {
                      setHistoryYear(e.target.value);
                      setHistoryCycleKey(null);
                    }}
                    className={selectClass}
                  >
                    {historyYears.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Month</label>
                  <select
                    value={effectiveHistoryCycleKey || ''}
                    onChange={(e) => setHistoryCycleKey(e.target.value)}
                    className={selectClass}
                  >
                    {cyclesInHistoryYear.map((cycle) => (
                      <option key={cycle.cycleKey} value={cycle.cycleKey}>{formatCycleMonthLabel(cycle)}</option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedHistoryCycle && (
                <BillingCycleRow
                  key={selectedHistoryCycle.cycleKey}
                  card={selectedCard}
                  cycle={selectedHistoryCycle}
                  transactions={cardTxns}
                  cycleRecord={cycleRecordFor(selectedHistoryCycle)}
                  onSaveError={onSaveError}
                />
              )}
            </section>
          )}
        </>
      )}

      {pendingDeleteList.length > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-2.5rem)] sm:w-auto max-w-sm space-y-2">
          {pendingDeleteList.map(({ txn }) => (
            <div key={txn.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink text-paper px-4 py-3 shadow-2xl text-sm">
              <span className="min-w-0 truncate">
                Deleted {txn.description ? `"${txn.description}"` : formatCurrency(txn.amount)}
              </span>
              <button type="button" onClick={() => handleUndo(txn.id)} className="shrink-0 font-semibold text-ledger-green hover:text-ledger-green/80 underline">
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
