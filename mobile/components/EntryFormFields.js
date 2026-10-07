import { View, Text, TextInput, Pressable, Keyboard } from 'react-native';
import PickerField from './PickerField';
import DateField from './DateField';
import CustomSplitEditor from './CustomSplitEditor';
import { parseAmountInput } from '../lib/utils';

// The fields of Add Entry and Edit Entry, in one place: change the layout or
// add a field here and both forms get it. `f` is the object from useEntryForm.
// Each form fills the slots with what only it has (Add: the "as before" chip,
// the card/cash hints and split-across-months; Edit: nothing extra).

// On a phone short fields pair up two to a row (47% + the gap fits even a 320px
// screen) and text fields take the full row.
const FIELD_HALF = 'w-[47%] sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]';
const FIELD_FULL = 'w-full sm:w-[calc(50%-7px)] lg:w-[calc(33.333%-9.333px)]';
const FIELD_TEXT = 'w-full lg:w-[calc(33.333%-9.333px)]';

export const SPLIT_TYPE_OPTIONS = [
  { value: 'shared', label: 'Split' },
  { value: 'owed', label: 'Owed' },
  { value: 'personal', label: 'Personal' },
  { value: 'custom', label: 'Custom amounts' },
];

const labelClass = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const inputClass = 'font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs';
const monoInputClass = 'font-mono-bold text-sm text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs';

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

function CheckRow({ checked, onPress, children }) {
  return (
    <Pressable onPress={onPress} className="mt-3 flex-row items-center gap-2.5">
      <View
        className={`w-4 h-4 rounded border items-center justify-center ${
          checked ? 'bg-ledger-green border-ledger-green' : 'border-ink/30 bg-paper'
        }`}
      >
        {checked && <Text className="text-white text-xs">✓</Text>}
      </View>
      {children}
    </Pressable>
  );
}

