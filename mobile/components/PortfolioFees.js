import { View } from 'react-native';
import { FoldCard, FundLines, Line, Note } from './PortfolioRows';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { formatShortDate } from '../lib/portfolio';

// What the funds' expense ratios cost a year on today's value.
export default function PortfolioFees({ fees, collapsible = false }) {
  const { money } = usePortfolioPrivacy();
  const none = fees.funds.length === 0;
  return (
    <FoldCard
      title="Fund Fees"
      subtitle="Expense ratios, in rupees a year"
      summary={none ? 'No expense ratios yet' : `${money(fees.yearly)} a year`}
      collapsible={collapsible}
    >
      {none ? (
        <Note>Ask Claude for the fund details file, then paste it in Settings → Portfolio → Import & Export.</Note>
      ) : (
        <View>
          <Line strong label={fees.missing.length ? 'Funds With a Ratio' : 'All Funds'} value={money(fees.yearly)} valueSub={`${fees.avgTer.toFixed(2)}% average`} />
          <FundLines items={fees.funds} render={(f) => <Line key={f.key} label={f.short} value={money(f.yearly)} valueSub={`${f.ter.toFixed(2)}%`} />} />
          <Note>
            Already taken out of each NAV, so you do not pay this separately. Ratios as of {formatShortDate(fees.asOf)}.
          </Note>
          {fees.missing.length ? <Note tone="text-mustard">No ratio on file: {fees.missing.join(', ')}.</Note> : null}
        </View>
      )}
    </FoldCard>
  );
}
