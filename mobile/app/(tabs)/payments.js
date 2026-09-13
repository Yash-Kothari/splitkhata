import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { ScrollView } from 'react-native';
import { subscribeToExpenses, subscribeToMembers, subscribeToPaymentReminderConfig, addExpense } from '../../lib/firebase';
import { DEFAULT_PERSONS, computeBalance, todayISO } from '../../lib/utils';
import AppHeader from '../../components/AppHeader';
import Card from '../../components/Card';
import PickerField from '../../components/PickerField';
import BalanceStrip from '../../components/BalanceStrip';
import EntryList from '../../components/EntryList';
import PaymentReminderBanner from '../../components/PaymentReminderBanner';

function RewardPointsCard({ entries, travelEntries, dbMembers, onSaveError }) {
  const hasPoints = travelEntries.some((e) => Number(e.rewardPoints || 0) !== 0);
  const pointsBalance = useMemo(
    () => (hasPoints ? computeBalance([...entries, ...travelEntries], null, dbMembers, 'rewardPoints') : null),
    [entries, travelEntries, dbMembers, hasPoints],
  );

  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState('');
  const [owedBy, setOwedBy] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  if (!hasPoints) return null;

  function startSettling() {
    const [defaultPayer, defaultOwedBy] =
      pointsBalance.status === 'settled' ? [dbMembers[0] || '', dbMembers[1] || ''] : [pointsBalance.debtor, pointsBalance.creditor];
    setAmount(pointsBalance.status === 'settled' ? '' : Math.round(pointsBalance.amount).toString());
    setPayer(defaultPayer);
    setOwedBy(defaultOwedBy);
    setDate(todayISO());
    setNote('');
    setSettling(true);
  }

  const parsedAmount = parseFloat(amount) || 0;
  const previewBalance = useMemo(() => {
    if (!parsedAmount || !payer || !owedBy || payer === owedBy) return null;
    return computeBalance(
      [...entries, ...travelEntries, { rewardPoints: parsedAmount, payer, owedBy, splitType: 'settlement', split: true }],
      null,
      dbMembers,
      'rewardPoints',
    );
  }, [entries, travelEntries, parsedAmount, payer, owedBy, dbMembers]);

  async function handleConfirm() {
    const parsed = Math.round(parseFloat(amount));
    if (!parsed || parsed <= 0 || !payer || !owedBy || payer === owedBy) return;
    setSaving(true);
    try {
      await addExpense({
        amount: 0,
        payer,
        owedBy,
        splitType: 'settlement',
        split: true,
        category: 'Settlement',
        note: note.trim(),
        date,
        ledger: 'household',
        tripName: '',
        rewardPoints: parsed,
      });
      setSettling(false);
    } catch (err) {
      onSaveError?.(err);
      Alert.alert('Could not save', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="px-5 py-4 mb-4">
      <Text className="font-display text-lg text-ink mb-1">Reward Points Owed</Text>
      {pointsBalance.status === 'settled' ? (
        <Text className="font-body-semibold text-sm text-ledger-green">All settled up across every trip</Text>
      ) : (
        <Text className="font-body text-base text-ink">
          💳 <Text className="font-body-semibold text-stamp-red">{pointsBalance.debtor}</Text>
          <Text> owes </Text>
          <Text className="font-body-semibold text-ledger-green">{pointsBalance.creditor}</Text>
          <Text> </Text>
          <Text className="font-mono-bold text-lg text-ink">{Math.round(pointsBalance.amount).toLocaleString('en-IN')} pts</Text>
        </Text>
      )}
      <Text className="font-body text-xs text-muted-text mt-1">Combined across every trip's reward points, not just one.</Text>

      {!settling && (
        <Pressable onPress={startSettling} className="mt-3 min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center self-start">
          <Text className="font-body-semibold text-xs text-white">Record Points Payment</Text>
        </Pressable>
      )}

      {settling && (
        <View className="mt-4 pt-4 border-t border-ink/10">
          <Text className="font-body text-sm text-ink mb-3">
            Record a real points transfer - either direction, any amount. It doesn't have to match the balance above.
          </Text>

          <View className="mb-3">
            <PickerField label="Paid by" value={payer} options={dbMembers} onChange={setPayer} />
          </View>
          <View className="mb-3">
            <PickerField label="Paid to" value={owedBy} options={dbMembers} onChange={setOwedBy} />
          </View>
          {payer && owedBy && payer === owedBy && (
            <Text className="font-body text-xs text-stamp-red mb-3">"Paid by" and "Paid to" can't be the same person.</Text>
          )}

          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Points</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            className="font-mono-bold text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
          />

          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Date</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
          />

          <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Transferred miles"
            className="font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper shadow-2xs"
          />

          {parsedAmount > 0 && previewBalance && (
            <Text className="font-body text-xs text-muted-text mb-3">
              {previewBalance.status === 'settled' ? (
                <Text className="font-body-semibold text-ledger-green">This fully settles the points balance.</Text>
              ) : (
                <>
                  After this, <Text className="font-body-semibold text-ink">{previewBalance.debtor}</Text> will owe{' '}
                  <Text className="font-body-semibold text-ink">{previewBalance.creditor}</Text>{' '}
                  <Text className="font-mono text-ink">{Math.round(previewBalance.amount).toLocaleString('en-IN')} pts</Text>.
                </>
              )}
            </Text>
          )}

          <View className="flex-row gap-2">
            <Pressable
              onPress={handleConfirm}
              disabled={saving || !amount || !payer || !owedBy || payer === owedBy}
              className="flex-1 min-h-10 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
            >
              {saving ? <ActivityIndicator color="white" /> : <Text className="font-body-semibold text-xs text-white">Record Points Payment</Text>}
            </Pressable>
            <Pressable
              onPress={() => setSettling(false)}
              disabled={saving}
              className="flex-1 min-h-10 rounded-lg border border-ink/15 items-center justify-center disabled:opacity-50"
            >
              <Text className="font-body-semibold text-xs text-ink">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Card>
  );
}

export default function Payments() {
  const [entries, setEntries] = useState(null);
  const [travelEntries, setTravelEntries] = useState([]);
  const [members, setMembers] = useState(DEFAULT_PERSONS);
  const [reminderConfig, setReminderConfig] = useState({ enabled: true, amountThreshold: 2000 });

  useEffect(() => subscribeToExpenses('household', setEntries, (err) => console.warn(err)), []);
  useEffect(() => subscribeToExpenses('travel', setTravelEntries, (err) => console.warn(err)), []);
  useEffect(
    () =>
      subscribeToMembers(
        (data) => data.members?.length && setMembers(data.members),
        (err) => console.warn(err),
      ),
    [],
  );
  useEffect(() => subscribeToPaymentReminderConfig(setReminderConfig), []);

  const paymentEntries = useMemo(
    () => (entries || []).filter((e) => e.splitType === 'settlement' || e.isTripRollup),
    [entries],
  );

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="💰 Payments" />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          {entries && <PaymentReminderBanner entries={entries} dbMembers={members} config={reminderConfig} />}
          {entries && <BalanceStrip entries={entries} ledger="household" dbMembers={members} />}
          {entries && <RewardPointsCard entries={entries} travelEntries={travelEntries} dbMembers={members} />}
        </View>

        <EntryList
          title="Payment History"
          emptyMessage="No payments recorded yet - settle up Household above, or add a finished trip's balance from its own Trip Summary."
          entries={paymentEntries}
          ledger="household"
          members={members}
        />
      </ScrollView>
    </View>
  );
}
