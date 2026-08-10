// Initial default seeds used only when seeding a fresh empty database/storage
export const DEFAULT_PERSONS = ['Yash', 'Kruti'];

export const DEFAULT_CATEGORIES = [
  'Groceries',
  'Utilities',
  'Rent',
  'Eating Out',
  'Transport',
  'Household',
  'Health',
  'Entertainment',
];

export const DEFAULT_TRAVEL_CATEGORIES = [
  'Flight',
  'Hotel',
  'Food',
  'Commute',
  'Attraction',
  'Souvenir',
  'Insurance',
  'Misc',
];

export const DEFAULT_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'TWD', 'JPY', 'AED', 'SGD'];

export const DEFAULT_PAYMENT_METHODS = ['Cash'];

export const CATEGORY_COLORS = [
  '#3D7068',
  '#A63D40',
  '#C98A2C',
  '#5C6478',
  '#24304A',
  '#6B9080',
  '#BC6C25',
  '#457B9D',
  '#8D6A9F',
];

export const MEMBER_PALETTE = [
  '#A63D40',
  '#3D7068',
  '#C98A2C',
  '#457B9D',
  '#8D6A9F',
  '#24304A',
  '#BC6C25',
  '#6B9080',
];

export const PERSON_COLORS = {
  Yash: '#A63D40',
  Kruti: '#3D7068',
  Husband: '#A63D40',
  Wife: '#3D7068',
};

export function getPersonColor(personName, index = 0) {
  if (PERSON_COLORS[personName]) return PERSON_COLORS[personName];
  if (typeof index === 'number' && index >= 0) {
    return MEMBER_PALETTE[index % MEMBER_PALETTE.length];
  }
  let hash = 0;
  const name = String(personName || '');
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pos = Math.abs(hash) % MEMBER_PALETTE.length;
  return MEMBER_PALETTE[pos];
}

export const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  TWD: 'NT$',
  SGD: 'S$',
  THB: '฿',
  AED: 'AED ',
  CAD: 'CA$',
  AUD: 'A$',
};

export function formatCurrency(amount, currencyCode = 'INR') {
  const formattedNum = Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = CURRENCY_SYMBOLS[currencyCode] || `${currencyCode} `;
  return `${symbol}${formattedNum}`;
}

export function normalizeLedger(ledger) {
  if (!ledger) return 'household';
  const str = String(ledger).toLowerCase();
  if (str === 'travel') return 'travel';
  return 'household';
}

// Chronological order for the FIFO cash queue: date first, then createdAt
// as a tie-break. An entry with no createdAt yet (still being composed in
// AddEntryForm, not saved) sorts last among same-date entries, so it
// queues behind whatever's already recorded for that day.
function fifoSortKey(entry) {
  return `${entry.date || ''}_${entry.createdAt || '9999-99-99'}`;
}

// Prices a cash purchase by walking the trip's withdrawals as a single
// FIFO queue of local-currency "chunks", each at its own rate, consumed in
// order by every cash purchase that came before this one (by date, then
// createdAt). A purchase that straddles two withdrawals - one nearly
// drained, a fresh one covering the rest - is billed at each withdrawal's
// own rate for the exact portion it funds, e.g. $10 of a $90 purchase at
// the old rate and $80 at the new one, not a blend of the two across the
// full $90. A later withdrawal can only ever fund purchases that come
// after it in the queue, so it never changes what an earlier purchase was
// billed. Returns null if the known withdrawals don't yet cover this
// purchase's full local amount (so the caller can fall back to manual
// entry instead of guessing) - otherwise { amount, breakdown }, where
// breakdown lists which withdrawal(s) funded which slice, for a note
// explaining how the amount was derived.
export function computeFifoCashAmount(withdrawals = [], otherCashEntries = [], targetEntry) {
  const sortedWithdrawals = [...withdrawals].sort((a, b) => fifoSortKey(a).localeCompare(fifoSortKey(b)));
  const targetKey = fifoSortKey(targetEntry);

  const priorLocal = otherCashEntries
    .filter((e) => e.id !== targetEntry.id && fifoSortKey(e) < targetKey)
    .reduce((sum, e) => sum + Number(e.localAmount || 0), 0);

  const targetLocal = Number(targetEntry.localAmount || 0);
  if (targetLocal <= 0) return null;

  const rangeStart = priorLocal;
  const rangeEnd = priorLocal + targetLocal;

  let cursor = 0;
  let coveredLocal = 0;
  let inrSum = 0;
  const breakdown = [];

  for (const w of sortedWithdrawals) {
    const wLocal = Number(w.localAmount || 0);
    if (wLocal <= 0) continue;
    const wStart = cursor;
    const wEnd = cursor + wLocal;
    cursor = wEnd;

    const overlapLocal = Math.min(rangeEnd, wEnd) - Math.max(rangeStart, wStart);
    if (overlapLocal > 0) {
      const rate = Number(w.amount || 0) / wLocal;
      const overlapInr = overlapLocal * rate;
      inrSum += overlapInr;
      coveredLocal += overlapLocal;
      breakdown.push({
        date: w.date,
        localAmount: Math.round(overlapLocal * 100) / 100,
        rate,
        inr: Math.round(overlapInr * 100) / 100,
      });
    }
  }

  if (coveredLocal < targetLocal - 0.01) return null;
  return { amount: Math.round(inrSum * 100) / 100, breakdown };
}

