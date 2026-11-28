import { View } from 'react-native';
import { FoldCard, FundLines, Line, Note, HISTORY_NEEDED } from './PortfolioRows';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { formatShortDate } from '../lib/portfolio';
import { signedPct, gainClass } from './PortfolioSummary';
import { XIRR_MIN_DAYS } from '../lib/portfolioLedger';

const rate = (v) => (v == null ? '-' : signedPct(v));
const since = (iso) => `since ${formatShortDate(iso)} ${iso.slice(0, 4)}`;

// The yearly return (XIRR): what a steady rate would have to be for each rupee, from the day it went in, to become what
// came out and what is held now.
export default function PortfolioReturns({ returns, collapsible = false }) {
  const { signed } = usePortfolioPrivacy();
  const { funds, total, missing, estimated } = returns;
  const none = funds.length === 0 && !total.since;
  return (
    <FoldCard
      title="Annual Return"
      subtitle="XIRR: allows for when each rupee went in"
      summary={total.xirr != null ? `${rate(total.xirr)} a year` : none ? 'Needs transaction history' : 'Too new to say'}
      collapsible={collapsible}
      defaultOpen
    >
      {none ? (
        <Note>{HISTORY_NEEDED}</Note>
      ) : (
        <View>
          <Line
            strong
            label={missing.length ? 'Funds With History' : 'All Funds'}
            sub={total.since ? since(total.since) : null}
            value={rate(total.xirr)}
            tone={total.xirr == null ? 'text-ink' : gainClass(total.xirr)}
            valueSub={`${signed(total.gain)} gain`}
          />
          <FundLines
            items={funds}
            render={(f) => <Line key={f.key} label={f.short} sub={since(f.since)} value={rate(f.xirr)} tone={f.xirr == null ? 'text-muted-text' : gainClass(f.xirr)} />}
          />
          <Note>
            A dash means under {XIRR_MIN_DAYS} days. The total includes funds you have since sold. Direct stocks are not included.
            {estimated ? ' Purchases after the statement date are estimated from later imports and your SIP plan.' : ''}
          </Note>
          {missing.length ? <Note tone="text-mustard">No history yet: {missing.join(', ')}.</Note> : null}
        </View>
      )}
    </FoldCard>
  );
}
