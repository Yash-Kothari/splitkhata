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

const GLOBAL_SEARCH_RESULT_LIMIT = 50;

// Tokenized AND-across-words / OR-across-fields matching for the global
// search bar - "Japan USJ" shouldn't require any single field to literally
// contain "japan usj"; it's a match as long as "japan" is found somewhere
// (e.g. the trip name) AND "usj" is found somewhere else (e.g. the note),
// each word checked independently against every field combined into one
// haystack. A plain substring match on the whole query would miss this,
// since real queries are often "which field has X" + "which field has Y"
// rather than one contiguous phrase.
export function searchAllEntries(entries, term) {
  const tokens = (term || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return entries
    .filter((e) => e.splitType !== 'settlement' && !e.isTripRollup)
    .filter((e) => {
      const haystack = [e.note, e.category, e.payer, e.tripName, e.amount, e.localAmount]
        .filter((v) => v != null && v !== '')
        .join(' ')
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, GLOBAL_SEARCH_RESULT_LIMIT);
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

// Constrains the category suggestion to a value that's actually in the
// ledger's category list (via enum) - the model can't hallucinate a
// category that doesn't exist, it can only pick from what's given.
export function buildCategorySuggestionSchema(categories) {
  return {
    type: 'object',
    properties: { category: { type: 'string', enum: categories } },
    required: ['category'],
  };
}

export function buildCategorySuggestionPrompt(note, categories) {
  return `Given this expense note: "${note}"\n\nSuggest the single best matching category from this list: ${categories.join(', ')}.`;
}

// Same enum-constraint approach for quick-add: category/payer/splitType/
// paymentMethod can only ever be a value that's actually valid for this
// ledger, so a parsed entry never needs its own extra validation pass
// before landing in the form.
export function buildQuickAddSchema({ categories, members, paymentMethods = [], isTravel = false }) {
  const properties = {
    amount: { type: 'number', description: 'The expense amount as a plain number, no currency symbol.' },
    category: { type: 'string', enum: categories },
    payer: { type: 'string', enum: members },
    splitType: { type: 'string', enum: ['shared', 'personal', 'owed'] },
    owedBy: { type: 'string', enum: members },
    note: { type: 'string' },
    date: { type: 'string', description: 'ISO date YYYY-MM-DD, resolved from any relative date mentioned (e.g. yesterday).' },
  };
  const required = ['amount', 'category', 'payer', 'splitType', 'note', 'date'];
  if (isTravel && paymentMethods.length > 0) {
    properties.paymentMethod = { type: 'string', enum: paymentMethods };
  }
  return { type: 'object', properties, required };
}

export function buildQuickAddPrompt(text, { members, today }) {
  return `Parse this casual expense description into structured fields. Today's date is ${today}.

"${text}"

Rules:
- amount: the numeric amount only, no currency symbol.
- category: pick the single best match from the allowed list - never invent a new one.
- payer: who paid, from the allowed list of people (${members.join(', ')}). If not mentioned, default to ${members[0]}.
- splitType: "shared" if the cost is split between everyone (the default for most expenses), "personal" if it's explicitly just for the payer alone, "owed" if one specific other person owes the full amount back.
- owedBy: only set this when splitType is "owed" - who owes the money back. Must be different from payer.
- date: resolve any relative date mentioned (e.g. "yesterday", "last Monday") against today's date, in YYYY-MM-DD format. Default to today if no date is mentioned.
- note: a short cleaned-up description of what the expense was for.`;
}

// Constrains a natural-language question to a list of one or more fixed,
// computable metrics - the AI's only job is figuring out WHAT the user is
// asking for (breaking a compound question like "compare X and Y" into
// several small queries), WHICH ledger/trip each one is about, and which
// category/person/month it refers to - never computing an answer itself.
// resolveAskQuery below does the actual math, with the same functions the
// rest of the app already uses and trusts. scope+trip make the chat usable
// from anywhere (e.g. asking about a trip while sitting on the Payments
// tab) instead of only ever answering about whatever's on screen.
export function buildAskQuestionSchema({ categories, members, trips }) {
  return {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['household', 'travel'] },
            trip: { type: 'string', enum: trips },
            metric: {
              type: 'string',
              enum: [
                'total_spend',
                'category_total',
                'member_total',
                'balance',
                'entry_count',
                'biggest_expense',
                'smallest_expense',
                'monthly_trend',
                'trip_comparison',
              ],
            },
            category: { type: 'string', enum: categories },
            member: { type: 'string', enum: members },
            month: { type: 'string', description: 'YYYY-MM, e.g. 2026-08. Omit for all-time.' },
            count: {
              type: 'integer',
              description: 'How many results for biggest_expense/smallest_expense, e.g. 3 for "top 3". Omit for just 1.',
            },
          },
          required: ['metric', 'scope'],
        },
      },
    },
    required: ['queries'],
  };
}