// Turns computeFifoCashAmount's breakdown into a short human-readable
// explanation for a hover tooltip, quoted as a standard FX rate (1 unit of
// the local currency = so many INR), e.g. "10 TWD @ 1 TWD = ₹10.00
// (withdrawal 2030-01-01) + 80 TWD @ 1 TWD = ₹11.00 (withdrawal 2030-01-03)".
export function formatFifoBreakdownSummary(breakdown = [], currency = '') {
  if (!breakdown.length) return '';
  const unit = currency || 'unit';
  return breakdown
    .map((b) => `${b.localAmount} ${unit} @ 1 ${unit} = ₹${b.rate.toFixed(2)} (withdrawal ${b.date || '?'})`)
    .join(' + ');
}

// Rupee floating-point addition isn't associative, so summing hundreds of
// entries in whatever order Firestore happens to return them can silently
// drift a total by a few paise depending on entry order - the same trip,
// recomputed twice from the same data, isn't guaranteed to produce the same
// float. Converting every amount to integer paise up front avoids that.
function toPaise(value) {
  return Math.round(Number(value || 0) * 100);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

// LCM(1, 2, ..., n) - the smallest number every group size from 1 up to n
// people divides evenly. Used as the scale factor below so that splitting
// an entry among any subset of the members (not just all of them) never
// needs per-entry rounding.
function lcmRange(n) {
  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result = (result * i) / gcd(result, i);
  }
  return result;
}

// A shared expense's fair 1/k-per-member paise share (k = however many
// people it's actually split among - everyone by default, or just a subset
// via entry.splitAmong, e.g. a trip guest who wasn't in on this particular
// expense) is often fractional. Rounding each member's share to a whole
// paisa per entry means giving the leftover paisa to *someone*, and doing
// that the same way every time (e.g. always the first member) quietly
// biases their balance by a paisa per entry, compounding to real money over
// enough entries. Working in units of "paise x LCM(1..memberCount)" instead
// sidesteps the choice entirely: LCM(1..memberCount) divides evenly by
// every possible subset size from 1 up to everyone, so a k-way split's
// per-member share in these units is always the whole number
// valuePaise * scale / k, with no remainder to assign regardless of k. The
// only division happens once per member at the very end (see the /scale
// below), so the result is both exact and independent of entry order.
//
// Shared by computeBalance and computeSettlements so the two can never
// disagree on the same entries.
function computeNetByMemberScaled(entries, ledger, members, valueField) {
  const targetLedger = ledger ? normalizeLedger(ledger) : null;
  const scale = lcmRange(members.length);

  const netByMemberScaled = Object.fromEntries(members.map((member) => [member, 0]));
  const resolveMember = (name) => {
    if (members.includes(name)) return name;
    if (name === 'Husband') return members[0];
    if (name === 'Wife') return members[1];
    return members[0];
  };

  for (const entry of entries) {
    if (!entry || !entry.split) continue;
    if (targetLedger && normalizeLedger(entry.ledger) !== targetLedger) continue;

    const payer = resolveMember(entry.payer);
    const valuePaise = toPaise(entry[valueField]);

    if (!valuePaise || !payer) continue;
    netByMemberScaled[payer] += valuePaise * scale;

    if ((entry.splitType === 'owed' || entry.splitType === 'settlement') && entry.owedBy) {
      const debtor = resolveMember(entry.owedBy);
      if (debtor && debtor !== payer) netByMemberScaled[debtor] -= valuePaise * scale;
      continue;
    }

    // splitAmong narrows a shared entry to only some of the members (e.g.
    // one trip guest wasn't part of this particular expense) - absent on
    // every entry that predates this field, which is exactly why it
    // defaults to "everyone" rather than needing a migration.
    const splitSet = entry.splitAmong && entry.splitAmong.length > 0
      ? entry.splitAmong.filter((m) => members.includes(m))
      : members;
    if (splitSet.length === 0) continue;
    const share = (valuePaise * scale) / splitSet.length;
    splitSet.forEach((member) => {
      netByMemberScaled[member] -= share;
    });
  }

  return { netByMemberScaled, scale };
}

