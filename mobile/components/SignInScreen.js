import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { IS_SHARED_EDITION } from '../lib/edition';
import { signInWithGoogleIdToken, signInWithGooglePopup, signInDevTestUser, IS_DEV_EMULATOR } from '../lib/firebase';
import { themeColor } from '../lib/theme';
import { shadowStyle } from '../lib/shadow';
import { isIosHomeScreenApp, startHomeScreenSignIn, finishHomeScreenSignIn } from '../lib/googleRedirect';

// Matches web's shadow-xl on this specific card (GoogleSignIn in App.jsx) -
// a taller, softer shadow than .panel-card's own box-shadow, which is what
// Card.js's cardShadow is tuned for instead.
const signInCardShadow = shadowStyle({ color: '#000000', x: 0, y: 20, blur: 25, opacity: 0.1, elevation: 12 });

WebBrowser.maybeCompleteAuthSession();

// Registered in Google Cloud Console (same project as Firebase) under APIs &
// Services > Credentials > OAuth client ID > iOS, bundle id
// com.splitkhata.mobile - the "Web client ID" Firebase auto-creates for its
// own Google sign-in provider isn't enough on its own for a real (non-Expo
// Go) build; Google requires a client registered for this exact app.
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

export default function SignInScreen() {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  // Dev-only: skip the real Google OAuth flow entirely and sign straight
  // into the Auth emulator as a test user, so local testing against
  // EXPO_PUBLIC_USE_FIRESTORE_EMULATOR never needs a Google account. Never
  // runs against the real Auth service - IS_DEV_EMULATOR is __DEV__-gated.
  useEffect(() => {
    if (!IS_DEV_EMULATOR) return;
    signInDevTestUser().catch((err) => setError(err?.message || 'Dev sign-in failed.'));
  }, []);

  // iPhone Home Screen app: finish a sign-in that has just come back from Google (lib/googleRedirect.js).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const result = finishHomeScreenSignIn(window);
    if (!result) return;
    Promise.resolve(result)
      .then(({ idToken, error: failure }) => {
        if (failure) throw new Error(failure);
        setSigningIn(true);
        return signInWithGoogleIdToken(idToken);
      })
      .catch((err) => setError(err?.message || 'Sign-in failed.'))
      .finally(() => setSigningIn(false));
  }, []);

  // useIdTokenAuthRequest (not the plain useAuthRequest) - the plain hook
  // defaults to responseType 'token' (an access token, no id_token at all)
  // on every non-native platform, since that's "the most pragmatic option"
  // for generic web auth per its own source comment. This variant forces
  // the right response type per platform instead: implicit id_token flow
  // on web, authorization-code-then-exchange on native - both end up with
  // response.params.id_token populated, which is what Firebase needs.
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: IOS_CLIENT_ID,
    webClientId: WEB_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params?.id_token;
      if (!idToken) {
        setError('Google sign-in did not return an id token.');
        return;
      }
      setSigningIn(true);
      signInWithGoogleIdToken(idToken)
        .catch((err) => setError(err?.message || 'Sign-in failed.'))
        .finally(() => setSigningIn(false));
    } else if (response?.type === 'error') {
      setError(response.error?.message || 'Google sign-in was cancelled or failed.');
    }
  }, [response]);

  const isWeb = Platform.OS === 'web';
  const configMissing = !isWeb && (!IOS_CLIENT_ID || !WEB_CLIENT_ID);

  async function handleWebSignIn() {
    setError('');
    // An iPhone Home Screen app leaves for Google in this window instead of a pop-up. No spinner: closing Google's page
    // brings the person back here, and the button must still work.
    if (WEB_CLIENT_ID && isIosHomeScreenApp(window)) {
      try {
        startHomeScreenSignIn(window, WEB_CLIENT_ID);
      } catch (err) {
        setError(err?.message || 'Sign-in failed.');
      }
      return;
    }
    setSigningIn(true);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        setError(err?.message || 'Sign-in failed.');
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <View className="flex-1 items-center justify-center bg-paper px-6">
      <View
        style={signInCardShadow}
        className="w-full max-w-sm rounded-2xl border border-ink/15 bg-paper-card px-6 py-8 items-center"
      >
        <Text className="font-display text-3xl text-ink mb-2">Splitkhata</Text>
        <Text className="font-body text-sm text-muted-text text-center mb-6">
          {IS_SHARED_EDITION
            ? 'Keep track of shared expenses. Sign in with your Google account - your data is private to you and the people you invite.'
            : 'Sign in with an approved Google account to access the shared ledger.'}
        </Text>

        {IS_DEV_EMULATOR ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator color={themeColor('ledgerGreen', false)} />
            <Text className="font-body text-xs text-muted-text">Signing in as a dev test user (emulator)…</Text>
          </View>
        ) : configMissing ? (
          <Text className="font-body text-xs text-stamp-red text-center">
            Google sign-in isn't set up on this build yet - ask whoever set up the app to enable it.
          </Text>
        ) : (
          <Pressable
            disabled={(!isWeb && !request) || signingIn}
            onPress={() => (isWeb ? handleWebSignIn() : promptAsync())}
            className="w-full min-h-12 rounded-xl bg-ledger-green items-center justify-center px-4 disabled:opacity-50"
          >
            {signingIn ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="font-body-semibold text-white">Continue with Google</Text>
            )}
          </Pressable>
        )}

        {error ? <Text className="font-body text-sm text-red-700 text-center mt-3">{error}</Text> : null}
      </View>
    </View>
  );
}
