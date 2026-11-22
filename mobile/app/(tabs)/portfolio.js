import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { FEATURES } from '../../lib/edition';
import usePortfolio from '../../lib/usePortfolio';
import { getJSON, setJSON } from '../../lib/deviceStore';
import { useSettingsModal } from '../../lib/SettingsModalContext';
import { PortfolioPrivacyProvider } from '../../lib/PortfolioPrivacyContext';
import AppHeader from '../../components/AppHeader';
import Card from '../../components/Card';
import PortfolioSectionNav from '../../components/PortfolioSectionNav';
import PortfolioPeopleSwitch from '../../components/PortfolioPeopleSwitch';
import PortfolioSummary from '../../components/PortfolioSummary';
import PortfolioSyncCard from '../../components/PortfolioSyncCard';
import PortfolioFundList from '../../components/PortfolioFundList';
import PortfolioBenchmark from '../../components/PortfolioBenchmark';
import PortfolioAllocation from '../../components/PortfolioAllocation';
import PortfolioLimits from '../../components/PortfolioLimits';
import PortfolioOverlap from '../../components/PortfolioOverlap';
import PortfolioWhatIf from '../../components/PortfolioWhatIf';
import PortfolioProjection from '../../components/PortfolioProjection';
import PortfolioSheet from '../../components/PortfolioSheet';
import PortfolioTradeForm from '../../components/PortfolioTradeForm';
import { DailyPnlChart, ValueChart } from '../../components/PortfolioCharts';

// The tab only shows things; changing anything (the SIP plan, the limits, new holdings) is a setting and lives in Settings ->
// Portfolio. Recording a trade is a quick action on the fund list, in a pop-up. Four short sections instead of one long page.
const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'funds', label: 'Funds' },
  { key: 'insights', label: 'Insights' },
  { key: 'plan', label: 'Plan' },
];

// Two columns on a wide screen (like Household's main area and side rail), one column on a phone.
function Columns({ wide, left, right }) {
  if (!wide) {
    return (
      <View>
        {left}
        {right}
      </View>
    );
  }
  return (
    <View className="flex-row" style={{ gap: 16, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, minWidth: 0 }}>{left}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{right}</View>
    </View>
  );
}

const VIEW_KEY = 'portfolio_view';

function PortfolioScreen() {
  // Whose holdings are shown (a person's name, or null for everyone together), remembered on this device.
  const [view, setView] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getJSON(VIEW_KEY, null).then((stored) => {
      if (!cancelled) setView(stored || null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const changeView = (next) => {
    setView(next);
    setJSON(VIEW_KEY, next);
  };
  const p = usePortfolio({ view });
  const { open: openSettings } = useSettingsModal();
  const { width } = useWindowDimensions();
  // Same rule as the other tabs: above 1024px there is room for two columns and the charts stay open; on a phone they fold.
  const isWide = width >= 1024;
  const fold = !isWide;
  const [section, setSection] = useState('overview');
  const [trading, setTrading] = useState(false);

  const sync = (
    <PortfolioSyncCard
      sync={p.sync}
      backfill={p.backfill}
      estimatedCount={p.portfolio.estimatedCount}
      hasSetup={p.hasSetup}
      nudges={p.nudges}
      onOpenSettings={(tab) => openSettings(tab)}
      onRefreshNavs={p.refreshNavs}
    />
  );

  let body;
  if (p.loading) {
    body = (
      <View className="py-16 items-center">
        <ActivityIndicator />
      </View>
    );
  } else if (!p.hasSetup || p.portfolio.rows.length === 0) {
    body = (
      <View>
        {sync}
        <Card className="p-4 mb-4">
          <Text className="font-display text-lg text-ink mb-1">Nothing here yet</Text>
          <Text className="font-body text-sm text-muted-text">
            Open Settings → Portfolio → Import & export and paste the setup file to add your funds, units and SIP plan. After that, NAVs fill in by
            themselves each time you open this tab, and a fresh Kite snapshot keeps the units exact.
          </Text>
        </Card>
      </View>
    );
  } else {
    const columns = {
      overview: (
        <Columns
          wide={isWide}
          left={
            <>
              <PortfolioSummary portfolio={p.portfolio} view={p.view} />
              {sync}
            </>
          }
          right={
            <>
              <DailyPnlChart history={p.history} collapsible={fold} />
              <ValueChart history={p.history} collapsible={fold} />
            </>
          }
        />
      ),
      funds: (
        <Columns
          wide={isWide}
          left={<PortfolioFundList portfolio={p.portfolio} view={p.view} onTrade={() => setTrading(true)} />}
          right={<PortfolioBenchmark table={p.benchmarkTable} benchmark={p.benchmark} rows={p.portfolio.rows} navByCode={p.navByCode} collapsible={fold} />}
        />
      ),
      insights: (
        <Columns
          wide={isWide}
          left={
            <>
              <PortfolioAllocation rows={p.portfolio.rows} byPerson={p.owners.length > 1 && !p.view} hasStocks={p.portfolio.byKind.stocks.count > 0} collapsible={fold} defaultOpen />
              <PortfolioLimits evaluated={p.evaluatedLimits} saved={p.limitsSaved} collapsible={fold} defaultOpen onEdit={() => openSettings('portfolioLimits')} />
            </>
          }
          right={<PortfolioOverlap overlap={p.overlap} asOfDate={p.overlapData?.asOfDate} collapsible={fold} />}
        />
      ),
      plan: (
        <Columns
          wide={isWide}
          left={
            <PortfolioWhatIf
              key={JSON.stringify(p.viewSipPlan)}
              portfolio={p.portfolio}
              funds={p.viewFunds}
              overlapData={p.overlapData}
              metrics={p.metrics}
              sipPlan={p.viewSipPlan}
              collapsible={fold}
              defaultOpen
            />
          }
          right={<PortfolioProjection portfolio={p.portfolio} sipPlan={p.viewSipPlan} collapsible={fold} />}
        />
      ),
    };
    body = (
      <View>
        {p.owners.length > 1 ? (
          <View className="mb-3">
            <PortfolioPeopleSwitch owners={p.owners} view={p.view} onChange={changeView} />
          </View>
        ) : null}
        <PortfolioSectionNav sections={SECTIONS} active={section} onChange={setSection} />
        {columns[section]}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="📈 Portfolio" />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32, paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      <PortfolioSheet visible={trading} onClose={() => setTrading(false)}>
        <PortfolioTradeForm funds={p.viewFunds} navByCode={p.navByCode} rows={p.portfolio.rows} trades={p.viewTrades} onClose={() => setTrading(false)} />
      </PortfolioSheet>
    </View>
  );
}

// Not part of every edition (see lib/edition.js): where this tab is switched off, its URL goes to Household and
// none of its subscriptions ever start.
export default function Portfolio() {
  if (!FEATURES.portfolio) return <Redirect href="/household" />;
  return (
    <PortfolioPrivacyProvider>
      <PortfolioScreen />
    </PortfolioPrivacyProvider>
  );
}
