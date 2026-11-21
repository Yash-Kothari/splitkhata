import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { FEATURES } from '../../lib/edition';
import { useAuth } from '../../lib/AuthContext';
import { useGroup } from '../../lib/GroupContext';
import { usePersonalBalances } from '../../lib/usePersonalBalances';
import { createGroup, addExpenseToGroup } from '../../lib/firebase';
import { directGroupId, memberNameForEmail, formatCurrency, parseAmountInput, todayISO, isValidISODate } from '../../lib/utils';
import { notify } from '../../lib/dialogs';
import AppHeader from '../../components/AppHeader';
import Card from '../../components/Card';
import DateField from '../../components/DateField';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper h-11';

function firstName(user) {
  const first = String(user?.displayName || user?.email || 'Me').trim().split(/[\s@]+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function Summary({ owedToMe, iOwe, net }) {
  return (
    <Card className="px-4 py-4">
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Overall</Text>
      <Text className={`font-display text-2xl ${net > 0 ? 'text-ledger-green' : net < 0 ? 'text-stamp-red' : 'text-ink'}`}>
        {net > 0 ? `You are owed ${formatCurrency(net)}` : net < 0 ? `You owe ${formatCurrency(-net)}` : 'You are all settled up'}
      </Text>
      <View className="flex-row mt-3" style={{ gap: 12 }}>
        <View className="flex-1 rounded-xl border border-ink/10 bg-paper px-3 py-2">
          <Text className="font-body text-2xs text-muted-text">You are owed</Text>
          <Text className="font-mono-bold text-sm text-ledger-green">{formatCurrency(owedToMe)}</Text>
        </View>
        <View className="flex-1 rounded-xl border border-ink/10 bg-paper px-3 py-2">
          <Text className="font-body text-2xs text-muted-text">You owe</Text>
          <Text className="font-mono-bold text-sm text-stamp-red">{formatCurrency(iOwe)}</Text>
        </View>
      </View>
    </Card>
  );
}

function PersonRow({ person, onSettle, onAddExpense, directReady }) {
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const owes = person.net > 0;
  const settled = person.net === 0;

  function startSettle() {
    setAmount(String(Math.abs(person.net)));
    setDate(todayISO());
    setNote('');
    setSettling(true);
  }

  async function handleSave() {
    const parsed = parseAmountInput(amount);
    if (!parsed || parsed <= 0) return notify('Enter an amount', 'Type how much was paid.');
    if (!isValidISODate(date)) return notify('Check the date', 'Pick a valid date.');
    setSaving(true);
    try {
      await onSettle(person, parsed, date, note.trim());
      setSettling(false);
    } catch (err) {
      notify('Could not save', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="rounded-xl border border-ink/10 bg-paper mb-2">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center px-3.5 py-3">
        <View className="w-9 h-9 rounded-full bg-ledger-green/15 items-center justify-center mr-3">
          <Text className="font-body-semibold text-sm text-ledger-green">{person.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View className="flex-1 min-w-0">
          <Text className="font-body-semibold text-sm text-ink" numberOfLines={1}>{person.name}</Text>
          <Text className="font-body text-2xs text-muted-text" numberOfLines={1}>{person.email}</Text>
        </View>
        <Text className={`font-mono-bold text-sm ${settled ? 'text-muted-text' : owes ? 'text-ledger-green' : 'text-stamp-red'}`}>
          {settled ? 'settled up' : owes ? `owes you ${formatCurrency(person.net)}` : `you owe ${formatCurrency(-person.net)}`}
        </Text>
      </Pressable>

      {open ? (
        <View className="px-3.5 pb-3 pt-1 border-t border-ink/10">
          {person.perGroup.map((g) => (
            <View key={g.groupId} className="flex-row justify-between py-1">
              <Text className="font-body text-xs text-muted-text" numberOfLines={1}>{g.kind === 'direct' ? 'Directly' : g.groupName}</Text>
              <Text className={`font-mono-medium text-xs ${g.net === 0 ? 'text-muted-text' : g.net > 0 ? 'text-ledger-green' : 'text-stamp-red'}`}>
                {g.net === 0 ? 'settled' : g.net > 0 ? `owes you ${formatCurrency(g.net)}` : `you owe ${formatCurrency(-g.net)}`}
              </Text>
            </View>
          ))}

          {settling ? (
            <View className="mt-3">
              <Text className="font-body text-xs text-muted-text mb-2">
                {owes ? `${person.name} paid you back.` : `You paid ${person.name} back.`} This records a payment, not an expense.
              </Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <View className="flex-1">
                  <Text className={label}>Amount (₹)</Text>
                  <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" className={input} />
                </View>
                <View className="flex-1">
                  <Text className={label}>Date</Text>
                  <DateField value={date} onChange={setDate} className={input} />
                </View>
              </View>
              <Text className={`${label} mt-2`}>Note (optional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="UPI, cash..." className={input} />
              <View className="flex-row gap-2 mt-3">
                <Pressable onPress={handleSave} disabled={saving} className="px-4 py-2.5 rounded-lg bg-ledger-green disabled:opacity-50">
                  <Text className="font-body-semibold text-xs text-white">{saving ? 'Saving...' : 'Record payment'}</Text>
                </Pressable>
                <Pressable onPress={() => setSettling(false)} className="px-4 py-2.5 rounded-lg border border-ink/15">
                  <Text className="font-body-semibold text-xs text-muted-text">Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-2 mt-3">
              {!settled ? (
                <Pressable onPress={startSettle} className="px-3.5 py-2 rounded-lg bg-ledger-green">
                  <Text className="font-body-semibold text-xs text-white">Settle up</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => onAddExpense(person)} className="px-3.5 py-2 rounded-lg border border-ink/15">
                <Text className="font-body-semibold text-xs text-ink">{directReady ? 'Add expense' : 'Add expense together'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function PersonalScreen() {
  const { user } = useAuth();
  const { groups, selectGroup } = useGroup();
  const router = useRouter();
  const me = String(user?.email || '').toLowerCase();
  const { loading, people, owedToMe, iOwe, net, groupData } = usePersonalBalances(groups, me);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  // My name as the people I already share groups with know me; the Google first name otherwise.
  function myNameAnywhere() {
    for (const g of groups || []) {
      const found = memberNameForEmail(groupData[g.id]?.memberDocs, me);
      if (found) return found;
    }
    return firstName(user);
  }

  // The hidden two-person ledger with this person, created on first use. Returns { id, myName, theirName }.
  async function ensureDirect(otherEmail, otherName) {
    const id = directGroupId(me, otherEmail);
    const existing = (groups || []).find((g) => g.id === id);
    if (existing) {
      const docs = groupData[id]?.memberDocs || [];
      return { id, myName: memberNameForEmail(docs, me) || myNameAnywhere(), theirName: memberNameForEmail(docs, otherEmail) || otherName };
    }
    const mine = myNameAnywhere();
    await createGroup({
      id,
      kind: 'direct',
      name: `${mine} & ${otherName}`,
      owner: { uid: user.uid, email: me, name: mine },
      others: [{ name: otherName, email: otherEmail }],
    });
    return { id, myName: mine, theirName: otherName };
  }

  async function handleAddPerson() {
    setAdding(true);
    try {
      const otherEmail = email.trim().toLowerCase();
      if (otherEmail === me) throw new Error("That's your own email.");
      const { id } = await ensureDirect(otherEmail, name.trim() || otherEmail.split('@')[0]);
      setName('');
      setEmail('');
      selectGroup(id);
      router.push('/groups');
    } catch (err) {
      notify('Could not add', err?.message || 'Something went wrong.');
    } finally {
      setAdding(false);
    }
  }

  async function handleAddExpense(person) {
    try {
      const { id } = await ensureDirect(person.email, person.name);
      selectGroup(id);
      router.push('/groups');
    } catch (err) {
      notify('Could not open', err?.message || 'Something went wrong.');
    }
  }

  // Recording a payment goes in the one-to-one ledger with that person; balances add up across ledgers,
  // so it reduces what they owe you (or you owe them) overall.
  async function handleSettle(person, amount, date, note) {
    const { id, myName, theirName } = await ensureDirect(person.email, person.name);
    const theyPaid = person.net > 0;
    await addExpenseToGroup(id, {
      amount,
      payer: theyPaid ? theirName : myName,
      owedBy: theyPaid ? myName : theirName,
      splitType: 'settlement',
      split: true,
      category: 'Settlement',
      note,
      date,
      ledger: 'household',
    });
  }

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="👤 Personal" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View className="px-4" style={{ gap: 12 }}>
            <Summary owedToMe={owedToMe} iOwe={iOwe} net={net} />

            <Card className="px-4 py-4">
              <Text className="font-display text-lg text-ink mb-2">Balances</Text>
              {groups === null || loading ? (
                <Text className="font-body text-sm text-muted-text">Loading...</Text>
              ) : people.length === 0 ? (
                <Text className="font-body text-sm text-muted-text">
                  Nothing yet. Add a person below to split expenses one-to-one, or start a group in the Groups tab.
                </Text>
              ) : (
                people.map((p) => (
                  <PersonRow
                    key={p.email}
                    person={p}
                    onSettle={handleSettle}
                    onAddExpense={handleAddExpense}
                    directReady={(groups || []).some((g) => g.id === directGroupId(me, p.email))}
                  />
                ))
              )}
            </Card>

            <Card className="px-4 py-4">
              <Text className="font-display text-lg text-ink mb-1">Split with someone</Text>
              <Text className="font-body text-xs text-muted-text mb-3">
                Add a person by Gmail to keep a one-to-one tab with them, outside any group. They need to sign in with that Google account to see it.
              </Text>
              <Text className={label}>Name</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Their name" className={`${input} mb-2`} />
              <Text className={label}>Gmail</Text>
              <View className="flex-row gap-2">
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@gmail.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  className={`${input} flex-1`}
                />
                <Pressable onPress={handleAddPerson} disabled={adding || !email.trim()} className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                  <Text className="font-body-semibold text-white text-sm">{adding ? 'Adding...' : 'Add'}</Text>
                </Pressable>
              </View>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// Shared edition only. The admin app has no Personal tab.
export default function Personal() {
  if (!FEATURES.groups) return <Redirect href="/household" />;
  return <PersonalScreen />;
}
