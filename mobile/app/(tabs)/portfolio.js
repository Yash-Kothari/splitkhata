import { useState } from 'react';
import { Redirect } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { FEATURES } from '../../lib/edition';
import usePortfolio from '../../lib/usePortfolio';
import AppHeader from '../../components/AppHeader';
import Card from '../../components/Card';
import PortfolioSummary from '../../components/PortfolioSummary';
import PortfolioSyncCard from '../../components/PortfolioSyncCard';
import PortfolioImport from '../../components/PortfolioImport';
import PortfolioFundList from '../../components/PortfolioFundList';
import PortfolioOverlap from '../../components/PortfolioOverlap';
import { DailyPnlChart, ValueChart } from '../../components/PortfolioCharts';

function PortfolioScreen() {
  const p = usePortfolio();
  const { width } = useWindowDimensions();
  // Same rule as the other tabs: above 1024px there is a side rail and the charts stay open; on a phone they fold.
  const isWide = width >= 1024;
  const [importing, setImporting] = useState(false);

  const sync = (
    <PortfolioSyncCard
      sync={p.sync}
      backfill={p.backfill}
      estimatedCount={p.portfolio.estimatedCount}
      hasSetup={p.hasSetup}
      onImport={() => setImporting(true)}
      onRefreshNavs={p.refreshNavs}
    />
  );
  const importCard = importing ? (
    <PortfolioImport funds={p.funds} snapshots={p.snapshots} navByCode={p.navByCode} sipPlan={p.sipPlan} onClose={() => setImporting(false)} />
  ) : null;

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
    body = (
      <View className="px-4">
        {importCard}
        {isWide ? (
          <View className="flex-row" style={{ gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1.15, minWidth: 0 }}>
              {summary}
              {sync}
              {funds}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {daily}
              {value}
              {overlap}
            </View>
          </View>
        ) : (
          <View>
            {summary}
            {sync}
            {daily}
            {value}
            {funds}
            {overlap}
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
  return <PortfolioScreen />;
}