export function buildAskQuestionPrompt(question, { categories, members, trips, today, currentContext }) {
  return `Turn this question about an expense ledger into one or more structured queries. Today's date is ${today}. You are currently viewing: ${currentContext}. Break a compound question (e.g. "compare X and Y", "highest and lowest of each") into a separate query per distinct fact needed - don't try to cram multiple facts into one query.

"${question}"

Rules:
- scope: "household" or "travel" - which ledger this query is about. If the question doesn't name a specific trip or say "household", default to what's currently being viewed (above) rather than guessing.
- trip: only when scope is "travel" and the question names a specific trip (e.g. "my Japan trip") - match it to the closest name in the allowed list (${trips.length > 0 ? trips.join(', ') : 'no trips yet'}) even if not spelled exactly the same. Omit for "travel overall, across every trip".
- metric:
  - "total_spend" - overall total spend, optionally scoped to a month.
  - "category_total" - total for one specific category (needs category).
  - "member_total" - total for one specific person (needs member).
  - "balance" - who currently owes whom.
  - "entry_count" - how many entries/transactions there are.
  - "biggest_expense" - the largest expense(s), optionally scoped to a category and/or month.
  - "smallest_expense" - the smallest expense(s), optionally scoped to a category and/or month.
  - "monthly_trend" - spend total for each of the last 6 months.
  - "trip_comparison" - breaks spend down per trip (optionally scoped to one category), ranked highest first. Use this - not category_total - whenever the question asks "which trip", "compare trips", or wants a per-trip breakdown rather than one combined number. Ignores trip/scope (always compares across every trip).
- category: from the allowed list (${categories.join(', ')}) - only when relevant to that query.
- member: from the allowed list (${members.join(', ')}) - only when relevant to that query.
- month: resolve any month/date mentioned into YYYY-MM format against today's date. Omit entirely if that query isn't time-scoped.
- count: only for biggest_expense/smallest_expense - set this when the question asks for more than one (e.g. "top 3", "5 biggest"). Omit for just the single highest/lowest.`;
}

