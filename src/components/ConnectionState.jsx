export default function ConnectionState({ status, message, onDismiss }) {
  if (status === 'ok') return null;

  const styles = {
    offline: 'bg-mustard/20 text-ink border-mustard/40',
    error: 'bg-stamp-red/10 text-stamp-red border-stamp-red/30',
    syncing: 'bg-ledger-green/10 text-ledger-green border-ledger-green/30',
  };

  const labels = {
    offline: 'Offline - changes will sync when you reconnect',
    error: message || 'Something went wrong saving',
    syncing: 'Syncing with database...',
  };

  return (
    <div
      role="status"
      className={`fixed top-0 inset-x-0 z-50 px-4 py-2 text-sm text-center border-b font-medium shadow-xs ${styles[status] ?? styles.error}`}
    >
      <span>{labels[status] ?? message}</span>
      {onDismiss && status === 'error' && (
        <button
          type="button"
          onClick={onDismiss}
          className="ml-3 underline text-sm font-semibold hover:opacity-80"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
