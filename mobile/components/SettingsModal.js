import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, Alert, Switch, useWindowDimensions, Platform } from 'react-native';
import { useColorScheme } from 'nativewind';
import PickerField from './PickerField';
import DateField from './DateField';
import CustomSplitEditor from './CustomSplitEditor';
import {
  subscribeToExpenses,
  subscribeToCategories,
  addCategoryToDb,
  deleteCategoryFromDb,
  subscribeToCurrencies,
  addCurrencyToDb,
  deleteCurrencyFromDb,
  subscribeToMembers,
  addMemberToDb,
  deleteMemberFromDb,
  subscribeToHouseholdBudgets,
  saveHouseholdBudgetsToDb,
  subscribeToPaymentReminderConfig,
  savePaymentReminderConfigToDb,
  subscribeToRecurringRules,
  saveRecurringRulesToDb,
  subscribeToPinConfig,
  savePinConfigToDb,
  subscribeToCreditCards,
  addCreditCardToDb,
  updateCreditCardInDb,
  updatePaymentMethodInDb,
  linkCardsToPaymentMethods,
  deleteCreditCardFromDb,
  isFirebaseConfigured,
  subscribeToTrips,
  subscribeToCashMovements,
  subscribeToCardTransactions,
  subscribeToCardBillingCycles,
  subscribeToPaymentMethods,
  addPaymentMethodToDb,
  deletePaymentMethodFromDb,
} from '../lib/firebase';
import {
  formatCurrency,
  groupByCategory,
  computeBudgetTrend,
  getMonthKey,
  getPreviousMonthKey,
  todayISO,
  DEFAULT_PAYMENT_REMINDER_THRESHOLD,
  CARD_REWARD_STRATEGIES,
  CARD_STRATEGY_DEFAULTS,
  resolveStrategyParamsForDate,
  DEFAULT_CATEGORIES,
  DEFAULT_TRAVEL_CATEGORIES,
  DEFAULT_CURRENCIES,
  DEFAULT_PERSONS,
  INSTRUMENT_TYPES,
  getQuarterBounds,
  checkCustomSharesTotal,
  parseCustomShares,
  getUnlinkedCards,
  normalizeInstrumentType,
  toCsv,
  buildFullBackupJson,
  getStoredColorScheme,
  setStoredColorScheme,
  LEDGER_CSV_COLUMNS,
  CARD_TRANSACTION_CSV_COLUMNS,
} from '../lib/utils';
import { reportError } from '../lib/errorReporting';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_OPTIONS = MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }));

// Which of a strategy's numeric params are worth exposing as an editable
// field - exact copy of web's SettingsModal.jsx table, cross-checked
// against each bank's real terms.
const CARD_PARAM_FIELDS = {
  hdfc_diners_slab_milestone: [
    { key: 'pointsPerUnit', label: 'Points per unit' },
    { key: 'unitAmount', label: 'Unit amount (₹)' },
    { key: 'cycleCap', label: 'Max points earned per cycle' },
    { key: 'quarterlyMilestoneTarget', label: 'Quarterly milestone spend (₹)' },
    { key: 'quarterlyMilestoneBonus', label: 'Quarterly milestone bonus points' },
    { key: 'annualMilestoneTarget', label: 'Annual milestone spend (₹)' },
    { key: 'annualMilestoneLabel', label: 'Annual milestone reward', isText: true },
  ],
  sbi_two_channel_cashback: [
    { key: 'onlineRate', label: 'Online rate (%)' },
    { key: 'offlineRate', label: 'Offline rate (%)' },
    { key: 'onlineCycleCap', label: 'Max online cashback per cycle (₹)' },
    { key: 'offlineCycleCap', label: 'Max offline cashback per cycle (₹)' },
    { key: 'minTransaction', label: 'Minimum transaction to earn (₹)' },
    { key: 'annualMilestoneTarget', label: 'Annual fee-waiver spend (₹)' },
    { key: 'annualMilestoneLabel', label: 'Annual milestone reward', isText: true },
  ],
  hsbc_tiered_cashback_aggregate: [
    { key: 'bonusRate', label: 'Bonus category rate (%)' },
    { key: 'bonusMonthlyCap', label: 'Max bonus cashback per month (₹)' },
    { key: 'baseRate', label: 'Base rate (%)' },
    { key: 'annualMilestoneTarget', label: 'Annual fee-waiver spend (₹)' },
    { key: 'annualMilestoneLabel', label: 'Annual milestone reward', isText: true },
  ],
  axis_supermoney_dual_pool: [
    { key: 'baseRate', label: 'Base rate (%)' },
    { key: 'bonusRate', label: 'Super.money rate (%)' },
    { key: 'minTransaction', label: 'Minimum transaction to earn (₹)' },
    { key: 'bonusFloor', label: 'Minimum bonus cashback, even if capped (₹)' },
  ],
  annual_milestone_only: [
    { key: 'annualMilestoneTarget', label: 'Annual milestone spend (₹)' },
    { key: 'annualMilestoneLabel', label: 'Annual milestone reward', isText: true },
  ],
  hsbc_premier_flat_capped: [
    { key: 'baseRate', label: 'Base rate (%)' },
    { key: 'categoryMonthlyCap', label: 'Max capped-category spend per month (₹)' },
    { key: 'travelBonusMonthlyCap', label: 'Max Travel with Points bonus per month (pts)' },
  ],
};

function coerceStrategyParams(strategyKey, rawParams) {
  const textFieldKeys = new Set((CARD_PARAM_FIELDS[strategyKey] || []).filter((f) => f.isText).map((f) => f.key));
  return Object.fromEntries(
    Object.entries(rawParams).map(([k, v]) => [
      k,
      k === 'categories' || textFieldKeys.has(k) ? v : (v === '' || v == null ? null : Number(v)),
    ]),
  );
}

const SPLIT_TYPE_OPTIONS = [
  { value: 'shared', label: 'Split' },
  { value: 'owed', label: 'Owed' },
  { value: 'personal', label: 'Personal' },
];
const RULE_SPLIT_TYPE_OPTIONS = [
  { value: 'shared', label: 'Split' },
  { value: 'owed', label: 'Owed in full' },
  { value: 'personal', label: 'Personal' },
  { value: 'custom', label: 'Custom amounts' },
];
const CAP_PERIOD_OPTIONS = [
  { value: '', label: 'No cap' },
  { value: 'day', label: 'Per day' },
  { value: 'month', label: 'Per month' },
];

const SHARED_OWNER_LABEL = 'Shared / anyone';

const TABS = [
  { key: 'categories', label: 'Categories' },
  { key: 'budgets', label: 'Budgets' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'currencies', label: 'Currencies' },
  { key: 'paymentMethods', label: 'Payment Methods & Cards' },
  { key: 'members', label: 'Members' },
  { key: 'database', label: 'Cloud Status' },
  { key: 'export', label: 'Export' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'security', label: '🔒 Security PIN' },
];

function Tag({ label, onRemove, onEdit, removable = true, labelWeight = 'font-body-medium' }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-xl border border-ink/15 bg-paper px-3 py-1.5 mr-1.5 mb-1.5 shadow-2xs">
      <Text className={`${labelWeight} text-xs text-ink`}>{label}</Text>
      {onEdit && (
        <Pressable onPress={onEdit} hitSlop={6}>
          <Text className="font-body-semibold text-xs text-muted-text">✎</Text>
        </Pressable>
      )}
      {removable && (
        <Pressable onPress={onRemove} hitSlop={6}>
          <Text className="font-body-semibold text-xs text-muted-text">✕</Text>
        </Pressable>
      )}
    </View>
  );
}

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const sectionLabel = 'font-body-semibold text-2xs uppercase tracking-wider text-ledger-green mb-1';
// Web sizes these "Active Database X (count)" captions at 11px (text-[11px]),
// one notch up from an ordinary field label (text-2xs/10px) - reusing `label`
// made this caption visually indistinguishable from a plain field label.
const activeListCaption = 'font-body-semibold text-[11px] uppercase tracking-wider text-muted-text mb-1';
const input = 'font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper';

