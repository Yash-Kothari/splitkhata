import { useCallback, useEffect, useState } from 'react';
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
import PortfolioMonth from '../../components/PortfolioMonth';
import PortfolioReturns from '../../components/PortfolioReturns';
import PortfolioAssetMix from '../../components/PortfolioAssetMix';
import PortfolioFees from '../../components/PortfolioFees';
import PortfolioSellPreview from '../../components/PortfolioSellPreview';
import PortfolioGains from '../../components/PortfolioGains';
import { fundDetails, taxClassOf, lockInMonthsOf } from '../../lib/portfolioInsights';
import { todayISO } from '../../lib/utils';
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
  const [viewLoaded, setViewLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getJSON(VIEW_KEY, null).then((stored) => {
      if (cancelled) return;
      setView(stored || null);
      setViewLoaded(true);
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
  const taxClassFor = useCallback((fund) => taxClassOf(fund, p.fundInfo), [p.fundInfo]);
  const detailsFor = useCallback((fund) => fundDetails(fund, p.fundInfo), [p.fundInfo]);
  const lockInFor = useCallback((fund) => lockInMonthsOf(fund, p.fundInfo), [p.fundInfo]);

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
  // Until the remembered person has been read, show nothing but the spinner, so the tab never flashes the wrong view first.
  if (p.loading || !viewLoaded) {
    body = (
      <View className="py-16 items-center">
        <ActivityIndicator />
      </View>
    );
  } else if (!p.hasSetup || p.portfolio.rows.length === 0) {
    // Someone's view can be empty while the others are not (a person whose funds have no prices yet): the switcher stays, so
    // there is always a way back to everyone.
    const emptyView = p.hasSetup && p.owners.length > 1;
    body = (
      <View>
        {p.owners.length > 1 ? (
          <View className="mb-3">
            <PortfolioPeopleSwitch owners={p.owners} view={p.view} onChange={changeView} />
          </View>
        ) : null}
        {sync}
        <Card className="p-4 mb-4">
          <Text className="font-display text-lg text-ink mb-1">Nothing here yet</Text>
          <Text className="font-body text-sm text-muted-text">
            {emptyView
              ? `${p.view ? `${p.view} has` : 'There are'} no holdings with prices yet. NAVs fill in by themselves each time you open this tab; if this stays empty, check that the latest import for ${p.view || 'everyone'} has been confirmed in Settings.`
              : 'Open Settings → Portfolio → Import & export and paste the setup file to add your funds, units and SIP plan. After that, NAVs fill in by themselves each time you open this tab, and a fresh Kite snapshot keeps the units exact.'}
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
              <PortfolioMonth months={p.months} sipChecks={p.sipChecks} collapsible={fold} />
            </>
          }
        />
      ),
      funds: (
        <Columns
          wide={isWide}
          left={<PortfolioFundList portfolio={p.portfolio} view={p.view} returns={p.returns.funds} drawdowns={p.drawdowns} onTrade={() => setTrading(true)} />}
          right={<PortfolioBenchmark table={p.benchmarkTable} benchmark={p.benchmark} rows={p.portfolio.rows} navByCode={p.navByCode} collapsible={fold} />}
        />
      ),
      insights: (
        <Columns
          wide={isWide}
          left={
            <>
              <PortfolioReturns returns={p.returns} collapsible={fold} />
              <PortfolioAllocation key={p.view || 'all'} rows={p.portfolio.rows} byPerson={p.owners.length > 1 && !p.view} hasStocks={p.portfolio.byKind.stocks.count > 0} collapsible={fold} defaultOpen />
              <PortfolioAssetMix mix={p.assetMix} collapsible={fold} onEdit={() => openSettings('portfolioTargets')} />
              <PortfolioLimits evaluated={p.evaluatedLimits} saved={p.limitsSaved} collapsible={fold} defaultOpen onEdit={() => openSettings('portfolioLimits')} />
            </>
          }
          right={
            <>
              <PortfolioOverlap overlap={p.overlap} asOfDate={p.overlapData?.asOfDate} collapsible={fold} />
              <PortfolioFees fees={p.fees} collapsible={fold} />
            </>
          }
        />
      ),
      plan: (
        <Columns
          wide={isWide}
          left={
            <PortfolioWhatIf
              key={`whatif:${JSON.stringify(p.viewSipPlan)}`}
              portfolio={p.portfolio}
              funds={p.viewFunds}
              overlapData={p.overlapData}
              metrics={p.metrics}
              sipPlan={p.viewSipPlan}
              collapsible={fold}
              defaultOpen
            />
          }
          right={
            <>
              <PortfolioSellPreview
                key={`sell:${p.view || 'all'}`}
                rows={p.portfolio.rows}
                funds={p.funds}
                ledgers={p.ledgers}
                taxClassFor={taxClassFor}
                detailsFor={detailsFor}
                lockInFor={lockInFor}
                slabPct={p.slabPct}
                today={todayISO()}
                collapsible={fold}
              />
              <PortfolioGains
                funds={p.viewFunds}
                owners={p.view ? [p.view] : p.owners}
                ledgers={p.ledgers}
                taxClassFor={taxClassFor}
                slabPct={p.slabPct}
                today={todayISO()}
                collapsible={fold}
              />
              <PortfolioProjection key={`projection:${JSON.stringify(p.viewSipPlan)}`} portfolio={p.portfolio} sipPlan={p.viewSipPlan} collapsible={fold} />
            </>
          }
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
        <PortfolioTradeForm funds={p.viewFunds} navByCode={p.navByCode} rows={p.portfolio.rows} soldKeys={p.portfolio.soldKeys} trades={p.viewTrades} onClose={() => setTrading(false)} />
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
