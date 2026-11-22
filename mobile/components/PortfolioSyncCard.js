import { View, Text, Pressable } from 'react-native';
import Card from './Card';
import { formatShortDate, previousWeekday, nudgeTarget } from '../lib/portfolio';
import { todayISO } from '../lib/utils';

// How old the data behind the numbers is, in the three places it comes from, and any reminder that something is due.
// Kept at the top so a stale figure is never mistaken for a live one. Changing anything (new holdings, the SIP plan) is a
// setting, so the buttons and reminders here only point at Settings.
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
    <View className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5" style={{ flexGrow: 1, flexBasis: '30%', minWidth: 110 }}>
      <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text" numberOfLines={2}>{label}</Text>
      <Text className="font-mono-bold text-base text-ink">{value}</Text>
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
const NUDGE_HINT = {
  kite: 'Ask Claude to “sync the portfolio”, then paste the result in Settings.',
  cas: 'Give Claude the latest CAS, then paste the file it makes in Settings.',
  overlap: 'Ask Claude to refresh the overlap data, then import the new setup file in Settings.',
  limit: 'Change the limit in Settings if it no longer suits you.',
};
const hintFor = (key) => NUDGE_HINT[key] || (key.startsWith('limit') ? NUDGE_HINT.limit : '');

// What a manual NAV check found, shown under its button.
export function NavCheckResult({ backfill }) {
  if (!backfill.manual || !backfill.lastRunAt || backfill.running) return null;
  if (backfill.failed > 0) {
    return (
      <Text className="font-body text-xs text-stamp-red">
        {backfill.failed} fund{backfill.failed === 1 ? '' : 's'} could not be updated. Try again in a moment.
      </Text>
    );
  }
  return (
    <Text className="font-body text-xs text-muted-text">
      {backfill.updated > 0
        ? `Checked just now: new NAVs found for ${backfill.updated} fund${backfill.updated === 1 ? '' : 's'}.`
        : 'Checked just now: no newer NAVs have been published. Funds publish in the evening, and not on market holidays or weekends.'}
    </Text>
  );
}

export default function PortfolioSyncCard({ sync, backfill, estimatedCount, hasSetup, nudges = [], onOpenSettings, onRefreshNavs }) {
  const expected = previousWeekday(todayISO());
  const navCurrent = sync.navDate && sync.navDate >= expected;

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Sync Status</Text>
      <Text className="font-body text-xs text-muted-text mb-3">When each part of these numbers was last brought up to date</Text>

      {nudges.map((n) => (
        <Pressable
          key={n.key}
          onPress={() => onOpenSettings(nudgeTarget(n.key))}
          accessibilityRole="button"
          className={`rounded-xl border px-3.5 py-2.5 mb-3 ${NUDGE_STYLE[n.level] || NUDGE_STYLE.stale}`}
        >
          <Text className="font-body-semibold text-sm text-ink">{n.text}</Text>
          <Text className="font-body text-xs text-muted-text mt-0.5">{hintFor(n.key)}</Text>
          <Text className="font-body-semibold text-xs text-ledger-green mt-1">Open Settings →</Text>
        </Pressable>
      ))}

      <View className="flex-row flex-wrap gap-2">
        <Tile label="Zerodha (Kite)" value={sync.kiteDate ? formatShortDate(sync.kiteDate) : 'Never'}>
          {syncChip(sync.kite)}
        </Tile>
        <Tile label="Other Funds (CAS)" value={sync.casDate ? formatShortDate(sync.casDate) : 'Never'}>
          {syncChip(sync.cas)}
        </Tile>
        <Tile label="NAVs Up To" value={sync.navDate ? formatShortDate(sync.navDate) : 'None yet'}>
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

      <View className="flex-row flex-wrap gap-2 mt-3">
        <Pressable onPress={() => onOpenSettings('portfolioData')} className="min-h-9 px-3.5 rounded-lg bg-ledger-green items-center justify-center">
          <Text className="font-body-semibold text-xs text-white">{hasSetup ? 'Update Holdings' : 'Set Up'}</Text>
        </Pressable>
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
      <View className="mt-2">
        <NavCheckResult backfill={backfill} />
      </View>
    </Card>
  );
}
