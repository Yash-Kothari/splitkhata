import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, Alert } from 'react-native';
import PickerField from './PickerField';
import {
  updateTripInDb,
  deleteTripFromDb,
  addCashMovementToDb,
  addExpense,
  addCategoryToDb,
  deleteCategoryFromDb,
  addPaymentMethodToDb,
  deletePaymentMethodFromDb,
} from '../lib/firebase';
import { computeBudgetStatus, formatCurrency, groupByCategory, normalizeLedger, todayISO } from '../lib/utils';

function Tag({ label, onRemove, removable = true }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-md border border-ink/10 bg-paper px-2.5 py-1.5 mr-1.5 mb-1.5">
      <Text className="font-body-medium text-xs text-ink">{label}</Text>
      {removable && (
        <Pressable onPress={onRemove} hitSlop={6}>
          <Text className="font-body-semibold text-xs text-muted-text">✕</Text>
        </Pressable>
      )}
    </View>
  );
}

// RN full-screen Modal port of TravelManager.jsx's Trip Settings overlay.
export default function TripSettings({
  visible,
  onClose,
  trip,
  trips,
  entries,
  dbCategories,
  rawCategoryDocs,
  dbPaymentMethods,
  rawPaymentMethodDocs,
  dbMembers,
  currentCurrency,
  onSaveError,
  onTripDeleted,
}) {
  const [datesStart, setDatesStart] = useState('');
  const [datesEnd, setDatesEnd] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalInr, setWithdrawalInr] = useState('');
  const [withdrawalDate, setWithdrawalDate] = useState(todayISO());
  const [withdrawalPayer, setWithdrawalPayer] = useState('');
  const [withdrawalPaymentMethod, setWithdrawalPaymentMethod] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [paymentMethodDraft, setPaymentMethodDraft] = useState('');
  const [guestDraft, setGuestDraft] = useState('');
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
    setWithdrawalPaymentMethod(dbPaymentMethods[0] || 'Cash');
  }, [trip?.id]);

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
    try {
      await updateTripInDb(trip.id, { startDate: datesStart || null, endDate: datesEnd || null });
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleSaveCash() {
    const parsed = parseFloat(openingCash);
    if (!(parsed > 0)) return;
    try {
      await addCashMovementToDb({ tripName: trip.name, type: 'opening', amount: parsed });
      setOpeningCash('');
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleAddWithdrawal() {
    const parsedWithdrawal = parseFloat(withdrawalAmount);
    const parsedInr = parseFloat(withdrawalInr);
    if (!(parsedWithdrawal > 0) || !(parsedInr > 0) || !withdrawalPayer) {
      Alert.alert('Missing info', 'Amount, INR cost, and who withdrew it are all required.');
      return;
    }
    try {
      await addCashMovementToDb({ tripName: trip.name, type: 'withdrawal', amount: parsedWithdrawal, date: withdrawalDate });
      await addExpense({
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
        paymentMethod: withdrawalPaymentMethod,
        isWithdrawal: true,
      });
      setWithdrawalAmount('');
      setWithdrawalInr('');
      setWithdrawalDate(todayISO());
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not record withdrawal', err?.message || String(err));
    }
  }

  async function handleAddCategory() {
    const trimmed = categoryDraft.trim();
    if (!trimmed) return;
    try {
      await addCategoryToDb('travel', trimmed, rawCategoryDocs);
      setCategoryDraft('');
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleAddPaymentMethod() {
    const trimmed = paymentMethodDraft.trim();
    if (!trimmed) return;
    try {
      await addPaymentMethodToDb(trimmed, rawPaymentMethodDocs);
      setPaymentMethodDraft('');
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleAddGuest() {
    const trimmed = guestDraft.trim();
    if (!trimmed || !trip) return;
    const taken = [...dbMembers, ...tripGuests].some((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (taken) {
      Alert.alert('Name already in use', `"${trimmed}" is already a member or guest.`);
      return;
    }
    try {
      await updateTripInDb(trip.id, { guests: [...tripGuests, trimmed] });
      setGuestDraft('');
    } catch (err) {
      onSaveError?.(err);
    }
  }

  async function handleDeleteTrip() {
    try {
      await deleteTripFromDb(trip.id);
      setConfirmingDelete(false);
      onTripDeleted?.();
      onClose?.();
    } catch (err) {
      onSaveError?.(err);
    }
  }

  if (!trip) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-paper">
        <View className="flex-row items-center justify-between px-4 pt-14 pb-3 border-b border-ink/10 bg-paper-card">
          <Text className="font-display text-lg text-ink flex-1" numberOfLines={1}>
            {trip.name} Settings
          </Text>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-full border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-ink">✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text className="font-body-semibold text-xs text-ink mb-2">Trip Dates</Text>
          <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">Start Date</Text>
          <TextInput
            value={datesStart}
            onChangeText={setDatesStart}
            placeholder="2026-08-24"
            className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
          />
          <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">End Date</Text>
          <TextInput
            value={datesEnd}
            onChangeText={setDatesEnd}
            placeholder="2026-09-02"
            className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
          />
          <Pressable onPress={handleSaveDates} className="min-h-10 rounded-xl border border-ink/15 items-center justify-center mb-5">
            <Text className="font-body-semibold text-sm text-ink">Save Dates</Text>
          </Pressable>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className="font-body-semibold text-xs text-ink mb-2">Starting Cash</Text>
            <TextInput
              value={openingCash}
              onChangeText={setOpeningCash}
              keyboardType="decimal-pad"
              placeholder="0"
              className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
            />
            <Pressable onPress={handleSaveCash} className="min-h-10 rounded-xl bg-ledger-green items-center justify-center">
              <Text className="font-body-semibold text-sm text-white">Save Starting Cash</Text>
            </Pressable>
          </View>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className="font-body-semibold text-xs text-ink mb-1">ATM Cash Withdrawal ({currentCurrency || 'Local'})</Text>
            <TextInput
              value={withdrawalAmount}
              onChangeText={setWithdrawalAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
            />
            <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">INR Cost (required)</Text>
            <TextInput
              value={withdrawalInr}
              onChangeText={setWithdrawalInr}
              keyboardType="decimal-pad"
              placeholder="From card/forex statement"
              className="font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
            />
            <Text className="font-body text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
            <TextInput
              value={withdrawalDate}
              onChangeText={setWithdrawalDate}
              className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper"
            />
            <View className="mb-3">
              <PickerField label="Withdrawn By" value={withdrawalPayer} options={dbMembers} onChange={setWithdrawalPayer} />
            </View>
            <View className="mb-3">
              <PickerField label="Card Used" value={withdrawalPaymentMethod} options={dbPaymentMethods} onChange={setWithdrawalPaymentMethod} />
            </View>
            <Text className="font-body text-2xs text-muted-text mb-2">
              The INR cost is what registers the joint debt and gives every "Cash" purchase you add afterward its rate.
            </Text>
            <Pressable onPress={handleAddWithdrawal} className="min-h-10 rounded-xl border border-ink/15 items-center justify-center">
              <Text className="font-body-semibold text-sm text-ink">Record Withdrawal</Text>
            </Pressable>
          </View>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className="font-body-semibold text-xs text-ink mb-2">Travel Categories</Text>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={categoryDraft}
                onChangeText={setCategoryDraft}
                placeholder="Add travel category"
                className="flex-1 font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper"
              />
              <Pressable onPress={handleAddCategory} className="px-3.5 rounded-xl border border-ink/15 items-center justify-center">
                <Text className="font-body-semibold text-xs text-ink">Add</Text>
              </Pressable>
            </View>
            <View className="flex-row flex-wrap">
              {dbCategories.map((c) => (
                <Tag key={c} label={c} onRemove={() => deleteCategoryFromDb('travel', c, rawCategoryDocs).catch((err) => onSaveError?.(err))} />
              ))}
            </View>
          </View>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className="font-body-semibold text-xs text-ink mb-1">Category Budgets (this trip)</Text>
            <Text className="font-body text-2xs text-muted-text mb-2">
              Set a limit for the whole trip, not per month. Warns at 80%, alerts once exceeded.
            </Text>
            {unbudgetedCategories.length > 0 && (
              <View className="flex-row gap-2 mb-2">
                <View className="flex-1">
                  <PickerField label="" value={newBudgetCategory} options={unbudgetedCategories} onChange={setNewBudgetCategory} />
                </View>
                <TextInput
                  value={newBudgetAmount}
                  onChangeText={setNewBudgetAmount}
                  keyboardType="decimal-pad"
                  placeholder="₹ limit"
                  className="w-24 font-mono text-sm text-ink border border-ink/15 rounded-xl px-2 py-2 bg-paper"
                />
                <Pressable
                  onPress={() => {
                    const amt = Number(newBudgetAmount);
                    if (!newBudgetCategory || !amt || amt <= 0) return;
                    persistBudgets({ ...tripBudgetDrafts, [newBudgetCategory]: amt });
                    setNewBudgetCategory('');
                    setNewBudgetAmount('');
                  }}
                  className="px-3.5 rounded-xl border border-ink/15 items-center justify-center"
                >
                  <Text className="font-body-semibold text-xs text-ink">Add</Text>
                </Pressable>
              </View>
            )}
            {tripBudgetStatus.map((s) => (
              <View key={s.category} className="mb-3">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="font-body-medium text-xs text-ink">{s.category}</Text>
                  <Pressable
                    onPress={() => {
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
            <Text className="font-body-semibold text-xs text-ink mb-2">Payment Methods</Text>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={paymentMethodDraft}
                onChangeText={setPaymentMethodDraft}
                placeholder="e.g. Yash Forex, Kruti Diners"
                className="flex-1 font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper"
              />
              <Pressable onPress={handleAddPaymentMethod} className="px-3.5 rounded-xl border border-ink/15 items-center justify-center">
                <Text className="font-body-semibold text-xs text-ink">Add</Text>
              </Pressable>
            </View>
            <View className="flex-row flex-wrap">
              {dbPaymentMethods.map((m) => (
                <Tag
                  key={m}
                  label={m}
                  removable={m !== 'Cash'}
                  onRemove={() => deletePaymentMethodFromDb(m, rawPaymentMethodDocs).catch((err) => onSaveError?.(err))}
                />
              ))}
            </View>
          </View>

          <View className="border-t border-ink/10 pt-4 mb-5">
            <Text className="font-body-semibold text-xs text-ink mb-1">Guests (this trip only)</Text>
            <Text className="font-body text-2xs text-muted-text mb-2">
              Can be a payer/split target on {trip.name}'s entries only - never on the household ledger or Payments tab.
            </Text>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={guestDraft}
                onChangeText={setGuestDraft}
                placeholder="e.g. Priya"
                className="flex-1 font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2 bg-paper"
              />
              <Pressable onPress={handleAddGuest} className="px-3.5 rounded-xl border border-ink/15 items-center justify-center">
                <Text className="font-body-semibold text-xs text-ink">Add Guest</Text>
              </Pressable>
            </View>
            <View className="flex-row flex-wrap">
              {tripGuests.map((g) => (
                <Tag key={g} label={g} onRemove={() => updateTripInDb(trip.id, { guests: tripGuests.filter((x) => x !== g) }).catch((err) => onSaveError?.(err))} />
              ))}
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
                  Permanently delete <Text className="font-body-semibold">{trip.name}</Text>? Its entries and cash movements
                  aren't deleted with it, but they'll no longer be reachable from any trip. This can't be undone.
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
    </Modal>
  );
}
