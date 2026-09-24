import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { verifyPin } from '../lib/pinAuth';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// After this many wrong PINs in a row, the keypad locks out for a bit -
// doubling each further block of ATTEMPT_LIMIT wrong guesses, so a 4-digit
// PIN can't just be brute-forced by someone with the phone in hand and no
// hurry. Resets to 0 on a correct entry.
const ATTEMPT_LIMIT = 5;
const BASE_COOLDOWN_SECONDS = 30;

// RN port of web's PinLockScreen.jsx - a 4-digit numeric keypad instead of
// a real keyboard, since that's the natural input for a phone PIN screen
// (web's keydown listener has no mobile equivalent needed).
//
// `pinConfig` (from PinGate, already the trusted config for this session)
// replaces the old `correctPin` string prop: the PIN is now compared as a
// hash (see lib/pinAuth.js), so verifying it is async.
export default function PinLockScreen({ onUnlock, pinConfig }) {
  const [pinDigits, setPinDigits] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [wrongCount, setWrongCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!cooldownUntil) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (remaining <= 0) setCooldownUntil(null);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const locked = cooldownUntil != null && cooldownUntil > Date.now();

  const handleKeyPress = useCallback(
    (digit) => {
      if (locked || checking || pinDigits.length >= 4) return;
      setError(false);
      const next = pinDigits + digit;
      setPinDigits(next);
      if (next.length === 4) {
        const myRequest = ++requestId.current;
        setChecking(true);
        verifyPin(next, pinConfig).then((ok) => {
          // A later attempt may have started (and been answered) while this
          // one was still in flight - never let a stale result act.
          if (myRequest !== requestId.current) return;
          setChecking(false);
          if (ok) {
            onUnlock();
            return;
          }
          setError(true);
          setPinDigits('');
          const nextWrongCount = wrongCount + 1;
          setWrongCount(nextWrongCount);
          if (nextWrongCount % ATTEMPT_LIMIT === 0) {
            const blocks = nextWrongCount / ATTEMPT_LIMIT;
            const seconds = BASE_COOLDOWN_SECONDS * 2 ** (blocks - 1);
            setCooldownUntil(Date.now() + seconds * 1000);
          }
        });
      }
    },
    [locked, checking, pinDigits, pinConfig, wrongCount, onUnlock],
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
      <Text className="font-body-medium text-xs text-muted-text mb-6">Enter the household PIN</Text>

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
        {locked ? (
          <Text className="font-body-semibold text-xs text-stamp-red">Too many wrong tries. Try again in {cooldownRemaining}s.</Text>
        ) : error ? (
          <Text className="font-body-semibold text-xs text-stamp-red">Incorrect PIN. Please try again.</Text>
        ) : checking ? (
          <Text className="font-body text-[11px] text-muted-text/70">Checking...</Text>
        ) : (
          <Text className="font-body text-[11px] text-muted-text/70">One PIN for both of you, on every device.</Text>
        )}
      </View>

      <View className="flex-row flex-wrap justify-center" style={{ width: 240, gap: 12, opacity: locked ? 0.4 : 1 }}>
        {KEYS.map((num) => (
          <Pressable
            key={num}
            disabled={locked}
            onPress={() => handleKeyPress(num)}
            className="rounded-full border border-ink/15 bg-paper-card items-center justify-center"
            style={{ width: 64, height: 64 }}
          >
            <Text className="font-display text-2xl text-ink">{num}</Text>
          </Pressable>
        ))}
        <View style={{ width: 64, height: 64 }} />
        <Pressable
          disabled={locked}
          onPress={() => handleKeyPress('0')}
          className="rounded-full border border-ink/15 bg-paper-card items-center justify-center"
          style={{ width: 64, height: 64 }}
        >
          <Text className="font-display text-2xl text-ink">0</Text>
        </Pressable>
        <Pressable
          disabled={locked}
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
