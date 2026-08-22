import { useMemo, useState } from 'react';
import {
  getPinConfig,
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
} from '../utils';
import {
  addCategoryToDb,
  deleteCategoryFromDb,
  addCurrencyToDb,
  deleteCurrencyFromDb,
  addMemberToDb,
  deleteMemberFromDb,
  isFirebaseConfigured,
  savePinConfigToDb,
  saveHouseholdBudgetsToDb,
  saveRecurringRulesToDb,
  savePaymentReminderConfigToDb,
  addCreditCardToDb,
  updateCreditCardInDb,
  deleteCreditCardFromDb,
  seedSampleExpenses,
  wipeAllExpenses,
} from '../firebase';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Which of a strategy's numeric params are worth exposing as an editable
// field when adding/tuning a card - `categories` (Diners' nested
// per-category list) stays at its verified-against-T&C default rather than
// getting a bespoke nested-array editor for a single card shape.
const CARD_PARAM_FIELDS = {
  hdfc_diners_slab_milestone: [
    { key: 'pointsPerUnit', label: 'Points per unit' },
    { key: 'unitAmount', label: 'Unit amount (₹)' },
    { key: 'cycleCap', label: 'Overall points cap / cycle' },
    { key: 'quarterlyMilestoneTarget', label: 'Quarterly milestone spend (₹)' },
    { key: 'quarterlyMilestoneBonus', label: 'Quarterly milestone bonus points' },
    { key: 'annualMilestoneTarget', label: 'Annual milestone spend (₹)' },
    { key: 'annualMilestoneLabel', label: 'Annual milestone reward', isText: true },
  ],
  sbi_two_channel_cashback: [
    { key: 'onlineRate', label: 'Online rate (%)' },
    { key: 'offlineRate', label: 'Offline rate (%)' },
    { key: 'onlineCycleCap', label: 'Online cap / cycle (₹)' },
    { key: 'offlineCycleCap', label: 'Offline cap / cycle (₹)' },
    { key: 'minTransaction', label: 'Minimum transaction to earn (₹)' },
    { key: 'annualMilestoneTarget', label: 'Annual fee-waiver spend (₹)' },
    { key: 'annualMilestoneLabel', label: 'Annual milestone reward', isText: true },
  ],
  hsbc_tiered_cashback_aggregate: [
    { key: 'bonusRate', label: 'Bonus category rate (%)' },
    { key: 'bonusMonthlyCap', label: 'Bonus cap / month (₹)' },
    { key: 'baseRate', label: 'Base rate (%)' },
    { key: 'annualMilestoneTarget', label: 'Annual fee-waiver spend (₹)' },
    { key: 'annualMilestoneLabel', label: 'Annual milestone reward', isText: true },
  ],
  axis_supermoney_dual_pool: [
    { key: 'baseRate', label: 'Base rate (%)' },
    { key: 'bonusRate', label: 'Super.money rate (%)' },
    { key: 'minTransaction', label: 'Minimum transaction to earn (₹)' },
    { key: 'bonusFloor', label: 'Bonus pool floor (₹)' },
  ],
  hsbc_premier_flat_capped: [
    { key: 'baseRate', label: 'Base rate (%)' },
    { key: 'categoryMonthlyCap', label: 'Capped-category spend / month (₹)' },
    { key: 'travelBonusMonthlyCap', label: 'Travel with Points cap / month (pts)' },
  ],
};

// Numeric strategy params come back out of number inputs as strings -
// coerce everything CARD_PARAM_FIELDS marks numeric so computeCardCycleReward
// gets real numbers to do math on, not string concatenation bugs. Text
// fields (e.g. annualMilestoneLabel) and the Diners category list stay as-is
// - Number("Annual fee waived") is NaN, not a number worth coercing toward.
function coerceStrategyParams(strategyKey, rawParams) {
  const textFieldKeys = new Set((CARD_PARAM_FIELDS[strategyKey] || []).filter((f) => f.isText).map((f) => f.key));
  return Object.fromEntries(
    Object.entries(rawParams).map(([k, v]) => [
      k,
      k === 'categories' || textFieldKeys.has(k) ? v : (v === '' || v == null ? null : Number(v)),
    ]),
  );
}

