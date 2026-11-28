// Google sign-in for the website opened from an iPhone Home Screen icon. There Firebase's pop-up cannot report back, so the
// whole window goes to Google and returns with the ID token after the # of the app's address. public/index.html moves that
// part into `window.__googleReturn` before any other script runs. No Firebase here, so all of it is testable.
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const PENDING_KEY = 'splitkhata-google-signin';
export const MAX_AGE_MS = 10 * 60 * 1000;
const RETRY = 'Could not finish signing in. Please tap Continue with Google again.';

// Safari sets this only for a page opened from a Home Screen icon.
export const isIosHomeScreenApp = (win) => win?.navigator?.standalone === true;

// Where Google sends the person back to: the app's front page, which must be listed on the Google OAuth client. The base
// path (/splitkhata) is read off the app bundle's own address, as the offline worker's registration does.
export function appRootAddress(win) {
  const bundle = win.document.querySelector('script[src*="/_expo/static/js/"]');
  const base = bundle ? new URL(bundle.src, win.location.origin).pathname.split('/_expo/')[0] : '';
  return `${win.location.origin}${base}/`;
}

function randomText(win) {
  return Array.from(win.crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function startHomeScreenSignIn(win, clientId, now = Date.now()) {
  const state = randomText(win);
  const nonce = randomText(win);
  win.localStorage.setItem(PENDING_KEY, JSON.stringify({ state, nonce, at: now }));
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: appRootAddress(win),
    response_type: 'id_token',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
    nonce,
  });
  win.location.assign(`${AUTH_ENDPOINT}?${query}`);
}

function tokenNonce(idToken) {
  try {
    return JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).nonce;
  } catch (_) {
    return null;
  }
}

// null when this launch is not a return from Google; otherwise { idToken } or { error }. Only the answer to a sign-in started
// on this device is accepted (state and nonce), so a made-up link cannot sign anyone in. It is read once.
export function finishHomeScreenSignIn(win, now = Date.now()) {
  const returned = win.__googleReturn;
  if (!returned) return null;
  delete win.__googleReturn;
  const params = new URLSearchParams(returned);
  let pending = null;
  try {
    pending = JSON.parse(win.localStorage.getItem(PENDING_KEY));
  } catch (_) {
    // unreadable storage counts as nothing pending
  }
  if (!pending || params.get('state') !== pending.state) return { error: RETRY };
  win.localStorage.removeItem(PENDING_KEY);
  if (now - pending.at > MAX_AGE_MS) return { error: 'That sign-in took too long. Please try again.' };
  const failure = params.get('error');
  if (failure) return { error: failure === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${failure}).` };
  const idToken = params.get('id_token');
  if (!idToken || tokenNonce(idToken) !== pending.nonce) return { error: RETRY };
  return { idToken };
}
