import { Tabs } from 'expo-router';
import { Text } from 'react-native';

function TabIcon({ emoji }) {
  return <Text style={{ fontSize: 20 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#3D7068',
        tabBarInactiveTintColor: '#5C6478',
        tabBarStyle: { backgroundColor: '#F2ECDD', borderTopColor: 'rgba(36,48,74,0.1)' },
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="payments"
        options={{ title: 'Payments', tabBarIcon: () => <TabIcon emoji="💰" /> }}
      />
      <Tabs.Screen
        name="household"
        options={{ title: 'Household', tabBarIcon: () => <TabIcon emoji="🏠" /> }}
      />
      <Tabs.Screen
        name="travel"
        options={{ title: 'Travel', tabBarIcon: () => <TabIcon emoji="✈️" /> }}
      />
      <Tabs.Screen
        name="cards"
        options={{ title: 'Cards', tabBarIcon: () => <TabIcon emoji="💳" /> }}
      />
    </Tabs>
  );
}