// RN full-screen Modal port of SettingsModal.jsx - self-contained (unlike
// most mobile/components, which receive data as props from a screen): this
// is opened from the global AppHeader, present on every tab, so it
// subscribes to all its own Firestore data rather than needing each of the
// 4 screens to thread half a dozen datasets down to it.
export default function SettingsModal({ visible, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState('categories');
  const { colorScheme, setColorScheme } = useColorScheme();

  function handleSetColorScheme(scheme) {
    setColorScheme(scheme);
    setStoredColorScheme(scheme);
  }

  const [householdEntries, setHouseholdEntries] = useState([]);
  const [categories, setCategories] = useState({ household: DEFAULT_CATEGORIES, travel: DEFAULT_TRAVEL_CATEGORIES, rawDocs: [] });
  const [currencies, setCurrencies] = useState({ currencies: DEFAULT_CURRENCIES, rawDocs: [] });
  const [membersData, setMembersData] = useState({ members: DEFAULT_PERSONS, rawDocs: [] });
  const [householdBudgets, setHouseholdBudgetsState] = useState({});
  const [reminderConfig, setReminderConfigState] = useState({ enabled: true, amountThreshold: DEFAULT_PAYMENT_REMINDER_THRESHOLD });
  const [recurringRules, setRecurringRules] = useState([]);
  const [pinConfig, setPinConfigState] = useState({ pin: '', enabled: false });
  const [creditCards, setCreditCards] = useState([]);
  const [travelEntries, setTravelEntries] = useState([]);
  const [dbTrips, setDbTrips] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [cardTransactions, setCardTransactions] = useState([]);
  const [cardBillingCycles, setCardBillingCycles] = useState([]);
  const [paymentMethodsData, setPaymentMethodsData] = useState({ methods: ['Cash'], rawDocs: [] });

  const dbMembers = membersData.members;
  const dbPaymentMethods = paymentMethodsData.methods;

  useEffect(() => subscribeToExpenses('household', (data) => setHouseholdEntries(data), (err) => reportError(err, 'Could not load household entries')), []);
  useEffect(() => subscribeToExpenses('travel', (data) => setTravelEntries(data), (err) => reportError(err, 'Could not load travel entries')), []);
  useEffect(() => subscribeToCategories((data) => setCategories(data), (err) => reportError(err, 'Could not load categories')), []);
  useEffect(() => subscribeToCurrencies((data) => setCurrencies(data), (err) => reportError(err, 'Could not load currencies')), []);
  useEffect(() => subscribeToMembers((data) => setMembersData(data), (err) => reportError(err, 'Could not load members')), []);
  useEffect(() => subscribeToHouseholdBudgets(setHouseholdBudgetsState), []);
  useEffect(() => subscribeToPaymentReminderConfig(setReminderConfigState), []);
  useEffect(() => subscribeToRecurringRules(setRecurringRules), []);
  useEffect(() => subscribeToPinConfig(setPinConfigState), []);
  useEffect(() => subscribeToCreditCards(setCreditCards, (err) => reportError(err, 'Could not load credit cards')), []);
  useEffect(() => subscribeToTrips((data) => setDbTrips(data), (err) => reportError(err, 'Could not load trips')), []);
  useEffect(() => subscribeToCashMovements((data) => setCashMovements(data), (err) => reportError(err, 'Could not load cash movements')), []);
  useEffect(() => subscribeToCardTransactions((data) => setCardTransactions(data), (err) => reportError(err, 'Could not load card transactions')), []);
  useEffect(() => subscribeToCardBillingCycles((data) => setCardBillingCycles(data), (err) => reportError(err, 'Could not load billing cycles')), []);
  useEffect(() => subscribeToPaymentMethods((data) => setPaymentMethodsData(data), (err) => reportError(err, 'Could not load payment methods')), []);

  const cardNameById = useMemo(() => Object.fromEntries(creditCards.map((c) => [c.id, c.name || c.id])), [creditCards]);

  // Native has no file-save/share flow wired up yet (would need expo-sharing,
  // not currently a dependency) - deliberately scoped to web for now, same
  // as the rest of this app's website-first rollout. `document`/`Blob`/`URL`
  // are real browser globals once react-native-web compiles this for the
  // website, exactly like the native-only branches elsewhere in this
  // codebase go the other way (Platform.OS === 'web' checks in firebase.js).
  function downloadTextFile(filename, content, mimeType) {
    if (Platform.OS !== 'web') {
      Alert.alert('Export', 'Downloading files is available on the Splitkhata website for now - open it in a browser to export your data.');
      return;
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportHouseholdCsv() {
    downloadTextFile('splitkhata-household.csv', toCsv(householdEntries, LEDGER_CSV_COLUMNS), 'text/csv');
  }

  function handleExportTravelCsv() {
    downloadTextFile('splitkhata-travel.csv', toCsv(travelEntries, LEDGER_CSV_COLUMNS), 'text/csv');
  }

  function handleExportCardsCsv() {
    const rows = cardTransactions.map((t) => ({ ...t, cardName: cardNameById[t.cardId] || t.cardId }));
    downloadTextFile('splitkhata-card-transactions.csv', toCsv(rows, CARD_TRANSACTION_CSV_COLUMNS), 'text/csv');
  }

  function handleExportFullBackup() {
    const json = buildFullBackupJson({
      householdEntries,
      travelEntries,
      trips: dbTrips,
      cashMovements,
      categories,
      currencies,
      members: membersData,
      householdBudgets,
      recurringRules,
      reminderConfig,
      creditCards,
      cardTransactions,
      cardBillingCycles,
    });
    downloadTextFile(`splitkhata-backup-${todayISO()}.json`, json, 'application/json');
  }

  // Categories tab
  const [categoryLedger, setCategoryLedger] = useState('household');
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const categoriesList = categoryLedger === 'travel' ? categories.travel : categories.household;

  async function handleAddCategory() {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    setAddingCat(true);
    try {
      await addCategoryToDb(categoryLedger, trimmed, categories.rawDocs);
      setNewCatName('');
    } catch (err) {
      reportError(err, 'Could not add category');
    } finally {
      setAddingCat(false);
    }
  }
  async function handleDeleteCategory(name) {
    try {
      await deleteCategoryFromDb(categoryLedger, name, categories.rawDocs);
    } catch (err) {
      reportError(err, 'Could not delete category');
    }
  }

  // Budgets tab
  const [budgetDrafts, setBudgetDrafts] = useState({});
  const [newBudgetCategory, setNewBudgetCategory] = useState('');
  const [newBudgetAmount, setNewBudgetAmount] = useState('');
  const [budgetMessage, setBudgetMessage] = useState('');
  const [savingBudgetCat, setSavingBudgetCat] = useState(null);

  useEffect(() => {
    if (visible) setBudgetDrafts({ ...householdBudgets });
  }, [visible]);

  const householdBudgetStatus = useMemo(() => {
    const currentMonth = getMonthKey(todayISO());
    const totals = groupByCategory(householdEntries, currentMonth, 'household');
    const prevTotals = groupByCategory(householdEntries, getPreviousMonthKey(currentMonth), 'household');
    return computeBudgetTrend(totals, prevTotals, budgetDrafts);
  }, [householdEntries, budgetDrafts]);
  const budgetedNames = new Set(householdBudgetStatus.map((s) => s.category));
  const unbudgetedCategories = categories.household.filter((c) => !budgetedNames.has(c));

  async function persistBudgets(next) {
    setBudgetMessage('');
    try {
      await saveHouseholdBudgetsToDb(next);
      setBudgetDrafts(next);
    } catch (err) {
      setBudgetMessage(`Failed to save: ${err?.message || err}`);
    }
  }
  async function handleAddBudget() {
    const amount = Number(newBudgetAmount);
    if (!newBudgetCategory || !amount || amount <= 0) return;
    setSavingBudgetCat(newBudgetCategory);
    try {
      await persistBudgets({ ...budgetDrafts, [newBudgetCategory]: amount });
      setNewBudgetCategory('');
      setNewBudgetAmount('');
    } finally {
      setSavingBudgetCat(null);
    }
  }
  async function handleRemoveBudget(category) {
    const next = { ...budgetDrafts };
    delete next[category];
    await persistBudgets(next);
  }

  // Recurring tab
  const [newRuleCategory, setNewRuleCategory] = useState('');
  const [newRuleAmount, setNewRuleAmount] = useState('');
  const [newRuleDay, setNewRuleDay] = useState('1');
  const [newRulePayer, setNewRulePayer] = useState('');
  const [newRuleSplitType, setNewRuleSplitType] = useState('shared');
  const [newRuleOwedBy, setNewRuleOwedBy] = useState('');
  const [newRuleShares, setNewRuleShares] = useState({});
  const newRuleSharesInvalid = newRuleSplitType === 'custom' && !checkCustomSharesTotal(newRuleShares, Number(newRuleAmount) || 0).ok;
  const [newRuleNote, setNewRuleNote] = useState('');
  const [addingRule, setAddingRule] = useState(false);
  const [ruleMessage, setRuleMessage] = useState('');

  useEffect(() => {
    if (!newRulePayer && dbMembers.length) setNewRulePayer(dbMembers[0]);
  }, [dbMembers.join('|')]);

  async function handleAddRule() {
    const amount = Number(newRuleAmount);
    if (!newRuleCategory || !amount || amount <= 0) return;
    setAddingRule(true);
    setRuleMessage('');
    try {
      const rule = {
        id: 'rule_' + crypto.randomUUID(),
        category: newRuleCategory,
        amount,
        payer: newRulePayer || dbMembers[0] || '',
        splitType: newRuleSplitType,
        owedBy: newRuleSplitType === 'owed' ? newRuleOwedBy : null,
        splitShares: newRuleSplitType === 'custom' ? parseCustomShares(newRuleShares) : null,
        note: newRuleNote.trim(),
        dayOfMonth: Math.min(Math.max(1, Math.round(Number(newRuleDay)) || 1), 31),
        active: true,
        lastGeneratedMonth: null,
        createdAt: new Date().toISOString(),
      };
      await saveRecurringRulesToDb([...recurringRules, rule]);
      setNewRuleCategory('');
      setNewRuleAmount('');
      setNewRuleDay('1');
      setNewRuleNote('');
      setNewRuleShares({});
      setRuleMessage(`Added - this month's ${rule.category} entry will be created automatically.`);
    } catch (err) {
      setRuleMessage(`Failed to save: ${err?.message || err}`);
    } finally {
      setAddingRule(false);
    }
  }
  async function handleRemoveRule(id) {
    await saveRecurringRulesToDb(recurringRules.filter((r) => r.id !== id));
  }

  // Reminders tab
  const [reminderDraft, setReminderDraft] = useState({ enabled: true, amountThreshold: DEFAULT_PAYMENT_REMINDER_THRESHOLD });
  const [reminderMessage, setReminderMessage] = useState('');

  useEffect(() => {
    if (visible) setReminderDraft({ ...reminderConfig });
  }, [visible]);

  async function handleReminderToggle(enabled) {
    const next = { ...reminderDraft, enabled };
    setReminderDraft(next);
    setReminderMessage('');
    try {
      await savePaymentReminderConfigToDb(next);
    } catch (err) {
      setReminderMessage(`Failed to save: ${err?.message || err}`);
    }
  }
  async function handleReminderThresholdBlur() {
    const amountThreshold = Math.max(1, Math.round(Number(reminderDraft.amountThreshold)) || DEFAULT_PAYMENT_REMINDER_THRESHOLD);
    const next = { ...reminderDraft, amountThreshold };
    setReminderDraft(next);
    setReminderMessage('');
    try {
      await savePaymentReminderConfigToDb(next);
    } catch (err) {
      setReminderMessage(`Failed to save: ${err?.message || err}`);
    }
  }

  // Currencies tab
  const [newCurrencyName, setNewCurrencyName] = useState('');
  const [addingCurr, setAddingCurr] = useState(false);
  async function handleAddCurrency() {
    const trimmed = newCurrencyName.trim();
    if (!trimmed) return;
    setAddingCurr(true);
    try {
      await addCurrencyToDb(trimmed, currencies.rawDocs);
      setNewCurrencyName('');
    } catch (err) {
      reportError(err, 'Could not add currency');
    } finally {
      setAddingCurr(false);
    }
  }
  async function handleDeleteCurrency(name) {
    try {
      await deleteCurrencyFromDb(name, currencies.rawDocs);
    } catch (err) {
      reportError(err, 'Could not delete currency');
    }
  }

  // Payment Methods tab - moved here from the trip settings sheet, since a
  // payment method (a card, forex account, "Cash") is reused across every
  // trip, not scoped to one - the same reasoning that already put
  // currencies and members here instead of in the trip sheet.
  const [newPaymentMethodName, setNewPaymentMethodName] = useState('');
  const [showAddMethodForm, setShowAddMethodForm] = useState(false);
  const [editingMethod, setEditingMethod] = useState(null);
  async function handleSaveEditedMethod() {
    if (!editingMethod?.name.trim()) return;
    try {
      await updatePaymentMethodInDb(editingMethod.id, {
        name: editingMethod.name,
        type: editingMethod.type,
        owner: editingMethod.owner === SHARED_OWNER_LABEL ? '' : editingMethod.owner,
      });
      const linkedCard = creditCards.find((c) => c.paymentMethodId === editingMethod.id);
      if (linkedCard) {
        await updateCreditCardInDb(linkedCard.id, {
          name: editingMethod.name.trim(),
          owner: editingMethod.owner === SHARED_OWNER_LABEL ? '' : editingMethod.owner,
        });
      }
      setEditingMethod(null);
    } catch (err) {
      reportError(err, 'Could not update payment method');
    }
  }
  const [newPaymentMethodType, setNewPaymentMethodType] = useState('upi');
  const [newPaymentMethodOwner, setNewPaymentMethodOwner] = useState(SHARED_OWNER_LABEL);
  const [addingPaymentMethod, setAddingPaymentMethod] = useState(false);
  async function handleAddPaymentMethod() {
    const trimmed = newPaymentMethodName.trim();
    if (!trimmed) return;
    setAddingPaymentMethod(true);
    try {
      await addPaymentMethodToDb(trimmed, paymentMethodsData.rawDocs, {
        type: newPaymentMethodType,
        owner: newPaymentMethodOwner === SHARED_OWNER_LABEL ? '' : newPaymentMethodOwner,
      });
      setNewPaymentMethodName('');
    } catch (err) {
      reportError(err, 'Could not add payment method');
    } finally {
      setAddingPaymentMethod(false);
    }
  }
  async function handleDeletePaymentMethod(name) {
    const doc = paymentMethodsData.rawDocs.find((d) => d.name === name);
    if (doc && creditCards.some((c) => c.paymentMethodId === doc.id)) {
      Alert.alert('Linked to a card', `"${name}" is linked to a tracked card - delete the card first.`);
      return;
    }
    try {
      await deletePaymentMethodFromDb(name, paymentMethodsData.rawDocs);
    } catch (err) {
      reportError(err, 'Could not delete payment method');
    }
  }

  // Members tab
  const [newMemberName, setNewMemberName] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  async function handleAddMember() {
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    setAddingMember(true);
    try {
      await addMemberToDb(trimmed, membersData.rawDocs);
      setNewMemberName('');
    } catch (err) {
      reportError(err, 'Could not add member');
    } finally {
      setAddingMember(false);
    }
  }
  function handleDeleteMember(name) {
    if (dbMembers.length <= 1) {
      Alert.alert('At least one member is required.');
      return;
    }
    Alert.alert('Delete member?', `Delete member "${name}" from database?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMemberFromDb(name, membersData.rawDocs).catch((err) => reportError(err, 'Could not delete member')),
      },
    ]);
  }

  // Cards tab
  const [showAddCardForm, setShowAddCardForm] = useState(false);
  const [newCardMethodName, setNewCardMethodName] = useState('');
  const [newCardOwner, setNewCardOwner] = useState('');
  const [newCardStrategy, setNewCardStrategy] = useState(CARD_REWARD_STRATEGIES[0].key);
  const [newCardParams, setNewCardParams] = useState(() => ({ ...CARD_STRATEGY_DEFAULTS[CARD_REWARD_STRATEGIES[0].key] }));
  const [newCardBillingDay, setNewCardBillingDay] = useState('1');
  const [newCardDueOffset, setNewCardDueOffset] = useState('20');
  const [newCardAnnualAnchorMonth, setNewCardAnnualAnchorMonth] = useState('1');
  const [newCardAnnualStartingSpend, setNewCardAnnualStartingSpend] = useState('0');
  const [newCardQuarterlyStartingSpend, setNewCardQuarterlyStartingSpend] = useState('0');
  const [newCardStartingPoints, setNewCardStartingPoints] = useState('0');
  const [addingCard, setAddingCard] = useState(false);
  const [cardMessage, setCardMessage] = useState('');
  const [editingCardId, setEditingCardId] = useState(null);
  const [editCardDrafts, setEditCardDrafts] = useState({});
  const [editingRulesCardId, setEditingRulesCardId] = useState(null);
  const [newVersionEffectiveFrom, setNewVersionEffectiveFrom] = useState(todayISO());
  const [newVersionParams, setNewVersionParams] = useState({});
  const [savingRuleVersion, setSavingRuleVersion] = useState(false);

  useEffect(() => {
    if (!newCardOwner && dbMembers.length) setNewCardOwner(dbMembers[0]);
  }, [dbMembers.join('|')]);
  useEffect(() => {
    if (visible) setShowAddCardForm(creditCards.length === 0);
  }, [visible]);

  function handleNewCardStrategyChange(strategyKey) {
    setNewCardStrategy(strategyKey);
    setNewCardParams({ ...CARD_STRATEGY_DEFAULTS[strategyKey] });
  }

  const unlinkedCards = getUnlinkedCards(paymentMethodsData.rawDocs, creditCards);
  const linkedMethodIds = new Set(creditCards.map((c) => c.paymentMethodId).filter(Boolean));
  const linkableMethods = paymentMethodsData.rawDocs.filter(
    (d) => !linkedMethodIds.has(d.id) && normalizeInstrumentType(d.type, d.name) === 'credit',
  );
  const selectedCardMethod = linkableMethods.find((d) => d.name === newCardMethodName) || null;
  const [linkingCards, setLinkingCards] = useState(false);
  async function handleLinkExistingCards() {
    setLinkingCards(true);
    try {
      await linkCardsToPaymentMethods(unlinkedCards, paymentMethodsData.rawDocs);
    } catch (err) {
      reportError(err, 'Could not link cards to payment methods');
    } finally {
      setLinkingCards(false);
    }
  }

  async function handleAddCard() {
    if (!selectedCardMethod) return;
    const trimmed = selectedCardMethod.name.trim();
    setAddingCard(true);
    setCardMessage('');
    try {
      const coercedParams = coerceStrategyParams(newCardStrategy, newCardParams);
      await addCreditCardToDb({
        name: trimmed,
        owner: selectedCardMethod.owner || newCardOwner,
        paymentMethodId: selectedCardMethod.id,
        rewardStrategy: newCardStrategy,
        strategyParamsHistory: [{ effectiveFrom: todayISO(), params: coercedParams }],
        billingCycleDay: Math.min(31, Math.max(1, Math.round(Number(newCardBillingDay)) || 1)),
        dueDateOffsetDays: Math.max(0, Math.round(Number(newCardDueOffset)) || 0),
        annualMilestoneAnchorMonth: Math.min(12, Math.max(1, Math.round(Number(newCardAnnualAnchorMonth)) || 1)),
        annualMilestoneStartingSpend: Math.max(0, Number(newCardAnnualStartingSpend) || 0),
        ...(CARD_STRATEGY_DEFAULTS[newCardStrategy]?.quarterlyMilestoneTarget
          ? {
              quarterlyMilestoneStartingSpend: Math.max(0, Number(newCardQuarterlyStartingSpend) || 0),
              quarterlyMilestoneStartingQuarter: getQuarterBounds(todayISO()).quarterStart,
            }
          : {}),
        startingRewardPoints: CARD_REWARD_STRATEGIES.find((s) => s.key === newCardStrategy)?.unit === 'points'
          ? Math.max(0, Number(newCardStartingPoints) || 0)
          : 0,
        active: true,
      });
      setNewCardMethodName('');
      setNewCardQuarterlyStartingSpend('0');
      setCardMessage(`${trimmed} added.`);
      setShowAddCardForm(false);
    } catch (err) {
      setCardMessage(`Failed to save: ${err?.message || err}`);
    } finally {
      setAddingCard(false);
    }
  }

  function startEditCard(card) {
    setEditingCardId(card.id);
    setEditCardDrafts({
      name: card.name,
      owner: card.owner || '',
      billingCycleDay: String(card.billingCycleDay ?? 1),
      dueDateOffsetDays: String(card.dueDateOffsetDays ?? 20),
      annualMilestoneAnchorMonth: String(card.annualMilestoneAnchorMonth ?? 1),
      annualMilestoneStartingSpend: String(card.annualMilestoneStartingSpend ?? 0),
      quarterlyMilestoneStartingSpend: String(
        card.quarterlyMilestoneStartingQuarter === getQuarterBounds(todayISO()).quarterStart ? card.quarterlyMilestoneStartingSpend ?? 0 : 0,
      ),
      startingRewardPoints: String(card.startingRewardPoints ?? 0),
    });
  }
  async function saveEditCard(cardId) {
    try {
      const strategyKey = creditCards.find((c) => c.id === cardId)?.rewardStrategy;
      const isPointsCard = CARD_REWARD_STRATEGIES.find((s) => s.key === strategyKey)?.unit === 'points';
      await updateCreditCardInDb(cardId, {
        billingCycleDay: Math.min(31, Math.max(1, Math.round(Number(editCardDrafts.billingCycleDay)) || 1)),
        dueDateOffsetDays: Math.max(0, Math.round(Number(editCardDrafts.dueDateOffsetDays)) || 0),
        annualMilestoneAnchorMonth: Math.min(12, Math.max(1, Math.round(Number(editCardDrafts.annualMilestoneAnchorMonth)) || 1)),
        annualMilestoneStartingSpend: Math.max(0, Number(editCardDrafts.annualMilestoneStartingSpend) || 0),
        ...(CARD_STRATEGY_DEFAULTS[strategyKey]?.quarterlyMilestoneTarget
          ? {
              quarterlyMilestoneStartingSpend: Math.max(0, Number(editCardDrafts.quarterlyMilestoneStartingSpend) || 0),
              quarterlyMilestoneStartingQuarter: getQuarterBounds(todayISO()).quarterStart,
            }
          : {}),
        startingRewardPoints: isPointsCard ? Math.max(0, Number(editCardDrafts.startingRewardPoints) || 0) : 0,
      });
      setEditingCardId(null);
    } catch (err) {
      setCardMessage(`Failed to save: ${err?.message || err}`);
    }
  }
  function handleDeleteCard(card) {
    Alert.alert(
      `Delete "${card.name}"?`,
      "Its transactions and billing cycle history will stay in storage but won't be reachable from the app anymore.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteCreditCardFromDb(card.id).catch((err) => setCardMessage(`Failed to delete: ${err?.message || err}`)),
        },
      ],
    );
  }

  function startEditRules(card) {
    setEditingRulesCardId(card.id);
    setNewVersionEffectiveFrom(todayISO());
    setNewVersionParams({ ...resolveStrategyParamsForDate(card.strategyParamsHistory, todayISO()) });
  }
  function updateCategoryField(index, field, value) {
    setNewVersionParams((prev) => {
      const cats = [...(prev.categories || [])];
      const current = cats[index];
      const next = { ...current, [field]: value };
      if (field === 'label' && !current.key) {
        next.key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      }
      cats[index] = next;
      return { ...prev, categories: cats };
    });
  }
  function addCategoryRow() {
    setNewVersionParams((prev) => ({
      ...prev,
      categories: [...(prev.categories || []), { key: '', label: '', multiplier: 1, capAmount: null, capPeriod: null }],
    }));
  }
  function removeCategoryRow(index) {
    setNewVersionParams((prev) => ({ ...prev, categories: (prev.categories || []).filter((_, i) => i !== index) }));
  }
  async function saveNewRuleVersion(card) {
    if (!newVersionEffectiveFrom) return;
    setSavingRuleVersion(true);
    try {
      const coercedParams = coerceStrategyParams(card.rewardStrategy, newVersionParams);
      if (coercedParams.categories) {
        coercedParams.categories = coercedParams.categories.filter((c) => c.key && c.label);
      }
      const history = card.strategyParamsHistory || [];
      const withoutSameDate = history.filter((v) => v.effectiveFrom !== newVersionEffectiveFrom);
      const updatedHistory = [...withoutSameDate, { effectiveFrom: newVersionEffectiveFrom, params: coercedParams }]
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      await updateCreditCardInDb(card.id, { strategyParamsHistory: updatedHistory });
      setEditingRulesCardId(null);
    } catch (err) {
      setCardMessage(`Failed to save rule version: ${err?.message || err}`);
    } finally {
      setSavingRuleVersion(false);
    }
  }

  // PIN tab
  const [newPin, setNewPin] = useState('');
  const [pinMessage, setPinMessage] = useState('');

  useEffect(() => {
    if (visible) setNewPin(pinConfig.pin || '');
  }, [visible]);

  async function handleSavePinConfig(enabledOverride = null) {
    const enabled = enabledOverride !== null ? enabledOverride : pinConfig.enabled;
    const cleanPin = newPin.trim();
    if (enabled && cleanPin.length !== 4) {
      setPinMessage('PIN must be exactly 4 digits.');
      return;
    }
    const updated = { pin: cleanPin, enabled };
    await savePinConfigToDb(updated);
    setPinMessage(enabled ? 'Security PIN saved & synced to cloud!' : 'Security PIN disabled.');
  }

  const hasFirebase = isFirebaseConfigured();

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center justify-center px-2.5">
        <View
          className="w-full rounded-2xl bg-paper-card border border-ink/15 overflow-hidden"
          style={{ maxWidth: 576, height: Math.round(windowHeight * 0.92), shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.25, shadowRadius: 30, elevation: 10 }}
        >
        <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-ink/10 bg-paper/60">
          <View className="flex-row items-center gap-2 flex-1">
            <Text className="font-display text-base text-ink" numberOfLines={1}>
              Settings & Configuration
            </Text>
            <View className={`px-2 py-0.5 rounded-full ${hasFirebase ? 'bg-ledger-green/15' : 'bg-mustard/20'}`}>
              <Text className={`font-body-semibold text-[10px] ${hasFirebase ? 'text-ledger-green' : 'text-mustard'}`}>
                {hasFirebase ? 'Synced' : 'Not synced'}
              </Text>
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-full border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-ink">✕</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="border-b border-ink/10 bg-paper/30"
          contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center' }}
          style={{ flexGrow: 0, flexShrink: 0, height: 44 }}
        >
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              className={`px-3 py-3 border-b-2 ${activeTab === t.key ? 'border-ledger-green' : 'border-transparent'}`}
            >
              <Text className={`font-body-semibold text-xs ${activeTab === t.key ? 'text-ledger-green' : 'text-muted-text'}`}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {activeTab === 'categories' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Manage Categories Database</Text>
              <Text className="font-body text-xs text-muted-text mb-3">Categories stored here are synchronized in real-time across devices.</Text>

              <View className="flex-row gap-2 mb-3">
                <Pressable
                  onPress={() => setCategoryLedger('household')}
                  className={`flex-1 min-h-9 rounded-lg items-center justify-center border ${categoryLedger === 'household' ? 'bg-ledger-green border-ledger-green' : 'border-ink/15 bg-paper'}`}
                >
                  <Text className={`font-body-semibold text-xs ${categoryLedger === 'household' ? 'text-white' : 'text-ink'}`}>🏠 Household</Text>
                </Pressable>
                <Pressable
                  onPress={() => setCategoryLedger('travel')}
                  className={`flex-1 min-h-9 rounded-lg items-center justify-center border ${categoryLedger === 'travel' ? 'bg-ledger-green border-ledger-green' : 'border-ink/15 bg-paper'}`}
                >
                  <Text className={`font-body-semibold text-xs ${categoryLedger === 'travel' ? 'text-white' : 'text-ink'}`}>✈️ Travel</Text>
                </Pressable>
              </View>

              <View className="flex-row gap-2 mb-3">
                <TextInput
                  value={newCatName}
                  onChangeText={setNewCatName}
                  placeholder={`New ${categoryLedger} category name...`}
                  className={`${input} flex-1 mb-0 h-11`}
                />
                <Pressable onPress={handleAddCategory} disabled={addingCat || !newCatName.trim()} className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                  <Text className="font-body-semibold text-white text-sm">{addingCat ? 'Saving...' : 'Add'}</Text>
                </Pressable>
              </View>

              <Text className={activeListCaption}>Active Database Categories ({categoriesList.length})</Text>
              <View className="flex-row flex-wrap mt-1">
                {categoriesList.map((cat) => (
                  <Tag key={cat} label={cat} onRemove={() => handleDeleteCategory(cat)} />
                ))}
              </View>
            </View>
          )}

          {activeTab === 'budgets' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Household Category Budgets</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                Pick a category and set a monthly limit - it applies every month, not just this one. Nothing is flagged until you set one. Warns at 80% of the limit, alerts once it's exceeded.
              </Text>
              {budgetMessage ? <Text className="font-body text-xs text-stamp-red mb-3">{budgetMessage}</Text> : null}

              {unbudgetedCategories.length > 0 && (
                <>
                  <View className="mb-3">
                    <PickerField label="Category" value={newBudgetCategory || 'Select a category...'} options={unbudgetedCategories} onChange={setNewBudgetCategory} />
                  </View>
                  <View className="flex-row gap-2 mb-3">
                    <TextInput
                      value={newBudgetAmount}
                      onChangeText={setNewBudgetAmount}
                      keyboardType="decimal-pad"
                      placeholder="Limit (₹)"
                      className={`${input} flex-1 mb-0 h-11`}
                    />
                    <Pressable
                      onPress={handleAddBudget}
                      disabled={!newBudgetCategory || !newBudgetAmount || savingBudgetCat === newBudgetCategory}
                      className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
                    >
                      <Text className="font-body-semibold text-white text-sm">Add</Text>
                    </Pressable>
                  </View>
                </>
              )}
              {categories.household.length === 0 && (
                <Text className="font-body text-xs text-muted-text mb-3">No household categories yet - add some in the Categories tab first.</Text>
              )}
              {categories.household.length > 0 && unbudgetedCategories.length === 0 && (
                <Text className="font-body text-xs text-muted-text mb-3">Every category already has a budget set.</Text>
              )}

              {householdBudgetStatus.map((s) => (
                <View key={s.category} className="mb-4">
                  <View className="flex-row items-center justify-between mb-1">
                    <Text className="font-body-medium text-sm text-ink">{s.category}</Text>
                    <View className="flex-row items-center gap-1.5">
                      <TextInput
                        value={String(budgetDrafts[s.category] ?? '')}
                        onChangeText={(v) => setBudgetDrafts((prev) => ({ ...prev, [s.category]: v }))}
                        onBlur={() => {
                          const amount = Number(budgetDrafts[s.category]);
                          if (amount > 0) persistBudgets({ ...budgetDrafts, [s.category]: amount });
                        }}
                        keyboardType="decimal-pad"
                        className="w-24 min-h-8 font-body text-sm text-ink border border-ink/15 rounded-lg px-2 py-1 bg-paper text-right"
                      />
                      <Pressable onPress={() => handleRemoveBudget(s.category)}>
                        <Text className="font-body-semibold text-xs text-muted-text">✕</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
                    <View
                      className={`h-full rounded-full ${s.pctUsed >= 1 ? 'bg-stamp-red' : s.pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green'}`}
                      style={{ width: `${Math.min(s.pctUsed * 100, 100)}%` }}
                    />
                  </View>
                  <Text className="font-body text-2xs text-muted-text mt-1">
                    {formatCurrency(s.spent)} of {formatCurrency(s.limit)} this month ({Math.round(s.pctUsed * 100)}%)
                  </Text>
                  {s.previous && (
                    <View className="flex-row items-center gap-1 mt-0.5">
                      <View
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          s.previous.pctUsed >= 1 ? 'bg-stamp-red' : s.previous.pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green'
                        }`}
                      />
                      <Text className="font-body text-2xs text-muted-text">
                        Last month: {formatCurrency(s.previous.spent)} ({Math.round(s.previous.pctUsed * 100)}%{s.previous.pctUsed >= 1 ? ' - over' : ''})
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {activeTab === 'recurring' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Recurring Household Expenses</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                Rent, subscriptions, utilities - bills that repeat every month. Each rule auto-creates this month's entry the next time the app is opened; nothing is added before you save the rule.
              </Text>

              <View className="rounded-xl border border-ink/10 bg-paper/60 p-3.5 mb-3">
                <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  <View className="w-full sm:w-[calc(50%-6px)]">
                    <PickerField label="Category" value={newRuleCategory || 'Select a category...'} options={categories.household} onChange={setNewRuleCategory} />
                  </View>
                  <View className="w-full sm:w-[calc(50%-6px)]">
                    <PickerField label="Who pays" value={newRulePayer} options={dbMembers} onChange={setNewRulePayer} />
                  </View>
                </View>
                <View className="flex-row flex-wrap mt-3" style={{ gap: 12 }}>
                  <View className="w-full sm:w-[calc(50%-6px)]">
                    <Text className={label}>Amount (₹)</Text>
                    <TextInput value={newRuleAmount} onChangeText={setNewRuleAmount} keyboardType="decimal-pad" placeholder="0.00" className={input} />
                  </View>
                  <View className="w-full sm:w-[calc(50%-6px)]">
                    <Text className={label}>Day of month</Text>
                    <TextInput value={newRuleDay} onChangeText={setNewRuleDay} keyboardType="number-pad" className={input} />
                  </View>
                </View>
                <View className="mt-3">
                  <PickerField label="Split type" value={newRuleSplitType} options={RULE_SPLIT_TYPE_OPTIONS} onChange={setNewRuleSplitType} />
                </View>
                {newRuleSplitType === 'owed' && (
                  <View className="mt-3">
                    <PickerField label="Owed by" value={newRuleOwedBy || 'Owed by...'} options={dbMembers.filter((m) => m !== newRulePayer)} onChange={setNewRuleOwedBy} />
                  </View>
                )}
                {newRuleSplitType === 'custom' && (
                  <CustomSplitEditor members={dbMembers} total={Number(newRuleAmount) || 0} shares={newRuleShares} onChange={setNewRuleShares} />
                )}
                <View className="mt-3">
                  <Text className={label}>Note (optional)</Text>
                  <TextInput value={newRuleNote} onChangeText={setNewRuleNote} placeholder="e.g. Rent" className={input} />
                </View>

                <Pressable onPress={handleAddRule} disabled={addingRule || !newRuleCategory || !newRuleAmount || newRuleSharesInvalid} className="mt-3 min-h-10 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                  <Text className="font-body-semibold text-white text-sm">{addingRule ? 'Saving...' : 'Add Recurring Rule'}</Text>
                </Pressable>
                {ruleMessage ? <Text className="font-body text-xs text-muted-text mt-3">{ruleMessage}</Text> : null}
              </View>

              {recurringRules.length === 0 ? (
                <Text className="font-body text-xs text-muted-text">No recurring rules yet.</Text>
              ) : (
                recurringRules.map((rule) => (
                  <View key={rule.id} className="rounded-xl border border-ink/10 bg-paper-card px-3.5 py-3 mb-2">
                    <View className="flex-row items-start justify-between gap-2">
                      <Text className="font-body-medium text-sm text-ink flex-1">{rule.category} - {formatCurrency(rule.amount)}</Text>
                      <Pressable onPress={() => handleRemoveRule(rule.id)}>
                        <Text className="font-body-semibold text-xs text-muted-text">✕</Text>
                      </Pressable>
                    </View>
                    <Text className="font-body text-2xs text-muted-text mt-0.5">
                      Every month on day {rule.dayOfMonth} · {rule.payer} pays{rule.note ? ` · ${rule.note}` : ''}
                    </Text>
                  </View>
                ))
              )}
            </View>
          )}

          {activeTab === 'reminders' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Payment Reminders</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                A nudge when the household balance owed crosses an amount you set - in-app only, there's no push notification without a backend.
              </Text>

              <Pressable
                onPress={() => handleReminderToggle(!reminderDraft.enabled)}
                className="flex-row items-center justify-between rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 mb-3"
              >
                <Text className="font-body-medium text-sm text-ink flex-1 mr-2">Remind us about unsettled balances</Text>
                {/* Web uses a plain OS checkbox here, not a pill toggle - the
                    pill Switch look is reserved for Security PIN below, which
                    web also renders as a hand-rolled pill. */}
                <View
                  className={`w-5 h-5 rounded border items-center justify-center ${
                    reminderDraft.enabled ? 'bg-ledger-green border-ledger-green' : 'border-ink/30 bg-paper'
                  }`}
                >
                  {reminderDraft.enabled && <Text className="text-white text-xs">✓</Text>}
                </View>
              </Pressable>

              <View className="flex-row items-center gap-2.5">
                <Text className="font-body text-sm text-ink">Remind when balance exceeds</Text>
                <TextInput
                  value={String(reminderDraft.amountThreshold)}
                  onChangeText={(v) => setReminderDraft((prev) => ({ ...prev, amountThreshold: v }))}
                  onBlur={handleReminderThresholdBlur}
                  editable={reminderDraft.enabled}
                  keyboardType="decimal-pad"
                  placeholder="₹"
                  className={`w-24 min-h-10 font-body text-sm text-ink border border-ink/15 rounded-xl px-3 bg-paper text-center ${!reminderDraft.enabled ? 'opacity-50' : ''}`}
                />
              </View>
              {reminderMessage ? <Text className="font-body text-xs text-muted-text mt-2">{reminderMessage}</Text> : null}
            </View>
          )}

          {activeTab === 'currencies' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Manage Currencies Database</Text>
              <Text className="font-body text-xs text-muted-text mb-3">Currencies stored in the database are selectable for entries and trips.</Text>
              <View className="flex-row gap-2 mb-3">
                <TextInput
                  value={newCurrencyName}
                  onChangeText={(v) => setNewCurrencyName(v.toUpperCase())}
                  placeholder="New Currency Code (e.g. CAD, AUD, CHF)..."
                  className={`${input} flex-1 mb-0 h-11 uppercase`}
                  autoCapitalize="characters"
                />
                <Pressable onPress={handleAddCurrency} disabled={addingCurr || !newCurrencyName.trim()} className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                  <Text className="font-body-semibold text-white text-sm">{addingCurr ? 'Saving...' : 'Add Currency'}</Text>
                </Pressable>
              </View>
              <Text className={activeListCaption}>Active Database Currencies ({currencies.currencies.length})</Text>
              <View className="flex-row flex-wrap">
                {currencies.currencies.map((c) => (
                  <Tag key={c} label={c} onRemove={() => handleDeleteCurrency(c)} labelWeight="font-body-semibold" />
                ))}
              </View>
            </View>
          )}

          {activeTab === 'paymentMethods' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Cash, UPI & accounts</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                Everything an expense can be paid with, shared across Household and every trip - so it only needs adding once. Credit cards are added below and appear in the same picker.
              </Text>
              <Pressable onPress={() => setShowAddMethodForm((v) => !v)} className="self-start mb-3">
                <Text className="font-body-semibold text-xs text-ledger-green">{showAddMethodForm ? 'Hide' : '+ Add another method (UPI, forex account...)'}</Text>
              </Pressable>
              {showAddMethodForm && (
                <View>
              <View className="flex-row gap-2 mb-2">
                <TextInput
                  value={newPaymentMethodName}
                  onChangeText={setNewPaymentMethodName}
                  placeholder="e.g. UPI, Yash Forex"
                  className={`${input} flex-1 mb-0 h-11`}
                />
                <Pressable
                  onPress={handleAddPaymentMethod}
                  disabled={addingPaymentMethod || !newPaymentMethodName.trim()}
                  className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
                >
                  <Text className="font-body-semibold text-white text-sm">{addingPaymentMethod ? 'Saving...' : 'Add'}</Text>
                </Pressable>
              </View>
              <View className="flex-row flex-wrap mb-3" style={{ gap: 8 }}>
                <View className="w-full sm:w-[calc(50%-4px)]">
                  <PickerField
                    label="Type"
                    value={INSTRUMENT_TYPES.find((t) => t.key === newPaymentMethodType)?.label || 'Select type'}
                    options={INSTRUMENT_TYPES.map((t) => t.label)}
                    onChange={(label) => setNewPaymentMethodType(INSTRUMENT_TYPES.find((t) => t.label === label)?.key || '')}
                  />
                </View>
                <View className="w-full sm:w-[calc(50%-4px)]">
                  <PickerField label="Owner" value={newPaymentMethodOwner} options={[SHARED_OWNER_LABEL, ...dbMembers]} onChange={setNewPaymentMethodOwner} />
                </View>
              </View>
                </View>
              )}
              <Text className={activeListCaption}>Active Payment Methods ({paymentMethodsData.rawDocs.length || dbPaymentMethods.length})</Text>
              <View className="flex-row flex-wrap mt-1 mb-5">
                {(paymentMethodsData.rawDocs.length ? paymentMethodsData.rawDocs : dbPaymentMethods.map((name) => ({ id: name, name }))).map((d) => {
                  const rawTypeLabel = INSTRUMENT_TYPES.find((t) => t.key === normalizeInstrumentType(d.type, d.name))?.label;
                  const typeLabel = rawTypeLabel && rawTypeLabel.toLowerCase() !== d.name.toLowerCase() ? rawTypeLabel : null;
                  const detail = [typeLabel, d.owner].filter(Boolean).join(' · ');
                  if (editingMethod?.id === d.id) {
                    return (
                      <View key={d.id} className="w-full rounded-xl border border-ink/15 bg-paper-card p-3 mb-2" style={{ gap: 8 }}>
                        <TextInput
                          value={editingMethod.name}
                          onChangeText={(v) => setEditingMethod((p) => ({ ...p, name: v }))}
                          className={`${input} mb-0`}
                        />
                        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                          <View className="w-full sm:w-[calc(50%-4px)]">
                            <PickerField
                              label="Type"
                              value={INSTRUMENT_TYPES.find((t) => t.key === editingMethod.type)?.label || 'Select type'}
                              options={INSTRUMENT_TYPES.map((t) => t.label)}
                              onChange={(label) => setEditingMethod((p) => ({ ...p, type: INSTRUMENT_TYPES.find((t) => t.label === label)?.key || '' }))}
                            />
                          </View>
                          <View className="w-full sm:w-[calc(50%-4px)]">
                            <PickerField label="Owner" value={editingMethod.owner} options={[SHARED_OWNER_LABEL, ...dbMembers]} onChange={(v) => setEditingMethod((p) => ({ ...p, owner: v }))} />
                          </View>
                        </View>
                        <Text className="font-body text-2xs text-muted-text">
                          Renaming only affects new entries - older ones keep the name they were saved with.
                        </Text>
                        <View className="flex-row gap-2">
                          <Pressable onPress={() => setEditingMethod(null)} className="flex-1 min-h-10 rounded-lg border border-ink/15 items-center justify-center">
                            <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
                          </Pressable>
                          <Pressable onPress={handleSaveEditedMethod} className="flex-1 min-h-10 rounded-lg bg-ledger-green items-center justify-center">
                            <Text className="font-body-semibold text-xs text-white">Save</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  }
                  return (
                    <Tag
                      key={d.id}
                      label={`${creditCards.some((c) => c.paymentMethodId === d.id) ? '💳 ' : ''}${detail ? `${d.name} (${detail})` : d.name}`}
                      removable={d.name !== 'Cash'}
                      onRemove={() => handleDeletePaymentMethod(d.name)}
                      onEdit={
                        paymentMethodsData.rawDocs.length
                          ? () => setEditingMethod({
                              id: d.id,
                              name: d.name,
                              type: normalizeInstrumentType(d.type, d.name),
                              owner: d.owner || SHARED_OWNER_LABEL,
                            })
                          : undefined
                      }
                    />
                  );
                })}
              </View>
            </View>
          )}

          {activeTab === 'paymentMethods' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Credit Cards</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                Every reward rule below was cross-checked against each bank's current terms, not guessed from a spreadsheet formula - tune the numbers here if a card's real terms change.
              </Text>

              {unlinkedCards.length > 0 && (
                <View className="rounded-xl border border-mustard/40 bg-mustard/10 p-3 mb-3">
                  <Text className="font-body-semibold text-xs text-ink mb-1">
                    {unlinkedCards.length} card{unlinkedCards.length > 1 ? 's' : ''} not linked to a payment method
                  </Text>
                  <Text className="font-body text-2xs text-muted-text mb-2">
                    {unlinkedCards.map((c) => c.name).join(', ')} won't show in the entry pickers until linked. Linking matches by name, or creates the missing Credit payment method.
                  </Text>
                  <Pressable
                    onPress={handleLinkExistingCards}
                    disabled={linkingCards}
                    className="self-start min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
                  >
                    <Text className="font-body-semibold text-xs text-white">{linkingCards ? 'Linking...' : 'Link now'}</Text>
                  </Pressable>
                </View>
              )}

              <View className="rounded-xl border border-ink/10 bg-paper-card mb-3 overflow-hidden">
                <Pressable onPress={() => setShowAddCardForm((v) => !v)} className="flex-row items-center justify-between px-3.5 py-3">
                  <Text className="font-body-semibold text-sm text-ink">💳 Add a card</Text>
                  <Text className="font-body-semibold text-xs text-ledger-green">{showAddCardForm ? 'Collapse' : 'Expand'}</Text>
                </Pressable>

                {showAddCardForm && (
                  <View className="px-3.5 pb-4 pt-1 border-t border-ink/10">
                    <Text className={sectionLabel}>Card details</Text>
                    {linkableMethods.length === 0 ? (
                      <Text className="font-body text-xs text-stamp-red mb-3">
                        A card is linked to a payment method - first add one above with type Credit (its name becomes the card's name), then come back here.
                      </Text>
                    ) : (
                      <PickerField
                        label="Payment method (Credit)"
                        value={newCardMethodName || 'Select a payment method...'}
                        options={linkableMethods.map((d) => d.name)}
                        onChange={setNewCardMethodName}
                      />
                    )}
                    <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                      {!selectedCardMethod?.owner && (
                        <View className="w-full sm:w-[calc(50%-6px)]">
                          <PickerField label="Owner" value={newCardOwner} options={dbMembers} onChange={setNewCardOwner} />
                        </View>
                      )}
                      <View className="w-full sm:w-[calc(50%-6px)]">
                        <PickerField
                          label="Reward strategy"
                          value={newCardStrategy}
                          options={CARD_REWARD_STRATEGIES.map((s) => ({ value: s.key, label: s.label }))}
                          onChange={handleNewCardStrategyChange}
                        />
                      </View>
                    </View>

                    <Text className={`${sectionLabel} mt-3 pt-3 border-t border-ink/10`}>Billing cycle</Text>
                    <View className="flex-row flex-wrap mt-2" style={{ gap: 12 }}>
                      <View className="w-full sm:w-[calc(50%-6px)]">
                        <Text className={label}>Billing cycle day</Text>
                        <TextInput value={newCardBillingDay} onChangeText={setNewCardBillingDay} keyboardType="number-pad" className={input} />
                      </View>
                      <View className="w-full sm:w-[calc(50%-6px)]">
                        <Text className={label}>Due date offset (days)</Text>
                        <TextInput value={newCardDueOffset} onChangeText={setNewCardDueOffset} keyboardType="number-pad" className={input} />
                      </View>
                    </View>

                    <Text className={`${sectionLabel} mt-3 pt-3 border-t border-ink/10`}>Milestone tracking</Text>
                    <Text className="font-body text-2xs text-muted-text mb-2">
                      The annual milestone (fee waiver / bonus) runs on the card's own 12-month cycle from the month below, not
                      the calendar year. Adding this card partway through that period? Use the spend/points fields to carry over
                      what already happened before you started tracking here.
                    </Text>
                    <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                      <View className="w-full sm:w-[calc(50%-6px)]">
                        <PickerField label="Annual milestone starts from" value={newCardAnnualAnchorMonth} options={MONTH_OPTIONS} onChange={setNewCardAnnualAnchorMonth} />
                      </View>
                      <View className="w-full sm:w-[calc(50%-6px)]">
                        <Text className={label}>Spend already counted this period (₹)</Text>
                        <TextInput value={newCardAnnualStartingSpend} onChangeText={setNewCardAnnualStartingSpend} keyboardType="decimal-pad" placeholder="0" className={input} />
                      </View>
                      {CARD_STRATEGY_DEFAULTS[newCardStrategy]?.quarterlyMilestoneTarget ? (
                        <View className="w-full sm:w-[calc(50%-6px)]">
                          <Text className={label}>Spend already counted this quarter (₹)</Text>
                          <TextInput value={newCardQuarterlyStartingSpend} onChangeText={setNewCardQuarterlyStartingSpend} keyboardType="decimal-pad" placeholder="0" className={input} />
                        </View>
                      ) : null}
                      {CARD_REWARD_STRATEGIES.find((s) => s.key === newCardStrategy)?.unit === 'points' && (
                        <View className="w-full sm:w-[calc(50%-6px)]">
                          <Text className={label}>Starting reward points balance</Text>
                          <TextInput value={newCardStartingPoints} onChangeText={setNewCardStartingPoints} keyboardType="decimal-pad" placeholder="0" className={input} />
                        </View>
                      )}
                    </View>

                    <Text className={`${sectionLabel} mt-3 pt-3 border-t border-ink/10`}>Reward rules</Text>
                    <View className="flex-row flex-wrap mt-2" style={{ gap: 12 }}>
                      {(CARD_PARAM_FIELDS[newCardStrategy] || []).map((field) => (
                        <View key={field.key} className="w-full sm:w-[calc(50%-6px)]">
                          <Text className={label}>{field.label}</Text>
                          <TextInput
                            value={String(newCardParams[field.key] ?? '')}
                            onChangeText={(v) => setNewCardParams((prev) => ({ ...prev, [field.key]: v }))}
                            keyboardType={field.isText ? 'default' : 'decimal-pad'}
                            className={input}
                          />
                        </View>
                      ))}
                    </View>
                    {newCardStrategy === 'hdfc_diners_slab_milestone' && (
                      <View className="flex-row flex-wrap mb-2">
                        {(newCardParams.categories || []).map((c) => (
                          <View key={c.key} className="rounded-full border border-ink/10 bg-paper px-2 py-1 mr-1.5 mb-1.5">
                            <Text className="font-body text-2xs text-muted-text">
                              {c.label}: {c.multiplier}× {c.capAmount ? `(cap ${c.capAmount}/${c.capPeriod})` : ''}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <Pressable onPress={handleAddCard} disabled={addingCard || !selectedCardMethod} className="min-h-10 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                      <Text className="font-body-semibold text-white text-sm">{addingCard ? 'Saving...' : 'Add Card'}</Text>
                    </Pressable>
                    {cardMessage ? <Text className="font-body text-xs text-muted-text mt-2">{cardMessage}</Text> : null}
                  </View>
                )}
              </View>

              {creditCards.length === 0 ? (
                <Text className="font-body text-xs text-muted-text">No cards yet - add your first one above.</Text>
              ) : (
                creditCards.map((card) => {
                  const strategyMeta = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy);
                  const strategyLabel = strategyMeta?.label || card.rewardStrategy;
                  const strategyIcon = strategyMeta?.unit === 'points' ? '🎫' : '💰';
                  const isEditing = editingCardId === card.id;
                  return (
                    <View key={card.id} className="rounded-xl border border-ink/10 bg-paper-card px-3.5 py-3 mb-2">
                      {isEditing ? (
                        <View>
                          <Text className="font-body text-2xs text-muted-text mb-2">
                            Name and owner are edited on this card's payment method, above.
                          </Text>
                          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                            <View className="w-full sm:w-[calc(33.333%-5.333px)]">
                              <Text className={label}>Billing day</Text>
                              <TextInput value={editCardDrafts.billingCycleDay} onChangeText={(v) => setEditCardDrafts((p) => ({ ...p, billingCycleDay: v }))} keyboardType="number-pad" className={input} />
                            </View>
                            <View className="w-full sm:w-[calc(33.333%-5.333px)]">
                              <Text className={label}>Due offset (days)</Text>
                              <TextInput value={editCardDrafts.dueDateOffsetDays} onChangeText={(v) => setEditCardDrafts((p) => ({ ...p, dueDateOffsetDays: v }))} keyboardType="number-pad" className={input} />
                            </View>
                          </View>
                          <View className="flex-row flex-wrap mt-3" style={{ gap: 8 }}>
                            <View className="w-full sm:w-[calc(33.333%-5.333px)]">
                              <PickerField label="Annual milestone from" value={editCardDrafts.annualMilestoneAnchorMonth} options={MONTH_OPTIONS} onChange={(v) => setEditCardDrafts((p) => ({ ...p, annualMilestoneAnchorMonth: v }))} />
                            </View>
                            <View className="w-full sm:w-[calc(33.333%-5.333px)]">
                              <Text className={label}>Spend counted so far (₹)</Text>
                              <TextInput value={editCardDrafts.annualMilestoneStartingSpend} onChangeText={(v) => setEditCardDrafts((p) => ({ ...p, annualMilestoneStartingSpend: v }))} keyboardType="decimal-pad" className={input} />
                            </View>
                            {CARD_STRATEGY_DEFAULTS[card.rewardStrategy]?.quarterlyMilestoneTarget ? (
                              <View className="w-full sm:w-[calc(33.333%-5.333px)]">
                                <Text className={label}>Quarter spend counted so far (₹)</Text>
                                <TextInput value={editCardDrafts.quarterlyMilestoneStartingSpend} onChangeText={(v) => setEditCardDrafts((p) => ({ ...p, quarterlyMilestoneStartingSpend: v }))} keyboardType="decimal-pad" className={input} />
                              </View>
                            ) : null}
                            {strategyMeta?.unit === 'points' && (
                              <View className="w-full sm:w-[calc(33.333%-5.333px)]">
                                <Text className={label}>Starting points balance</Text>
                                <TextInput value={editCardDrafts.startingRewardPoints} onChangeText={(v) => setEditCardDrafts((p) => ({ ...p, startingRewardPoints: v }))} keyboardType="decimal-pad" className={input} />
                              </View>
                            )}
                          </View>
                          <View className="flex-row gap-2 mt-3">
                            <Pressable onPress={() => saveEditCard(card.id)} className="px-3 py-2 rounded-lg bg-ledger-green">
                              <Text className="font-body-semibold text-xs text-white">Save</Text>
                            </Pressable>
                            <Pressable onPress={() => setEditingCardId(null)} className="px-3 py-2 rounded-lg border border-ink/15">
                              <Text className="font-body-semibold text-xs text-muted-text">Cancel</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <View className="flex-row items-center justify-between gap-2">
                          <View className="flex-1 min-w-0">
                            <Text className="font-body-semibold text-sm text-ink" numberOfLines={1}>{strategyIcon} {card.name}</Text>
                            <View className="flex-row flex-wrap gap-1.5 mt-1">
                              <View className="rounded-md border border-ink/10 bg-paper px-2 py-0.5"><Text className="font-body-medium text-2xs text-muted-text">{card.owner}</Text></View>
                              <View className="rounded-md border border-ink/10 bg-paper px-2 py-0.5"><Text className="font-body-medium text-2xs text-muted-text">{strategyLabel}</Text></View>
                              <View className="rounded-md border border-ink/10 bg-paper px-2 py-0.5"><Text className="font-body-medium text-2xs text-muted-text">Billing day {card.billingCycleDay}</Text></View>
                            </View>
                          </View>
                          <View className="flex-row items-center gap-1 shrink-0">
                            <Pressable
                              onPress={() => (editingRulesCardId === card.id ? setEditingRulesCardId(null) : startEditRules(card))}
                              className={`px-2.5 py-1 rounded-full ${editingRulesCardId === card.id ? 'bg-ledger-green' : 'bg-ledger-green/10'}`}
                            >
                              <Text className={`font-body-semibold text-2xs ${editingRulesCardId === card.id ? 'text-white' : 'text-ledger-green'}`}>🗓 Rules</Text>
                            </Pressable>
                            <Pressable onPress={() => startEditCard(card)} hitSlop={6} className="min-w-8 min-h-8 items-center justify-center">
                              <Text className="text-xs text-muted-text">✎</Text>
                            </Pressable>
                            <Pressable onPress={() => handleDeleteCard(card)} hitSlop={6} className="min-w-8 min-h-8 items-center justify-center">
                              <Text className="text-xs text-stamp-red/70">✕</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}

                      {editingRulesCardId === card.id && (
                        <View className="rounded-lg border border-ink/10 bg-paper px-3 py-3 mt-2.5">
                          <Text className={sectionLabel}>Rule history (oldest to newest)</Text>
                          {[...(card.strategyParamsHistory || [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).map((version) => (
                            <View key={version.effectiveFrom} className="rounded-lg border border-ink/10 bg-paper-card px-2.5 py-2 mb-1.5">
                              <Text className="font-body-semibold text-xs text-ink mb-0.5">{version.effectiveFrom}</Text>
                              {(CARD_PARAM_FIELDS[card.rewardStrategy] || []).filter((f) => !f.isText).map((f) => (
                                <Text key={f.key} className="font-body text-2xs text-muted-text">
                                  {f.label}: <Text className="font-body-semibold text-ink">{version.params[f.key] ?? '-'}</Text>
                                </Text>
                              ))}
                            </View>
                          ))}

                          <Text className={`${sectionLabel} mt-2`}>Add a new rule version</Text>
                          <Text className={label}>Effective from</Text>
                          <DateField value={newVersionEffectiveFrom} onChange={setNewVersionEffectiveFrom} className={input} />
                          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                            {(CARD_PARAM_FIELDS[card.rewardStrategy] || []).map((field) => (
                              <View key={field.key} className="w-full sm:w-[calc(50%-4px)]">
                                <Text className={label}>{field.label}</Text>
                                <TextInput
                                  value={String(newVersionParams[field.key] ?? '')}
                                  onChangeText={(v) => setNewVersionParams((prev) => ({ ...prev, [field.key]: v }))}
                                  keyboardType={field.isText ? 'default' : 'decimal-pad'}
                                  className={input}
                                />
                              </View>
                            ))}
                          </View>

                          {card.rewardStrategy === 'hdfc_diners_slab_milestone' && (
                            <View className="pt-2 border-t border-ink/10 mb-3">
                              <Text className={sectionLabel}>Categories</Text>
                              <Text className="font-body text-2xs text-muted-text mb-2">
                                Renaming a category is safe - it doesn't touch past transactions. Removing one that past
                                transactions still use falls back to the base 1x rate for them, same as an unrecognized category.
                              </Text>
                              {(newVersionParams.categories || []).map((cat, i) => (
                                <View key={i} className="rounded-lg border border-ink/10 bg-paper-card px-2.5 py-2.5 mb-2">
                                  <View className="flex-row items-center gap-2 mb-2">
                                    <TextInput
                                      value={cat.label}
                                      onChangeText={(v) => updateCategoryField(i, 'label', v)}
                                      placeholder="Category name"
                                      className={`${input} flex-1 mb-0 font-body-semibold`}
                                    />
                                    <Pressable onPress={() => removeCategoryRow(i)} hitSlop={6}>
                                      <Text className="text-xs text-stamp-red/70">✕</Text>
                                    </Pressable>
                                  </View>
                                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                                    <View className="w-[calc(33.333%-5.333px)]">
                                      <Text className={label}>Multiplier</Text>
                                      <TextInput
                                        value={String(cat.multiplier ?? '')}
                                        onChangeText={(v) => updateCategoryField(i, 'multiplier', v === '' ? '' : Number(v))}
                                        keyboardType="decimal-pad"
                                        className={input}
                                      />
                                    </View>
                                    <View className="w-[calc(33.333%-5.333px)]">
                                      <Text className={label}>Cap amount</Text>
                                      <TextInput
                                        value={cat.capAmount == null ? '' : String(cat.capAmount)}
                                        onChangeText={(v) => updateCategoryField(i, 'capAmount', v === '' ? null : Number(v))}
                                        keyboardType="decimal-pad"
                                        placeholder="None"
                                        className={input}
                                      />
                                    </View>
                                    <View className="w-[calc(33.333%-5.333px)]">
                                      <PickerField label="Cap period" value={cat.capPeriod ?? ''} options={CAP_PERIOD_OPTIONS} onChange={(v) => updateCategoryField(i, 'capPeriod', v === '' ? null : v)} />
                                    </View>
                                  </View>
                                </View>
                              ))}
                              <Pressable onPress={addCategoryRow} className="min-h-9 rounded-lg border border-dashed border-ink/20 items-center justify-center">
                                <Text className="font-body-semibold text-xs text-muted-text">+ Add category</Text>
                              </Pressable>
                            </View>
                          )}

                          <Text className="font-body text-2xs text-muted-text mb-2">
                            Transactions on or after this date use these rules; earlier transactions keep using whichever rule was active on their own date.
                          </Text>
                          <View className="flex-row gap-2">
                            <Pressable onPress={() => saveNewRuleVersion(card)} disabled={savingRuleVersion || !newVersionEffectiveFrom} className="px-3 py-2 rounded-lg bg-ledger-green disabled:opacity-50">
                              <Text className="font-body-semibold text-xs text-white">{savingRuleVersion ? 'Saving...' : 'Save new version'}</Text>
                            </Pressable>
                            <Pressable onPress={() => setEditingRulesCardId(null)} className="px-3 py-2 rounded-lg border border-ink/15">
                              <Text className="font-body-semibold text-xs text-muted-text">Cancel</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          )}

          {activeTab === 'members' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Manage Members Database</Text>
              <Text className="font-body text-xs text-muted-text mb-3">Persons/Partners in your household ledger. Stored dynamically in database.</Text>
              <View className="flex-row gap-2 mb-3">
                <TextInput value={newMemberName} onChangeText={setNewMemberName} placeholder="New Member Name..." className={`${input} flex-1 mb-0 h-11`} />
                <Pressable onPress={handleAddMember} disabled={addingMember || !newMemberName.trim()} className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                  <Text className="font-body-semibold text-white text-sm">{addingMember ? 'Saving...' : 'Add Member'}</Text>
                </Pressable>
              </View>
              <Text className={activeListCaption}>Active Database Members ({dbMembers.length})</Text>
              <View className="flex-row flex-wrap">
                {dbMembers.map((m) => (
                  <Tag key={m} label={m} onRemove={() => handleDeleteMember(m)} labelWeight="font-body-semibold" />
                ))}
              </View>
            </View>
          )}

          {activeTab === 'database' && (
            <View>
              <View className="p-4 rounded-xl border border-ink/15 bg-paper">
                <View className="flex-row items-center justify-between gap-2 mb-2">
                  <Text className="font-body-semibold text-sm text-ink">Sync Status</Text>
                  <View className={`px-2.5 py-0.5 rounded-full border ${hasFirebase ? 'bg-ledger-green/15 border-ledger-green/30' : 'bg-mustard/20 border-mustard/40'}`}>
                    <Text className={`font-body-semibold text-xs ${hasFirebase ? 'text-ledger-green' : 'text-mustard'}`}>
                      {hasFirebase ? 'Synced' : 'Not synced'}
                    </Text>
                  </View>
                </View>
                <Text className="font-body text-xs text-muted-text">
                  {hasFirebase
                    ? 'Your expense entries, categories, currencies, and members are synchronized live across all active devices.'
                    : 'Your entries, categories, currencies, and members are only saved on this device. Ask whoever set up the app to help connect it to shared cloud storage so everyone sees the same data.'}
                </Text>
              </View>
            </View>
          )}

          {activeTab === 'export' && (
            <View className="gap-3">
              <View>
                <Text className="font-body-semibold text-sm text-ink mb-0.5">Export & Backup</Text>
                <Text className="font-body text-xs text-muted-text">
                  This is the only copy of this data. Download it periodically, and definitely before making any
                  large change - a CSV per ledger for spreadsheets, or a full JSON backup of everything.
                </Text>
              </View>
              <View className="p-4 rounded-xl border border-ink/15 bg-paper gap-2.5">
                <Text className="font-body-semibold text-sm text-ink">Ledger CSVs</Text>
                <View className="flex-row flex-wrap gap-2">
                  <Pressable
                    onPress={handleExportHouseholdCsv}
                    disabled={householdEntries.length === 0}
                    className="min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
                  >
                    <Text className="font-body-semibold text-xs text-white">Household CSV ({householdEntries.length})</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleExportTravelCsv}
                    disabled={travelEntries.length === 0}
                    className="min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
                  >
                    <Text className="font-body-semibold text-xs text-white">Travel CSV ({travelEntries.length})</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleExportCardsCsv}
                    disabled={cardTransactions.length === 0}
                    className="min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
                  >
                    <Text className="font-body-semibold text-xs text-white">Card Transactions CSV ({cardTransactions.length})</Text>
                  </Pressable>
                </View>
              </View>
              <View className="p-4 rounded-xl border border-ink/15 bg-paper gap-2.5">
                <Text className="font-body-semibold text-sm text-ink">Full Backup</Text>
                <Text className="font-body text-xs text-muted-text">
                  Every entry, trip, card, transaction, category, currency, member, budget, and recurring rule as
                  one JSON file.
                </Text>
                <Pressable
                  onPress={handleExportFullBackup}
                  className="self-start min-h-10 px-3.5 rounded-lg border border-ledger-green/40 bg-ledger-green/10 items-center justify-center"
                >
                  <Text className="font-body-semibold text-xs text-ledger-green">Download Full Backup (JSON)</Text>
                </Pressable>
              </View>
            </View>
          )}

          {activeTab === 'appearance' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">Appearance</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                A per-device preference, not synced to the other person's phone - pick whichever suits this
                screen's lighting.
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => handleSetColorScheme('light')}
                  className={`flex-1 min-h-9 rounded-lg items-center justify-center border ${colorScheme === 'light' ? 'bg-ledger-green border-ledger-green' : 'border-ink/15 bg-paper'}`}
                >
                  <Text className={`font-body-semibold text-xs ${colorScheme === 'light' ? 'text-white' : 'text-ink'}`}>☀️ Light</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleSetColorScheme('dark')}
                  className={`flex-1 min-h-9 rounded-lg items-center justify-center border ${colorScheme === 'dark' ? 'bg-ledger-green border-ledger-green' : 'border-ink/15 bg-paper'}`}
                >
                  <Text className={`font-body-semibold text-xs ${colorScheme === 'dark' ? 'text-white' : 'text-ink'}`}>🌙 Dark</Text>
                </Pressable>
              </View>
            </View>
          )}

          {activeTab === 'security' && (
            <View>
              <Text className="font-body-semibold text-sm text-ink mb-0.5">App Passcode & Security PIN</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                Set a 4-digit security PIN to restrict access to your expense entries on this device.
              </Text>
              {pinMessage ? (
                <View className="p-3 rounded-xl bg-ledger-green/10 border border-ledger-green/30 mb-3">
                  <Text className="font-body-semibold text-xs text-ledger-green">{pinMessage}</Text>
                </View>
              ) : null}

              <View className="p-4 rounded-xl border border-ink/15 bg-paper">
                <View className="flex-row items-center justify-between gap-3 mb-4">
                  <View className="flex-1">
                    <Text className="font-body-semibold text-sm text-ink">Require PIN Protection</Text>
                    <Text className="font-body text-xs text-muted-text">Prompt for 4-digit PIN upon entering Splitkhata</Text>
                  </View>
                  <Switch
                    value={pinConfig.enabled}
                    onValueChange={(v) => handleSavePinConfig(v)}
                    trackColor={{
                      false: colorScheme === 'dark' ? '#5A6885' : '#C9C5B8',
                      true: colorScheme === 'dark' ? '#4FB3A0' : '#3D7068',
                    }}
                    thumbColor={colorScheme === 'dark' ? '#EDE6D3' : '#FFFFFF'}
                    ios_backgroundColor={colorScheme === 'dark' ? '#5A6885' : '#C9C5B8'}
                  />
                </View>

                <View className="pt-3 border-t border-ink/10">
                  <Text className="font-body-semibold text-xs text-ink mb-2">Set / Change 4-Digit Security PIN</Text>
                  <View className="flex-row gap-2">
                    <TextInput
                      value={newPin}
                      onChangeText={(v) => setNewPin(v.replace(/\D/g, '').slice(0, 4))}
                      placeholder="e.g. 1234"
                      keyboardType="number-pad"
                      secureTextEntry
                      maxLength={4}
                      className="flex-1 min-w-0 font-mono-bold text-base text-ink border border-ink/15 rounded-xl px-3.5 py-2.5 bg-paper tracking-widest"
                      style={{ minWidth: 0 }}
                    />
                    <Pressable onPress={() => handleSavePinConfig()} disabled={newPin.length !== 4} className="min-h-11 px-5 shrink-0 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                      <Text className="font-body-semibold text-white text-sm">Save PIN</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        <View className="px-4 py-3 border-t border-ink/10 bg-paper/80">
          <Pressable onPress={onClose} className="min-h-11 rounded-xl bg-ledger-green items-center justify-center">
            <Text className="font-body-semibold text-white">Done</Text>
          </Pressable>
        </View>
        </View>
      </View>
    </Modal>
  );
}
