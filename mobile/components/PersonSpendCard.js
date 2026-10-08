import { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useColorScheme } from 'nativewind';
import Card from './Card';
import PickerField from './PickerField';
import { computeMemberTotalsForPeriod, getAvailableYears, getDefaultYear, formatCurrency, getMonthKey, todayISO, PERSON_COLORS } from '../lib/utils';
import { themeColor } from '../lib/theme';

// P1-16: "how much have I actually spent" and "how does this year break down
// per person" - the household ledger only ever showed a net balance (who
// owes whom) and category totals, never each person's own share of what was
// spent. Reuses computeMemberTotals' existing share math (via
// computeMemberTotalsForPeriod) rather than a second way to attribute a
// shared expense - "my share" of a 50/50 dinner is half of it, not the
// whole amount just because I happened to pay.
export default function PersonSpendCard({ entries, members, deviceMemberName }) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const currentMonthKey = getMonthKey(todayISO());
  const monthTotals = useMemo(
    () => computeMemberTotalsForPeriod(entries, members, { monthKey: currentMonthKey, ledger: 'household' }),
    [entries, members, currentMonthKey],
  );
  const myShare = deviceMemberName && members.includes(deviceMemberName) ? monthTotals[deviceMemberName] || 0 : null;

  const availableYears = useMemo(() => getAvailableYears(entries), [entries]);
  const [yearChoice, setYearChoice] = useState(null);
  const selectedYear = yearChoice && availableYears.includes(yearChoice) ? yearChoice : getDefaultYear(availableYears);
  const yearTotals = useMemo(
    () => computeMemberTotalsForPeriod(entries, members, { year: selectedYear, ledger: 'household' }),
    [entries, members, selectedYear],
  );
  const yearTotal = useMemo(() => Object.values(yearTotals).reduce((sum, v) => sum + v, 0), [yearTotals]);
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => (yearTotals[b] || 0) - (yearTotals[a] || 0)),
    [members, yearTotals],
  );

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink mb-3">Household Spending</Text>

      {myShare != null && (
        <View className="rounded-xl bg-ledger-green/10 px-3.5 py-2.5 mb-4">
          <Text className="font-body-semibold text-2xs text-ledger-green uppercase tracking-wider">My Share This Month</Text>
          <Text className="font-mono-bold text-ledger-green text-2xl">{formatCurrency(myShare)}</Text>
          <Text className="font-body text-2xs text-muted-text mt-0.5">Your even/custom split of shared spend, not just what you paid.</Text>
        </View>
      )}

      <View className="flex-row items-center justify-between mb-3">
        <Text className="font-body-semibold text-sm text-ink">Yearly breakdown</Text>
        <View style={{ width: 110 }}>
          <PickerField value={selectedYear} options={availableYears} onChange={setYearChoice} label="Year" />
        </View>
      </View>

      {yearTotal === 0 ? (
        <View className="border-2 border-dashed border-ink/20 rounded-xl py-8 items-center justify-center bg-paper/50">
          <Text className="font-body text-sm text-muted-text text-center px-4">No household expenses recorded in {selectedYear}.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {sortedMembers.map((m) => {
            const amount = yearTotals[m] || 0;
            const pct = yearTotal > 0 ? amount / yearTotal : 0;
            const color = PERSON_COLORS[m] || themeColor('ledgerGreen', isDark);
            return (
              <View key={m}>
                <View className="flex-row items-center justify-between mb-1">
                  <View className="flex-row items-center gap-1.5">
                    <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <Text className="font-body-semibold text-sm text-ink">{m}</Text>
                  </View>
                  <Text className="font-mono-bold text-sm text-ink">{formatCurrency(amount)}</Text>
                </View>
                <View className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden">
                  <View className="h-full rounded-full" style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: color }} />
                </View>
              </View>
            );
          })}
          <View className="flex-row items-center justify-between pt-2 mt-1 border-t border-ink/10">
            <Text className="font-body-semibold text-xs text-muted-text uppercase tracking-wider">Total {selectedYear}</Text>
            <Text className="font-mono-bold text-sm text-ink">{formatCurrency(yearTotal)}</Text>
          </View>
        </View>
      )}
    </Card>
  );
}
