import { View, Text } from 'react-native';
import AppHeader from './AppHeader';
import Card from './Card';

export default function ComingSoon({ emoji, title }) {
  return (
    <View className="flex-1 bg-paper">
      <AppHeader badge={`${emoji} ${title}`} />
      <View className="flex-1 items-center justify-center px-6">
        <Card className="items-center px-6 py-8 w-full max-w-sm">
          <Text style={{ fontSize: 40 }} className="mb-3">{emoji}</Text>
          <Text className="font-display text-xl text-ink mb-2">{title}</Text>
          <Text className="font-body text-sm text-muted-text text-center">
            Coming in a later phase of the app.
          </Text>
        </Card>
      </View>
    </View>
  );
}
