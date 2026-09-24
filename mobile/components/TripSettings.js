import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { notify, confirmAsync } from '../lib/dialogs';
import PickerField from './PickerField';
import DateField from './DateField';
import { updateTripInDb, deleteTripCascade, addWithdrawal, setOpeningCash as setOpeningCashInDb, addGuestToDb, deleteGuestFromDb, renameGuestInDb } from '../lib/firebase';
import { computeBudgetStatus, formatCurrency, groupByCategory, normalizeLedger, todayISO, parseAmountInput, isValidISODate } from '../lib/utils';

function Tag({ label, onRemove, onEdit, removable = true }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-md border border-ink/10 bg-paper px-2.5 py-1.5 mr-1.5 mb-1.5">
      <Text className="font-body-medium text-xs text-ink">{label}</Text>
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

const fieldLabel = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const inputBox = 'font-mono text-base text-ink border border-ink/15 rounded-lg px-3 py-2.5 bg-paper shadow-2xs';
const dateBox = 'font-body-medium text-sm text-ink border border-ink/15 rounded-lg px-3 py-2.5 bg-paper shadow-2xs w-full';
const sectionTitle = 'font-body-semibold text-sm text-ink mb-2';

// RN full-screen Modal port of TravelManager.jsx's Trip Settings overlay.
export default function TripSettings({
  visible,
  onClose,
  trip,
  trips,
  entries,
  dbCategories,
  instruments = [],
  dbMembers,
  dbGuests = [],
  guestRawDocs = [],
  currentCurrency,
  onSaveError,
  onTripDeleted,
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Native always fills the physical screen, so a real full-screen slide-up
  // panel is right there - only a wide browser window needs this capped to
  // a centered dialog instead of stretching a settings form edge to edge.
  const isWide = windowWidth >= 768;
  const [datesStart, setDatesStart] = useState('');
  const [datesEnd, setDatesEnd] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalInr, setWithdrawalInr] = useState('');
  const [withdrawalDate, setWithdrawalDate] = useState(todayISO());
  const [withdrawalPayer, setWithdrawalPayer] = useState('');
  const [withdrawalPaymentMethod, setWithdrawalPaymentMethod] = useState('');
  // A withdrawal is the card/forex charge that carries the shared debt for
  // the cash - saving one as "Cash" dropped it from every trip total (so the
  // other person's half vanished) and zeroed the Cash Balance tile. Cash
  // itself is never offered here.
  const withdrawalInstruments = instruments.filter((i) => i.type !== 'cash');
  const [guestDraft, setGuestDraft] = useState('');
  const [editingGuest, setEditingGuest] = useState(null);
  const [savingGuestRename, setSavingGuestRename] = useState(false);
  const [tripBudgetDrafts, setTripBudgetDrafts] = useState({});
  const [newBudgetCategory, setNewBudgetCategory] = useState('');
  const [newBudgetAmount, setNewBudgetAmount] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!trip) return;
    setDatesStart(trip.startDate || '');
    setDatesEnd(trip.endDate || '');
    setTripBudgetDrafts({ ...(trip.categoryBudgets || {}) });
    setWithdrawalPayer(dbMembers[0] || '');
    setWithdrawalPaymentMethod(withdrawalInstruments[0]?.label || '');
  }, [trip?.id]);

  // Instruments can load after the trip does - keep the picker on a real option.
  const withdrawalLabels = withdrawalInstruments.map((i) => i.label).join('|');
  useEffect(() => {
    if (!withdrawalInstruments.some((i) => i.label === withdrawalPaymentMethod)) {
      setWithdrawalPaymentMethod(withdrawalInstruments[0]?.label || '');
    }
  }, [withdrawalLabels]);

  const tripGuests = trip?.guests || [];

  const tripCategoryTotals = useMemo(
    () => groupByCategory(entries.filter((e) => normalizeLedger(e.ledger) === 'travel' && e.tripName === trip?.name), null, 'travel'),
    [entries, trip?.name],
  );
  const tripBudgetStatus = useMemo(
    () => computeBudgetStatus(tripCategoryTotals, tripBudgetDrafts),
    [tripCategoryTotals, tripBudgetDrafts],
  );
  const budgetedNames = new Set(tripBudgetStatus.map((s) => s.category));
  const unbudgetedCategories = dbCategories.filter((c) => !budgetedNames.has(c));

  async function persistBudgets(next) {
    if (!trip) return;
    try {
      await updateTripInDb(trip.id, { categoryBudgets: next });
      setTripBudgetDrafts(next);
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleSaveDates() {
    if (!trip) return;
    // Dates must be real YYYY-MM-DD dates, and the trip can't end before it starts.
    if ((datesStart && !isValidISODate(datesStart)) || (datesEnd && !isValidISODate(datesEnd))) {
      notify('Check the dates', 'Use the format YYYY-MM-DD.');
      return;
    }
    if (datesStart && datesEnd && datesEnd < datesStart) {
      notify('Check the dates', 'The end date is before the start date.');
      return;
    }
    try {
      await updateTripInDb(trip.id, { startDate: datesStart || null, endDate: datesEnd || null });
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleSaveCash() {
    const parsed = parseAmountInput(openingCash);
    if (!(parsed > 0)) {
      notify('Check the amount', 'Enter an amount like 20000 or 20,000.');
      return;
    }
    try {
      await setOpeningCashInDb(trip.name, trip.id, parsed);
      setOpeningCash('');
      notify('Starting cash set', `Starting cash for this trip is now ${parsed.toLocaleString('en-IN')} ${currentCurrency || ''}.`.trim());
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleAddWithdrawal() {
    const parsedWithdrawal = parseAmountInput(withdrawalAmount);
    const parsedInr = parseAmountInput(withdrawalInr);
    if (!(parsedWithdrawal > 0) || !(parsedInr > 0) || !withdrawalPayer) {
      notify('Missing info', 'Amount, INR cost, and who withdrew it are all required. Amounts look like 1200 or 1,200.50.');
      return;
    }
    const withdrawalInstrument = withdrawalInstruments.find((i) => i.label === withdrawalPaymentMethod);
    if (!withdrawalInstrument) {
      notify('Pick the card or account', 'Choose the card or forex account the cash came from.');
      return;
    }
    if (!isValidISODate(withdrawalDate)) {
      notify('Check the date', 'Use the format YYYY-MM-DD.');
      return;
    }
    try {
      await addWithdrawal({ tripName: trip.name, type: 'withdrawal', amount: parsedWithdrawal, date: withdrawalDate }, {
        amount: parsedInr,
        localAmount: parsedWithdrawal,
        payer: withdrawalPayer,
        category: 'Misc',
        split: true,
        splitType: 'shared',
        owedBy: null,
        note: `${currentCurrency || 'Local'} ATM Withdrawal`,
        date: withdrawalDate,
        ledger: 'travel',
        tripName: trip.name,
        paymentMethod: withdrawalInstrument.label,
        paymentInstrumentId: withdrawalInstrument.id,
        paymentType: withdrawalInstrument.type || null,
        isWithdrawal: true,
      });
      setWithdrawalAmount('');
      setWithdrawalInr('');
      setWithdrawalDate(todayISO());
    } catch (err) {
      onSaveError?.(err);
      notify('Could not record withdrawal', err?.message || String(err));
    }
  }

  async function handleSaveRenamedGuest() {
    if (!editingGuest?.name.trim()) return;
    const trimmed = editingGuest.name.trim();
    const taken = [...dbMembers, ...tripGuests].some((n) => n.toLowerCase() === trimmed.toLowerCase() && n !== editingGuest.oldName);
    if (taken) {
      notify('Name already in use', `"${trimmed}" is already a member or guest.`);
      return;
    }
    setSavingGuestRename(true);
    try {
      await renameGuestInDb(editingGuest.oldName, trimmed, guestRawDocs);
      setEditingGuest(null);
    } catch (err) {
      onSaveError?.(err);
    } finally {
      setSavingGuestRename(false);
    }
  }

  async function handleAddGuest() {
    const trimmed = guestDraft.trim();
    if (!trimmed || !trip) return;
    const taken = [...dbMembers, ...tripGuests].some((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (taken) {
      notify('Name already in use', `"${trimmed}" is already a member or guest.`);
      return;
    }
    try {
      await updateTripInDb(trip.id, { guests: [...tripGuests, trimmed] });
      setGuestDraft('');
      await addGuestToDb(trimmed, guestRawDocs);
    } catch (err) {
      onSaveError?.(err);
    }
  }

  // Adding a name already in the directory skips straight to the trip -
  // no need to re-type it or re-check the taken-name guard, since it was
  // already checked once when this name first entered the directory.
  async function handleAddKnownGuest(name) {
    if (!trip) return;
    try {
      await updateTripInDb(trip.id, { guests: [...tripGuests, name] });
    } catch (err) {
      onSaveError?.(err);
    }
  }

  const knownGuestSuggestions = dbGuests.filter(
    (g) => !tripGuests.some((tg) => tg.toLowerCase() === g.toLowerCase()) && !dbMembers.some((m) => m.toLowerCase() === g.toLowerCase()),
  );

  async function handleDeleteTrip() {
    try {
      await deleteTripCascade(trip);
      setConfirmingDelete(false);
      onTripDeleted?.();
      onClose?.();
    } catch (err) {
      onSaveError?.(err);
    }
  }

  const tripEntriesForDelete = (entries || []).filter((e) => normalizeLedger(e.ledger) === 'travel' && e.tripName === trip?.name);

  if (!trip) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={isWide} onRequestClose={onClose}>
      <View className={isWide ? 'flex-1 bg-black/40 items-center justify-center' : 'flex-1'}>
        <View
          className={isWide ? 'w-full rounded-2xl bg-paper overflow-hidden' : 'flex-1 bg-paper'}
          style={isWide ? { maxWidth: 560, maxHeight: Math.round(windowHeight * 0.85) } : undefined}
        >
        <View className={`flex-row items-center justify-between px-4 pb-3 border-b border-ink/10 bg-paper-card ${isWide ? 'pt-4' : 'pt-14'}`}>
          <Text className="font-display text-lg text-ink flex-1" numberOfLines={1}>
            {trip.name} Settings
          </Text>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-full border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-ink">✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text className={sectionTitle}>Trip Dates</Text>
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <View className="w-full sm:w-[calc(50%-6px)]">
              <Text className={fieldLabel}>Start Date</Text>
              <DateField value={datesStart} onChange={setDatesStart} className={dateBox} />
            </View>
            <View className="w-full sm:w-[calc(50%-6px)]">
              <Text className={fieldLabel}>End Date</Text>
              <DateField value={datesEnd} onChange={setDatesEnd} className={dateBox} />
            </View>
            <Pressable onPress={handleSaveDates} className="w-full min-h-11 rounded-lg border border-ink/15 items-center justify-center">
              <Text className="font-body-semibold text-sm text-ink">Save Dates</Text>
            </Pressable>
            <Text className="w-full font-body text-2xs text-muted-text">
              Sets when {trip.name} counts as your active trip, so it surfaces automatically without searching.
            </Text>
          </View>

          <View className="border-t border-ink/10 pt-4 mt-5 mb-5">
            <Text className={sectionTitle}>Starting Cash</Text>
            <Text className={fieldLabel}>Amount ({currentCurrency || 'Local'})</Text>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <TextInput
                value={openingCash}
                onChangeText={setOpeningCash}
                keyboardType="decimal-pad"
                placeholder="0"
                className={`flex-1 min-w-0 ${inputBox}`}
                style={{ minWidth: 0 }}
              />
              <Pressable onPress={handleSaveCash} className="min-h-11 px-5 shrink-0 rounded-lg bg-ledger-green items-center justify-center">
                <Text className="font-body-semibold text-sm text-white">Set Starting Cash</Text>
              </Pressable>
            </View>
          </View>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className={sectionTitle}>ATM Cash Withdrawal</Text>
            <View className="flex-row flex-wrap" style={{ gap: 12 }}>
              <View className="w-full sm:w-[calc(50%-6px)]">
                <Text className={fieldLabel}>Amount withdrawn ({currentCurrency || 'Local'})</Text>
                <TextInput
                  value={withdrawalAmount}
                  onChangeText={setWithdrawalAmount}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  className={inputBox}
                />
              </View>
              <View className="w-full sm:w-[calc(50%-6px)]">
                <Text className={fieldLabel}>INR cost (required)</Text>
                <TextInput
                  value={withdrawalInr}
                  onChangeText={setWithdrawalInr}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  className={inputBox}
                />
              </View>
              <View className="w-full sm:w-[calc(50%-6px)]">
                <Text className={fieldLabel}>Date</Text>
                <DateField value={withdrawalDate} onChange={setWithdrawalDate} className={dateBox} />
              </View>
              <View className="w-full sm:w-[calc(50%-6px)]">
                <PickerField label="Withdrawn By" value={withdrawalPayer} options={dbMembers} onChange={setWithdrawalPayer} />
              </View>
              <View className="w-full">
                {withdrawalInstruments.length ? (
                  <PickerField
                    label="Card / method used"
                    value={withdrawalPaymentMethod}
                    options={withdrawalInstruments.map((i) => i.label)}
                    onChange={setWithdrawalPaymentMethod}
                  />
                ) : (
                  <Text className="font-body text-xs text-stamp-red">
                    Add the card or forex account you withdraw with in Settings → Payment Methods first.
                  </Text>
                )}
              </View>
              <Text className="w-full font-body text-2xs text-muted-text">
                This is the only place to record an ATM withdrawal. The INR cost is required - it's what registers the joint
                debt above and gives every "Cash" purchase you add afterward its rate, so nothing needs pricing by hand.
              </Text>
              <Pressable
                onPress={handleAddWithdrawal}
                disabled={!withdrawalInstruments.length}
                className={`w-full min-h-11 rounded-lg border border-ink/15 items-center justify-center ${withdrawalInstruments.length ? '' : 'opacity-40'}`}
              >
                <Text className="font-body-semibold text-sm text-ink">Record Withdrawal</Text>
              </Pressable>
            </View>
          </View>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className={sectionTitle}>Category Budgets (this trip)</Text>
            <Text className="font-body text-2xs text-muted-text mb-2">
              Pick a category and set a limit for the whole trip, not per month. Nothing is flagged until you set one. Warns at 80% of the limit, alerts once it's exceeded.
              Manage the travel category list itself from Settings, since it's shared across every trip.
            </Text>
            {unbudgetedCategories.length > 0 && (
              <View className="flex-row items-end mb-3" style={{ gap: 8 }}>
                <View className="flex-1 min-w-0">
                  <PickerField label="Category" value={newBudgetCategory || 'Select...'} options={unbudgetedCategories} onChange={setNewBudgetCategory} />
                </View>
                <View className="w-28">
                  <Text className={fieldLabel}>Limit (₹)</Text>
                  <TextInput
                    value={newBudgetAmount}
                    onChangeText={setNewBudgetAmount}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    className={inputBox}
                  />
                </View>
                <Pressable
                  onPress={() => {
                    const amt = parseAmountInput(newBudgetAmount);
                    if (!newBudgetCategory) return;
                    if (!(amt > 0)) {
                      notify('Check the amount', 'Enter a budget like 50000 or 50,000.');
                      return;
                    }
                    persistBudgets({ ...tripBudgetDrafts, [newBudgetCategory]: amt });
                    setNewBudgetCategory('');
                    setNewBudgetAmount('');
                  }}
                  className="min-h-11 px-5 shrink-0 rounded-lg bg-ledger-green items-center justify-center"
                >
                  <Text className="font-body-semibold text-sm text-white">Add</Text>
                </Pressable>
              </View>
            )}
            {tripBudgetStatus.map((s) => (
              <View key={s.category} className="mb-3">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="font-body-medium text-xs text-ink">{s.category}</Text>
                  <Pressable
                    onPress={async () => {
                      if (!(await confirmAsync({ title: `Remove the ${s.category} budget for this trip?`, message: 'Your entries are not affected.', confirmLabel: 'Remove' }))) return;
                      const next = { ...tripBudgetDrafts };
                      delete next[s.category];
                      persistBudgets(next);
                    }}
                  >
                    <Text className="font-body-semibold text-xs text-muted-text">Remove</Text>
                  </Pressable>
                </View>
                <View className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
                  <View
                    className={`h-full rounded-full ${s.pctUsed >= 1 ? 'bg-stamp-red' : s.pctUsed >= 0.8 ? 'bg-mustard' : 'bg-ledger-green'}`}
                    style={{ width: `${Math.min(s.pctUsed * 100, 100)}%` }}
                  />
                </View>
                <Text className="font-body text-2xs text-muted-text mt-1">
                  {formatCurrency(s.spent)} of {formatCurrency(s.limit)} ({Math.round(s.pctUsed * 100)}%)
                </Text>
              </View>
            ))}
          </View>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className={sectionTitle}>Guests (this trip only)</Text>
            <Text className="font-body text-2xs text-muted-text mb-2">
              Someone who joined just this trip - they can be picked as a payer or split target on {trip.name}'s
              entries, but never anywhere on the household ledger or Payments tab, and this trip won't get an
              "Add to Main Ledger" option while it has any (there's no single honest "who owes whom" once a third
              person is splitting bills, so settle with them separately).
            </Text>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={guestDraft}
                onChangeText={setGuestDraft}
                placeholder="e.g. Priya"
                className="flex-1 font-body text-sm text-ink border border-ink/15 rounded-lg px-3 py-2 bg-paper shadow-2xs"
              />
              <Pressable onPress={handleAddGuest} className="min-h-11 px-5 shrink-0 rounded-lg bg-ledger-green items-center justify-center">
                <Text className="font-body-semibold text-sm text-white">Add Guest</Text>
              </Pressable>
            </View>
            {knownGuestSuggestions.length > 0 && (
              <View className="mb-2">
                <Text className="font-body text-2xs text-muted-text mb-1">From past trips - tap to add here, ✕ to forget them</Text>
                <View className="flex-row flex-wrap">
                  {knownGuestSuggestions.map((g) => (
                    <View key={g} className="flex-row items-center gap-1.5 rounded-md border border-dashed border-ink/20 px-2.5 py-1.5 mr-1.5 mb-1.5">
                      <Pressable onPress={() => handleAddKnownGuest(g)}>
                        <Text className="font-body-medium text-xs text-muted-text">+ {g}</Text>
                      </Pressable>
                      <Pressable
                        onPress={async () => {
                          if (!(await confirmAsync({ title: `Forget ${g}?`, message: 'They leave the suggestions list. Trips they were on keep them.', confirmLabel: 'Forget' }))) return;
                          deleteGuestFromDb(g, guestRawDocs).catch((err) => onSaveError?.(err));
                        }}
                        hitSlop={6}
                      >
                        <Text className="font-body-semibold text-xs text-muted-text">✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <View className="flex-row flex-wrap">
              {tripGuests.map((g) =>
                editingGuest?.oldName === g ? (
                  <View key={g} className="w-full rounded-lg border border-ink/15 bg-paper p-3 mb-2" style={{ gap: 8 }}>
                    <TextInput
                      value={editingGuest.name}
                      onChangeText={(v) => setEditingGuest((p) => ({ ...p, name: v }))}
                      className="font-body text-sm text-ink border border-ink/15 rounded-lg px-3 py-2 bg-paper shadow-2xs"
                    />
                    <Text className="font-body text-2xs text-muted-text">
                      Renames every entry {g} paid for or shares in too, on any trip they're on.
                    </Text>
                    <View className="flex-row gap-2">
                      <Pressable onPress={() => setEditingGuest(null)} className="flex-1 min-h-9 rounded-lg border border-ink/15 items-center justify-center">
                        <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleSaveRenamedGuest}
                        disabled={savingGuestRename || !editingGuest.name.trim()}
                        className="flex-1 min-h-9 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
                      >
                        <Text className="font-body-semibold text-xs text-white">{savingGuestRename ? 'Renaming...' : 'Save'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Tag
                    key={g}
                    label={g}
                    onEdit={() => setEditingGuest({ oldName: g, name: g })}
                    onRemove={async () => {
                      if (!(await confirmAsync({ title: `Remove ${g} from this trip?`, message: `Entries ${g} paid for or shares in will no longer balance correctly until they're edited.`, confirmLabel: 'Remove' }))) return;
                      updateTripInDb(trip.id, { guests: tripGuests.filter((x) => x !== g) }).catch((err) => onSaveError?.(err));
                    }}
                  />
                ),
              )}
            </View>
          </View>

          <View className="border-t border-ink/10 pt-4">
            <Text className="font-body-semibold text-xs text-stamp-red uppercase tracking-wider mb-2">Danger Zone</Text>
            {!confirmingDelete ? (
              <Pressable
                onPress={() => setConfirmingDelete(true)}
                className="min-h-10 self-start px-3.5 rounded-lg border border-stamp-red/30 items-center justify-center"
              >
                <Text className="font-body-semibold text-xs text-stamp-red">Delete {trip.name}…</Text>
              </Pressable>
            ) : (
              <View className="rounded-lg border border-stamp-red/30 bg-stamp-red/5 p-3">
                <Text className="font-body text-xs text-ink mb-2.5">
                  Permanently delete <Text className="font-body-semibold">{trip.name}</Text>? This also deletes its{' '}
                  {tripEntriesForDelete.length} {tripEntriesForDelete.length === 1 ? 'entry' : 'entries'} (
                  {formatCurrency(tripEntriesForDelete.reduce((sum, e) => sum + (Number(e.amount) || 0), 0))}), their card
                  transactions and its cash records
                  {trip.rolledUpEntryId ? `, and the ${formatCurrency(trip.rolledUpAmount || 0)} line it added to the household ledger` : ''}.
                  This can't be undone - export the Travel CSV from Settings first if you want a copy.
                </Text>
                <View className="flex-row gap-2">
                  <Pressable onPress={handleDeleteTrip} className="flex-1 min-h-9 rounded-lg bg-stamp-red items-center justify-center">
                    <Text className="font-body-semibold text-xs text-white">Confirm Delete</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmingDelete(false)} className="flex-1 min-h-9 rounded-lg border border-ink/15 items-center justify-center">
                    <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        <View className="px-4 py-3 border-t border-ink/10 bg-paper-card">
          <Pressable onPress={onClose} className="min-h-11 rounded-xl bg-ledger-green items-center justify-center">
            <Text className="font-body-semibold text-white">Done</Text>
          </Pressable>
        </View>
        </View>
      </View>
    </Modal>
  );
}
