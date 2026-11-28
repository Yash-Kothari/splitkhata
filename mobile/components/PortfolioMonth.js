import { View, Text } from 'react-native';
import { FoldCard, Line, Note, Heading } from './PortfolioRows';
import { usePortfolioPrivacy } from '../lib/PortfolioPrivacyContext';
import { formatShortDate } from '../lib/portfolio';
import { gainClass } from './PortfolioSummary';

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const nameOf = (m) => `${MONTH[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Each recent month's change in value, split into what the market did and what you put in or took out; and whether the
// SIP units expected between the last two imports arrived.
export default function PortfolioMonth({ months, sipChecks = [], collapsible = false }) {
  const { money, signed } = usePortfolioPrivacy();
  const short = sipChecks.filter((c) => c.isShort);
  if (!months.length && !sipChecks.length) return null;
  const lead = months[0];
  return (
    <FoldCard
      title="Monthly Change"
      subtitle="Market movement against new money"
      summary={short.length ? `${short.length} SIP${short.length === 1 ? '' : 's'} may have missed` : lead ? `Market ${signed(lead.market)} this month` : null}
      collapsible={collapsible}
      defaultOpen={short.length > 0}
    >
      {months.map((m) => (
        <View key={m.month} className="mb-2">
          <Heading>{nameOf(m.month)}</Heading>
          <Line label="Value" sub={`${formatShortDate(m.from)} to ${formatShortDate(m.to)}`} value={money(m.end)} valueSub={`from ${money(m.start)}`} />
          <Line label="Market Movement" value={signed(m.market)} tone={gainClass(m.market)} />
          <Line label={m.added < 0 ? 'Money Out' : 'Money In'} value={signed(m.added)} />
          {m.partial ? <Note>Starts before the first import, so money in is understated.</Note> : null}
        </View>
      ))}
      {sipChecks.length ? (
        <View>
          <Heading>SIP Check</Heading>
          {short.length === 0 ? (
            <Text className="font-body text-sm text-ink">
              {sipChecks.length === 1 ? 'The 1 SIP' : `All ${sipChecks.length} SIPs`} with two imports to compare got the expected units.
            </Text>
          ) : (
            short.map((c) => (
              <Line
                key={c.key}
                label={c.short}
                sub={`${formatShortDate(c.from)} to ${formatShortDate(c.to)}, ${c.days} SIP days`}
                value={`${money(c.missingRupees)} short`}
                tone="text-stamp-red"
              />
            ))
          )}
          {short.length ? <Note>Fewer units arrived than the SIP plan expects. Check that the SIP went through, or update the plan in Settings.</Note> : null}
        </View>
      ) : null}
    </FoldCard>
  );
}
