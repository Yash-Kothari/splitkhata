import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import usePortfolio from '../lib/usePortfolio';
import { exportHoldingsCsv } from '../lib/portfolioExport';
import { reportError } from '../lib/errorReporting';
import { formatShortDate } from '../lib/portfolio';
import PortfolioShell from './PortfolioShell';
import PortfolioSipEditor from './PortfolioSipEditor';
import PortfolioImport from './PortfolioImport';
import PortfolioBenchmarkTool from './PortfolioBenchmarkTool';
import { PortfolioLimitsEditor } from './PortfolioLimits';
import { NavCheckResult } from './PortfolioSyncCard';

// The Portfolio pages of Settings: everything you set up or change now and then (the SIP plan, the limits, new holdings),
// kept off the Portfolio tab itself, which only shows. They read the same data as the tab; the once-per-visit NAV check is
// left to the tab.
function Needs({ loading, hasSetup, children }) {
  if (loading) {
    return (
      <View className="py-10 items-center">
        <ActivityIndicator />
      </View>
    );
  }
  if (!hasSetup) {
    return (
      <PortfolioShell variant="settings" title="Set Up First" subtitle="This page needs your funds, which come from the setup file.">
        <Text className="font-body text-sm text-muted-text">
          Open Import & Export in this section and paste the setup file under Update Holdings. Then come back here.
        </Text>
      </PortfolioShell>
    );
  }
  return children;
}

export function PortfolioSettingsSip() {
  const p = usePortfolio({ autoBackfill: false });
  return (
    <Needs loading={p.loading} hasSetup={p.hasSetup}>
      <PortfolioSipEditor funds={p.funds} schedule={p.sipSchedule} />
    </Needs>
  );
}

export function PortfolioSettingsLimits() {
  const p = usePortfolio({ autoBackfill: false });
  return (
    <Needs loading={p.loading} hasSetup={p.hasSetup}>
      <PortfolioLimitsEditor limits={p.limits} saved={p.limitsSaved} metrics={p.metrics} />
    </Needs>
  );
}

export function PortfolioSettingsData() {
  const p = usePortfolio({ autoBackfill: false });
  if (p.loading) {
    return (
      <View className="py-10 items-center">
        <ActivityIndicator />
      </View>
    );
  }
  const rows = p.portfolio.rows;
  return (
    <View className="gap-4">
      <PortfolioImport
        funds={p.funds}
        snapshots={p.snapshots}
        navByCode={p.navByCode}
        sipPlan={p.sipPlan}
        sipSchedule={p.sipSchedule}
        trades={p.trades}
      />

      <PortfolioBenchmarkTool benchmark={p.benchmark} hasSetup={p.hasSetup} />

      {p.hasSetup ? (
        <PortfolioShell
          variant="settings"
          title="NAVs"
          subtitle="Prices fill in by themselves whenever you open Portfolio. Check now to look for anything newer."
        >
          <Text className="font-body text-sm text-ink">
            Latest NAV on file: <Text className="font-mono-bold">{p.sync.navDate ? formatShortDate(p.sync.navDate) : 'none yet'}</Text>
          </Text>
          <View className="flex-row">
            <Pressable
              onPress={p.refreshNavs}
              disabled={p.backfill.running}
              className="min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
            >
              <Text className="font-body-semibold text-xs text-white">{p.backfill.running ? 'Checking...' : 'Check NAVs'}</Text>
            </Pressable>
          </View>
          <NavCheckResult backfill={p.backfill} />
        </PortfolioShell>
      ) : null}

      {p.hasSetup ? (
        <PortfolioShell variant="settings" title="Export" subtitle="Your holdings as a spreadsheet: one line per fund, with units, cost, value and P&L.">
          <View className="flex-row">
            <Pressable
              onPress={() => exportHoldingsCsv(rows).catch((err) => reportError(err, 'Could not export the holdings'))}
              disabled={rows.length === 0}
              className="min-h-10 px-3.5 rounded-lg bg-ledger-green items-center justify-center disabled:opacity-50"
            >
              <Text className="font-body-semibold text-xs text-white">Holdings CSV ({rows.length})</Text>
            </Pressable>
          </View>
        </PortfolioShell>
      ) : null}
    </View>
  );
}