export function computeBalance(entries = [], ledger, dynamicMembers = DEFAULT_PERSONS, valueField = 'amount') {
  const members = dynamicMembers && dynamicMembers.length > 0 ? dynamicMembers : DEFAULT_PERSONS;
  const { netByMemberScaled, scale } = computeNetByMemberScaled(entries, ledger, members, valueField);

  // netByMemberScaled always sums to exactly 0 across all members (every
  // entry moves money from payer to member(s), never creating or losing
  // any) - so "settled" can be checked as an exact integer equality
  // instead of a float tolerance, and the eventual /scale below is the
  // only division in the whole function, done once per member.
  if (members.length === 2) {
    const p0NetScaled = netByMemberScaled[members[0]];
    const p1NetScaled = netByMemberScaled[members[1]];

    if (p0NetScaled === 0) {
      return { status: 'settled', amount: 0, debtor: null, creditor: null };
    }

    if (p0NetScaled > 0) {
      return {
        status: 'owes',
        amount: p0NetScaled / (100 * scale),
        debtor: members[1],
        creditor: members[0],
      };
    }

    return {
      status: 'owes',
      amount: p1NetScaled / (100 * scale),
      debtor: members[0],
      creditor: members[1],
    };
  }

  let maxDebtor = null;
  let maxCreditor = null;
  let maxOwedScaled = 0;

  for (const m of members) {
    const net = netByMemberScaled[m];
    if (net > maxOwedScaled) {
      maxOwedScaled = net;
      maxCreditor = m;
    }
  }

  let minNetScaled = 0;
  for (const m of members) {
    const net = netByMemberScaled[m];
    if (net < minNetScaled) {
      minNetScaled = net;
      maxDebtor = m;
    }
  }

  if (maxOwedScaled === 0 || !maxDebtor || !maxCreditor) {
    return { status: 'settled', amount: 0, debtor: null, creditor: null };
  }

  return {
    status: 'owes',
    amount: maxOwedScaled / (100 * scale),
    debtor: maxDebtor,
    creditor: maxCreditor,
  };
}

// For 3+ people (e.g. a trip with a guest tagging along), there's no single
// honest "X owes Y" figure the way there is for a two-person household -
// multiple independent debts can exist at once, and computeBalance's
// biggest-debtor-vs-biggest-creditor fallback above silently drops the
// rest. This returns the actual minimal set of pairwise transfers that
// settles everyone up, via the standard "debt simplification" approach:
// repeatedly match whoever currently owes the most against whoever is
// currently owed the most. For exactly 2 members this always produces the
// same single settlement (or none) as computeBalance.
export function computeSettlements(entries = [], ledger, dynamicMembers = DEFAULT_PERSONS, valueField = 'amount') {
  const members = dynamicMembers && dynamicMembers.length > 0 ? dynamicMembers : DEFAULT_PERSONS;
  const { netByMemberScaled, scale } = computeNetByMemberScaled(entries, ledger, members, valueField);

  const creditors = [];
  const debtors = [];
  for (const m of members) {
    const net = netByMemberScaled[m];
    if (net > 0) creditors.push({ member: m, amount: net });
    else if (net < 0) debtors.push({ member: m, amount: -net });
  }
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const transfer = Math.min(c.amount, d.amount);
    if (transfer > 0) {
      settlements.push({ debtor: d.member, creditor: c.member, amount: transfer / (100 * scale) });
    }
    c.amount -= transfer;
    d.amount -= transfer;
    if (c.amount === 0) ci += 1;
    if (d.amount === 0) di += 1;
  }
  return settlements;
}

