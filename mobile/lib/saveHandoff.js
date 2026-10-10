// Firestore applies a write to its local cache (and every screen sees it)
// right away; the promise a save returns only resolves once the server
// acknowledges it, which on a slow or offline connection can take seconds or
// never. Wait for that acknowledgement just long enough to show a quick
// failure (a rejected write answers fast), then hand off: the form closes, the
// write keeps going in the background (ConnectionBanner counts it), and a late
// failure still reaches `onLateError`.
export const SAVE_HANDOFF_MS = 1000;

export async function settleOrHandOff(savePromise, onLateError, ms = SAVE_HANDOFF_MS) {
  const settled = savePromise.then(() => ({ status: 'done' })).catch((error) => ({ status: 'error', error }));
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), ms);
  });
  const outcome = await Promise.race([settled, timedOut]);
  clearTimeout(timer);
  if (outcome.status === 'timeout') {
    settled.then((result) => {
      if (result.status === 'error') onLateError?.(result.error);
    });
  }
  return outcome;
}
