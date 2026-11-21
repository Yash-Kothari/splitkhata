import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { FEATURES } from '../../lib/edition';
import { useAuth } from '../../lib/AuthContext';
import { useGroup } from '../../lib/GroupContext';
import { createGroup, subscribeToMembers, ensureOwnMemberDoc } from '../../lib/firebase';
import { groupDisplayName } from '../../lib/utils';
import { notify } from '../../lib/dialogs';
import { reportError } from '../../lib/errorReporting';
import AppHeader from '../../components/AppHeader';
import Card from '../../components/Card';
import GroupPeople from '../../components/GroupPeople';
import { HouseholdScreen } from './household';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-body text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper h-11';

function firstName(user) {
  const first = String(user?.displayName || user?.email || 'Me').trim().split(/[\s@]+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// Above the open group's ledger: where you are, who is in it, and a way back.
function GroupHeader() {
  const { user } = useAuth();
  const { activeGroup, selectGroup } = useGroup();
  const router = useRouter();
  const [showPeople, setShowPeople] = useState(false);
  const [memberDocs, setMemberDocs] = useState([]);
  const me = String(user?.email || '').toLowerCase();

  // A group whose creation was interrupted, or one you were added to, may lack your own person record.
  useEffect(
    () =>
      subscribeToMembers(
        (data) => {
          const docs = data.rawDocs || [];
          setMemberDocs(docs);
          if (docs.length && !docs.some((m) => String(m.email || '').toLowerCase() === me)) {
            ensureOwnMemberDoc(user).catch((err) => reportError(err, 'Could not add you to the group'));
          }
        },
        (err) => reportError(err, 'Could not load people'),
      ),
    [me, user],
  );

  if (!activeGroup) return null;
  const isDirect = activeGroup.kind === 'direct';
  const title = isDirect ? `You & ${groupDisplayName(activeGroup, me, memberDocs)}` : activeGroup.name;

  return (
    <Card className="px-4 py-3 mb-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => {
            selectGroup(null);
            if (isDirect) router.push('/personal');
          }}
          hitSlop={8}
        >
          <Text className="font-body-semibold text-xs text-ledger-green">{isDirect ? '← Personal' : '← All groups'}</Text>
        </Pressable>
        <Pressable onPress={() => setShowPeople((v) => !v)} hitSlop={8}>
          <Text className="font-body-semibold text-xs text-ledger-green">
            {activeGroup.memberEmails.length} {activeGroup.memberEmails.length === 1 ? 'person' : 'people'} {showPeople ? '▴' : '▾'}
          </Text>
        </Pressable>
      </View>
      <Text className="font-display text-xl text-ink mt-1" numberOfLines={1}>{title}</Text>
      {activeGroup.memberEmails.length < 2 && !isDirect ? (
        <Text className="font-body text-xs text-muted-text mt-1">Add the people you share expenses with to start splitting.</Text>
      ) : null}
      {showPeople || (activeGroup.memberEmails.length < 2 && !isDirect) ? (
        <View className="mt-3 pt-3 border-t border-ink/10">
          <GroupPeople />
        </View>
      ) : null}
    </Card>
  );
}

function GroupList() {
  const { user } = useAuth();
  const { groups, selectGroup } = useGroup();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const shared = (groups || []).filter((g) => g.kind === 'group');

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const id = await createGroup({
        name,
        owner: { uid: user.uid, email: user.email, name: firstName(user) },
      });
      setName('');
      selectGroup(id);
    } catch (err) {
      notify('Could not create the group', err?.message || 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="👥 Groups" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View className="px-4" style={{ gap: 12 }}>
            <Card className="px-4 py-4">
              <Text className="font-display text-lg text-ink mb-1">Start a group</Text>
              <Text className="font-body text-xs text-muted-text mb-3">A flat, a trip, a dinner - anything you split with other people. You add them next.</Text>
              <Text className={label}>Group name</Text>
              <View className="flex-row gap-2">
                <TextInput value={name} onChangeText={setName} placeholder="e.g. Flat 4B, Goa trip" className={`${input} flex-1`} />
                <Pressable onPress={handleCreate} disabled={creating || !name.trim()} className="h-11 px-5 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50">
                  <Text className="font-body-semibold text-white text-sm">{creating ? 'Creating...' : 'Create'}</Text>
                </Pressable>
              </View>
            </Card>

            <Card className="px-4 py-4">
              <Text className="font-display text-lg text-ink mb-2">Your groups</Text>
              {groups === null ? (
                <Text className="font-body text-sm text-muted-text">Loading...</Text>
              ) : shared.length === 0 ? (
                <Text className="font-body text-sm text-muted-text">No groups yet. Start one above, or ask a friend to add your Gmail to theirs.</Text>
              ) : (
                shared.map((g) => (
                  <Pressable key={g.id} onPress={() => selectGroup(g.id)} className="flex-row items-center justify-between rounded-xl border border-ink/10 bg-paper px-3.5 py-3 mb-2">
                    <View className="flex-1 min-w-0">
                      <Text className="font-body-semibold text-sm text-ink" numberOfLines={1}>{g.name}</Text>
                      <Text className="font-body text-2xs text-muted-text">{g.memberEmails.length} {g.memberEmails.length === 1 ? 'person' : 'people'}</Text>
                    </View>
                    <Text className="font-body-semibold text-ledger-green">›</Text>
                  </Pressable>
                ))
              )}
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function GroupsScreen() {
  const { activeGroup } = useGroup();
  // key: opening another group remounts the ledger so no list or form carries over from the last one.
  if (activeGroup) return <HouseholdScreen key={activeGroup.id} topSlot={<GroupHeader />} />;
  return <GroupList />;
}

// Shared edition only. The admin app has no groups.
export default function Groups() {
  if (!FEATURES.groups) return <Redirect href="/household" />;
  return <GroupsScreen />;
}