// Each member's share of trip cost - not who paid, but who it's ultimately
// attributed to: personal expenses count fully against the payer, "owed"
// expenses count fully against whoever owes it back, and shared expenses
// split evenly. Mirrors the Excel's "Total Kruti / Total Yash" panel, which
// only ever prices card-paid entries and the ATM withdrawal itself - it
// never assigns an INR cost to individual cash purchases, so neither does
// this (see the exclusion in the caller).
export function computeMemberTotals(entries, members, valueField = 'amount') {
  // Same scaled-units approach as computeBalance, and for the same reason:
  // a k-way shared entry's 1/k-per-member paise share is often fractional,
  // and rounding it per entry means picking someone to give the leftover
  // paisa to - do that the same way every time and it compounds into a
  // real, one-sided bias. LCM(1..memberCount) divides evenly by any subset
  // size (see splitAmong below), keeping every share a whole number with
  // nothing to round until the final /scale below.
  const scale = lcmRange(members.length);
  const totalsScaled = Object.fromEntries(members.map((m) => [m, 0]));
  for (const entry of entries) {
    const amountPaise = toPaise(entry[valueField]);
    if (!amountPaise) continue;
    if (!entry.split) {
      if (members.includes(entry.payer)) totalsScaled[entry.payer] += amountPaise * scale;
    } else if (entry.splitType === 'owed' && entry.owedBy) {
      if (members.includes(entry.owedBy)) totalsScaled[entry.owedBy] += amountPaise * scale;
    } else {
      const splitSet = entry.splitAmong && entry.splitAmong.length > 0
        ? entry.splitAmong.filter((m) => members.includes(m))
        : members;
      if (splitSet.length === 0) continue;
      const share = (amountPaise * scale) / splitSet.length;
      splitSet.forEach((m) => {
        totalsScaled[m] += share;
      });
    }
  }
  return Object.fromEntries(members.map((m) => [m, totalsScaled[m] / (100 * scale)]));
}

// A shared ATM withdrawal and the itemized Cash-tagged purchases it funds
// both carry a real INR `amount`, but they're the same money once, not
// twice - the withdrawal already creates the shared debt for that cash
// (both people owe half of what was taken out), so re-splitting each
// individual Cash-tagged purchase on top double-counts it. Every
// trip-level money figure (the overall balance, per-person totals, total
// spend) excludes Cash-paid entries for this reason; Category Breakdown
// is the one place that's supposed to look at them, since it wants to
// know *what* the cash went on, not re-total it.
//
// This one-line filter went unnoticed as a source of real bugs for a
// while: it's easy to add a new trip-level total and forget it needs the
// same exclusion, since the mistake doesn't show up until a trip has a
// withdrawal AND shared (not personal) cash purchases funded by it -
// Taiwan's cash was all personal, so nothing to double-count; Sri Lanka
// and South Korea both had shared cash purchases, and both silently
// double-counted until caught against their real Splitwise settlement
// figures. See tests/utils.test.mjs for the regression cases.
export function excludeCashSpend(entries) {
  return entries.filter((e) => e.paymentMethod !== 'Cash');
}

// Same basis as computeMemberTotals, not Category Breakdown - card
// entries plus the ATM withdrawal itself, never the itemized cash
// purchases it funded. Total trip expense computed this way always
// equals the sum of computeMemberTotals' per-person figures; Category
// Breakdown can legitimately total less when some withdrawn cash is
// still unspent, and that's not a mismatch to reconcile.
export function computeTripTotalSpend(entries) {
  const totalPaise = excludeCashSpend(entries)
    .filter((e) => e.splitType !== 'settlement' && !e.isTripRollup)
    .reduce((sum, e) => sum + toPaise(e.amount), 0);
  return totalPaise / 100;
}

