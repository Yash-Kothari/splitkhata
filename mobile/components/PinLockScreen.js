import { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// RN port of web's PinLockScreen.jsx - a 4-digit numeric keypad instead of
// a real keyboard, since that's the natural input for a phone PIN screen
// (web's keydown listener has no mobile equivalent needed).
export default function PinLockScreen({ onUnlock, correctPin }) {
  const [pinDigits, setPinDigits] = useState('');
  const [error, setError] = useState(false);

  const handleKeyPress = useCallback(
    (digit) => {
      if (pinDigits.length >= 4) return;
      setError(false);
      const next = pinDigits + digit;
      setPinDigits(next);
      if (next.length === 4) {
        if (next === correctPin) {
          onUnlock();
        } else {
          setError(true);
          setTimeout(() => {
            setPinDigits('');
            setError(false);
          }, 600);
        }
      }
    },
    [pinDigits, correctPin, onUnlock],
  );

  function handleBackspace() {
    setError(false);
    setPinDigits((prev) => prev.slice(0, -1));
  }

  return (
    <View className="flex-1 items-center justify-center bg-paper px-6">
      <View className="w-16 h-16 rounded-2xl bg-ledger-green/10 border border-ledger-green/30 items-center justify-center mb-4">
        <Text style={{ fontSize: 28 }}>🔒</Text>
      </View>

      <Text className="font-display text-2xl text-ink mb-1">Splitkhata</Text>
      <Text className="font-body-medium text-xs text-muted-text mb-6">Enter your 4-digit Security PIN</Text>

      <View className="flex-row items-center justify-center gap-4 mb-8">
        {[0, 1, 2, 3].map((index) => {
          const isFilled = pinDigits.length > index;
          return (
            <View
              key={index}
              className={`w-4 h-4 rounded-full border-2 ${
                error ? 'border-stamp-red bg-stamp-red' : isFilled ? 'border-ledger-green bg-ledger-green' : 'border-ink/25 bg-transparent'
              }`}
            />
          );
        })}
      </View>

      <View className="h-6 mb-4 items-center justify-center">
        {error ? (
          <Text className="font-body-semibold text-xs text-stamp-red">Incorrect PIN. Please try again.</Text>
        ) : (
          <Text className="font-body text-[11px] text-muted-text/70">Protected by local device PIN</Text>
        )}
      </View>

      <View className="flex-row flex-wrap justify-center" style={{ width: 240, gap: 12 }}>
        {KEYS.map((num) => (
          <Pressable
            key={num}
            onPress={() => handleKeyPress(num)}
            className="rounded-full border border-ink/15 bg-paper-card items-center justify-center"
            style={{ width: 64, height: 64 }}
          >
            <Text className="font-display text-2xl text-ink">{num}</Text>
          </Pressable>
        ))}
        <View style={{ width: 64, height: 64 }} />
        <Pressable
          onPress={() => handleKeyPress('0')}
          className="rounded-full border border-ink/15 bg-paper-card items-center justify-center"
          style={{ width: 64, height: 64 }}
        >
          <Text className="font-display text-2xl text-ink">0</Text>
        </Pressable>
        <Pressable
          onPress={handleBackspace}
          className="rounded-full border border-ink/10 bg-paper/50 items-center justify-center"
          style={{ width: 64, height: 64 }}
        >
          <Text className="font-body-semibold text-muted-text" style={{ fontSize: 22 }}>⌫</Text>
        </Pressable>
      </View>
    </View>
  );
}
