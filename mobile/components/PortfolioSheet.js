import { Modal, Pressable, ScrollView, View, KeyboardAvoidingView, Platform } from 'react-native';
import { useColorScheme } from 'nativewind';
import Card from './Card';
import { themeRgba } from '../lib/theme';

// A centred pop-up for a short task started from where you are (recording a trade from the fund list), so nothing opens
// off-screen at the top of the page. Tapping outside, or the platform back gesture, closes it.
export default function PortfolioSheet({ visible, onClose, children }) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          style={{ flex: 1, justifyContent: 'center', padding: 16, backgroundColor: themeRgba('ink', isDark, 0.45) }}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '92%' }}>
            <Card className="p-4">
              <ScrollView keyboardShouldPersistTaps="handled">
                <View>{children}</View>
              </ScrollView>
            </Card>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