export default function SettingsModal({
  onClose,
  deviceName,
  onChangeDeviceName,
  dbCategories,
  rawCategoryDocs,
  dbCurrencies = [],
  rawCurrencyDocs = [],
  dbMembers = [],
  rawMemberDocs = [],
  activeLedger = 'household',
  householdBudgets = {},
  householdEntries = [],
  recurringRules = [],
  reminderConfig = { enabled: true, amountThreshold: DEFAULT_PAYMENT_REMINDER_THRESHOLD },
  creditCards = [],
}) {
  const [activeTab, setActiveTab] = useState('categories');
  const [categoryLedger, setCategoryLedger] = useState(activeLedger);
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  const [newCurrencyName, setNewCurrencyName] = useState('');
  const [addingCurr, setAddingCurr] = useState(false);

  const [newMemberName, setNewMemberName] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const [pinConfig, setPinConfigState] = useState(() => getPinConfig());
  const [newPin, setNewPin] = useState(pinConfig.pin || '');
  const [pinMessage, setPinMessage] = useState('');

  const [budgetDrafts, setBudgetDrafts] = useState(() => ({ ...householdBudgets }));
  const [newBudgetCategory, setNewBudgetCategory] = useState('');
  const [newBudgetAmount, setNewBudgetAmount] = useState('');
  const [savingBudgetCat, setSavingBudgetCat] = useState('');
  const [budgetMessage, setBudgetMessage] = useState('');

  const [newRuleCategory, setNewRuleCategory] = useState('');
  const [newRuleAmount, setNewRuleAmount] = useState('');
  const [newRuleDay, setNewRuleDay] = useState('1');
  const [newRulePayer, setNewRulePayer] = useState(dbMembers[0] || '');
  const [newRuleSplitType, setNewRuleSplitType] = useState('shared');
  const [newRuleOwedBy, setNewRuleOwedBy] = useState('');
  const [newRuleNote, setNewRuleNote] = useState('');
  const [addingRule, setAddingRule] = useState(false);
  const [ruleMessage, setRuleMessage] = useState('');

  const [reminderDraft, setReminderDraft] = useState(() => ({ ...reminderConfig }));
  const [reminderMessage, setReminderMessage] = useState('');

  const [newCardName, setNewCardName] = useState('');
  const [newCardOwner, setNewCardOwner] = useState(dbMembers[0] || '');
  const [newCardStrategy, setNewCardStrategy] = useState(CARD_REWARD_STRATEGIES[0].key);
  const [newCardParams, setNewCardParams] = useState(() => ({ ...CARD_STRATEGY_DEFAULTS[CARD_REWARD_STRATEGIES[0].key] }));
  const [newCardBillingDay, setNewCardBillingDay] = useState('1');
  const [newCardDueOffset, setNewCardDueOffset] = useState('20');
  const [newCardAnnualAnchorMonth, setNewCardAnnualAnchorMonth] = useState('1');
  const [newCardAnnualStartingSpend, setNewCardAnnualStartingSpend] = useState('0');
  const [newCardStartingPoints, setNewCardStartingPoints] = useState('0');
  const [addingCard, setAddingCard] = useState(false);
  const [cardMessage, setCardMessage] = useState('');
  const [editingCardId, setEditingCardId] = useState(null);
  const [editCardDrafts, setEditCardDrafts] = useState({});
  const [editingRulesCardId, setEditingRulesCardId] = useState(null);
  const [newVersionEffectiveFrom, setNewVersionEffectiveFrom] = useState(todayISO());
  const [newVersionParams, setNewVersionParams] = useState({});
  const [savingRuleVersion, setSavingRuleVersion] = useState(false);
  const [showAddCardForm, setShowAddCardForm] = useState(() => creditCards.length === 0);

  const [seeding, setSeeding] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [sampleDataMessage, setSampleDataMessage] = useState('');

  async function handleSeedSampleData() {
    setSeeding(true);
    setSampleDataMessage('');
    try {
      await seedSampleExpenses();
      setSampleDataMessage('Sample data loaded - a few months of household spend plus a Japan trip.');
    } catch (err) {
      setSampleDataMessage(`Failed to load sample data: ${err?.message || err}`);
    } finally {
      setSeeding(false);
    }
  }

  async function handleWipeAllData() {
    if (!window.confirm('Delete every expense entry? This cannot be undone.')) return;
    setWiping(true);
    setSampleDataMessage('');
    try {
      await wipeAllExpenses();
      setSampleDataMessage('All expense entries deleted.');
    } catch (err) {
      setSampleDataMessage(`Failed to wipe data: ${err?.message || err}`);
    } finally {
      setWiping(false);
    }
  }

  async function handleSavePinConfig(enabledOverride = null) {
    const enabled = enabledOverride !== null ? enabledOverride : pinConfig.enabled;
    const cleanPin = newPin.trim();

    if (enabled && cleanPin.length !== 4) {
      setPinMessage('PIN must be exactly 4 digits.');
      return;
    }

    const updated = { pin: cleanPin, enabled };
    await savePinConfigToDb(updated);
    setPinConfigState(updated);
    setPinMessage(enabled ? 'Security PIN saved & synced to cloud!' : 'Security PIN disabled.');
  }

  const householdBudgetStatus = useMemo(() => {
    const currentMonth = getMonthKey(todayISO());
    const totals = groupByCategory(householdEntries, currentMonth, 'household');
    const prevTotals = groupByCategory(householdEntries, getPreviousMonthKey(currentMonth), 'household');
    return computeBudgetTrend(totals, prevTotals, budgetDrafts);
  }, [householdEntries, budgetDrafts]);

  const budgetedCategoryNames = new Set(householdBudgetStatus.map((s) => s.category));
  const unbudgetedCategories = (dbCategories?.household || []).filter((c) => !budgetedCategoryNames.has(c));

  async function persistBudgets(nextBudgets, category) {
    setSavingBudgetCat(category);
    setBudgetMessage('');
    try {
      await saveHouseholdBudgetsToDb(nextBudgets);
      setBudgetDrafts(nextBudgets);
    } catch (err) {
      setBudgetMessage(`Failed to save: ${err?.message || err}`);
    } finally {
      setSavingBudgetCat('');
    }
  }

  async function handleAddBudget(e) {
    e.preventDefault();
    const amount = Number(newBudgetAmount);
    if (!newBudgetCategory || !amount || amount <= 0) return;
    await persistBudgets({ ...budgetDrafts, [newBudgetCategory]: amount }, newBudgetCategory);
    setNewBudgetCategory('');
    setNewBudgetAmount('');
  }

  function handleBudgetAmountChange(category, value) {
    setBudgetDrafts((prev) => ({ ...prev, [category]: value }));
  }

  async function handleBudgetAmountBlur(category) {
    const amount = Number(budgetDrafts[category]);
    // Ignore an invalid in-progress edit on blur rather than silently
    // deleting the budget - Remove is the explicit way to clear one.
    if (!amount || amount <= 0) return;
    await persistBudgets({ ...budgetDrafts, [category]: amount }, category);
  }

  async function handleRemoveBudget(category) {
    const next = { ...budgetDrafts };
    delete next[category];
    await persistBudgets(next, category);
  }

  async function handleAddRule(e) {
    e.preventDefault();
    const amount = Number(newRuleAmount);
    if (!newRuleCategory || !amount || amount <= 0) return;
    setAddingRule(true);
    setRuleMessage('');
    try {
      const rule = {
        id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        category: newRuleCategory,
        amount,
        payer: newRulePayer || dbMembers[0] || '',
        splitType: newRuleSplitType,
        owedBy: newRuleSplitType === 'owed' ? newRuleOwedBy : null,
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

  function handleReminderThresholdChange(value) {
    setReminderDraft((prev) => ({ ...prev, amountThreshold: value }));
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

  function handleNewCardStrategyChange(strategyKey) {
    setNewCardStrategy(strategyKey);
    setNewCardParams({ ...CARD_STRATEGY_DEFAULTS[strategyKey] });
  }

  function updateNewCardParam(key, value) {
    setNewCardParams((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAddCard(e) {
    e.preventDefault();
    const trimmed = newCardName.trim();
    if (!trimmed) return;
    setAddingCard(true);
    setCardMessage('');
    try {
      const coercedParams = coerceStrategyParams(newCardStrategy, newCardParams);
      await addCreditCardToDb({
        name: trimmed,
        owner: newCardOwner,
        rewardStrategy: newCardStrategy,
        strategyParamsHistory: [{ effectiveFrom: todayISO(), params: coercedParams }],
        billingCycleDay: Math.min(31, Math.max(1, Math.round(Number(newCardBillingDay)) || 1)),
        dueDateOffsetDays: Math.max(0, Math.round(Number(newCardDueOffset)) || 0),
        annualMilestoneAnchorMonth: Math.min(12, Math.max(1, Math.round(Number(newCardAnnualAnchorMonth)) || 1)),
        annualMilestoneStartingSpend: Math.max(0, Number(newCardAnnualStartingSpend) || 0),
        startingRewardPoints: CARD_REWARD_STRATEGIES.find((s) => s.key === newCardStrategy)?.unit === 'points'
          ? Math.max(0, Number(newCardStartingPoints) || 0)
          : 0,
        active: true,
      });
      setNewCardName('');
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
      startingRewardPoints: String(card.startingRewardPoints ?? 0),
    });
  }

  async function saveEditCard(cardId) {
    try {
      const strategyKey = creditCards.find((c) => c.id === cardId)?.rewardStrategy;
      const isPointsCard = CARD_REWARD_STRATEGIES.find((s) => s.key === strategyKey)?.unit === 'points';
      await updateCreditCardInDb(cardId, {
        name: editCardDrafts.name.trim(),
        owner: editCardDrafts.owner,
        billingCycleDay: Math.min(31, Math.max(1, Math.round(Number(editCardDrafts.billingCycleDay)) || 1)),
        dueDateOffsetDays: Math.max(0, Math.round(Number(editCardDrafts.dueDateOffsetDays)) || 0),
        annualMilestoneAnchorMonth: Math.min(12, Math.max(1, Math.round(Number(editCardDrafts.annualMilestoneAnchorMonth)) || 1)),
        annualMilestoneStartingSpend: Math.max(0, Number(editCardDrafts.annualMilestoneStartingSpend) || 0),
        startingRewardPoints: isPointsCard ? Math.max(0, Number(editCardDrafts.startingRewardPoints) || 0) : 0,
      });
      setEditingCardId(null);
    } catch (err) {
      setCardMessage(`Failed to save: ${err?.message || err}`);
    }
  }

  async function handleDeleteCard(card) {
    if (!window.confirm(`Delete "${card.name}"? Its transactions and billing cycle history will stay in storage but won't be reachable from the app anymore.`)) return;
    try {
      await deleteCreditCardFromDb(card.id);
    } catch (err) {
      setCardMessage(`Failed to delete: ${err?.message || err}`);
    }
  }

  function startEditRules(card) {
    setEditingRulesCardId(card.id);
    setNewVersionEffectiveFrom(todayISO());
    setNewVersionParams({ ...resolveStrategyParamsForDate(card.strategyParamsHistory, todayISO()) });
  }

  function updateNewVersionParam(key, value) {
    setNewVersionParams((prev) => ({ ...prev, [key]: value }));
  }

  function updateCategoryField(index, field, value) {
    setNewVersionParams((prev) => {
      const categories = [...(prev.categories || [])];
      const current = categories[index];
      const next = { ...current, [field]: value };
      // A brand-new category (still has no key of its own) gets one derived
      // from its label as you type, so you don't have to hand-craft an
      // internal id - but once a category has a real key, it never changes
      // automatically, since that key is what links past transactions to it.
      if (field === 'label' && !current.key) {
        next.key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      }
      categories[index] = next;
      return { ...prev, categories };
    });
  }

  function addCategory() {
    setNewVersionParams((prev) => ({
      ...prev,
      categories: [...(prev.categories || []), { key: '', label: '', multiplier: 1, capAmount: null, capPeriod: null }],
    }));
  }

  function removeCategory(index) {
    setNewVersionParams((prev) => ({
      ...prev,
      categories: (prev.categories || []).filter((_, i) => i !== index),
    }));
  }

  // Appends a new dated rule version rather than overwriting the current
  // one, so past transactions keep being computed under whichever rule was
  // actually in effect on their own date - see resolveStrategyParamsForDate
  // in utils.js.
  async function saveNewRuleVersion(card) {
    if (!newVersionEffectiveFrom) return;
    setSavingRuleVersion(true);
    try {
      const coercedParams = coerceStrategyParams(card.rewardStrategy, newVersionParams);
      // Drop any category row left blank (empty label never got a derived
      // key, or was cleared) rather than saving a category nothing can match.
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

  const settingsLabelClass = 'block text-2xs font-semibold uppercase tracking-wider text-muted-text mb-1';
  // A stronger sub-section header within a single form (e.g. "Billing
  // cycle" vs "Reward rules" inside the Add Card form) - distinct from
  // settingsLabelClass, which labels one field, not a group of them.
  const settingsSectionLabelClass = 'text-2xs font-bold uppercase tracking-wider text-ledger-green';
  const settingsInputClass =
    'w-full min-h-10 px-3 rounded-xl border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40';
  // Same custom chevron everywhere a <select> appears in this modal - append
  // to any select's own sizing classes rather than only via settingsSelectClass
  // below, so a select with different height/padding (e.g. the Budgets tab's)
  // still gets the same arrow instead of falling back to the browser's
  // native one.
  const dropdownArrowClass =
    `appearance-none bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2324304A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")] bg-[length:1rem_1rem] bg-[right_0.65rem_center] bg-no-repeat pr-8`;
  const settingsSelectClass = `${settingsInputClass} ${dropdownArrowClass}`;

  const categoriesList =
    categoryLedger === 'travel'
      ? dbCategories?.travel || []
      : dbCategories?.household || [];

  async function handleAddCategory(e) {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) return;

    setAddingCat(true);
    try {
      await addCategoryToDb(categoryLedger, trimmed, rawCategoryDocs);
      setNewCatName('');
    } catch (err) {
      console.error('Failed to add category to database:', err);
    } finally {
      setAddingCat(false);
    }
  }

  async function handleDeleteCategory(categoryName) {
    try {
      await deleteCategoryFromDb(categoryLedger, categoryName, rawCategoryDocs);
    } catch (err) {
      console.error('Failed to delete category from database:', err);
    }
  }

  async function handleAddCurrency(e) {
    e.preventDefault();
    const trimmed = newCurrencyName.trim();
    if (!trimmed) return;

    setAddingCurr(true);
    try {
      await addCurrencyToDb(trimmed, rawCurrencyDocs);
      setNewCurrencyName('');
    } catch (err) {
      console.error('Failed to add currency to database:', err);
    } finally {
      setAddingCurr(false);
    }
  }

  async function handleDeleteCurrency(currencyName) {
    try {
      await deleteCurrencyFromDb(currencyName, rawCurrencyDocs);
    } catch (err) {
      console.error('Failed to delete currency from database:', err);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;

    setAddingMember(true);
    try {
      await addMemberToDb(trimmed, rawMemberDocs);
      setNewMemberName('');
    } catch (err) {
      console.error('Failed to add member to database:', err);
    } finally {
      setAddingMember(false);
    }
  }

  async function handleDeleteMember(memberName) {
    if (dbMembers.length <= 1) {
      alert('At least one member is required.');
      return;
    }
    if (!window.confirm(`Delete member "${memberName}" from database?`)) return;
    try {
      await deleteMemberFromDb(memberName, rawMemberDocs);
    } catch (err) {
      console.error('Failed to delete member from database:', err);
    }
  }

  const hasFirebase = isFirebaseConfigured();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2.5 sm:px-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-2xl bg-paper-card border border-ink/15 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-ink/10 flex items-center justify-between bg-paper/60">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <h2 className="font-display text-base sm:text-xl font-bold text-ink truncate">
              Settings & Configuration
            </h2>
            <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-ledger-green/15 text-ledger-green font-semibold shrink-0">
              Sync Active
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-ink/15 bg-paper flex items-center justify-center text-ink hover:bg-paper-card font-bold transition-colors shrink-0"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-ink/10 bg-paper/30 px-3 sm:px-6 gap-1 pt-2 overflow-x-auto scrollbar-none shrink-0 flex-nowrap">
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'categories'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Categories
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('budgets')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'budgets'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Budgets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('recurring')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'recurring'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Recurring
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reminders')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'reminders'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Reminders
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cards')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'cards'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Cards
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('currencies')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'currencies'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Currencies
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'members'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Members
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('user')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'user'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Device User
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('database')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'database'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Cloud Status
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'security'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            🔒 Security PIN
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1">
          {activeTab === 'categories' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Manage Categories Database
                </h3>
                <p className="text-xs text-muted-text">
                  Categories stored here are synchronized in real-time across devices.
                </p>
              </div>

              {/* Add Category Form */}
              <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder={`New ${categoryLedger} category name...`}
                  className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                />
                <button
                  type="submit"
                  disabled={addingCat || !newCatName.trim()}
                  className="min-h-11 px-4 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                >
                  {addingCat ? 'Saving...' : 'Add Category'}
                </button>
              </form>

              {/* Category List */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-text">
                  Active Database Categories ({categoriesList.length})
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-48 sm:max-h-60 overflow-y-auto p-1">
                  {categoriesList.map((cat) => (
                    <div
                      key={cat}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ink/15 bg-paper text-xs sm:text-sm text-ink font-medium shadow-2xs"
                    >
                      <span>{cat}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat)}
                        className="text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors ml-1"
                        title="Remove category"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'budgets' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Household Category Budgets
                </h3>
                <p className="text-xs text-muted-text">
                  Pick a category and set a monthly limit - it applies every month, not just this one. Nothing
                  is flagged until you set one. Warns at 80% of the limit, alerts once it's exceeded.
                </p>
              </div>

              {budgetMessage && (
                <div className="p-3 rounded-xl bg-stamp-red/10 border border-stamp-red/30 text-stamp-red text-xs font-semibold">
                  {budgetMessage}
                </div>
              )}

              <form onSubmit={handleAddBudget} className="flex flex-col sm:flex-row gap-2">
                <select
                  value={newBudgetCategory}
                  onChange={(e) => setNewBudgetCategory(e.target.value)}
                  className={`flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40 ${dropdownArrowClass}`}
                >
                  <option value="">Select a category...</option>
                  {unbudgetedCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={newBudgetAmount}
                    onChange={(e) => setNewBudgetAmount(e.target.value)}
                    placeholder="Limit (₹)"
                    className="flex-1 sm:w-32 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                  />
                  <button
                    type="submit"
                    disabled={!newBudgetCategory || !newBudgetAmount || savingBudgetCat === newBudgetCategory}
                    className="min-h-11 px-4 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors shrink-0"
                  >
                    Add
                  </button>
                </div>
              </form>

              {(dbCategories?.household || []).length === 0 && (
                <p className="text-xs text-muted-text">No household categories yet - add some in the Categories tab first.</p>
              )}
              {(dbCategories?.household || []).length > 0 && unbudgetedCategories.length === 0 && (
                <p className="text-xs text-muted-text">Every category already has a budget set.</p>
              )}

              {householdBudgetStatus.length > 0 && (
                <div className="space-y-3.5 pt-3 border-t border-ink/10">
                  {householdBudgetStatus.map((s) => (
                    <div key={s.category} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{s.category}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={budgetDrafts[s.category] ?? ''}
                            onChange={(e) => handleBudgetAmountChange(s.category, e.target.value)}
                            onBlur={() => handleBudgetAmountBlur(s.category)}
                            className="w-24 min-h-8 px-2 py-1 rounded-lg border border-ink/15 bg-paper text-ink text-sm text-right focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveBudget(s.category)}
                            className="text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors"
                            title="Remove budget"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            s.pctUsed >= 1 ? 'bg-stamp-red' : s.pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green'
                          }`}
                          style={{ width: `${Math.min(s.pctUsed * 100, 100)}%` }}
                        />
                      </div>
                      <p className="text-2xs text-muted-text">
                        {formatCurrency(s.spent)} of {formatCurrency(s.limit)} this month ({Math.round(s.pctUsed * 100)}%)
                      </p>
                      {s.previous && (
                        <p className="text-2xs text-muted-text flex items-center gap-1">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                              s.previous.pctUsed >= 1 ? 'bg-stamp-red' : s.previous.pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green'
                            }`}
                          />
                          Last month: {formatCurrency(s.previous.spent)} ({Math.round(s.previous.pctUsed * 100)}%
                          {s.previous.pctUsed >= 1 ? ' - over' : ''})
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'recurring' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">Recurring Household Expenses</h3>
                <p className="text-xs text-muted-text">
                  Rent, subscriptions, utilities - bills that repeat every month. Each rule auto-creates this
                  month's entry the next time the app is opened; nothing is added before you save the rule.
                </p>
              </div>

              <form onSubmit={handleAddRule} className="space-y-3 rounded-xl border border-ink/10 bg-paper/60 p-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={settingsLabelClass}>Category</label>
                    <select
                      value={newRuleCategory}
                      onChange={(e) => setNewRuleCategory(e.target.value)}
                      className={settingsSelectClass}
                    >
                      <option value="">Select a category...</option>
                      {(dbCategories?.household || []).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={settingsLabelClass}>Who pays</label>
                    <select
                      value={newRulePayer}
                      onChange={(e) => setNewRulePayer(e.target.value)}
                      className={settingsSelectClass}
                    >
                      {dbMembers.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={settingsLabelClass}>Amount (₹)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={newRuleAmount}
                      onChange={(e) => setNewRuleAmount(e.target.value)}
                      placeholder="0.00"
                      className={settingsInputClass}
                    />
                  </div>
                  <div>
                    <label className={settingsLabelClass}>Day of month</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={newRuleDay}
                      onChange={(e) => setNewRuleDay(e.target.value)}
                      className={settingsInputClass}
                    />
                  </div>
                </div>

                <div>
                  <label className={settingsLabelClass}>Split type</label>
                  <select
                    value={newRuleSplitType}
                    onChange={(e) => setNewRuleSplitType(e.target.value)}
                    className={settingsSelectClass}
                  >
                    <option value="shared">Split</option>
                    <option value="owed">Owed in full</option>
                    <option value="personal">Personal</option>
                  </select>
                </div>

                {newRuleSplitType === 'owed' && (
                  <div>
                    <label className={settingsLabelClass}>Owed by</label>
                    <select
                      value={newRuleOwedBy}
                      onChange={(e) => setNewRuleOwedBy(e.target.value)}
                      className={settingsSelectClass}
                    >
                      <option value="">Owed by...</option>
                      {dbMembers.filter((m) => m !== newRulePayer).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className={settingsLabelClass}>Note (optional)</label>
                  <input
                    type="text"
                    value={newRuleNote}
                    onChange={(e) => setNewRuleNote(e.target.value)}
                    placeholder="e.g. Rent"
                    className={settingsInputClass}
                  />
                </div>

                <button
                  type="submit"
                  disabled={addingRule || !newRuleCategory || !newRuleAmount}
                  className="w-full min-h-10 rounded-xl bg-ledger-green text-white font-semibold text-sm disabled:opacity-50 hover:bg-ledger-green/90 transition-colors"
                >
                  {addingRule ? 'Saving...' : 'Add Recurring Rule'}
                </button>
                {ruleMessage && <p className="text-xs text-muted-text">{ruleMessage}</p>}
              </form>

              {recurringRules.length === 0 ? (
                <p className="text-xs text-muted-text">No recurring rules yet.</p>
              ) : (
                <div className="space-y-2">
                  {recurringRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-ink truncate">
                          {rule.category} - {formatCurrency(rule.amount)}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRemoveRule(rule.id)}
                          className="shrink-0 text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors"
                          title="Remove recurring rule"
                        >
                          ✕
                        </button>
                      </div>
                      <p className="text-2xs text-muted-text">
                        Every month on day {rule.dayOfMonth} · {rule.payer} pays
                        {rule.note ? ` · ${rule.note}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'reminders' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">Payment Reminders</h3>
                <p className="text-xs text-muted-text">
                  A nudge when the household balance owed crosses an amount you set - in-app only, there's no
                  push notification without a backend.
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3">
                <span className="text-sm font-medium text-ink">Remind us about unsettled balances</span>
                <input
                  type="checkbox"
                  checked={reminderDraft.enabled}
                  onChange={(e) => handleReminderToggle(e.target.checked)}
                  className="w-5 h-5 accent-ledger-green"
                />
              </label>

              <div className="flex items-center gap-2.5">
                <span className="text-sm text-ink">Remind when balance exceeds</span>
                <input
                  type="number"
                  min="1"
                  value={reminderDraft.amountThreshold}
                  onChange={(e) => handleReminderThresholdChange(e.target.value)}
                  onBlur={handleReminderThresholdBlur}
                  disabled={!reminderDraft.enabled}
                  placeholder="₹"
                  className="w-24 min-h-10 px-3 rounded-xl border border-ink/15 bg-paper text-ink text-sm text-center disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                />
              </div>
              {reminderMessage && <p className="text-xs text-muted-text">{reminderMessage}</p>}
            </div>
          )}

          {activeTab === 'cards' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">Credit Cards</h3>
                <p className="text-xs text-muted-text">
                  Every reward rule below was cross-checked against each bank's current terms, not guessed from a
                  spreadsheet formula - tune the numbers here if a card's real terms change.
                </p>
              </div>

              <div className="rounded-xl border border-ink/10 bg-paper/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAddCardForm((v) => !v)}
                  className="w-full flex items-center justify-between px-3.5 py-3 text-sm font-bold text-ink"
                >
                  <span>💳 Add a card</span>
                  <span className="text-xs font-semibold text-ledger-green">{showAddCardForm ? 'Collapse' : 'Expand'}</span>
                </button>

                {showAddCardForm && (
                  <form onSubmit={handleAddCard} className="space-y-4 px-3.5 pb-4 pt-1 border-t border-ink/10">
                    <div className="space-y-2.5">
                      <p className={settingsSectionLabelClass}>Card details</p>
                      <div>
                        <label className={settingsLabelClass}>Card name</label>
                        <input
                          type="text"
                          value={newCardName}
                          onChange={(e) => setNewCardName(e.target.value)}
                          placeholder="e.g. HDFC Diners Club Black Metal"
                          className={settingsInputClass}
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className={settingsLabelClass}>Owner</label>
                          <select
                            value={newCardOwner}
                            onChange={(e) => setNewCardOwner(e.target.value)}
                            className={settingsSelectClass}
                          >
                            {dbMembers.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={settingsLabelClass}>Reward strategy</label>
                          <select
                            value={newCardStrategy}
                            onChange={(e) => handleNewCardStrategyChange(e.target.value)}
                            className={settingsSelectClass}
                          >
                            {CARD_REWARD_STRATEGIES.map((s) => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2.5 pt-3 border-t border-ink/10">
                      <p className={settingsSectionLabelClass}>Billing cycle</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className={settingsLabelClass}>Billing cycle day</label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={newCardBillingDay}
                            onChange={(e) => setNewCardBillingDay(e.target.value)}
                            className={settingsInputClass}
                          />
                        </div>
                        <div>
                          <label className={settingsLabelClass}>Due date offset (days)</label>
                          <input
                            type="number"
                            min="0"
                            value={newCardDueOffset}
                            onChange={(e) => setNewCardDueOffset(e.target.value)}
                            className={settingsInputClass}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2.5 pt-3 border-t border-ink/10">
                      <p className={settingsSectionLabelClass}>Milestone tracking</p>
                      <p className="text-2xs text-muted-text">
                        The annual milestone (fee waiver / bonus) runs on the card's own 12-month cycle from the month below, not the calendar year. Adding this card partway through that period? Use the spend/points fields to carry over what already happened before you started tracking here.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className={settingsLabelClass}>Annual milestone starts from</label>
                          <select
                            value={newCardAnnualAnchorMonth}
                            onChange={(e) => setNewCardAnnualAnchorMonth(e.target.value)}
                            className={settingsSelectClass}
                          >
                            {MONTH_NAMES.map((name, i) => (
                              <option key={name} value={i + 1}>{name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={settingsLabelClass}>Spend already counted this period (₹)</label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={newCardAnnualStartingSpend}
                            onChange={(e) => setNewCardAnnualStartingSpend(e.target.value)}
                            placeholder="0"
                            className={settingsInputClass}
                          />
                        </div>
                        {CARD_REWARD_STRATEGIES.find((s) => s.key === newCardStrategy)?.unit === 'points' && (
                          <div>
                            <label className={settingsLabelClass}>Starting reward points balance</label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={newCardStartingPoints}
                              onChange={(e) => setNewCardStartingPoints(e.target.value)}
                              placeholder="0"
                              className={settingsInputClass}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2.5 pt-3 border-t border-ink/10">
                      <p className={settingsSectionLabelClass}>Reward rules</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {(CARD_PARAM_FIELDS[newCardStrategy] || []).map((field) => (
                          <div key={field.key}>
                            <label className={settingsLabelClass}>{field.label}</label>
                            <input
                              type={field.isText ? 'text' : 'number'}
                              step={field.isText ? undefined : 'any'}
                              value={newCardParams[field.key] ?? ''}
                              onChange={(e) => updateNewCardParam(field.key, e.target.value)}
                              className={settingsInputClass}
                            />
                          </div>
                        ))}
                      </div>

                      {newCardStrategy === 'hdfc_diners_slab_milestone' && (
                        <div className="space-y-1.5 pt-1">
                          <p className="text-2xs text-muted-text">Categories (fixed per-category rates, verified against HDFC's T&C - not editable here; use Rules after adding the card to revise its other terms):</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(newCardParams.categories || []).map((c) => (
                              <span key={c.key} className="text-2xs px-2 py-1 rounded-full bg-paper border border-ink/10 text-muted-text">
                                {c.label}: {c.multiplier}× {c.capAmount ? `(cap ${c.capAmount}/${c.capPeriod})` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={addingCard || !newCardName.trim()}
                      className="w-full min-h-10 rounded-xl bg-ledger-green text-white font-semibold text-sm disabled:opacity-50 hover:bg-ledger-green/90 transition-colors"
                    >
                      {addingCard ? 'Saving...' : 'Add Card'}
                    </button>
                    {cardMessage && <p className="text-xs text-muted-text">{cardMessage}</p>}
                  </form>
                )}
              </div>

              {creditCards.length === 0 ? (
                <p className="text-xs text-muted-text">No cards yet - add your first one above.</p>
              ) : (
                <div className="space-y-2">
                  {creditCards.map((card) => {
                    const strategyMeta = CARD_REWARD_STRATEGIES.find((s) => s.key === card.rewardStrategy);
                    const strategyLabel = strategyMeta?.label || card.rewardStrategy;
                    const strategyIcon = strategyMeta?.unit === 'points' ? '🎫' : '💰';
                    const isEditing = editingCardId === card.id;
                    return (
                      <div key={card.id} className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 space-y-2.5">
                        {isEditing ? (
                          <div className="space-y-2.5">
                            <div>
                              <label className={settingsLabelClass}>Card name</label>
                              <input
                                type="text"
                                value={editCardDrafts.name}
                                onChange={(e) => setEditCardDrafts((prev) => ({ ...prev, name: e.target.value }))}
                                className={settingsInputClass}
                              />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <label className={settingsLabelClass}>Owner</label>
                                <select
                                  value={editCardDrafts.owner}
                                  onChange={(e) => setEditCardDrafts((prev) => ({ ...prev, owner: e.target.value }))}
                                  className={settingsSelectClass}
                                >
                                  {dbMembers.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className={settingsLabelClass}>Billing day</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="31"
                                  value={editCardDrafts.billingCycleDay}
                                  onChange={(e) => setEditCardDrafts((prev) => ({ ...prev, billingCycleDay: e.target.value }))}
                                  className={settingsInputClass}
                                />
                              </div>
                              <div>
                                <label className={settingsLabelClass}>Due offset (days)</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={editCardDrafts.dueDateOffsetDays}
                                  onChange={(e) => setEditCardDrafts((prev) => ({ ...prev, dueDateOffsetDays: e.target.value }))}
                                  className={settingsInputClass}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <label className={settingsLabelClass}>Annual milestone from</label>
                                <select
                                  value={editCardDrafts.annualMilestoneAnchorMonth}
                                  onChange={(e) => setEditCardDrafts((prev) => ({ ...prev, annualMilestoneAnchorMonth: e.target.value }))}
                                  className={settingsSelectClass}
                                >
                                  {MONTH_NAMES.map((name, i) => (
                                    <option key={name} value={i + 1}>{name}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className={settingsLabelClass}>Spend counted so far (₹)</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={editCardDrafts.annualMilestoneStartingSpend}
                                  onChange={(e) => setEditCardDrafts((prev) => ({ ...prev, annualMilestoneStartingSpend: e.target.value }))}
                                  className={settingsInputClass}
                                />
                              </div>
                              {strategyMeta?.unit === 'points' && (
                                <div>
                                  <label className={settingsLabelClass}>Starting points balance</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={editCardDrafts.startingRewardPoints}
                                    onChange={(e) => setEditCardDrafts((prev) => ({ ...prev, startingRewardPoints: e.target.value }))}
                                    className={settingsInputClass}
                                  />
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => saveEditCard(card.id)} className="min-h-9 px-3 rounded-lg bg-ledger-green text-white text-xs font-semibold">
                                Save
                              </button>
                              <button type="button" onClick={() => setEditingCardId(null)} className="min-h-9 px-3 rounded-lg border border-ink/15 text-xs font-semibold text-muted-text">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink truncate">
                                {strategyIcon} {card.name}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="text-2xs px-2 py-0.5 rounded-md bg-paper border border-ink/10 text-muted-text font-medium">{card.owner}</span>
                                <span className="text-2xs px-2 py-0.5 rounded-md bg-paper border border-ink/10 text-muted-text font-medium">{strategyLabel}</span>
                                <span className="text-2xs px-2 py-0.5 rounded-md bg-paper border border-ink/10 text-muted-text font-medium">Billing day {card.billingCycleDay}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => (editingRulesCardId === card.id ? setEditingRulesCardId(null) : startEditRules(card))}
                                className={`min-h-8 px-2.5 py-1 rounded-full text-2xs font-semibold transition-colors ${
                                  editingRulesCardId === card.id ? 'bg-ledger-green text-white' : 'bg-ledger-green/10 text-ledger-green hover:bg-ledger-green/20'
                                }`}
                                title="Rules history - revise rates/caps from a chosen date onward without changing past transactions"
                              >
                                🗓 Rules
                              </button>
                              <button type="button" onClick={() => startEditCard(card)} className="min-h-8 min-w-8 px-2 py-1 rounded-lg text-xs font-semibold text-muted-text hover:text-ink hover:bg-ink/5 transition-colors" title="Edit">
                                ✎
                              </button>
                              <button type="button" onClick={() => handleDeleteCard(card)} className="min-h-8 min-w-8 px-2 py-1 rounded-lg text-xs font-semibold text-stamp-red/70 hover:text-stamp-red hover:bg-stamp-red/10 transition-colors" title="Delete">
                                ✕
                              </button>
                            </div>
                          </div>
                        )}

                        {editingRulesCardId === card.id && (
                          <div className="space-y-3 rounded-lg border border-ink/10 bg-paper px-3 py-3 mt-2">
                            <div className="space-y-1.5">
                              <p className={settingsSectionLabelClass}>Rule history (oldest to newest)</p>
                              {[...(card.strategyParamsHistory || [])]
                                .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
                                .map((version) => (
                                  <div key={version.effectiveFrom} className="rounded-lg border border-ink/10 bg-paper-card px-2.5 py-2 space-y-0.5">
                                    <p className="text-xs font-bold text-ink">{version.effectiveFrom}</p>
                                    {(CARD_PARAM_FIELDS[card.rewardStrategy] || [])
                                      .filter((f) => !f.isText)
                                      .map((f) => (
                                        <p key={f.key} className="text-2xs text-muted-text">
                                          {f.label}: <span className="text-ink font-medium">{version.params[f.key] ?? '-'}</span>
                                        </p>
                                      ))}
                                  </div>
                                ))}
                            </div>
                            <div className="space-y-2 pt-2 border-t border-ink/10">
                              <p className={settingsSectionLabelClass}>Add a new rule version</p>
                              <div>
                                <label className={settingsLabelClass}>Effective from</label>
                                <input
                                  type="date"
                                  value={newVersionEffectiveFrom}
                                  onChange={(e) => setNewVersionEffectiveFrom(e.target.value)}
                                  className={settingsInputClass}
                                />
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {(CARD_PARAM_FIELDS[card.rewardStrategy] || []).map((field) => (
                                  <div key={field.key}>
                                    <label className={settingsLabelClass}>{field.label}</label>
                                    <input
                                      type={field.isText ? 'text' : 'number'}
                                      step={field.isText ? undefined : 'any'}
                                      value={newVersionParams[field.key] ?? ''}
                                      onChange={(e) => updateNewVersionParam(field.key, e.target.value)}
                                      className={settingsInputClass}
                                    />
                                  </div>
                                ))}
                              </div>
                              {card.rewardStrategy === 'hdfc_diners_slab_milestone' && (
                                <div className="space-y-2 pt-1 border-t border-ink/10">
                                  <p className={settingsSectionLabelClass}>Categories</p>
                                  <p className="text-2xs text-muted-text">
                                    Renaming a category is safe - it doesn't touch past transactions. Removing one that past transactions still use falls back to the base 1x rate for them, same as an unrecognized category.
                                  </p>
                                  {(newVersionParams.categories || []).map((cat, i) => (
                                    <div key={i} className="rounded-lg border border-ink/10 bg-paper px-2.5 py-2 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <input
                                          type="text"
                                          value={cat.label}
                                          onChange={(e) => updateCategoryField(i, 'label', e.target.value)}
                                          placeholder="Category name"
                                          className={`${settingsInputClass} font-semibold`}
                                        />
                                        <button type="button" onClick={() => removeCategory(i)} className="shrink-0 min-h-9 min-w-9 rounded-lg text-xs font-semibold text-stamp-red/70 hover:text-stamp-red hover:bg-stamp-red/10 transition-colors" title="Remove category">
                                          ✕
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <label className={settingsLabelClass}>Multiplier</label>
                                          <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={cat.multiplier ?? ''}
                                            onChange={(e) => updateCategoryField(i, 'multiplier', e.target.value === '' ? '' : Number(e.target.value))}
                                            className={settingsInputClass}
                                          />
                                        </div>
                                        <div>
                                          <label className={settingsLabelClass}>Cap amount</label>
                                          <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={cat.capAmount ?? ''}
                                            onChange={(e) => updateCategoryField(i, 'capAmount', e.target.value === '' ? null : Number(e.target.value))}
                                            placeholder="None"
                                            className={settingsInputClass}
                                          />
                                        </div>
                                        <div>
                                          <label className={settingsLabelClass}>Cap period</label>
                                          <select
                                            value={cat.capPeriod ?? ''}
                                            onChange={(e) => updateCategoryField(i, 'capPeriod', e.target.value === '' ? null : e.target.value)}
                                            className={settingsSelectClass}
                                          >
                                            <option value="">No cap</option>
                                            <option value="day">Per day</option>
                                            <option value="month">Per month</option>
                                          </select>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                  <button type="button" onClick={addCategory} className="w-full min-h-9 rounded-lg border border-dashed border-ink/20 text-xs font-semibold text-muted-text hover:text-ink hover:border-ink/40 transition-colors">
                                    + Add category
                                  </button>
                                </div>
                              )}
                              <p className="text-2xs text-muted-text">
                                Transactions on or after this date use these rules; earlier transactions keep using whichever rule was active on their own date.
                              </p>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => saveNewRuleVersion(card)} disabled={savingRuleVersion || !newVersionEffectiveFrom} className="min-h-9 px-3 rounded-lg bg-ledger-green text-white text-xs font-semibold disabled:opacity-50">
                                  {savingRuleVersion ? 'Saving...' : 'Save new version'}
                                </button>
                                <button type="button" onClick={() => setEditingRulesCardId(null)} className="min-h-9 px-3 rounded-lg border border-ink/15 text-xs font-semibold text-muted-text">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'currencies' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Manage Currencies Database
                </h3>
                <p className="text-xs text-muted-text">
                  Currencies stored in the database are selectable for entries and trips.
                </p>
              </div>

              {/* Add Currency Form */}
              <form onSubmit={handleAddCurrency} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newCurrencyName}
                  onChange={(e) => setNewCurrencyName(e.target.value)}
                  placeholder="New Currency Code (e.g. CAD, AUD, CHF)..."
                  className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                />
                <button
                  type="submit"
                  disabled={addingCurr || !newCurrencyName.trim()}
                  className="min-h-11 px-4 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                >
                  {addingCurr ? 'Saving...' : 'Add Currency'}
                </button>
              </form>

              {/* Currencies List */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-text">
                  Active Database Currencies ({dbCurrencies.length})
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-48 sm:max-h-60 overflow-y-auto p-1">
                  {dbCurrencies.map((curr) => (
                    <div
                      key={curr}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ink/15 bg-paper text-xs sm:text-sm text-ink font-bold shadow-2xs"
                    >
                      <span>{curr}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCurrency(curr)}
                        className="text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors ml-1"
                        title="Remove currency"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'members' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Manage Members Database
                </h3>
                <p className="text-xs text-muted-text">
                  Persons/Partners in your household ledger. Stored dynamically in database.
                </p>
              </div>

              {/* Add Member Form */}
              <form onSubmit={handleAddMember} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="New Member Name..."
                  className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                />
                <button
                  type="submit"
                  disabled={addingMember || !newMemberName.trim()}
                  className="min-h-11 px-4 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                >
                  {addingMember ? 'Saving...' : 'Add Member'}
                </button>
              </form>

              {/* Members List */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-text">
                  Active Database Members ({dbMembers.length})
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-48 sm:max-h-60 overflow-y-auto p-1">
                  {dbMembers.map((member) => (
                    <div
                      key={member}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ink/15 bg-paper text-xs sm:text-sm text-ink font-semibold shadow-2xs"
                    >
                      <span>{member}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteMember(member)}
                        className="text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors ml-1"
                        title="Remove member"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'user' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Device User Identity
                </h3>
                <p className="text-xs text-muted-text">
                  Select which member is currently using this device.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {dbMembers.map((person) => (
                  <button
                    key={person}
                    type="button"
                    onClick={() => {
                      onChangeDeviceName(person);
                    }}
                    className={`p-3.5 sm:p-4 rounded-xl border text-left transition-all ${
                      deviceName === person
                        ? 'border-ledger-green bg-ledger-green/10 ring-2 ring-ledger-green/40'
                        : 'border-ink/15 bg-paper hover:bg-paper-card'
                    }`}
                  >
                    <p className="font-bold text-ink text-sm sm:text-base">{person}</p>
                    <p className="text-xs text-muted-text mt-0.5">
                      {deviceName === person ? 'Active on this device' : 'Tap to switch to this user'}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'database' && (
            <div className="space-y-4">
              <div className="p-3.5 sm:p-4 rounded-xl border border-ink/15 bg-paper space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <span className="font-bold text-ink text-sm sm:text-base">Database Engine Status</span>
                  <span
                    className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border w-fit ${
                      hasFirebase
                        ? 'bg-ledger-green/15 text-ledger-green border-ledger-green/30'
                        : 'bg-mustard/20 text-mustard border-mustard/40'
                    }`}
                  >
                    {hasFirebase ? 'Cloud Firestore Active' : 'Persistent Local DB Mode'}
                  </span>
                </div>
                <p className="text-xs text-muted-text leading-relaxed">
                  {hasFirebase
                    ? 'Your expense entries, categories, currencies, and members are synchronized live across all active devices via Google Firebase Firestore.'
                    : 'Your entries, categories, currencies, and members are saved securely in your browser database. Configure VITE_FIREBASE_* environment variables in .env for multi-device cloud sync.'}
                </p>
              </div>

              {/* Database Status */}

              {!hasFirebase && (
                <div className="p-3.5 sm:p-4 rounded-xl border border-ink/10 bg-paper/60 space-y-2 text-xs">
                  <p className="font-bold text-ink text-sm">Required Cloud Variables:</p>
                  <ul className="font-mono text-muted-text space-y-1 list-disc list-inside">
                    <li>VITE_FIREBASE_API_KEY</li>
                    <li>VITE_FIREBASE_PROJECT_ID</li>
                    <li>VITE_FIREBASE_AUTH_DOMAIN</li>
                  </ul>
                </div>
              )}

              {!hasFirebase && (
                <div className="p-3.5 sm:p-4 rounded-xl border border-ink/15 bg-paper space-y-2.5">
                  <p className="font-bold text-ink text-sm">Sample Data (local DB mode only)</p>
                  <p className="text-xs text-muted-text leading-relaxed">
                    Only available here because there's no real cloud data to accidentally touch. Loads a
                    few months of household spend plus a Japan trip - handy for testing without typing entries by hand.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={handleSeedSampleData}
                      disabled={seeding || wiping}
                      className="min-h-10 rounded-lg bg-ledger-green px-3.5 py-2 text-xs font-semibold text-white hover:bg-ledger-green/90 transition-colors disabled:opacity-50"
                    >
                      {seeding ? 'Loading…' : 'Load Sample Data'}
                    </button>
                    <button
                      type="button"
                      onClick={handleWipeAllData}
                      disabled={seeding || wiping}
                      className="min-h-10 rounded-lg border border-stamp-red/30 bg-paper px-3.5 py-2 text-xs font-semibold text-stamp-red hover:bg-stamp-red/10 transition-colors disabled:opacity-50"
                    >
                      {wiping ? 'Wiping…' : 'Wipe All Data'}
                    </button>
                  </div>
                  {sampleDataMessage && (
                    <p className="text-xs text-muted-text">{sampleDataMessage}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  App Passcode & Security PIN
                </h3>
                <p className="text-xs text-muted-text">
                  Set a 4-digit security PIN to restrict access to your expense entries on this device.
                </p>
              </div>

              {pinMessage && (
                <div className="p-3 rounded-xl bg-ledger-green/10 border border-ledger-green/30 text-ledger-green text-xs font-semibold">
                  {pinMessage}
                </div>
              )}

              <div className="p-3.5 sm:p-4 rounded-xl border border-ink/15 bg-paper space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink text-sm">Require PIN Protection</p>
                    <p className="text-xs text-muted-text">Prompt for 4-digit PIN upon entering Splitkhata</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={pinConfig.enabled}
                      onChange={(e) => {
                        handleSavePinConfig(e.target.checked);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-ink/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ledger-green"></div>
                  </label>
                </div>

                <div className="pt-3 border-t border-ink/10 space-y-3">
                  <label className="block text-xs font-bold text-ink">
                    Set / Change 4-Digit Security PIN
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="password"
                      maxLength={4}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newPin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setNewPin(val);
                      }}
                      placeholder="e.g. 1234"
                      className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-base font-mono font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                    />
                    <button
                      type="button"
                      onClick={() => handleSavePinConfig()}
                      disabled={newPin.length !== 4}
                      className="min-h-11 px-5 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                    >
                      Save PIN
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-ink/10 bg-paper/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-11 px-6 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

