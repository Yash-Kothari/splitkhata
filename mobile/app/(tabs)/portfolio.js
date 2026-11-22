import { useState } from 'react';
import { Redirect } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, Platform, Share, useWindowDimensions } from 'react-native';
import { FEATURES } from '../../lib/edition';
import usePortfolio from '../../lib/usePortfolio';
import AppHeader from '../../components/AppHeader';
import Card from '../../components/Card';
import PortfolioSummary from '../../components/PortfolioSummary';
import PortfolioSyncCard from '../../components/PortfolioSyncCard';
import PortfolioImport from '../../components/PortfolioImport';
import PortfolioTradeForm from '../../components/PortfolioTradeForm';
import PortfolioSipEditor from '../../components/PortfolioSipEditor';
import PortfolioLimits from '../../components/PortfolioLimits';
import PortfolioWhatIf from '../../components/PortfolioWhatIf';
import PortfolioBenchmark from '../../components/PortfolioBenchmark';
import PortfolioProjection from '../../components/PortfolioProjection';
import { PortfolioPrivacyProvider } from '../../lib/PortfolioPrivacyContext';
import { holdingsToCsv } from '../../lib/portfolio';
import { todayISO } from '../../lib/utils';
import { reportError } from '../../lib/errorReporting';
import PortfolioFundList from '../../components/PortfolioFundList';
import PortfolioOverlap from '../../components/PortfolioOverlap';
import { DailyPnlChart, ValueChart } from '../../components/PortfolioCharts';

function PortfolioScreen() {
  const p = usePortfolio();
  const { width } = useWindowDimensions();
  // Same rule as the other tabs: above 1024px there is a side rail and the charts stay open; on a phone they fold.
  const isWide = width >= 1024;
  const [importing, setImporting] = useState(false);
  const [trading, setTrading] = useState(false);
  const [editingSip, setEditingSip] = useState(false);

  // Website: a file download. Phone: the share sheet with the CSV text.
  async function exportCsv() {
    const csv = holdingsToCsv(p.portfolio.rows);
    const name = `portfolio-${todayISO()}.csv`;
    try {
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: name, message: csv });
      }
    } catch (err) {
      reportError(err, 'Could not export the holdings');
    }
  }

  const sync = (
    <PortfolioSyncCard
      sync={p.sync}
      backfill={p.backfill}
      estimatedCount={p.portfolio.estimatedCount}
      hasSetup={p.hasSetup}
      nudges={p.nudges}
      onImport={() => setImporting(true)}
      onTrade={() => setTrading(true)}
      onSip={() => setEditingSip(true)}
      onExport={exportCsv}
      onRefreshNavs={p.refreshNavs}
    />
  );
  const importCard = (
    <>
      {importing ? (
        <PortfolioImport
          funds={p.funds}
          snapshots={p.snapshots}
          navByCode={p.navByCode}
          sipPlan={p.sipPlan}
          trades={p.trades}
          onClose={() => setImporting(false)}
        />
      ) : null}
      {trading ? (
        <PortfolioTradeForm funds={p.funds} navByCode={p.navByCode} rows={p.portfolio.rows} trades={p.trades} onClose={() => setTrading(false)} />
      ) : null}
      {editingSip ? <PortfolioSipEditor funds={p.funds} schedule={p.sipSchedule} onClose={() => setEditingSip(false)} /> : null}
    </>
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
      <View className="px-4">
        {importCard}
        {sync}
        <Card className="p-4 mb-4">
          <Text className="font-display text-lg text-ink mb-1">Nothing here yet</Text>
          <Text className="font-body text-sm text-muted-text">
            Import the setup file to add your funds, units and SIP plan. After that, NAVs fill in by themselves each time you open this tab, and a
            fresh Kite snapshot keeps the units exact.
          </Text>
        </Card>
      </View>
    );
  } else {
    const summary = <PortfolioSummary portfolio={p.portfolio} />;
    const funds = <PortfolioFundList portfolio={p.portfolio} />;
    const daily = <DailyPnlChart history={p.history} collapsible={!isWide} />;
    const value = <ValueChart history={p.history} collapsible={!isWide} />;
    const overlap = <PortfolioOverlap overlap={p.overlap} mix={p.mix} asOf={p.overlapAsOf} collapsible={!isWide} />;
    const limits = <PortfolioLimits evaluated={p.evaluatedLimits} limits={p.limits} saved={p.limitsSaved} metrics={p.metrics} collapsible={!isWide} />;
    const whatIf = (
      <PortfolioWhatIf portfolio={p.portfolio} funds={p.funds} overlapData={p.overlapData} metrics={p.metrics} sipPlan={p.sipPlan} collapsible={!isWide} />
    );
    const benchmark = <PortfolioBenchmark table={p.benchmarkTable} benchmark={p.benchmark} collapsible={!isWide} />;
    const projection = <PortfolioProjection portfolio={p.portfolio} sipPlan={p.sipPlan} collapsible={!isWide} />;
    body = (
      <View className="px-4">
        {importCard}
        {isWide ? (
          <View className="flex-row" style={{ gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1.15, minWidth: 0 }}>
              {summary}
              {sync}
              {limits}
              {funds}
              {benchmark}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {daily}
              {value}
              {overlap}
              {whatIf}
              {projection}
            </View>
          </View>
        ) : (
          <View>
            {summary}
            {sync}
            {limits}
            {daily}
            {value}
            {funds}
            {overlap}
            {whatIf}
            {benchmark}
            {projection}
          </View>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge="📈 Portfolio" />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
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
