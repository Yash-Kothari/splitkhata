// A trip's foreign cash, one queue per currency. Money comes in as lots (starting cash with a rupee rate, ATM withdrawals,
// currency exchanges) and goes out oldest first (cash purchases, exchanges). Each rupee figure is worked out from the whole
// history every time, so editing, deleting or back-dating anything re-prices what follows. Pure, so it is testable.
//
// Starting cash with a rate and an owner was bought before the trip and charged to nobody. It counts as its owner's spending
// when it leaves their hands: spent on a purchase, or exchanged. Everything that comes in locally - from an ATM or from a
// money changer - is charged to the trip when it arrives, so spending it charges nothing again.
//
// An exchange is a travel entry: a withdrawal (like an ATM one) whose money came from other cash, `exchangedFrom`
// ({ currency, amount }), with `localAmount` / `localCurrency` saying what was received.
import { isCashExchange, isCashPaid, isWithdrawalEntry, localCurrencyOf, normalizeLedger } from './utils.js';

const NEARLY_NOTHING = 0.005; // in local currency
const round2 = (n) => Math.round(n * 100) / 100;
// Date first, then the time saved. Something still being typed has no time yet and queues after that day's records.
const orderKey = (x) => `${x.date || ''}_${x.createdAt || '9999-99-99'}`;
const byOrder = (a, b) => orderKey(a).localeCompare(orderKey(b));

export const isPricedStartingCash = (m) => m?.type === 'opening' && Number(m.amount) > 0 && Number(m.rate) > 0 && Boolean(m.owner);

// A rupee rate as typed. A dong is a fraction of a paisa, so it takes more decimals than an amount does.
export function parseRateInput(text) {
  const cleaned = String(text ?? '').replace(/[\s,]/g, '');
  if (!/^(\d+(\.\d{1,8})?|\.\d{1,8})$/.test(cleaned)) return null;
  return Number(cleaned) > 0 ? Number(cleaned) : null;
}

export const formatRate = (rate) => String(Number(Number(rate).toFixed(8)));

export const belongsToTrip = (x, tripId, tripName) => (x.tripId ? x.tripId === tripId : x.tripName === tripName);

// Walks one trip's cash. `entries` and `movements` must already be that trip's. Returns what each cash purchase and exchange
// took (`byEntry`: id -> { slices, short, exchange }) and the owned cash not yet used (`leftover`).
export function runTripCash({ entries = [], movements = [], primaryCurrency = '' }) {
  const pools = new Map();
  const pool = (currency) => {
    if (!pools.has(currency)) pools.set(currency, { lots: [], waiting: [], used: [] });
    return pools.get(currency);
  };
  // Hands cash from the oldest lots to whoever has waited longest. A purchase made before the money that covers it was
  // recorded simply waits for it.
  function serve(currency) {
    const p = pool(currency);
    while (p.waiting.length && p.lots.length) {
      const want = p.waiting[0];
      const lot = p.lots[0];
      const local = Math.min(want.left, lot.left);
      const inr = (lot.inr * local) / lot.left;
      lot.left -= local;
      lot.inr -= inr;
      want.left -= local;
      if (lot.left <= NEARLY_NOTHING) p.lots.shift();
      if (want.left <= NEARLY_NOTHING) p.waiting.shift();
      want.take({ local, inr, owner: lot.owner, source: lot.source, date: lot.date });
    }
  }
  function addLot(currency, lot) {
    pool(currency).lots.push(lot);
    serve(currency);
  }
  function ask(currency, amount, take) {
    const want = { left: amount, take };
    pool(currency).waiting.push(want);
    serve(currency);
    return want;
  }
  // A cash refund puts back what was spent last, with its owner and rate, at the front of the queue.
  function giveBack(currency, amount, record) {
    const p = pool(currency);
    let left = amount;
    while (left > NEARLY_NOTHING && p.used.length) {
      const last = p.used.pop();
      const local = Math.min(last.local, left);
      const inr = (last.inr * local) / last.local;
      if (last.local - local > NEARLY_NOTHING) p.used.push({ ...last, local: last.local - local, inr: last.inr - inr });
      left -= local;
      p.lots.unshift({ left: local, inr, owner: last.owner, source: last.source, date: last.date });
      record.slices.push({ ...last, local: -local, inr: -inr });
    }
    serve(currency);
  }

  const byEntry = new Map();

  // Starting cash goes in first, so it is used before anything withdrawn later.
  movements
    .filter(isPricedStartingCash)
    .sort(byOrder)
    .forEach((m) => addLot(localCurrencyOf(m, primaryCurrency), { left: Number(m.amount), inr: Number(m.amount) * Number(m.rate), owner: m.owner, source: 'starting', date: m.date || '' }));

  const events = [];
  for (const e of entries) {
    if (normalizeLedger(e.ledger) !== 'travel') continue;
    const local = Number(e.localAmount || 0);
    const currency = localCurrencyOf(e, primaryCurrency);
    if (isCashExchange(e)) {
      const from = e.exchangedFrom.currency;
      const given = Number(e.exchangedFrom.amount || 0);
      if (!(given > 0) || !(local > 0) || from === currency) continue;
      events.push({
        at: e,
        rank: 1,
        run: () => {
          const record = { slices: [], short: 0, exchange: true };
          byEntry.set(e.id, record);
          // The cash received costs what the cash handed over cost. It is charged to the trip here, so it has no owner.
          record.want = ask(from, given, (slice) => {
            record.slices.push(slice);
            addLot(currency, { left: (local * slice.local) / given, inr: slice.inr, owner: null, source: 'exchange', date: e.date });
          });
        },
      });
    } else if (isWithdrawalEntry(e)) {
      if (local > 0) events.push({ at: e, rank: 0, run: () => addLot(currency, { left: local, inr: Number(e.amount || 0), owner: null, source: 'withdrawal', date: e.date }) });
    } else if (isCashPaid(e) && local) {
      events.push({
        at: e,
        rank: 1,
        run: () => {
          const record = { slices: [], short: 0 };
          byEntry.set(e.id, record);
          if (local < 0) return giveBack(currency, -local, record);
          record.want = ask(currency, local, (slice) => {
            record.slices.push(slice);
            pool(currency).used.push({ ...slice });
          });
        },
      });
    }
  }
  events.sort((a, b) => byOrder(a.at, b.at) || a.rank - b.rank).forEach((event) => event.run());

  for (const record of byEntry.values()) {
    record.short = record.want && record.want.left > NEARLY_NOTHING ? record.want.left : 0;
    delete record.want;
  }

  const owned = new Map();
  for (const [currency, p] of pools) {
    for (const lot of p.lots) {
      if (!lot.owner) continue;
      const key = `${currency}|${lot.owner}`;
      const sum = owned.get(key) || { currency, owner: lot.owner, local: 0, inr: 0 };
      sum.local += lot.left;
      sum.inr += lot.inr;
      owned.set(key, sum);
    }
  }
  const leftover = [...owned.values()]
    .filter((x) => x.local > NEARLY_NOTHING)
    .map((x) => ({ currency: x.currency, owner: x.owner, local: round2(x.local), inr: round2(x.inr), rate: x.inr / x.local }));

  return { byEntry, leftover };
}

