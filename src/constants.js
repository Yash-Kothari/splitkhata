export const PERSONS = ['Husband', 'Wife'];

export const CATEGORIES = [
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

export const PERSON_COLORS = {
  Husband: '#A63D40',
  Wife: '#3D7068',
};

export function formatCurrency(amount) {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function computeBalance(entries) {
  let husbandPaid = 0;
  let wifePaid = 0;

  for (const entry of entries) {
    if (!entry.split) continue;
    if (entry.payer === 'Husband') husbandPaid += entry.amount;
    else if (entry.payer === 'Wife') wifePaid += entry.amount;
  }

  const totalSplit = husbandPaid + wifePaid;
  const eachShare = totalSplit / 2;
  const husbandNet = husbandPaid - eachShare;
  const wifeNet = wifePaid - eachShare;

  if (Math.abs(husbandNet) < 0.01 && Math.abs(wifeNet) < 0.01) {
    return { status: 'settled', amount: 0, debtor: null, creditor: null };
  }

  if (husbandNet > 0) {
    return {
      status: 'owes',
      amount: husbandNet,
      debtor: 'Wife',
      creditor: 'Husband',
    };
  }

  return {
    status: 'owes',
    amount: wifeNet,
    debtor: 'Husband',
    creditor: 'Wife',
  };
}

export function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function getAvailableMonths(entries) {
  const months = new Set(entries.map((e) => getMonthKey(e.date)));
  const sorted = [...months].sort().reverse();
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!sorted.includes(current)) sorted.unshift(current);
  return sorted;
}

export function groupByMonth(entries) {
  const groups = {};
  for (const entry of entries) {
    const key = getMonthKey(entry.date);
    if (!groups[key]) groups[key] = { Husband: 0, Wife: 0, total: 0 };
    groups[key][entry.payer] += entry.amount;
    groups[key].total += entry.amount;
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));
}

export function groupByCategory(entries, monthKey) {
  const filtered = monthKey
    ? entries.filter((e) => getMonthKey(e.date) === monthKey)
    : entries;
  const groups = {};
  for (const entry of filtered) {
    groups[entry.category] = (groups[entry.category] || 0) + entry.amount;
  }
  return CATEGORIES.filter((c) => groups[c])
    .map((category) => ({ category, amount: groups[category] }));
}

export const DEVICE_NAME_KEY = 'household-ledger-device-name';

export function getDeviceName() {
  return localStorage.getItem(DEVICE_NAME_KEY);
}

export function setDeviceName(name) {
  localStorage.setItem(DEVICE_NAME_KEY, name);
}
