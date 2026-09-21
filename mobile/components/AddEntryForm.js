import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import PickerField from './PickerField';
import DateField from './DateField';
import Card from './Card';
import CustomSplitEditor from './CustomSplitEditor';
import { addExpense, addExpensesBatch, updateExpense, addCardTransaction, generateStructured, extractReceiptFromImage } from '../lib/firebase';
import { reportError } from '../lib/errorReporting';
import {
  buildPaymentInstruments,
  checkCustomSharesTotal,
  isStatementOnlyCard,
  parseCustomShares,
  DEFAULT_PERSONS as PERSONS,
  DEFAULT_CATEGORIES,
  DEFAULT_TRAVEL_CATEGORIES,
  todayISO,
  addMonthsToDateISO,
  splitAmountEvenly,
  computeFifoCashAmount,
  formatFifoBreakdownSummary,
  buildQuickAddPrompt,
  buildQuickAddSchema,
  buildCategorySuggestionPrompt,
  buildCategorySuggestionSchema,
  buildReceiptExtractionPrompt,
  buildReceiptExtractionSchema,
  rankCardsForEntry,
  getRecentCombinations,
  inferCardRewardFields,
  resolveStrategyParamsForDate,
  formatCurrency,
} from '../lib/utils';

const SPLIT_TYPE_OPTIONS = [
  { value: 'shared', label: 'Split' },
  { value: 'owed', label: 'Owed' },
  { value: 'personal', label: 'Personal' },
  { value: 'custom', label: 'Custom amounts' },
];

function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-10 px-3.5 items-center justify-center rounded-lg border mr-2 mb-2 ${
        selected ? 'bg-ledger-green border-ledger-green' : 'bg-paper border-ink/15'
      }`}
    >
      <Text className={`font-body-semibold text-sm ${selected ? 'text-white' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}