// The rupee price of a cash purchase being typed or edited: what the queue would hand it. null while the recorded cash does
// not cover all of it, so the amount is typed by hand instead of guessed. `ownParts` is what counts as an owner's spending.
export function priceCashPurchase({ entries = [], movements = [], primaryCurrency = '', target }) {
  if (!(Number(target?.localAmount) > 0)) return null;
  const draft = { ...target, id: '__draft__', ledger: 'travel', paymentType: 'cash', isWithdrawal: false, splitType: 'shared' };
  const others = entries.filter((e) => !target.id || e.id !== target.id);
  const record = runTripCash({ entries: [...others, draft], movements, primaryCurrency }).byEntry.get(draft.id);
  if (!record || record.short) return null;
  return {
    amount: round2(record.slices.reduce((sum, s) => sum + s.inr, 0)),
    breakdown: record.slices.map((s) => ({ date: s.date, source: s.source, owner: s.owner, localAmount: round2(s.local), rate: s.inr / s.local, inr: round2(s.inr) })),
    ownParts: ownParts(record.slices),
  };
}

// What recording an exchange would do: the rupees it adds to the trip (`amount`, split by owner in `ownParts` - nothing for
// cash already charged) and whether the recorded cash covers it (`covered` is false too if it would take cash that
// something recorded for a later date has already used).
export function priceCashExchange({ entries = [], movements = [], primaryCurrency = '', target }) {
  const { date, fromCurrency, fromAmount, toCurrency, toAmount } = target;
  if (!(fromAmount > 0) || !(toAmount > 0) || fromCurrency === toCurrency) return null;
  const draft = { id: '__draft__', ledger: 'travel', isWithdrawal: true, date, localCurrency: toCurrency, localAmount: toAmount, exchangedFrom: { currency: fromCurrency, amount: fromAmount } };
  const before = runTripCash({ entries, movements, primaryCurrency }).byEntry;
  const after = runTripCash({ entries: [...entries, draft], movements, primaryCurrency }).byEntry;
  const record = after.get(draft.id);
  const covered = !record.short && [...before].every(([id, was]) => after.get(id).short <= was.short + NEARLY_NOTHING);
  const parts = ownParts(record.slices);
  return { covered, amount: sumAmounts(parts), ownParts: parts };
}