// Resolves one query spec (an item from buildAskQuestionSchema's queries
// array) against the full entry set - every household AND travel entry,
// across every trip, since the chat is reachable from anywhere and a
// question can name a trip that has nothing to do with whatever's
// currently on screen. scope/trip narrow it down first, then the same
// filters and aggregation functions the rest of the app already uses
// (isCountableSpend, computeMemberTotals, computeBalance/
// computeSettlements) do the actual math - never the AI's own arithmetic,
// so it can't report a figure that doesn't match the ledger. Called once
// per query when a question decomposes into several. Money is always
// formatted in INR - that's the only currency amount/e.amount is ever
// denominated in (a trip's localAmount is reference-only, never what
// drives a total), so there's no per-trip currency to thread through here.
export function resolveAskQuery(spec, allEntries, members) {
  const currency = 'INR';
  const scope = normalizeLedger(spec.scope || 'household');
  const month = spec.month || null;
  const scopeLabel = month ? formatMonthLabel(month) : 'all time';
  let scoped = allEntries.filter((e) => normalizeLedger(e.ledger) === scope);
  if (scope === 'travel' && spec.trip) {
    scoped = scoped.filter((e) => e.tripName === spec.trip);
  }
  const tripLabel = scope === 'travel' && spec.trip ? ` (${spec.trip})` : '';
  const countable = scoped.filter((e) => isCountableSpend(e, month, scope));

  switch (spec.metric) {
    case 'total_spend': {
      const total = countable.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      return `Total spend${tripLabel} (${scopeLabel}): ${formatCurrency(total, currency)}.`;
    }
    case 'category_total': {
      if (!spec.category) return "I couldn't tell which category you meant.";
      const total = countable
        .filter((e) => e.category === spec.category)
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
      return `${spec.category}${tripLabel} (${scopeLabel}): ${formatCurrency(total, currency)}.`;
    }
    case 'member_total': {
      if (!spec.member) return "I couldn't tell which person you meant.";
      const monthScoped = month ? scoped.filter((e) => getMonthKey(e.date) === month) : scoped;
      const totals = computeMemberTotals(monthScoped, members);
      return `${spec.member}${tripLabel} (${scopeLabel}): ${formatCurrency(totals[spec.member] || 0, currency)}.`;
    }
    case 'balance': {
      const balanceEntries = scope === 'travel' ? excludeCashSpend(scoped) : scoped;
      if (members.length > 2) {
        const settlements = computeSettlements(balanceEntries, scope, members);
        return settlements.length === 0
          ? `Everyone is settled up${tripLabel}.`
          : `${settlements.map((s) => `${s.debtor} owes ${s.creditor} ${formatCurrency(s.amount, currency)}`).join('; ')}.`;
      }
      const balance = computeBalance(balanceEntries, scope, members);
      return balance.status === 'settled'
        ? `Everyone is settled up${tripLabel}.`
        : `${balance.debtor} owes ${balance.creditor} ${formatCurrency(balance.amount, currency)}.`;
    }
    case 'entry_count': {
      return `${countable.length} ${countable.length === 1 ? 'entry' : 'entries'}${tripLabel} (${scopeLabel}).`;
    }
    case 'biggest_expense':
    case 'smallest_expense': {
      const pool = spec.category ? countable.filter((e) => e.category === spec.category) : countable;
      const label = spec.metric === 'biggest_expense' ? 'Biggest' : 'Smallest';
      const scopedIn = spec.category ? ` in ${spec.category}` : '';
      if (pool.length === 0) return `No expenses recorded${scopedIn}${tripLabel} (${scopeLabel}).`;
      // Clamped to a sane range - "top 3" is a normal ask, "top 500" isn't
      // and would just dump the whole ledger into one narration prompt.
      const count = Math.min(10, Math.max(1, Math.round(spec.count) || 1));
      const sorted = [...pool].sort((a, b) =>
        spec.metric === 'biggest_expense' ? Number(b.amount) - Number(a.amount) : Number(a.amount) - Number(b.amount),
      );
      const picks = sorted.slice(0, count);
      if (picks.length === 1) {
        const picked = picks[0];
        const categoryPart = spec.category ? '' : ` on ${picked.category}`;
        return `${label} expense${scopedIn}${tripLabel} (${scopeLabel}): ${formatCurrency(picked.amount, currency)}${categoryPart}${picked.note ? ` (${picked.note})` : ''}, paid by ${picked.payer}.`;
      }
      const lines = picks.map((e, i) => {
        const categoryPart = spec.category ? '' : ` on ${e.category}`;
        return `${i + 1}. ${formatCurrency(e.amount, currency)}${categoryPart}${e.note ? ` (${e.note})` : ''}, paid by ${e.payer}`;
      });
      return `Top ${picks.length} ${label.toLowerCase()} expenses${scopedIn}${tripLabel} (${scopeLabel}): ${lines.join('; ')}.`;
    }
    case 'monthly_trend': {
      const monthly = getLast6MonthsData(scoped, scope);
      return `${monthly.map((m) => `${m.label}: ${formatCurrency(m.total, currency)}`).join(', ')}.`;
    }
    case 'trip_comparison': {
      // Deliberately ignores scope/trip above (scoped/countable) - the
      // whole point is comparing across every trip, so it re-derives its
      // own travel-only slice from allEntries instead.
      const travelEntries = allEntries.filter((e) => normalizeLedger(e.ledger) === 'travel');
      const tripNames = Array.from(new Set(travelEntries.map((e) => e.tripName).filter(Boolean)));
      const categoryPart = spec.category ? ` on ${spec.category}` : '';
      if (tripNames.length === 0) return `No trips recorded yet.`;
      const perTrip = tripNames
        .map((tripName) => {
          const total = travelEntries
            .filter((e) => e.tripName === tripName && isCountableSpend(e, month, 'travel') && (!spec.category || e.category === spec.category))
            .reduce((sum, e) => sum + Number(e.amount || 0), 0);
          return { tripName, total };
        })
        .filter((t) => t.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      if (perTrip.length === 0) return `No${categoryPart} expenses recorded across any trip (${scopeLabel}).`;
      const lines = perTrip.map((t) => `${t.tripName}: ${formatCurrency(t.total, currency)}`);
      return `Spend${categoryPart} by trip (${scopeLabel}): ${lines.join(', ')}.`;
    }
    default:
      return "I couldn't understand that question.";
  }
}

// Turns a list of already-computed, already-correct facts (one string per
// resolveAskQuery call) into one natural-sounding answer to the original
// question - the app has already done every calculation by this point,
// this call only phrases them. "Never invent" keeps a compound question
// (e.g. "compare X and Y") from getting a made-up comparison sentence
// layered on top of facts that don't actually say which one is bigger.
export function buildAskAnswerNarrationPrompt(question, facts) {
  return `Answer this question in a short, natural sentence or two, using ONLY the facts listed below - never invent, estimate, or infer any number, comparison, or conclusion that isn't directly supported by them.

Question: "${question}"

Facts:
${facts.map((f) => `- ${f}`).join('\n')}`;
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
export function isCountableSpend(entry, monthKey, targetLedger) {
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

// A category never appears here unless it has an explicit limit set (the
// default is "no limit", not zero) and spend has actually reached the
// warning threshold - most categories, most months, produce nothing to
// show at all.
export const BUDGET_WARNING_THRESHOLD = 0.8;

// categoryTotals: the output of groupByCategory - [{ category, amount }].
// budgets: { [category]: limitNumber }, from getHouseholdBudgets() or a
// trip's own categoryBudgets field. Every budgeted category gets a status
// row regardless of how close it is to its limit - this is what the
// budget-editing UI shows live progress from (computeBudgetAlerts below
// is just this, filtered down to what's actually worth surfacing as an
// alert). Ranked worst (highest % used) first.
export function computeBudgetStatus(categoryTotals, budgets) {
  const status = [];
  for (const [category, limit] of Object.entries(budgets || {})) {
    const numericLimit = Number(limit);
    if (!numericLimit || numericLimit <= 0) continue;
    const spent = categoryTotals.find((c) => c.category === category)?.amount || 0;
    status.push({ category, spent, limit: numericLimit, pctUsed: spent / numericLimit });
  }
  return status.sort((a, b) => b.pctUsed - a.pctUsed);
}

// A category never appears here unless it has an explicit limit set (the
// default is "no limit", not zero) and spend has actually reached the
// warning threshold - most categories, most months, produce nothing to
// show at all.
// Same computeBudgetStatus, but enriched with each category's status from
// the previous period too - "were we also over on this last month, or did
// it just creep up now?" prevCategoryTotals is groupByCategory's output for
// whatever the previous period is (last calendar month for a recurring
// household budget); the limit is assumed to be the same in both periods,
// which holds for household budgets but not for a whole-trip travel budget
// (no "last month" for those, so this isn't meant to be called there).
export function computeBudgetTrend(categoryTotals, prevCategoryTotals, budgets) {
  const prevByCategory = {};
  for (const s of computeBudgetStatus(prevCategoryTotals, budgets)) {
    prevByCategory[s.category] = s;
  }
  return computeBudgetStatus(categoryTotals, budgets).map((s) => ({
    ...s,
    previous: prevByCategory[s.category] || null,
  }));
}

export function computeBudgetAlerts(categoryTotals, budgets) {
  return computeBudgetStatus(categoryTotals, budgets)
    .filter((s) => s.pctUsed >= BUDGET_WARNING_THRESHOLD)
    .map((s) => ({ ...s, status: s.pctUsed >= 1 ? 'over' : 'warning' }));
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

export const HOUSEHOLD_BUDGETS_KEY = 'splitkhata_household_budgets';

// A category with no entry here has no limit - the default, and the only
// state every pre-existing category starts in. Household budgets are a
// single recurring monthly cap per category (not a specific month's
// figure), checked against whatever the current month's spend happens to
// be - so setting "Groceries: 10000" applies every month, not just once.
export function getHouseholdBudgets() {
  const raw = getItem(HOUSEHOLD_BUDGETS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function setHouseholdBudgets(budgets) {
  setItem(HOUSEHOLD_BUDGETS_KEY, JSON.stringify(budgets || {}));
}

export const RECURRING_RULES_KEY = 'splitkhata_recurring_rules';

// A recurring rule describes a bill that repeats every month indefinitely
// (rent, subscriptions, utilities) - distinct from "split across multiple
// months" on a single entry (AddEntryForm), which spreads one known lump
// sum across a fixed number of future months and then stops. Shape: { id,
// category, amount, payer, splitType, owedBy, note, dayOfMonth, active,
// lastGeneratedMonth }. Household-only - a trip is a bounded window, not an
// indefinite recurrence.
export function getRecurringRules() {
  const raw = getItem(RECURRING_RULES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setRecurringRules(rules) {
  setItem(RECURRING_RULES_KEY, JSON.stringify(rules || []));
}

function nextMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month, 1); // month is 1-indexed, so this lands on the 1st of next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Clamps the day to however many days the target month actually has (e.g.
// day 31 in February becomes the 28th/29th) - same idea as
// addMonthsToDateISO's day clamping above.
export function buildRecurringEntryDate(monthKey, dayOfMonth) {
  const [year, month] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(1, Math.round(dayOfMonth) || 1), daysInMonth);
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

// How many months a single dormant rule can backfill in one go - if the app
// hasn't been opened in longer than this, older gaps are silently skipped
// rather than dumping a year of back-dated entries into the ledger at once.
const RECURRING_MAX_BACKFILL_MONTHS = 6;

// Pure planning step for recurring-expense generation: given the saved
// rules and "what month is it now," works out which (rule, month) pairs
// still need an entry, without touching Firestore/localStorage itself - the
// caller does the actual writes, then persists updatedRules. A rule with no
// lastGeneratedMonth yet only generates for the current month; it doesn't
// backfill to before the rule existed.
export function computeRecurringEntriesToGenerate(rules, currentMonthKey) {
  const toCreate = [];
  let anyChanged = false;

  const updatedRules = (rules || []).map((rule) => {
    if (!rule?.active) return rule;
    let cursor = rule.lastGeneratedMonth ? nextMonthKey(rule.lastGeneratedMonth) : currentMonthKey;
    const months = [];
    while (cursor <= currentMonthKey && months.length < RECURRING_MAX_BACKFILL_MONTHS) {
      months.push(cursor);
      cursor = nextMonthKey(cursor);
    }
    if (months.length === 0) return rule;

    for (const monthKey of months) {
      toCreate.push({
        amount: Number(rule.amount) || 0,
        payer: rule.payer,
        category: rule.category,
        split: rule.splitType !== 'personal',
        splitType: rule.splitType,
        owedBy: rule.splitType === 'owed' ? rule.owedBy : null,
        splitAmong: null,
        note: rule.note || '',
        date: buildRecurringEntryDate(monthKey, rule.dayOfMonth),
        ledger: 'household',
        tripName: '',
        paymentMethod: null,
        localAmount: null,
        rewardPoints: null,
        isRecurring: true,
        recurringRuleId: rule.id,
      });
    }
    anyChanged = true;
    return { ...rule, lastGeneratedMonth: months[months.length - 1] };
  });

  return { toCreate, updatedRules: anyChanged ? updatedRules : null };
}

export const PAYMENT_REMINDER_CONFIG_KEY = 'splitkhata_payment_reminder_config';

export const DEFAULT_PAYMENT_REMINDER_THRESHOLD = 2000;

export function getPaymentReminderConfig() {
  const raw = getItem(PAYMENT_REMINDER_CONFIG_KEY);
  if (!raw) return { enabled: true, amountThreshold: DEFAULT_PAYMENT_REMINDER_THRESHOLD };
  try {
    const parsed = JSON.parse(raw);
    const amountThreshold = Number(parsed.amountThreshold);
    return {
      enabled: parsed.enabled !== false,
      amountThreshold: Number.isFinite(amountThreshold) && amountThreshold > 0
        ? amountThreshold
        : DEFAULT_PAYMENT_REMINDER_THRESHOLD,
    };
  } catch {
    return { enabled: true, amountThreshold: DEFAULT_PAYMENT_REMINDER_THRESHOLD };
  }
}

export function setPaymentReminderConfig(config) {
  setItem(PAYMENT_REMINDER_CONFIG_KEY, JSON.stringify(config || {}));
}

// A proxy for "how long has this balance been sitting unsettled" without
// tracking per-expense settled state: the most recent settlement's date, or
// (if the two of you have never settled up) the very first expense's date.
// Not perfectly precise if new debt keeps piling on top of old, but close
// enough for a nudge, not an audit.
export function getUnsettledSinceDate(entries, ledger) {
  const scoped = (entries || []).filter((e) => normalizeLedger(e.ledger) === normalizeLedger(ledger));
  const settlementDates = scoped.filter((e) => e.splitType === 'settlement' && e.date).map((e) => e.date).sort();
  if (settlementDates.length) return settlementDates[settlementDates.length - 1];
  const allDates = scoped.filter((e) => e.date).map((e) => e.date).sort();
  return allDates.length ? allDates[0] : null;
}

// Null when there's nothing worth nudging about: balance is settled, the
// reminder is turned off, or the amount owed hasn't crossed config.amountThreshold
// yet. daysSince is still attached (via getUnsettledSinceDate) purely as
// display context - "how long has this been sitting" - it no longer gates
// whether the reminder fires at all.
export function computePaymentReminder(entries, ledger, members, config, today = todayISO()) {
  if (!config?.enabled) return null;
  const balance = computeBalance(entries, ledger, members);
  if (balance.status !== 'owes' || balance.amount <= 0) return null;
  if (balance.amount < (config.amountThreshold || DEFAULT_PAYMENT_REMINDER_THRESHOLD)) return null;
  const sinceDate = getUnsettledSinceDate(entries, ledger);
  const daysSince = sinceDate ? Math.floor((new Date(today) - new Date(sinceDate)) / 86400000) : null;
  return { ...balance, daysSince, sinceDate };
}

// Constrains the AI's receipt read to only ever name a real category (never
// invent one that doesn't exist in the household list) and a plausible
// amount/date - same "app trusts nothing it can't validate" approach as
// buildAskQuestionSchema.
export function buildReceiptExtractionSchema(categories) {
  return {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'The total amount actually charged on the receipt - just the number, no currency symbol.',
      },
      date: {
        type: 'string',
        description: 'The purchase date in YYYY-MM-DD format. If not visible, use the fallback date given in the prompt.',
      },
      category: { type: 'string', enum: categories.length ? categories : ['Other'] },
      note: {
        type: 'string',
        description: 'A short 3-6 word description of what was bought, e.g. "Grocery run" or "Dinner at Cafe X".',
      },
    },
    required: ['amount', 'date', 'category', 'note'],
  };
}

export function buildReceiptExtractionPrompt(categories, todayFallback) {
  return `You are reading a photo of a shopping or restaurant receipt for a household expense-splitting app.
Extract the total amount, purchase date, the best-matching category, and a short note describing the purchase.

Available categories (pick the single best match, never invent a new one): ${categories.join(', ')}
If the receipt's date is unreadable or missing, use ${todayFallback} instead.
If the receipt shows multiple totals (subtotal, tax, tip, grand total), use the final grand total actually charged.`;
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