// RN port of web's AddEntryForm.jsx - shared by Household and Travel.
export default function AddEntryForm({
  deviceName,
  onSaveError,
  ledger = 'household',
  tripName = '',
  dbCategories,
  dbMembers = [],
  currentCurrency = 'INR',
  instruments: instrumentsProp,
  tripEntries = [],
  creditCards = [],
  cardTransactions = [],
  recentEntries = [],
}) {
  const isTravel = ledger === 'travel';
  const categories =
    dbCategories && dbCategories.length > 0 ? dbCategories : isTravel ? DEFAULT_TRAVEL_CATEGORIES : DEFAULT_CATEGORIES;
  const membersList = dbMembers && dbMembers.length > 0 ? dbMembers : PERSONS;
  // Cash, UPI, bank accounts and tracked cards as one list (see
  // buildPaymentInstruments) - picking a card here also links the entry to a
  // card transaction (see handleSubmit).
  const instruments = useMemo(
    () => (instrumentsProp && instrumentsProp.length ? instrumentsProp : buildPaymentInstruments([{ name: 'Cash' }], creditCards)),
    [instrumentsProp, creditCards],
  );
  const paymentMethodOptions = instruments.map((i) => i.label);

  const [amount, setAmount] = useState('');
  const [localAmount, setLocalAmount] = useState('');
  const [rewardPoints, setRewardPoints] = useState('');
  const [payer, setPayer] = useState(deviceName || membersList[0]);
  const [category, setCategory] = useState(categories[0] || 'Groceries');
  const [splitType, setSplitType] = useState('shared');
  const [owedBy, setOwedBy] = useState(() => membersList.find((p) => p !== (deviceName || membersList[0])) || '');
  const [splitAmong, setSplitAmong] = useState(membersList);
  const [customShares, setCustomShares] = useState({});
  const customSharesCheck = checkCustomSharesTotal(customShares, parseFloat(amount) || 0);
  const customSplitInvalid = splitType === 'custom' && !customSharesCheck.ok;
  const [paymentMethod, setPaymentMethod] = useState(paymentMethodOptions[0] || 'Cash');
  const selectedInstrument = instruments.find((i) => i.label === paymentMethod) || null;
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [splitAcrossMonths, setSplitAcrossMonths] = useState(false);
  const [monthsCount, setMonthsCount] = useState('6');
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
  const fifoResult = useMemo(() => {
    const parsedLocal = parseFloat(localAmount);
    if (!parsedLocal || parsedLocal <= 0) return null;
    return computeFifoCashAmount(tripWithdrawals, otherCashEntries, { id: null, date, createdAt: null, localAmount: parsedLocal });
  }, [tripWithdrawals, otherCashEntries, date, localAmount]);
  const fifoBreakdownText = useMemo(
    () => (fifoResult ? formatFifoBreakdownSummary(fifoResult.breakdown, currentCurrency) : ''),
    [fifoResult, currentCurrency],
  );
  const amountLocked = isTravel && paymentMethod === 'Cash' && fifoResult != null;

  // Which tracked card would earn the most on this specific entry, right
  // where the amount/category are being typed - the reward engine already
  // models every card's real terms, this just surfaces it at the moment
  // it's actually useful instead of only in the Cards tab after the fact.
  const rankedCards = useMemo(
    () => rankCardsForEntry(creditCards, cardTransactions, parseFloat(amount) || 0, category, date),
    [creditCards, cardTransactions, amount, category, date],
  );

  // Real household spending repeats far more than a blank form assumes -
  // one tap on a recent combination fills category/payer/payment method,
  // leaving only the amount to type.
  const recentCombinations = useMemo(() => getRecentCombinations(recentEntries), [recentEntries]);
  function applyRecentCombination(combo) {
    setCategory(combo.category);
    setPayer(combo.payer);
    if (combo.paymentMethod) setPaymentMethod(combo.paymentMethod);
  }

  useEffect(() => {
    if (categories.length && !categories.includes(category)) setCategory(categories[0]);
  }, [ledger, categories.join('|')]);

  useEffect(() => {
    if (deviceName && membersList.includes(deviceName)) {
      setPayer(deviceName);
    } else {
      setPayer((prev) => (membersList.includes(prev) ? prev : membersList[0]));
    }
  }, [deviceName, membersList.join('|')]);

  useEffect(() => {
    if (!owedBy || owedBy === payer || !membersList.includes(owedBy)) {
      setOwedBy(membersList.find((p) => p !== payer) || '');
    }
  }, [membersList.join('|'), owedBy, payer]);

  useEffect(() => {
    setSplitAmong(membersList);
  }, [membersList.join('|')]);

  useEffect(() => {
    if (paymentMethodOptions.length && !paymentMethodOptions.includes(paymentMethod)) {
      setPaymentMethod(paymentMethodOptions[0]);
    }
  }, [paymentMethodOptions.join('|')]);

  useEffect(() => {
    if (!isTravel || paymentMethod !== 'Cash' || fifoResult == null) return;
    setAmount(fifoResult.amount.toString());
  }, [fifoResult, paymentMethod, isTravel]);

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
  // The user still reviews every field and taps Add to Ledger themselves,
  // same as if they'd typed it all by hand.
  async function handleQuickAdd() {
    const text = quickAddText.trim();
    if (!text) return;
    setQuickAddStatus({ state: 'loading', error: '' });
    try {
      const schema = buildQuickAddSchema({
        categories,
        members: membersList,
        paymentMethods: paymentMethodOptions,
        isTravel,
      });
      const prompt = buildQuickAddPrompt(text, { members: membersList, today: todayISO() });
      const parsed = await generateStructured(prompt, schema);

      setAmount(String(parsed.amount ?? ''));
      if (parsed.category && categories.includes(parsed.category)) setCategory(parsed.category);
      if (parsed.payer && membersList.includes(parsed.payer)) setPayer(parsed.payer);
      if (parsed.splitType) setSplitType(parsed.splitType);
      if (parsed.splitType === 'custom' && Array.isArray(parsed.splitShares)) {
        setCustomShares(
          Object.fromEntries(
            parsed.splitShares.filter((s) => membersList.includes(s.person) && Number(s.amount) > 0).map((s) => [s.person, String(s.amount)]),
          ),
        );
      }
      if (parsed.splitType === 'owed' && parsed.owedBy && membersList.includes(parsed.owedBy)) {
        setOwedBy(parsed.owedBy);
      }
      if (parsed.note) setNote(parsed.note);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '')) setDate(parsed.date);
      if (isTravel && parsed.paymentMethod && paymentMethodOptions.includes(parsed.paymentMethod)) {
        setPaymentMethod(parsed.paymentMethod);
      }

      setQuickAddStatus({ state: 'done', error: '' });
      setQuickAddText('');
    } catch (err) {
      setQuickAddStatus({ state: 'error', error: err?.message || 'Could not parse that.' });
    }
  }

  // Fills in amount/category/date/note from a photo - payer and split type
  // are left alone since a receipt can't tell you who paid or how you're
  // splitting it.
  async function handleScanReceipt() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to scan a receipt.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.7,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    setReceiptStatus({ state: 'loading', error: '' });
    try {
      const asset = result.assets[0];
      const parsed = await extractReceiptFromImage(
        asset.base64,
        asset.mimeType || 'image/jpeg',
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

  // An owned card/account says who paid most of the time - fill it in, but
  // leave Who Paid editable (e.g. paying with the other person's card).
  function handlePaymentMethodChange(label) {
    setPaymentMethod(label);
    const owner = instruments.find((i) => i.label === label)?.owner;
    if (owner && membersList.includes(owner)) setPayer(owner);
  }

  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      const trimmedNote = note.trim();
      const months = !isTravel && splitAcrossMonths ? Math.max(2, Math.min(36, Math.round(Number(monthsCount)) || 2)) : 1;
      const parsedLocal = isTravel && localAmount ? parseFloat(localAmount) : null;
      const parsedPoints = isTravel && rewardPoints ? parseFloat(rewardPoints) : null;
      const effectiveSplitAmong =
        splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < membersList.length ? splitAmong : null;

      if (months > 1) {
        const installmentAmounts = splitAmountEvenly(parsed, months);
        const installments = Array.from({ length: months }, (_, i) => ({
          amount: installmentAmounts[i],
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          splitAmong: splitType === 'custom' ? null : effectiveSplitAmong,
          splitShares: splitType === 'custom' ? parseCustomShares(customShares) : null,
          note: trimmedNote ? `${trimmedNote} (${i + 1}/${months})` : `Installment ${i + 1}/${months}`,
          date: addMonthsToDateISO(date, i),
          ledger,
          tripName: isTravel ? tripName : '',
          deviceName: deviceName || payer,
        }));
        await addExpensesBatch(installments);
      } else {
        const newEntryId = await addExpense({
          amount: parsed,
          payer,
          category,
          split: splitType !== 'personal',
          splitType,
          owedBy: splitType === 'owed' ? owedBy : null,
          splitAmong: splitType === 'custom' ? null : effectiveSplitAmong,
          splitShares: splitType === 'custom' ? parseCustomShares(customShares) : null,
          note: trimmedNote,
          date,
          ledger,
          tripName: isTravel ? tripName : '',
          paymentMethod: paymentMethod || null,
          paymentInstrumentId: selectedInstrument?.id || null,
          localAmount: parsedLocal,
          rewardPoints: parsedPoints,
          deviceName: deviceName || payer,
        });

        // When the payment method names a tracked card, create the card
        // transaction as a side effect of saving the expense - one form,
        // two records, joined by id - instead of making that a second,
        // separate act of discipline in the Cards tab. Best-effort: a
        // failure here shouldn't undo the expense that already saved fine.
        // A statement-only card tracks just its statement amounts - copying every entry would double-count them.
        const linkedCard = selectedInstrument?.cardId ? creditCards.find((c) => c.id === selectedInstrument.cardId) : null;
        const matchedCard = isStatementOnlyCard(linkedCard) ? null : linkedCard;
        if (matchedCard) {
          try {
            const params = resolveStrategyParamsForDate(matchedCard.strategyParamsHistory, date);
            const fields = inferCardRewardFields(matchedCard, category, params);
            const cardTransactionId = await addCardTransaction({
              cardId: matchedCard.id,
              amount: parsed,
              date,
              description: trimmedNote || category,
              linkedEntryId: newEntryId,
              ...fields,
            });
            await updateExpense(newEntryId, { cardTransactionId });
          } catch (err) {
            reportError(err, 'Saved the entry, but could not link it to the card');
          }
        }
      }
      setAmount('');
      setLocalAmount('');
      setRewardPoints('');
      setNote('');
      setDate(todayISO());
      setSplitAcrossMonths(false);
      setCustomShares({});
      setMonthsCount('6');
      setSplitAmong(membersList);
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not save', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 mb-4">
      <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-center justify-between">
        <Text className="font-display text-lg text-ink">
          Add Entry{isTravel && tripName ? ` (${tripName})` : ''}
        </Text>
        <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
          <Text className="font-body-semibold text-xs text-muted-text">{expanded ? 'Collapse' : 'Expand'}</Text>
        </View>
      </Pressable>

      {expanded && (
        <View className="mt-3">
          {recentCombinations.length > 0 && (
            <View className="mb-3">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1.5">Recent</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {recentCombinations.map((c) => (
                  <Pressable
                    key={`${c.category}|${c.payer}|${c.paymentMethod}`}
                    onPress={() => applyRecentCombination(c)}
                    className="min-h-9 px-3 rounded-full border border-ink/15 bg-paper items-center justify-center flex-row"
                  >
                    <Text className="font-body-medium text-xs text-ink">
                      {c.category} · {c.payer}
                      {c.paymentMethod ? ` · ${c.paymentMethod}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Quick Add and receipt scan are occasional tools, not core to
              every entry - collapsed by default behind one affordance
              instead of always occupying the top of the form. */}
          {!aiToolsOpen ? (
            <Pressable
              onPress={() => setAiToolsOpen(true)}
              className="rounded-xl border border-ledger-green/20 bg-ledger-green/5 px-3.5 py-2.5 mb-3 flex-row items-center justify-center"
            >
              <Text className="font-body-semibold text-xs text-ledger-green">✨ Quick Add / 📷 Scan Receipt</Text>
            </Pressable>
          ) : (
            <>
              <View className="rounded-xl border border-ledger-green/20 bg-ledger-green/5 px-3.5 py-3 mb-3">
                <View className="flex-row items-center justify-between gap-2 mb-1">
                  <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">
                    ✨ Quick Add - describe it in a sentence
                  </Text>
                  <Pressable onPress={() => setAiToolsOpen(false)} hitSlop={6}>
                    <Text className="font-body-semibold text-2xs text-muted-text">Hide</Text>
                  </Pressable>
                </View>
                <View className="flex-row gap-2">
                  <TextInput
                    value={quickAddText}
                    onChangeText={setQuickAddText}
                    onSubmitEditing={handleQuickAdd}
                    placeholder="e.g. 1200 dinner with Kruti last night"
                    className="flex-1 font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
                  />
                  <Pressable
                    onPress={handleQuickAdd}
                    disabled={!quickAddText.trim() || quickAddStatus.state === 'loading'}
                    className="shrink-0 min-h-11 px-4 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
                  >
                    {quickAddStatus.state === 'loading' ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text className="font-body-semibold text-sm text-white">Parse</Text>
                    )}
                  </Pressable>
                </View>
                {quickAddStatus.state === 'done' && (
                  <Text className="font-body text-2xs text-ledger-green mt-1.5">Filled in below - review and Add to Ledger.</Text>
                )}
                {quickAddStatus.state === 'error' && (
                  <Text className="font-body text-2xs text-stamp-red mt-1.5">{quickAddStatus.error}</Text>
                )}
              </View>

              <View className="rounded-xl border border-ledger-green/20 bg-ledger-green/5 px-3.5 py-3 mb-3">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text flex-1">
                    📷 Scan a receipt to auto-fill
                  </Text>
                  <Pressable
                    onPress={handleScanReceipt}
                    disabled={receiptStatus.state === 'loading'}
                    className="shrink-0 min-h-9 px-3.5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
                  >
                    {receiptStatus.state === 'loading' ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <Text className="font-body-semibold text-xs text-white">Take Photo</Text>
                    )}
                  </Pressable>
                </View>
                {receiptStatus.state === 'done' && (
                  <Text className="font-body text-2xs text-ledger-green mt-1.5">Filled in below - review and Add to Ledger.</Text>
                )}
                {receiptStatus.state === 'error' && (
                  <Text className="font-body text-2xs text-stamp-red mt-1.5">{receiptStatus.error}</Text>
                )}
              </View>
            </>
          )}

          <View className="flex-row flex-wrap" style={{ gap: 14 }}>
            <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
                Amount (₹){isTravel ? ' - real cost' : ''}
              </Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                editable={!amountLocked}
                placeholder="0.00"
                className={`font-mono-bold text-sm border border-ink/15 rounded-xl px-3 py-2.5 ${
                  amountLocked ? 'bg-paper/60 text-muted-text' : 'bg-paper text-ink'
                }`}
              />
              {amountLocked && fifoBreakdownText ? (
                <Text className="font-body text-2xs text-muted-text mt-1">{fifoBreakdownText}</Text>
              ) : null}
            </View>

            {isTravel && (
              <>
                <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
                  <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
                    Local Amount ({currentCurrency})
                  </Text>
                  <TextInput
                    value={localAmount}
                    onChangeText={setLocalAmount}
                    keyboardType="decimal-pad"
                    placeholder="Optional"
                    className="font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
                  />
                </View>

                <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
                  <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">
                    Reward Points (+ spent / − earned)
                  </Text>
                  <TextInput
                    value={rewardPoints}
                    onChangeText={setRewardPoints}
                    keyboardType="numbers-and-punctuation"
                    placeholder="Optional"
                    className="font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
                  />
                </View>
              </>
            )}

            <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
              <PickerField label="Split Type" value={splitType} options={SPLIT_TYPE_OPTIONS} onChange={setSplitType} />
            </View>

            <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
              <PickerField label="Who Paid" value={payer} options={membersList} onChange={setPayer} />
            </View>

            {splitType === 'owed' && (
              <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
                <PickerField
                  label="Who Owes the Full Amount"
                  value={owedBy}
                  options={membersList.filter((p) => p !== payer)}
                  onChange={setOwedBy}
                />
              </View>
            )}

            <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)] order-last lg:order-none">
              <PickerField
                label="Category"
                value={category}
                options={categories}
                onChange={setCategory}
                labelExtra={
                  note.trim() ? (
                    <Pressable onPress={handleSuggestCategory} disabled={suggestingCategory} hitSlop={6}>
                      <Text className="font-body-semibold text-2xs text-ledger-green">
                        {suggestingCategory ? 'Suggesting...' : '✨ Suggest'}
                      </Text>
                    </Pressable>
                  ) : null
                }
              />
              {categorySuggestError ? (
                <Text className="font-body text-2xs text-stamp-red mt-1">{categorySuggestError}</Text>
              ) : null}
            </View>

            <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
              <PickerField label="Payment Method" value={paymentMethod} options={paymentMethodOptions} onChange={handlePaymentMethodChange} />
            </View>

            <View className="w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
              <DateField
                value={date}
                onChange={setDate}
                className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
              />
            </View>

            <View className="w-full lg:w-[calc(33.333%-9.333px)]">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="What was this for?"
                className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
              />
            </View>
          </View>

          {rankedCards.length > 0 && (
            <Text className="font-body text-2xs text-muted-text mt-2">
              💳{' '}
              {rankedCards
                .map((r) => `${r.card.name || r.card.id} → ${r.unit === 'points' ? `${Math.round(r.earned).toLocaleString('en-IN')} pts` : formatCurrency(r.earned)}`)
                .join('. ')}
              {rankedCards[0].capStatus.length > 0
                ? `. ${rankedCards[0].card.name || rankedCards[0].card.id} cap: ${rankedCards[0].capStatus
                    .map((c) => (c.unit === 'points' ? `${Math.round(c.remaining).toLocaleString('en-IN')} pts` : formatCurrency(c.remaining)))
                    .join(', ')} left this ${rankedCards[0].capStatus[0].capPeriod}.`
                : ''}
            </Text>
          )}

          {splitType === 'custom' && (
            <CustomSplitEditor members={membersList} total={parseFloat(amount) || 0} shares={customShares} onChange={setCustomShares} />
          )}

          {splitType === 'shared' && membersList.length > 2 && (
            <View className="mt-3">
              <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Split Among</Text>
              <View className="flex-row flex-wrap">
                {membersList.map((m) => (
                  <Chip key={m} label={m} selected={splitAmong.includes(m)} onPress={() => toggleSplitAmong(m)} />
                ))}
              </View>
              {splitAmong.length < membersList.length && (
                <Text className="font-body text-2xs text-muted-text mt-1">
                  Only split between {splitAmong.join(' and ')} - not everyone.
                </Text>
              )}
            </View>
          )}

          {!isTravel && (
            <View className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 mb-3 mt-3">
              <Pressable onPress={() => setSplitAcrossMonths((v) => !v)} className="flex-row items-center gap-2.5">
                <View
                  className={`w-4 h-4 rounded border items-center justify-center ${
                    splitAcrossMonths ? 'bg-ledger-green border-ledger-green' : 'border-ink/30 bg-paper'
                  }`}
                >
                  {splitAcrossMonths && <Text className="text-white text-xs">✓</Text>}
                </View>
                <Text className="font-body-semibold text-sm text-ink flex-1">Split across multiple months</Text>
              </Pressable>
              <Text className="font-body text-2xs text-muted-text mt-1 ml-7">
                For lump-sum payments that cover several months - spreads the amount evenly across one entry per month.
              </Text>

              {splitAcrossMonths && (
                <View className="mt-3 ml-7 max-w-[8rem]">
                  <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Number of Months</Text>
                  <TextInput
                    value={monthsCount}
                    onChangeText={setMonthsCount}
                    keyboardType="number-pad"
                    className="font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper shadow-2xs"
                  />
                  {amount && parseFloat(amount) > 0 && (
                    <Text className="font-body text-2xs text-muted-text mt-1">
                      ~{(parseFloat(amount) / Math.max(2, Math.min(36, Math.round(Number(monthsCount)) || 2))).toFixed(2)} / month
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={saving || !amount || customSplitInvalid}
            className={`mt-3 min-h-11 rounded-xl bg-ledger-green items-center justify-center ${!saving && (!amount || customSplitInvalid) ? 'opacity-40' : ''}`}
            style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
          >
            {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-sm text-white">Add to Ledger</Text>}
          </Pressable>
        </View>
      )}
    </Card>
  );
}
