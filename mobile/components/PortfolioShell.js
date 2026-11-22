import { View, Text } from 'react-native';
import Card from './Card';

// One title-and-body wrapper for the Portfolio forms, so the same form can sit in three places without three copies:
//  - 'settings': the way Settings tabs are laid out (a bold title, a caption, the body in a bordered box);
//  - 'bare': just the title and body, for inside a pop-up sheet that already supplies the surface;
//  - 'card' (default): a page card.
export default function PortfolioShell({ variant = 'card', title, subtitle, children }) {
  if (variant === 'settings') {
    return (
      <View className="gap-3">
        <View>
          <Text className="font-body-semibold text-sm text-ink mb-0.5">{title}</Text>
          {subtitle ? <Text className="font-body text-xs text-muted-text">{subtitle}</Text> : null}
        </View>
        <View className="p-4 rounded-xl border border-ink/15 bg-paper gap-2.5">{children}</View>
      </View>
    );
  }
  const body = (
    <>
      <Text className="font-display text-lg text-ink">{title}</Text>
      {subtitle ? <Text className="font-body text-xs text-muted-text mb-3">{subtitle}</Text> : <View style={{ height: 8 }} />}
      {children}
    </>
  );
  if (variant === 'bare') return <View>{body}</View>;
  return <Card className="p-4 mb-4">{body}</Card>;
}
