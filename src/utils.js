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
  'Other',
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
  'Other',
];

export const DEFAULT_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'TWD', 'JPY', 'AED', 'SGD'];

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

const CURRENCY_SYMBOLS = {
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
  const rounded = Math.round(Number(amount || 0));
  const formattedNum = rounded.toLocaleString('en-IN');
  const symbol = CURRENCY_SYMBOLS[currencyCode] || `${currencyCode} `;
  return `${symbol}${formattedNum}`;
}

export function normalizeLedger(ledger) {
  if (!ledger) return 'household';
  const str = String(ledger).toLowerCase();
  if (str === 'travel') return 'travel';
  return 'household';
}

export function computeBalance(entries = [], ledger, dynamicMembers = DEFAULT_PERSONS) {
  const members = dynamicMembers && dynamicMembers.length > 0 ? dynamicMembers : DEFAULT_PERSONS;
  const targetLedger = ledger ? normalizeLedger(ledger) : null;

  const netByMember = Object.fromEntries(members.map((member) => [member, 0]));
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
    const amount = Number(entry.amount || 0);

    if (!amount || !payer) continue;
    netByMember[payer] += amount;

    if (entry.splitType === 'owed' && entry.owedBy) {
      const debtor = resolveMember(entry.owedBy);
      if (debtor && debtor !== payer) netByMember[debtor] -= amount;
      continue;
    }

    const eachShare = amount / members.length;
    members.forEach((member) => {
      netByMember[member] -= eachShare;
    });
  }

  if (members.length === 2) {
    const p0Net = netByMember[members[0]];
    const p1Net = netByMember[members[1]];

    if (Math.abs(p0Net) < 0.01 && Math.abs(p1Net) < 0.01) {
      return { status: 'settled', amount: 0, debtor: null, creditor: null };
    }

    if (p0Net > 0) {
      return {
        status: 'owes',
        amount: p0Net,
        debtor: members[1],
        creditor: members[0],
      };
    }

    return {
      status: 'owes',
      amount: p1Net,
      debtor: members[0],
      creditor: members[1],
    };
  }

  let maxDebtor = null;
  let maxCreditor = null;
  let maxOwed = 0;

  for (const m of members) {
    const net = netByMember[m];
    if (net > maxOwed) {
      maxOwed = net;
      maxCreditor = m;
    }
  }

  let minNet = 0;
  for (const m of members) {
    const net = netByMember[m];
    if (net < minNet) {
      minNet = net;
      maxDebtor = m;
    }
  }

  if (maxOwed < 0.01 || !maxDebtor || !maxCreditor) {
    return { status: 'settled', amount: 0, debtor: null, creditor: null };
  }

  return {
    status: 'owes',
    amount: maxOwed,
    debtor: maxDebtor,
    creditor: maxCreditor,
  };
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

export function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const filtered = entries.filter((e) => {
    if (targetLedger && normalizeLedger(e.ledger) !== targetLedger) return false;
    return true;
  });

  const monthTotals = {};
  for (const entry of filtered) {
    const key = getMonthKey(entry.date);
    if (!key) continue;
    monthTotals[key] = (monthTotals[key] || 0) + Number(entry.amount || 0);
  }

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const allKeys = Object.keys(monthTotals).concat(currentKey).sort();
  const latestKey = allKeys[allKeys.length - 1];

  const [latestYear, latestMonth] = latestKey.split('-').map(Number);
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

export function groupByCategory(entries = [], monthKey, ledger, customCategoriesList = null) {
  const targetLedger = ledger ? normalizeLedger(ledger) : null;
  const filtered = entries.filter((e) => {
    if (monthKey && getMonthKey(e.date) !== monthKey) return false;
    if (targetLedger && normalizeLedger(e.ledger) !== targetLedger) return false;
    return true;
  });

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
