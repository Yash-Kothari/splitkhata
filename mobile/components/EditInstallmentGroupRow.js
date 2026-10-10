import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { notify } from '../lib/dialogs';
import PickerField from './PickerField';
import { cardShadow } from './Card';
import { updateInstallmentGroup } from '../lib/firebase';

const SPLIT_TYPE_OPTIONS = [
  { value: 'shared', label: 'Split' },
  { value: 'owed', label: 'Owed' },
  { value: 'personal', label: 'Personal' },
];

function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-2 rounded-xl border mr-2 mb-2 ${
        selected ? 'bg-ledger-green border-ledger-green' : 'bg-paper border-ink/15'
      }`}
    >
      <Text className={`font-body-semibold text-xs ${selected ? 'text-white' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}

// Edits the fields an installment set shares across every sibling at once -
// category, payer, split type/who-owes/split-among. Deliberately excludes
// amount, date and note (each installment genuinely has its own) and a
// custom split's per-person amounts (those are validated against one
// entry's own amount - installments can have slightly different amounts
// from paise rounding, so there's no single "total" a group-wide custom
// split could validate against). An installment already using a custom
// split keeps its existing splitShares untouched unless you pick a
// different split type here; to change the actual share amounts, edit that
// one installment row individually instead - P1-14.
export default function EditInstallmentGroupRow({ groupId, sampleEntry, categories, members, count, onCancel, onSaved, onSaveError }) {
  const [payer, setPayer] = useState(sampleEntry.payer);
  const [category, setCategory] = useState(sampleEntry.category);
  const initialSplitType = sampleEntry.splitType === 'custom' ? 'custom' : sampleEntry.splitType || (sampleEntry.split ? 'shared' : 'personal');
  const [splitType, setSplitType] = useState(initialSplitType);
  const [owedBy, setOwedBy] = useState(sampleEntry.owedBy || members.find((m) => m !== payer) || '');
  const [splitAmong, setSplitAmong] = useState(sampleEntry.splitAmong || members);
  const [saving, setSaving] = useState(false);

  function toggleSplitAmong(name) {
    setSplitAmong((prev) => {
      if (prev.includes(name)) {
        const next = prev.filter((p) => p !== name);
        return next.length > 0 ? next : prev;
      }
      return [...prev, name];
    });
  }

  async function handleSave() {
    if (splitType === 'owed' && (!owedBy || owedBy === payer)) {
      notify('Pick who owes', 'The person who owes must be different from who paid.');
      return;
    }
    setSaving(true);
    try {
      const effectiveSplitAmong = splitType === 'shared' && splitAmong.length > 0 && splitAmong.length < members.length ? splitAmong : null;
      const updates = {
        payer,
        category,
        owedBy: splitType === 'owed' ? owedBy : null,
        splitAmong: splitType === 'custom' ? null : effectiveSplitAmong,
      };
      // Custom stays custom (its own per-installment shares untouched); any
      // other choice here does change split/splitType for the whole set.
      if (splitType !== 'custom') {
        updates.split = splitType !== 'personal';
        updates.splitType = splitType;
        updates.splitMode = null;
      }
      await updateInstallmentGroup(groupId, updates);
      onSaved?.();
    } catch (err) {
      onSaveError?.(err);
      notify('Could not save', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={cardShadow} className="mx-4 my-3 p-4 rounded-2xl bg-paper-card border border-ledger-green/40">
      <Text className="font-body-semibold text-sm text-ink mb-1">Editing all {count} installments</Text>
      <Text className="font-body text-xs text-muted-text mb-3">
        Changes here apply to every installment in this set. Amount, date, note and a custom split's own share amounts
        stay per-installment - edit one row individually for those.
      </Text>

      <View className="flex-row flex-wrap" style={{ gap: 12 }}>
        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
          <PickerField
            label="Split Type"
            value={splitType}
            options={splitType === 'custom' ? [{ value: 'custom', label: 'Custom amounts (unchanged)' }, ...SPLIT_TYPE_OPTIONS] : SPLIT_TYPE_OPTIONS}
            onChange={setSplitType}
          />
        </View>

        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
          <PickerField label="Who Paid" value={payer} options={members} onChange={setPayer} />
        </View>

        {splitType === 'owed' && (
          <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)]">
            <PickerField
              label="Who Owes the Full Amount"
              value={owedBy}
              options={members.filter((m) => m !== payer)}
              onChange={setOwedBy}
            />
          </View>
        )}

        {splitType === 'shared' && members.length > 2 && (
          <View className="w-full">
            <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1">Split Among</Text>
            <View className="flex-row flex-wrap">
              {members.map((m) => (
                <Chip key={m} label={m} selected={splitAmong.includes(m)} onPress={() => toggleSplitAmong(m)} />
              ))}
            </View>
          </View>
        )}

        <View className="w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)] order-last lg:order-none">
          <PickerField label="Category" value={category} options={categories} onChange={setCategory} />
        </View>
      </View>

      <View className="flex-row gap-2 mt-3">
        <Pressable onPress={onCancel} className="flex-1 min-h-11 rounded-xl border border-ink/15 items-center justify-center">
          <Text className="font-body-semibold text-sm text-ink">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className={`flex-1 min-h-11 rounded-xl bg-ledger-green items-center justify-center ${saving ? 'opacity-40' : ''}`}
        >
          <Text className="font-body-semibold text-sm text-white">{saving ? 'Saving...' : `Save all ${count}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}
