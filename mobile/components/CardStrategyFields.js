import { View, Text, TextInput } from 'react-native';
import PickerField from './PickerField';
import { todayISO, resolveStrategyParamsForDate } from '../lib/utils';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 mb-3 bg-paper';

// Every reward strategy needs a different shape of "which category/channel
// does this transaction count as" - exact port of web's StrategyFields in
// CardsManager.jsx. Shared between the Add Transaction form and inline
// transaction editing.
export default function CardStrategyFields({ card, draft, onChange }) {
  const strategy = card.rewardStrategy;

  if (strategy === 'hdfc_diners_slab_milestone') {
    const dinersCategories = resolveStrategyParamsForDate(card.strategyParamsHistory, todayISO()).categories || [];
    const smartbuyCategory = dinersCategories.find((c) => c.key === 'smartbuy_hotel');
    return (
      <>
        <View className="mb-3">
          <PickerField
            label="Category"
            value={draft.category || 'regular'}
            options={dinersCategories.map((c) => ({ value: c.key, label: c.label }))}
            onChange={(v) => onChange({ category: v })}
          />
        </View>
        {draft.category === 'smartbuy_hotel' && (
          <>
            <Text className={label}>Multiplier</Text>
            <TextInput
              value={String(draft.travelMultiplier ?? '')}
              onChangeText={(v) => onChange({ travelMultiplier: v })}
              keyboardType="decimal-pad"
              placeholder={String(smartbuyCategory?.multiplier ?? 10)}
              className={input}
            />
            <Text className={label}>Points Redeemed (Optional)</Text>
            <TextInput
              value={String(draft.pointsRedeemed ?? '')}
              onChangeText={(v) => onChange({ pointsRedeemed: v })}
              keyboardType="decimal-pad"
              placeholder="0"
              className={input}
            />
          </>
        )}
      </>
    );
  }

  if (strategy === 'sbi_two_channel_cashback') {
    return (
      <View className="mb-3">
        <PickerField
          label="Category"
          value={draft.channel || 'online'}
          options={[
            { value: 'online', label: 'Online (5%)' },
            { value: 'offline', label: 'Offline / POS (1%)' },
            { value: 'excluded', label: 'Excluded (Fuel, Gaming, Tolls, Govt, Wallet, Rent, Jewellery, Education, Utility, Insurance, Gift Shop, Railways, EMI)' },
          ]}
          onChange={(v) => onChange({ channel: v })}
        />
      </View>
    );
  }

  if (strategy === 'hsbc_tiered_cashback_aggregate') {
    const value = draft.channel === 'excluded' ? 'excluded' : draft.isBonusEligible ? 'eligible' : 'base';
    return (
      <View className="mb-3">
        <PickerField
          label="Category"
          value={value}
          options={[
            { value: 'eligible', label: 'Dining / Food Delivery / Grocery / Shopping / Utility (10%)' },
            { value: 'base', label: 'Everything Else (1.5%)' },
            { value: 'excluded', label: 'Excluded (Rent, Fuel, Insurance, Education, Government, E-Wallets, Financial Institutions, Money Transfer, Jewellery, Tolls, Gambling, Hospitals, Wholesale Clubs, International / Forex, EMI - 0%)' },
          ]}
          onChange={(v) => {
            if (v === 'excluded') onChange({ channel: 'excluded', isBonusEligible: false });
            else if (v === 'eligible') onChange({ channel: null, isBonusEligible: true });
            else onChange({ channel: null, isBonusEligible: false });
          }}
        />
      </View>
    );
  }

  if (strategy === 'axis_supermoney_dual_pool') {
    return (
      <View className="mb-3">
        <PickerField
          label="Category"
          value={draft.isBonusEligible ? 'supermoney' : 'other'}
          options={[
            { value: 'supermoney', label: 'Super.Money App UPI (3%)' },
            { value: 'other', label: 'Other UPI / Card Spend (1%)' },
          ]}
          onChange={(v) => onChange({ isBonusEligible: v === 'supermoney' })}
        />
      </View>
    );
  }

  if (strategy === 'hsbc_premier_flat_capped') {
    return (
      <>
        <View className="mb-3">
          <PickerField
            label="Category"
            value={draft.category || 'regular'}
            options={[
              { value: 'regular', label: 'Regular (3%)' },
              { value: 'capped_category', label: 'Insurance / Utility / Education / Govt / Wallet / Real Estate / Jewellery / Tax / Money Transfer (3%, capped ₹1L/month)' },
              { value: 'fuel_excluded', label: 'Fuel (Excluded)' },
              { value: 'travel_bonus', label: 'Travel with Points Booking (Multiplier)' },
            ]}
            onChange={(v) => onChange({ category: v })}
          />
        </View>
        {draft.category === 'travel_bonus' && (
          <>
            <Text className={label}>Multiplier (6-36% per the booking)</Text>
            <TextInput
              value={String(draft.travelMultiplier ?? '')}
              onChangeText={(v) => onChange({ travelMultiplier: v })}
              keyboardType="decimal-pad"
              placeholder="e.g. 6"
              className={input}
            />
            <Text className={label}>Points Redeemed (Optional)</Text>
            <TextInput
              value={String(draft.pointsRedeemed ?? '')}
              onChangeText={(v) => onChange({ pointsRedeemed: v })}
              keyboardType="decimal-pad"
              placeholder="0"
              className={input}
            />
          </>
        )}
      </>
    );
  }

  return null;
}