// Turns already-computed trip figures into a plain-text prompt for the AI
// digest - the model only narrates these numbers, it never sees raw
// entries or does any math itself, so it can't invent a figure that
// doesn't match the ledger.
export function buildTripDigestPrompt({
  tripName,
  currency = 'INR',
  totalSpend,
  memberTotals = {},
  categoryBreakdown = [],
  settlementLines = [],
}) {
  const memberLines = Object.entries(memberTotals)
    .map(([name, amount]) => `- ${name}: ${formatCurrency(amount, currency)}`)
    .join('\n');
  const categoryLines = categoryBreakdown
    .map((c) => `- ${c.category}: ${formatCurrency(c.amount, currency)}`)
    .join('\n');
  const settlementText = settlementLines.length > 0 ? settlementLines.join('\n') : 'Everyone is settled up.';

  return `You are summarizing a trip's expenses for a small group of friends/family. Write a short, warm, plain-English digest (3-5 sentences, no headers or bullet points in your answer) covering: total spend, which category dominated, and who owes whom. Use only the numbers given below - never invent or estimate a number that isn't listed.

Trip: ${tripName}
Total spend: ${formatCurrency(totalSpend, currency)}

Per-person totals:
${memberLines || 'No entries yet.'}

Category breakdown:
${categoryLines || 'No entries yet.'}

Settlement:
${settlementText}`;
}

// The trip's own last entry date, used as the default date for a new
// household rollup line - a trip rolled up (or backfilled) well after it
// happened should read as having happened then, not on whatever day
// someone got around to clicking "Add to Main Ledger".
export function getTripLastDate(entries) {
  return entries.reduce((max, e) => (e.date && e.date > max ? e.date : max), '');
}

export function getMonthKey(dateStr) {
  if (!dateStr) return '';
  return dateStr.slice(0, 7);
}

export function formatMonthLabel(monthKey) {
  if (!monthKey) return '';
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function getAvailableMonths(entries = []) {
  const months = new Set(entries.map((e) => getMonthKey(e.date)).filter(Boolean));
  const sorted = [...months].sort().reverse();
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!sorted.includes(current)) sorted.unshift(current);
  return sorted;
}

// Adds `months` calendar months to an ISO date string, clamping the day to
// the target month's length (e.g. Jan 31 + 1 month -> Feb 28/29, not Mar 3).
export function addMonthsToDateISO(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = (m - 1) + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(d, daysInTargetMonth);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

// Splits `total` into `count` amounts (rounded to paise/cents) that sum
// exactly back to `total`, distributing the leftover paise across the
// first few installments instead of inflating a single one.
export function splitAmountEvenly(total, count) {
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

export function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isTripActive(trip, today = todayISO()) {
  if (!trip?.startDate || !trip?.endDate) return false;
  return today >= trip.startDate && today <= trip.endDate;
}

// Picks the trip currently in progress by date range, if any - ties (two
// trips somehow overlapping today) resolve to whichever comes first in the
// given list. Trips without both dates set can never be "active".
export function getActiveTrip(trips, today = todayISO()) {
  return trips.find((trip) => isTripActive(trip, today)) || null;
}

export function getPreviousMonthKey(monthKey) {
  if (!monthKey) return '';
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (isNaN(year) || isNaN(month)) return '';
  const prevDate = new Date(year, month - 2, 1);
  const pY = prevDate.getFullYear();
  const pM = String(prevDate.getMonth() + 1).padStart(2, '0');
  return `${pY}-${pM}`;
}

export function getLast6MonthsData(entries = [], ledger) {
  const targetLedger = ledger ? normalizeLedger(ledger) : null;
  const filtered = entries.filter((e) => isCountableSpend(e, null, targetLedger));

  const monthTotals = {};
  for (const entry of filtered) {
    const key = getMonthKey(entry.date);
    if (!key) continue;
    monthTotals[key] = (monthTotals[key] || 0) + Number(entry.amount || 0);
  }

  const now = new Date();
  const [latestYear, latestMonth] = [now.getFullYear(), now.getMonth() + 1];
  const last6Keys = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(latestYear, latestMonth - 1 - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    last6Keys.push(`${yyyy}-${mm}`);
  }

  return last6Keys.map((key) => {
    const total = monthTotals[key] || 0;
    const prevKey = getPreviousMonthKey(key);
    const prevTotal = monthTotals[prevKey] || 0;

    let pctChange = 0;
    if (prevTotal > 0) {
      pctChange = ((total - prevTotal) / prevTotal) * 100;
    } else if (total > 0 && prevTotal === 0) {
      pctChange = 100;
    }

    return {
      month: key,
      label: formatMonthLabel(key),
      total,
      prevTotal,
      pctChange: Math.round(pctChange * 10) / 10,
    };
  });
}

export function getCategoryMoMComparison(entries = [], monthKey, ledger, customCategoriesList = null) {
  const currentData = groupByCategory(entries, monthKey, ledger, customCategoriesList);
  const prevMonthKey = getPreviousMonthKey(monthKey);
  const prevData = groupByCategory(entries, prevMonthKey, ledger, customCategoriesList);

  const prevMap = {};
  for (const item of prevData) {
    prevMap[item.category] = item.amount;
  }

  return currentData.map((item) => {
    const prevAmount = prevMap[item.category] || 0;
    const diff = item.amount - prevAmount;
    let pctChange = 0;

    if (prevAmount > 0) {
      pctChange = ((item.amount - prevAmount) / prevAmount) * 100;
    } else if (item.amount > 0 && prevAmount === 0) {
      pctChange = 100;
    }

    return {
      category: item.category,
      amount: item.amount,
      prevAmount,
      diff,
      pctChange: Math.round(pctChange * 10) / 10,
      isNew: prevAmount === 0 && item.amount > 0,
    };
  });
}

export function groupByMonth(entries = [], dynamicMembers = DEFAULT_PERSONS) {
  const members = dynamicMembers && dynamicMembers.length > 0 ? dynamicMembers : DEFAULT_PERSONS;
  const groups = {};

  for (const entry of entries) {
    if (!isCountableSpend(entry, null, null)) continue;
    const key = getMonthKey(entry.date);
    if (!key) continue;
    if (!groups[key]) {
      groups[key] = { total: 0 };
      members.forEach((m) => {
        groups[key][m] = 0;
      });
    }

    const payerKey = members.includes(entry.payer) ? entry.payer : members[0];
    groups[key][payerKey] = (groups[key][payerKey] || 0) + Number(entry.amount || 0);
    groups[key].total += Number(entry.amount || 0);
  }

  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));
}

