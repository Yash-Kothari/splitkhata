import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { notify, confirmAsync } from '../lib/dialogs';
import * as ImagePicker from 'expo-image-picker';
import Card from './Card';
import EntryFormFields from './EntryFormFields';
import { useEntryForm } from '../lib/useEntryForm';
import { addExpense, addExpensesBatch, addCardTransactionAndLink, generateStructured, extractReceiptFromImage } from '../lib/firebase';
import { reportError } from '../lib/errorReporting';
import {
  isStatementOnlyCard,
  parseCustomShares,
  DEFAULT_PERSONS as PERSONS,
  DEFAULT_CATEGORIES,
  DEFAULT_TRAVEL_CATEGORIES,
  todayISO,
  addMonthsToDateISO,
  splitAmountEvenly,
  generateGroupId,
  buildQuickAddPrompt,
  buildQuickAddSchema,
  buildCategorySuggestionPrompt,
  buildCategorySuggestionSchema,
  buildReceiptExtractionPrompt,
  buildReceiptExtractionSchema,
  rankCardsForEntry,
  getRecentCombinations,
  suggestFromNote,
  inferCardRewardFields,
  resolveStrategyParamsForDate,
  formatCurrency,
  parseAmountInput,
  findPossibleDuplicateEntry,
  parseTagsInput,
} from '../lib/utils';
import { shadowStyle } from '../lib/shadow';

