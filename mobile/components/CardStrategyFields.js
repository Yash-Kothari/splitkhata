import { View, Text, TextInput } from 'react-native';
import PickerField from './PickerField';
import { todayISO, resolveStrategyParamsForDate } from '../lib/utils';

const label = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const input = 'font-mono text-base text-ink border border-ink/15 rounded-xl px-3 py-2.5 bg-paper';

// Every reward strategy needs a different shape of "which category/channel
// does this transaction count as" - exact port of web's StrategyFields in
// CardsManager.jsx. Shared between the Add Transaction form and inline
// transaction editing, which wrap this in a flex-row flex-wrap grid using
// two different gap values (14px vs 12px) - `gap` picks which matching
// half-width class to use so this component's own fields still line up
// with the rest of whichever parent grid it's rendered inside.
export default function CardStrategyFields({ card, draft, onChange, gap = 14 }) {
  const strategy = card.rewardStrategy;
  const halfWidth = gap === 14 ? 'w-full sm:w-[calc(50%-7px)]' : 'w-full sm:w-[calc(50%-6px)]';

  if (strategy === 'hdfc_diners_slab_milestone') {
    const dinersCategories = resolveStrategyParamsForDate(card.strategyParamsHistory, todayISO()).categories || [];
    const smartbuyCategory = dinersCategories.find((c) => c.key === 'smartbuy_hotel');
    return (
      <>
        <View className={halfWidth}>
          <PickerField
            label="Category"
            value={draft.category || 'regular'}
            options={dinersCategories.map((c) => ({ value: c.key, label: c.label }))}
            onChange={(v) => onChange({ category: v })}
          />
        </View>
        {draft.category === 'smartbuy_hotel' && (
          <>
            <View className={halfWidth}>
              <Text className={label}>Multiplier</Text>
              <TextInput
                value={String(draft.travelMultiplier ?? '')}
                onChangeText={(v) => onChange({ travelMultiplier: v })}
                keyboardType="decimal-pad"
                placeholder={String(smartbuyCategory?.multiplier ?? 10)}
                className={input}
              />
            </View>
            <View className={halfWidth}>
              <Text className={label}>Points Redeemed (Optional)</Text>
              <TextInput
                value={String(draft.pointsRedeemed ?? '')}
                onChangeText={(v) => onChange({ pointsRedeemed: v })}
                keyboardType="decimal-pad"
                placeholder="0"
                className={input}
              />
            </View>
          </>
        )}
      </>
    );
  }

  if (strategy === 'sbi_two_channel_cashback') {
    return (
      <View className={halfWidth}>
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
      <View className={halfWidth}>
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
    // 3% (Super.Money app UPI) is the default channel for a fresh
    // transaction - most spend on this card goes through the app. `?? true`
    // only fills in the unset case; an explicit false (user picked "other")
    // still sticks.
    const value = draft.channel === 'excluded' ? 'excluded' : (draft.isBonusEligible ?? true) ? 'supermoney' : 'other';
    return (
      <View className={halfWidth}>
        <PickerField
          label="Category"
          value={value}
          options={[
            { value: 'supermoney', label: 'Super.Money App UPI (3%)' },
            { value: 'other', label: 'Other UPI / Card Spend (1%)' },
            { value: 'excluded', label: 'Excluded (Repayments, Utility, Fuel, Jewellery, Cash Withdrawal, Wallet Load, Insurance, Education, Government, Financial Institutions, Rental, EMI, Telecom)' },
          ]}
          onChange={(v) => {
            if (v === 'excluded') onChange({ channel: 'excluded', isBonusEligible: false });
            else if (v === 'supermoney') onChange({ channel: null, isBonusEligible: true });
            else onChange({ channel: null, isBonusEligible: false });
          }}
        />
      </View>
    );
  }

  if (strategy === 'hsbc_premier_flat_capped') {
    return (
      <>
        <View className={halfWidth}>
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
            <View className={halfWidth}>
              <Text className={label}>Multiplier (6-36% per the booking)</Text>
              <TextInput
                value={String(draft.travelMultiplier ?? '')}
                onChangeText={(v) => onChange({ travelMultiplier: v })}
                keyboardType="decimal-pad"
                placeholder="e.g. 6"
                className={input}
              />
            </View>
            <View className={halfWidth}>
              <Text className={label}>Points Redeemed (Optional)</Text>
              <TextInput
                value={String(draft.pointsRedeemed ?? '')}
                onChangeText={(v) => onChange({ pointsRedeemed: v })}
                keyboardType="decimal-pad"
                placeholder="0"
                className={input}
              />
            </View>
          </>
        )}
      </>
    );
  }

  return null;
}
