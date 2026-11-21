import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { subscribeToMembers, addGroupMember, leaveGroup, renameGroup } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useGroup } from '../lib/GroupContext';
import { notify, confirmAsync } from '../lib/dialogs';
import { reportError } from '../lib/errorReporting';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper h-11';

// Shared edition: who is in the open group, and adding people to it. Everyone here has to sign in with
// the Google account whose email you add - that is how they see the group. Members can add people; only
// the owner renames the group; anyone but the owner can leave.
export default function GroupPeople() {
  const { user } = useAuth();
  const { activeGroup, selectGroup } = useGroup();
  const [memberDocs, setMemberDocs] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(
    () => (activeGroup ? subscribeToMembers((data) => setMemberDocs(data.rawDocs || []), (err) => reportError(err, 'Could not load people')) : undefined),
    [activeGroup],
  );

  if (!activeGroup) return null;
  const me = String(user?.email || '').toLowerCase();
  const isOwner = activeGroup.ownerUid === user?.uid;
  const isDirect = activeGroup.kind === 'direct';
  const nameByEmail = Object.fromEntries(memberDocs.map((m) => [String(m.email || '').toLowerCase(), m.name]));

  async function handleAdd() {
    setSaving(true);
    try {
      await addGroupMember({ name, email });
      setName('');
      setEmail('');
    } catch (err) {
      notify('Could not add', err?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLeave() {
    const ok = await confirmAsync({
      title: `Leave ${activeGroup.name}?`,
      message: "You'll lose access to this group. Your past expenses stay in it, so everyone's balances still add up. Settle up first if you owe anyone.",
      confirmLabel: 'Leave',
    });
    if (!ok) return;
    try {
      await leaveGroup(me);
      selectGroup(null);
    } catch (err) {
      notify('Could not leave', err?.message || 'Something went wrong.');
    }
  }

  async function handleRename() {
    try {
      await renameGroup(newName);
      setNewName('');
    } catch (err) {
      notify('Could not rename', err?.message || 'Something went wrong.');
    }
  }

  return (
    <View>
      {activeGroup.memberEmails.map((e) => (
        <View key={e} className="flex-row items-center rounded-xl border border-ink/10 bg-paper px-3 py-2 mb-1.5">
          <View className="flex-1 min-w-0">
            <Text className="font-body-semibold text-sm text-ink" numberOfLines={1}>
              {nameByEmail[e] || e.split('@')[0]}
              {e === me ? ' (you)' : ''}
            </Text>
            <Text className="font-body text-2xs text-muted-text" numberOfLines={1}>{e}</Text>
          </View>
        </View>
      ))}

      {isDirect ? (
        <Text className="font-body text-2xs text-muted-text mt-1">A one-to-one ledger always has exactly these two people.</Text>
      ) : (
        <View className="mt-2">
          <Text className={label}>Add a person</Text>
          <View className="flex-row gap-2 mb-1">
            <TextInput value={name} onChangeText={setName} placeholder="Name" className={`${input} flex-1`} />
          </View>
          <View className="flex-row gap-2">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Their Gmail address"
              autoCapitalize="none"
              keyboardType="email-address"
              className={`${input} flex-1`}
            />
            <Pressable onPress={handleAdd} disabled={saving || !email.trim()} className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
              <Text className="font-body-semibold text-white text-sm">{saving ? 'Adding...' : 'Add'}</Text>
            </Pressable>
          </View>
          <Text className="font-body text-2xs text-muted-text mt-1.5">
            They need to sign in to Splitkhata with that Google account to see this group. Until then they appear here as pending.
          </Text>
        </View>
      )}

      {!isDirect && isOwner ? (
        <View className="mt-4">
          <Text className={label}>Rename group</Text>
          <View className="flex-row gap-2">
            <TextInput value={newName} onChangeText={setNewName} placeholder={activeGroup.name} className={`${input} flex-1`} />
            <Pressable onPress={handleRename} disabled={!newName.trim()} className="h-11 px-5 rounded-xl border border-ink/15 items-center justify-center disabled:opacity-50">
              <Text className="font-body-semibold text-ink text-sm">Rename</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {!isDirect && !isOwner ? (
        <Pressable onPress={handleLeave} className="mt-4 self-start px-3 py-2 rounded-lg border border-stamp-red/40">
          <Text className="font-body-semibold text-xs text-stamp-red">Leave group</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
