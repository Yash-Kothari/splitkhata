import { View, Text, Pressable } from 'react-native';
import Card from './Card';
import { formatShortDate, previousWeekday } from '../lib/portfolio';
import { todayISO } from '../lib/utils';

// How old the data behind the numbers is, in the three places it comes from. Kept at the top of the tab so a
// stale figure is never mistaken for a live one.
const CHIP = {
  fresh: { box: 'bg-ledger-green/15', text: 'text-ledger-green' },
  stale: { box: 'bg-mustard/20', text: 'text-mustard' },
  old: { box: 'bg-stamp-red/15', text: 'text-stamp-red' },
};

function Chip({ level, children }) {
  const c = CHIP[level] || CHIP.old;
  return (
    <View className={`self-start px-1.5 py-0.5 rounded mt-1 ${c.box}`}>
      <Text className={`font-mono text-2xs ${c.text}`}>{children}</Text>
    </View>
  );
}

function Tile({ label, value, children }) {
  return (
    <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5" style={{ flexGrow: 1, flexBasis: '47%' }}>
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">{label}</Text>
      <Text className="font-mono-bold text-lg text-ink">{value}</Text>
      {children}
    </View>
  );
}

function syncChip(s) {
  if (s.level === 'never') return <Chip level="old">Not synced yet</Chip>;
  return <Chip level={s.level}>Synced {s.label}</Chip>;
}

const NUDGE_STYLE = {
  old: 'border-stamp-red/30 bg-stamp-red/10',
  stale: 'border-mustard/40 bg-mustard/10',
};
// What to do about each reminder. The sync itself is a Claude session (Kite is only reachable there); the app only
// takes the result, so these say what to ask for.
const NUDGE_HINT = {
  kite: 'Ask Claude to “sync the portfolio”, then paste the result under Import snapshot.',
  cas: 'Give Claude the latest CAS, then paste the file it makes under Import snapshot.',
};

export default function PortfolioSyncCard({ sync, backfill, estimatedCount, hasSetup, nudges = [], onImport, onTrade, onRefreshNavs }) {
  const expected = previousWeekday(todayISO());
  const navCurrent = sync.navDate && sync.navDate >= expected;

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Sync status</Text>
      <Text className="font-body text-xs text-muted-text mb-3">When each part of these numbers was last brought up to date</Text>

      {nudges.map((n) => (
        <View key={n.key} className={`rounded-xl border px-3.5 py-2.5 mb-3 ${NUDGE_STYLE[n.level] || NUDGE_STYLE.stale}`}>
          <Text className="font-body-semibold text-sm text-ink">{n.text}</Text>
          <Text className="font-body text-xs text-muted-text mt-0.5">{NUDGE_HINT[n.key]}</Text>
        </View>
      ))}

      <View className="flex-row flex-wrap gap-2">
        <Tile label="Zerodha holdings (Kite)" value={sync.kiteDate ? formatShortDate(sync.kiteDate) : 'Never'}>
          {syncChip(sync.kite)}
        </Tile>
        <Tile label="Other funds (CAS)" value={sync.casDate ? formatShortDate(sync.casDate) : 'Never'}>
          {syncChip(sync.cas)}
        </Tile>
        <Tile label="NAVs up to" value={sync.navDate ? formatShortDate(sync.navDate) : 'None yet'}>
          {backfill.running ? (
            <Chip level="stale">Updating {backfill.done}/{backfill.total}</Chip>
          ) : navCurrent ? (
            <Chip level="fresh">Up to date</Chip>
          ) : (
            <Chip level="stale">Behind</Chip>
          )}
        </Tile>
      </View>

      {hasSetup && sync.kite.days > 0 && estimatedCount > 0 ? (
        <Text className="font-body text-xs text-muted-text mt-3">
          Units bought since {formatShortDate(sync.kiteDate)} are estimated from your SIP plan until the next Kite sync.
        </Text>
      ) : null}
      {backfill.failed > 0 && !backfill.running ? (
        <Text className="font-body text-xs text-stamp-red mt-2">
          {backfill.failed} fund{backfill.failed === 1 ? '' : 's'} could not be updated. Tap Check NAVs to try again.
        </Text>
      ) : null}

      <View className="flex-row flex-wrap gap-2 mt-3">
        <Pressable onPress={onImport} className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center">
          <Text className="font-body-semibold text-xs text-white">{hasSetup ? 'Import snapshot' : 'Import setup file'}</Text>
        </Pressable>
        {hasSetup ? (
          <Pressable onPress={onTrade} className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center">
            <Text className="font-body-semibold text-xs text-ink">Record a trade</Text>
          </Pressable>
        ) : null}
        {hasSetup ? (
          <Pressable
            onPress={onRefreshNavs}
            disabled={backfill.running}
            className="min-h-9 px-3.5 rounded-lg border border-ink/15 bg-paper items-center justify-center disabled:opacity-50"
          >
            <Text className="font-body-semibold text-xs text-ink">{backfill.running ? 'Checking...' : 'Check NAVs'}</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