const sumAmounts = (parts) => round2(parts.reduce((sum, p) => sum + p.amount, 0));

function ownParts(slices) {
  const byOwner = new Map();
  for (const s of slices) if (s.owner) byOwner.set(s.owner, (byOwner.get(s.owner) || 0) + s.inr);
  return [...byOwner].map(([owner, inr]) => ({ owner, amount: round2(inr) })).filter((p) => p.amount);
}

// "10 TWD @ 1 TWD = ₹10.0000 (withdrawal 2030-01-01) + ..." under a priced amount.
export function formatCashBreakdown(breakdown = [], currency = '') {
  const unit = currency || 'unit';
  const from = (b) => {
    if (b.source === 'starting') return `${b.owner}'s starting cash`;
    if (b.source === 'exchange') return `${b.owner ? `${b.owner}'s ` : ''}exchange ${b.date || '?'}`;
    return `withdrawal ${b.date || '?'}`;
  };
  // Small units (a dong is a fraction of a paisa) need more decimals than rupees do.
  return breakdown.map((b) => `${b.localAmount} ${unit} @ 1 ${unit} = ₹${b.rate.toFixed(b.rate < 1 ? 5 : 2)} (${from(b)})`).join(' + ');
}

// Travel entries as the trip should be read, on a trip with priced starting cash or an exchange. Every cash purchase the
// recorded cash covers takes the rupee amount worked out now, and where an owner's cash paid for it the entry also gets
// `ownCash` ([{ owner, amount }], read by excludeCashSpend). An exchange's amount is what it adds to the trip: the rupee
// cost of the owned cash handed over, as paid by its owner. Entries of other trips come back untouched. For display and
// totals - the form that saves an entry again writes the same figures.
export function applyCashFunding(entries, movements = [], trips = []) {
  if (!entries) return entries;
  const tripIds = new Set([...(movements || []).filter(isPricedStartingCash), ...entries.filter(isCashExchange)].map((x) => x.tripId).filter(Boolean));
  const changes = new Map();
  for (const tripId of tripIds) {
    const trip = trips.find((t) => t.id === tripId);
    const own = (x) => belongsToTrip(x, tripId, trip?.name);
    const { byEntry } = runTripCash({ entries: entries.filter(own), movements: (movements || []).filter(own), primaryCurrency: trip?.currency || '' });
    for (const [id, record] of byEntry) {
      const parts = ownParts(record.slices);
      const change = parts.length ? { ownCash: parts } : {};
      if (record.exchange) {
        change.amount = sumAmounts(parts);
        if (parts.length) change.payer = parts[0].owner;
      } else if (!record.short && record.slices.length) {
        // A purchase not fully covered keeps the amount typed by hand.
        change.amount = round2(record.slices.reduce((sum, s) => sum + s.inr, 0));
      }
      if (Object.keys(change).length) changes.set(id, change);
    }
  }
  return changes.size ? entries.map((e) => (changes.has(e.id) ? { ...e, ...changes.get(e.id) } : e)) : entries;
}

// Owned cash still unspent on other trips, in any of `currencies` (the ones `tripId` handles), offered as its starting cash.
// A leftover already carried to some trip is not offered again (the record being edited, `exceptId`, does not count).
export function carryOverOptions({ entries = [], movements = [], trips = [], tripId, currencies = [], exceptId = null }) {
  const taken = new Set(
    movements.filter((m) => m.id !== exceptId && m.carriedFrom).map((m) => `${m.carriedFrom.tripId}|${m.currency}|${m.owner}`),
  );
  return trips
    .filter((t) => t.id !== tripId)
    .flatMap((t) => {
      const own = (x) => belongsToTrip(x, t.id, t.name);
      const cash = movements.filter(own);
      if (!cash.some(isPricedStartingCash)) return [];
      return runTripCash({ entries: entries.filter(own), movements: cash, primaryCurrency: t.currency })
        .leftover.filter((x) => currencies.includes(x.currency) && !taken.has(`${t.id}|${x.currency}|${x.owner}`))
        .map((x) => ({ ...x, tripId: t.id, tripName: t.name }));
    });
}

// Which earlier starting-cash records a save replaces. There is one per trip, currency and owner, so saving again corrects
// it. A record without a rate stands for the whole currency, in both directions. `editingId` is the one opened for editing.
export function startingCashReplaced(existing, record, primaryCurrency = '', editingId = null) {
  return existing
    .filter((m) => m.type === 'opening' && m.tripId === record.tripId)
    .filter((m) => m.id === editingId || ((m.currency || primaryCurrency) === record.currency && (!record.owner || !m.owner || m.owner === record.owner)))
    .map((m) => m.id);
}