// Shared by anything that totals up "real spend" (Category Breakdown, the
// per-category drill-down, monthly totals) - a settlement/withdrawal/rollup
// isn't a new expense, it's money already accounted for elsewhere.
function isCountableSpend(entry, monthKey, targetLedger) {
  if (monthKey && getMonthKey(entry.date) !== monthKey) return false;
  if (targetLedger && normalizeLedger(entry.ledger) !== targetLedger) return false;
  if (entry.splitType === 'settlement') return false;
  // A cash withdrawal isn't a spend category of its own - the money it
  // represents already shows up for real via the purchases it funded.
  if (entry.isWithdrawal) return false;
  // A trip-rollup entry is a debt transfer into the household ledger, not
  // a real household expense - it shouldn't inflate a spend category.
  if (entry.isTripRollup) return false;
  return true;
}

// The individual entries behind one category's slice of the Category
// Breakdown, biggest first - powers the "click a category" drill-down.
export function getCategoryEntries(entries = [], monthKey, ledger, category) {
  const targetLedger = ledger ? normalizeLedger(ledger) : null;
  return entries
    .filter((e) => e.category === category && isCountableSpend(e, monthKey, targetLedger))
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
}

export function groupByCategory(entries = [], monthKey, ledger, customCategoriesList = null) {
  const targetLedger = ledger ? normalizeLedger(ledger) : null;
  const filtered = entries.filter((e) => isCountableSpend(e, monthKey, targetLedger));

  const groups = {};
  for (const entry of filtered) {
    if (entry.category) {
      groups[entry.category] = (groups[entry.category] || 0) + Number(entry.amount || 0);
    }
  }

  const categoriesList =
    customCategoriesList && customCategoriesList.length > 0
      ? customCategoriesList
      : targetLedger === 'travel'
        ? DEFAULT_TRAVEL_CATEGORIES
        : DEFAULT_CATEGORIES;

  const allCategoryNames = Array.from(new Set([...categoriesList, ...Object.keys(groups)]));

  return allCategoryNames
    .filter((c) => groups[c])
    .map((category) => ({ category, amount: groups[category] }));
}

// Local storage helpers
let memoryStorage = {};

function getItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    // fallback
  }
  return memoryStorage[key] || null;
}

function setItem(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // fallback
  }
  memoryStorage[key] = value;
}

export const DEVICE_NAME_KEY = 'household-ledger-device-name';
export const HOUSEHOLD_CATEGORIES_KEY = 'household-ledger-categories';
export const TRIPS_KEY = 'household-ledger-trips';
export const CASH_MOVEMENTS_KEY = 'household-ledger-cash-movements';
export const PAYMENT_METHODS_KEY = 'household-ledger-payment-methods';
export const ACTIVE_LEDGER_KEY = 'household-ledger-active-ledger';
export const TRAVEL_CATEGORIES_KEY = 'household-ledger-travel-categories';
export const MEMBERS_KEY = 'household-ledger-members';
export const CURRENCIES_KEY = 'household-ledger-currencies';