export default function EntryFormFields({
  f,
  categories,
  members,
  currentCurrency = 'INR',
  categoryLabelExtra = null,
  categoryError = '',
  noteExtra = null,
  afterFields = null,
  moreExtra = null,
}) {
  const { isTravel } = f;
  const moreParts = ['tags', f.hasPoints ? 'reward points' : null, moreExtra ? 'split across months' : null].filter(Boolean);

  return (
    <>
      <View className="flex-row flex-wrap" style={{ gap: 14 }}>
        <View className={FIELD_HALF}>
          <Text className={labelClass}>Amount (₹){isTravel ? ' - real cost' : ''}</Text>
          <TextInput
            value={f.amount}
            onChangeText={f.setAmount}
            keyboardType="decimal-pad"
            editable={!f.amountLocked}
            placeholder="0.00"
            className={`font-mono-bold text-sm border border-ink/15 rounded-xl px-3 py-2.5 ${
              f.amountLocked ? 'bg-paper/60 text-muted-text' : 'bg-paper text-ink'
            }`}
          />
          {f.amountLocked && f.fifoBreakdownText ? <Text className="font-body text-2xs text-muted-text mt-1">{f.fifoBreakdownText}</Text> : null}
          {f.amountInvalid ? <Text className="font-body text-2xs text-stamp-red mt-1">Enter an amount like 1200 or 1200.50</Text> : null}
        </View>

        {isTravel ? (
          <View className={FIELD_HALF}>
            <Text className={labelClass}>Local Amount ({currentCurrency})</Text>
            <TextInput
              value={f.localAmount}
              onChangeText={f.setLocalAmount}
              keyboardType="decimal-pad"
              placeholder="Optional"
              className={monoInputClass}
            />
            {f.localAmountInvalid ? <Text className="font-body text-2xs text-stamp-red mt-1">Enter an amount like 1200 or 1200.50</Text> : null}
          </View>
        ) : (
          <View className={FIELD_HALF}>
            <Text className={labelClass}>Date</Text>
            <DateField value={f.date} onChange={f.setDate} className={inputClass} />
            {f.dateInvalid ? <Text className="font-body text-2xs text-stamp-red mt-1">Use the format YYYY-MM-DD</Text> : null}
          </View>
        )}

        <View className={FIELD_FULL}>
          <PickerField label="Category" value={f.category} options={categories} onChange={f.setCategory} labelExtra={categoryLabelExtra} />
          {categoryError ? <Text className="font-body text-2xs text-stamp-red mt-1">{categoryError}</Text> : null}
        </View>

        <View className={FIELD_HALF}>
          <PickerField label="Who Paid" value={f.payer} options={members} onChange={f.setPayer} />
        </View>

        <View className={FIELD_HALF}>
          <PickerField label="Split Type" value={f.splitType} options={SPLIT_TYPE_OPTIONS} onChange={f.setSplitType} />
        </View>

        {f.splitType === 'owed' && (
          <View className={FIELD_FULL}>
            <PickerField
              label="Who Owes the Full Amount"
              value={f.owedBy}
              options={members.filter((p) => p !== f.payer)}
              onChange={f.setOwedBy}
            />
          </View>
        )}

        <View className={isTravel || f.showTravelMultiplier ? FIELD_HALF : FIELD_FULL}>
          <PickerField
            label="Payment Method"
            value={f.paymentMethod || 'Not set'}
            options={f.paymentMethodOptions}
            onChange={f.handlePaymentMethodChange}
          />
        </View>

        {f.showTravelMultiplier && (
          <View className={FIELD_HALF}>
            <Text className={labelClass}>
              {f.bookingKind === 'smartbuy' ? 'SmartBuy multiplier (optional)' : 'Travel with Points multiplier (optional)'}
            </Text>
            <TextInput
              value={f.travelMultiplier}
              onChangeText={f.setTravelMultiplier}
              keyboardType="decimal-pad"
              placeholder={f.bookingKind === 'smartbuy' ? '10 (default)' : 'e.g. 12'}
              className={monoInputClass}
            />
          </View>
        )}

        {isTravel && (
          <View className={FIELD_HALF}>
            <Text className={labelClass}>Date</Text>
            <DateField value={f.date} onChange={f.setDate} className={inputClass} />
            {f.dateInvalid ? <Text className="font-body text-2xs text-stamp-red mt-1">Use the format YYYY-MM-DD</Text> : null}
          </View>
        )}

        <View className={FIELD_TEXT}>
          <Text className={labelClass}>Note (optional)</Text>
          <TextInput
            value={f.note}
            onChangeText={f.setNote}
            placeholder="What was this for?"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            className={inputClass}
          />
          {noteExtra}
        </View>
      </View>

      {afterFields}

      {f.canSkipCard && (
        <CheckRow checked={f.skipCardTracking} onPress={() => f.setSkipCardTracking((v) => !v)}>
          <Text className="font-body text-xs text-muted-text flex-1">
            Don't add to {f.selectedCard.name || 'the card'} (statement already closed)
          </Text>
        </CheckRow>
      )}

      {f.splitType === 'custom' && (
        <CustomSplitEditor members={members} total={parseAmountInput(f.amount) || 0} shares={f.customShares} onChange={f.setCustomShares} />
      )}

      {f.splitType === 'shared' && members.length > 2 && (
        <View className="mt-3">
          <Text className={labelClass}>Split Among</Text>
          <View className="flex-row flex-wrap">
            {members.map((m) => (
              <Chip key={m} label={m} selected={f.splitAmong.includes(m)} onPress={() => f.toggleSplitAmong(m)} />
            ))}
          </View>
          {f.splitAmong.length < members.length && (
            <Text className="font-body text-2xs text-muted-text mt-1">Only split between {f.splitAmong.join(' and ')} - not everyone.</Text>
          )}
        </View>
      )}

      <Pressable onPress={() => f.setMoreToggle(!f.moreOpen)} className="mt-3 flex-row items-center">
        <Text className="font-body-semibold text-xs text-muted-text">
          {f.moreOpen ? '▾' : '▸'} More details <Text className="font-body text-2xs">({moreParts.join(', ')})</Text>
        </Text>
      </Pressable>

      {f.moreOpen && (
        <>
          <View className="flex-row flex-wrap mt-3" style={{ gap: 14 }}>
            <View className={f.hasPoints ? FIELD_HALF : FIELD_FULL}>
              <Text className={labelClass}>Tags (optional)</Text>
              <TextInput
                value={f.tagsText}
                onChangeText={f.setTagsText}
                placeholder="Vacation, Reimbursable"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                className={inputClass}
              />
            </View>
            {f.hasPoints && (
              <View className={FIELD_HALF}>
                <Text className={labelClass}>Reward Points (+ spent / − earned)</Text>
                <TextInput
                  value={f.rewardPoints}
                  onChangeText={f.setRewardPoints}
                  keyboardType="numbers-and-punctuation"
                  placeholder="Optional"
                  className={monoInputClass}
                />
                {f.pointsInvalid ? (
                  <Text className="font-body text-2xs text-stamp-red mt-1">Enter whole or decimal points, e.g. 1500 or -250</Text>
                ) : null}
              </View>
            )}
          </View>
          {moreExtra}
        </>
      )}
    </>
  );
}