// Add Entry. The fields themselves, their defaults and their validation are the
// same ones Edit Entry uses (useEntryForm + EntryFormFields); what lives here is
// only what belongs to creating an entry: Recent chips, Quick Add / receipt
// scan, the "as before" suggestion, the card and cash hints, installments, and
// the save (which also creates the linked card transaction).
export default function AddEntryForm({
  deviceName,
  onSaveError,
  ledger = 'household',
  tripName = '',
  tripId = '',
  dbCategories,
  dbMembers = [],
  currentCurrency = 'INR',
  instruments: instrumentsProp,
  tripEntries = [],
  cashBalance = null,
  creditCards = [],
  cardTransactions = [],
  recentEntries = [],
}) {
  const isTravel = ledger === 'travel';
  const categories =
    dbCategories && dbCategories.length > 0 ? dbCategories : isTravel ? DEFAULT_TRAVEL_CATEGORIES : DEFAULT_CATEGORIES;
  const membersList = dbMembers && dbMembers.length > 0 ? dbMembers : PERSONS;

  const [splitAcrossMonths, setSplitAcrossMonths] = useState(false);
  const [monthsCount, setMonthsCount] = useState('6');
  const f = useEntryForm({
    ledger,
    categories,
    members: membersList,
    instruments: instrumentsProp,
    creditCards,
    cardTransactions,
    currentCurrency,
    tripEntries,
    recentEntries,
    deviceName,
    extraMoreOpen: splitAcrossMonths,
  });
  const { payer, category, splitType, owedBy, splitAmong, customShares, date, note, paymentMethod, selectedInstrument } = f;

  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddStatus, setQuickAddStatus] = useState({ state: 'idle', error: '' });
  const [suggestingCategory, setSuggestingCategory] = useState(false);
  const [categorySuggestError, setCategorySuggestError] = useState('');
  const [receiptStatus, setReceiptStatus] = useState({ state: 'idle', error: '' });

  // Which tracked card would earn the most on this specific entry, right
  // where the amount/category are being typed - the reward engine already
  // models every card's real terms, this just surfaces it at the moment
  // it's actually useful instead of only in the Cards tab after the fact.
  const rankedCards = useMemo(
    () =>
      rankCardsForEntry(
        creditCards,
        cardTransactions,
        parseAmountInput(f.amount) || 0,
        category,
        date,
        f.effectiveTravelMultiplier ? { cardId: f.selectedCardId, multiplier: f.effectiveTravelMultiplier } : null,
        { bookings: !isTravel },
      ),
    [creditCards, cardTransactions, f.amount, category, date, f.effectiveTravelMultiplier, f.selectedCardId, isTravel],
  );

  // Real household spending repeats far more than a blank form assumes -
  // one tap on a recent combination fills category/payer/payment method,
  // leaving only the amount to type.
  const recentCombinations = useMemo(() => getRecentCombinations(recentEntries), [recentEntries]);
  // "Uber" typed -> what earlier "Uber" entries used, as a tap-to-apply chip.
  // Never applied on its own: category drives card rewards and budgets.
  const noteSuggestion = useMemo(() => {
    const suggestion = suggestFromNote(recentEntries, note);
    if (!suggestion || !categories.includes(suggestion.category)) return null;
    const method = suggestion.paymentMethod && f.paymentMethodOptions.includes(suggestion.paymentMethod) ? suggestion.paymentMethod : null;
    return suggestion.category === category && (!method || method === paymentMethod) ? null : { ...suggestion, paymentMethod: method };
  }, [recentEntries, note, category, paymentMethod, categories, f.paymentMethodOptions]);
  function applyRecentCombination(combo) {
    f.setCategory(combo.category);
    f.setPayer(combo.payer);
    if (combo.paymentMethod) f.setPaymentMethod(combo.paymentMethod);
  }

  // Pre-fills the form from a casual sentence - never submits on its own.
  // The user still reviews every field and taps Add to Ledger themselves,
  // same as if they'd typed it all by hand.
  async function handleQuickAdd() {
    const text = quickAddText.trim();
    // The keyboard's return key also calls this - ignore it while a request is
    // already running, or repeated presses fired duplicate AI calls.
    if (!text || quickAddStatus.state === 'loading') return;
    setQuickAddStatus({ state: 'loading', error: '' });
    try {
      const schema = buildQuickAddSchema({
        categories,
        members: membersList,
        paymentMethods: f.paymentMethodOptions,
        isTravel,
      });
      const prompt = buildQuickAddPrompt(text, { members: membersList, today: todayISO() });
      const parsed = await generateStructured(prompt, schema);

      f.setAmount(String(parsed.amount ?? ''));
      if (parsed.category && categories.includes(parsed.category)) f.setCategory(parsed.category);
      if (parsed.payer && membersList.includes(parsed.payer)) f.setPayer(parsed.payer);
      if (parsed.splitType) f.setSplitType(parsed.splitType);
      if (parsed.splitType === 'custom' && Array.isArray(parsed.splitShares)) {
        f.setCustomShares(
          Object.fromEntries(
            parsed.splitShares.filter((s) => membersList.includes(s.person) && Number(s.amount) > 0).map((s) => [s.person, String(s.amount)]),
          ),
        );
      }
      if (parsed.splitType === 'owed' && parsed.owedBy && membersList.includes(parsed.owedBy)) {
        f.setOwedBy(parsed.owedBy);
      }
      if (parsed.note) f.setNote(parsed.note);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '')) f.setDate(parsed.date);
      if (isTravel && parsed.paymentMethod && f.paymentMethodOptions.includes(parsed.paymentMethod)) {
        f.setPaymentMethod(parsed.paymentMethod);
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
      notify('Camera access needed', 'Allow camera access to scan a receipt.');
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

      if (parsed.amount) f.setAmount(String(parsed.amount));
      if (parsed.category && categories.includes(parsed.category)) f.setCategory(parsed.category);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '')) f.setDate(parsed.date);
      if (parsed.note) f.setNote(parsed.note);

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
      if (result.category && categories.includes(result.category)) f.setCategory(result.category);
    } catch (err) {
      setCategorySuggestError(err?.message || 'Could not suggest a category.');
    } finally {
      setSuggestingCategory(false);
    }
  }

  async function handleSubmit() {
    const parsed = parseAmountInput(f.amount);
    if (parsed == null || f.inputInvalid) return;
    if (splitType === 'owed' && (!owedBy || owedBy === payer)) {
      notify('Pick who owes', 'The person who owes must be different from who paid.');
      return;
    }

    const duplicate = findPossibleDuplicateEntry(recentEntries, { category, payer, amount: parsed, date });
    if (duplicate) {
      const proceed = await confirmAsync({
        title: 'Possible duplicate',
        message: `${formatCurrency(parsed)} for ${category} paid by ${payer} is already logged on ${date}${duplicate.note ? ` ("${duplicate.note}")` : ''}. Add this one too?`,
        confirmLabel: 'Add anyway',
        destructive: false,
      });
      if (!proceed) return;
    }

    setSaving(true);

    const resetForm = () => {
      f.setAmount('');
      f.setLocalAmount('');
      f.setRewardPoints('');
      f.setNote('');
      f.setTagsText('');
      f.setTravelMultiplier('');
      f.setDate(todayISO());
      setSplitAcrossMonths(false);
      f.setMoreToggle(null);
      f.setCustomShares({});
      setMonthsCount('6');
      f.setSplitAmong(membersList);
    };

    const savePromise = doSave();
    // Firestore applies a write to its local cache (and this form's job is
    // done from the user's point of view) well before the awaited promise
    // below actually resolves - that only happens once the server
    // acknowledges it, which can hang indefinitely while offline. Rather
    // than let the button spin forever for a write that already "happened"
    // locally, give it a few seconds, then hand off and let it keep going
    // in the background (still visible via ConnectionBanner's pending-write
    // count) instead of freezing the form.
    const settled = savePromise.then(() => ({ status: 'done' })).catch((error) => ({ status: 'error', error }));
    const timedOut = new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 4000));
    const outcome = await Promise.race([settled, timedOut]);

    setSaving(false);
    if (outcome.status === 'error') {
      onSaveError?.(outcome.error);
      notify('Could not save', outcome.error?.message || String(outcome.error));
      return;
    }
    resetForm();
    if (outcome.status === 'timeout') {
      settled.then((result) => {
        if (result.status === 'error') {
          onSaveError?.(result.error);
          notify('Could not save', result.error?.message || String(result.error));
        }
      });
    }
  }

  async function doSave() {
    const parsed = parseAmountInput(f.amount);
    const trimmedNote = note.trim();
    const tags = parseTagsInput(f.tagsText);
    const months = !isTravel && splitAcrossMonths ? Math.max(2, Math.min(36, Math.round(Number(monthsCount)) || 2)) : 1;
    const parsedLocal = isTravel && f.localAmount ? parseAmountInput(f.localAmount) : null;
    const parsedPoints = isTravel && f.rewardPoints ? parseAmountInput(f.rewardPoints, { allowNegative: true }) : null;
    const effectiveSplitAmong =
      splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < membersList.length ? splitAmong : null;
    const { cardSkipped, effectiveTravelMultiplier } = f;

    if (months > 1) {
      const installmentAmounts = splitAmountEvenly(parsed, months);
      const installmentGroupId = generateGroupId('inst');
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
        tags,
        date: addMonthsToDateISO(date, i),
        ledger,
        tripId: isTravel ? tripId : null,
        paymentMethod: paymentMethod || null,
        paymentInstrumentId: selectedInstrument?.id || null,
        paymentType: selectedInstrument?.type || null,
        deviceName: deviceName || payer,
        skipCardTracking: cardSkipped || null,
        installmentGroupId,
        installmentIndex: i + 1,
        installmentCount: months,
      }));
      const createdIds = await addExpensesBatch(installments);

      // Same best-effort card-linking the single-entry path below does, just
      // once per installment instead of once - each installment gets its own
      // CardTransaction, dated and reward-computed against its own month, not
      // the purchase's original date (P1-14 - installments used to drop the
      // card entirely, since addExpensesBatch never did this step).
      const linkedCard = selectedInstrument?.cardId ? creditCards.find((c) => c.id === selectedInstrument.cardId) : null;
      // No card transaction for a ₹0 entry - there is no spend to earn on.
      const matchedCard = isStatementOnlyCard(linkedCard) || parsed === 0 || cardSkipped ? null : linkedCard;
      if (matchedCard) {
        for (let i = 0; i < installments.length; i += 1) {
          const inst = installments[i];
          try {
            const params = resolveStrategyParamsForDate(matchedCard.strategyParamsHistory, inst.date);
            const fields = inferCardRewardFields(matchedCard, inst.category, params, effectiveTravelMultiplier, { bookings: !isTravel });
            await addCardTransactionAndLink(createdIds[i], {
              cardId: matchedCard.id,
              amount: inst.amount,
              date: inst.date,
              description: inst.note || inst.category,
              ...fields,
            });
          } catch (err) {
            reportError(err, 'Saved the installment, but could not link it to the card');
          }
        }
      }
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
        tags,
        date,
        ledger,
        tripId: isTravel ? tripId : null,
        paymentMethod: paymentMethod || null,
        paymentInstrumentId: selectedInstrument?.id || null,
        paymentType: selectedInstrument?.type || null,
        localAmount: parsedLocal,
        rewardPoints: parsedPoints,
        skipCardTracking: cardSkipped || null,
        deviceName: deviceName || payer,
      });

      // When the payment method names a tracked card, create the card
      // transaction as a side effect of saving the expense - one form,
      // two records, joined by id - instead of making that a second,
      // separate act of discipline in the Cards tab. Best-effort: a
      // failure here shouldn't undo the expense that already saved fine.
      // A statement-only card tracks just its statement amounts - copying every entry would double-count them.
      const linkedCard = selectedInstrument?.cardId ? creditCards.find((c) => c.id === selectedInstrument.cardId) : null;
      const matchedCard = isStatementOnlyCard(linkedCard) || parsed === 0 || cardSkipped ? null : linkedCard;
      if (matchedCard) {
        try {
          const params = resolveStrategyParamsForDate(matchedCard.strategyParamsHistory, date);
          const fields = inferCardRewardFields(matchedCard, category, params, effectiveTravelMultiplier, { bookings: !isTravel });
          await addCardTransactionAndLink(newEntryId, {
            cardId: matchedCard.id,
            amount: parsed,
            date,
            description: trimmedNote || category,
            ...fields,
          });
        } catch (err) {
          reportError(err, 'Saved the entry, but could not link it to the card');
        }
      }
    }
  }

  const cashHint =
    isTravel && cashBalance != null && selectedInstrument?.type === 'cash'
      ? (() => {
          const afterThis = cashBalance - (parseAmountInput(f.localAmount) || 0);
          return (
            <Text className={`font-mono-bold text-xs mt-2 ${afterThis < 0 ? 'text-stamp-red' : 'text-ledger-green'}`}>
              💵 Cash left: {currentCurrency} {cashBalance.toFixed(2)}
              {parseAmountInput(f.localAmount) > 0 ? ` → ${afterThis.toFixed(2)} after this` : ''}
            </Text>
          );
        })()
      : null;

  const cardHint =
    rankedCards.length > 0
      ? (() => {
          // Caps are shown for the card actually being paid with (the top-ranked
          // one only when paying with cash/UPI), each labelled, and as they'd
          // stand after this entry is logged.
          const capCard = rankedCards.find((r) => r.card.id === f.selectedCardId) || rankedCards[0];
          const periodWord = { day: 'today', cycle: 'this cycle', month: 'this month' };
          const capText = (c) =>
            `${c.label} ${c.unit === 'points' ? `${Math.round(c.remaining).toLocaleString('en-IN')} pts` : formatCurrency(c.remaining)} left ${periodWord[c.capPeriod] || 'this month'}`;
          return (
            <Text className="font-body text-2xs text-muted-text mt-2">
              💳{' '}
              {rankedCards
                .map((r) => `${r.card.name || r.card.id} → ${r.unit === 'points' ? `${Math.round(r.earned).toLocaleString('en-IN')} pts` : formatCurrency(r.earned)}`)
                .join('. ')}
              {capCard.capStatus.length > 0
                ? `. ${capCard.card.name || capCard.card.id} after this entry: ${capCard.capStatus.map(capText).join(', ')}.`
                : ''}
            </Text>
          );
        })()
      : null;

  const noteChip = noteSuggestion ? (
    <Pressable
      onPress={() => {
        f.setCategory(noteSuggestion.category);
        if (noteSuggestion.paymentMethod) f.handlePaymentMethodChange(noteSuggestion.paymentMethod);
      }}
      className="self-start mt-1.5 min-h-8 px-3 rounded-full border border-ledger-green/40 bg-ledger-green/10 items-center justify-center"
    >
      <Text className="font-body-semibold text-xs text-ledger-green">
        💡 {noteSuggestion.category}
        {noteSuggestion.paymentMethod ? ` · ${noteSuggestion.paymentMethod}` : ''} (as before)
      </Text>
    </Pressable>
  ) : null;

  const splitAcrossMonthsBox = !isTravel ? (
    <View className="rounded-xl border border-ink/10 bg-paper/60 px-3.5 py-3 mt-3">
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
          {parseAmountInput(f.amount) > 0 && (
            <Text className="font-body text-2xs text-muted-text mt-1">
              ~{(parseAmountInput(f.amount) / Math.max(2, Math.min(36, Math.round(Number(monthsCount)) || 2))).toFixed(2)} / month
            </Text>
          )}
        </View>
      )}
    </View>
  ) : null;

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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
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
              </ScrollView>
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
                    returnKeyType="done"
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

          <EntryFormFields
            f={f}
            categories={categories}
            members={membersList}
            currentCurrency={currentCurrency}
            categoryLabelExtra={
              note.trim() ? (
                <Pressable onPress={handleSuggestCategory} disabled={suggestingCategory} hitSlop={6}>
                  <Text className="font-body-semibold text-2xs text-ledger-green">
                    {suggestingCategory ? 'Suggesting...' : '✨ Suggest'}
                  </Text>
                </Pressable>
              ) : null
            }
            categoryError={categorySuggestError}
            noteExtra={noteChip}
            afterFields={
              <>
                {cashHint}
                {cardHint}
              </>
            }
            moreExtra={splitAcrossMonthsBox}
          />

          <Pressable
            onPress={handleSubmit}
            disabled={saving || !f.amount || f.customSplitInvalid || f.inputInvalid}
            className={`mt-3 min-h-11 rounded-xl bg-ledger-green items-center justify-center ${!saving && (!f.amount || f.customSplitInvalid || f.inputInvalid) ? 'opacity-40' : ''}`}
            style={shadowStyle({ color: '#000000', x: 0, y: 1, blur: 2, opacity: 0.05, elevation: 1 })}
          >
            {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-sm text-white">Add to Ledger</Text>}
          </Pressable>
        </View>
      )}
    </Card>
  );
}
