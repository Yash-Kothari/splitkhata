import * as Crypto from 'expo-crypto';

// A fixed prefix, not a per-install random salt - the PIN doc is shared
// between two people's devices by design (see savePinConfigToDb's comment),
// so there's no single "this device" secret to salt with. The prefix only
// stops the hash from being a bare, recognizable SHA-256("1234") that a
// rainbow table could reverse in one lookup; it isn't a substitute for a
// real per-user salt, which a shared 4-digit device PIN has no room for.
const PIN_HASH_PREFIX = 'splitkhata-pin-v1:';

export async function hashPin(pin) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, PIN_HASH_PREFIX + pin);
}

// Checks a typed PIN against the stored config, hashed or (for a config
// saved before hashing existed) plaintext. Never rejects.
export async function verifyPin(typedPin, config) {
  if (!config) return false;
  if (config.pinHash) return (await hashPin(typedPin)) === config.pinHash;
  if (config.legacyPin) return typedPin === config.legacyPin;
  return false;
}