export function getDeviceName() {
  return getItem(DEVICE_NAME_KEY);
}

export function setDeviceName(name) {
  if (name === null) {
    setItem(DEVICE_NAME_KEY, '');
  } else {
    setItem(DEVICE_NAME_KEY, name);
  }
}

export function getStoredHouseholdCategories() {
  const raw = getItem(HOUSEHOLD_CATEGORIES_KEY);
  if (raw === null || raw === undefined) return DEFAULT_CATEGORIES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

export function setStoredHouseholdCategories(categories) {
  setItem(HOUSEHOLD_CATEGORIES_KEY, JSON.stringify(categories));
}

export function getLedgerCategories(ledger) {
  if (normalizeLedger(ledger) === 'travel') {
    return getStoredTravelCategories();
  }
  return getStoredHouseholdCategories();
}

export function getStoredTrips() {
  const raw = getItem(TRIPS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function setStoredTrips(trips) {
  setItem(TRIPS_KEY, JSON.stringify(trips));
}

export function getStoredCashMovements() {
  const raw = getItem(CASH_MOVEMENTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function setStoredCashMovements(movements) {
  setItem(CASH_MOVEMENTS_KEY, JSON.stringify(movements));
}

export function getStoredPaymentMethods() {
  const raw = getItem(PAYMENT_METHODS_KEY);
  if (raw === null || raw === undefined) return DEFAULT_PAYMENT_METHODS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PAYMENT_METHODS;
  } catch {
    return DEFAULT_PAYMENT_METHODS;
  }
}

export function setStoredPaymentMethods(methods) {
  setItem(PAYMENT_METHODS_KEY, JSON.stringify(methods));
}

// This is the active *tab*, not an expense's `ledger` field - it has a
// third value ('payments') that never appears on an actual entry, so it
// can't reuse normalizeLedger (which only ever resolves to 'household' or
// 'travel').
export function getStoredActiveLedger() {
  const raw = getItem(ACTIVE_LEDGER_KEY);
  return raw === 'travel' || raw === 'payments' ? raw : 'household';
}

export function setStoredActiveLedger(ledger) {
  setItem(ACTIVE_LEDGER_KEY, ledger === 'travel' || ledger === 'payments' ? ledger : 'household');
}

export function getStoredTravelCategories() {
  const raw = getItem(TRAVEL_CATEGORIES_KEY);
  if (raw === null || raw === undefined) return DEFAULT_TRAVEL_CATEGORIES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_TRAVEL_CATEGORIES;
  } catch {
    return DEFAULT_TRAVEL_CATEGORIES;
  }
}

export function setStoredTravelCategories(categories) {
  setItem(TRAVEL_CATEGORIES_KEY, JSON.stringify(categories));
}

export function getStoredMembers() {
  const raw = getItem(MEMBERS_KEY);
  if (raw === null || raw === undefined) return DEFAULT_PERSONS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PERSONS;
  } catch {
    return DEFAULT_PERSONS;
  }
}

export function setStoredMembers(members) {
  setItem(MEMBERS_KEY, JSON.stringify(members));
}

export const PIN_CONFIG_KEY = 'splitkhata_pin_config';

export function getPinConfig() {
  const raw = getItem(PIN_CONFIG_KEY);
  if (!raw) return { pin: '', enabled: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      pin: typeof parsed.pin === 'string' ? parsed.pin : '',
      enabled: Boolean(parsed.enabled),
    };
  } catch {
    return { pin: '', enabled: false };
  }
}

export function setPinConfig(config) {
  setItem(PIN_CONFIG_KEY, JSON.stringify(config));
}

export function verifyPin(inputPin) {
  const { pin, enabled } = getPinConfig();
  if (!enabled || !pin) return true;
  return inputPin === pin;
}

export function getStoredCurrencies() {
  const raw = getItem(CURRENCIES_KEY);
  if (raw === null || raw === undefined) return DEFAULT_CURRENCIES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_CURRENCIES;
  } catch {
    return DEFAULT_CURRENCIES;
  }
}

export function setStoredCurrencies(currencies) {
  setItem(CURRENCIES_KEY, JSON.stringify(currencies));
}
