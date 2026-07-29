import { formatCurrency, normalizeLedger } from '../constants';

function formatTripKey(tripName) {
  return tripName?.trim() || 'Untitled trip';
}

export default function TravelSummaryCard({ entries, ledger }) {
  if (normalizeLedger(ledger) !== 'travel') return null;

  const trips = entries.reduce((acc, entry) => {
    if (normalizeLedger(entry?.ledger) !== 'travel') return acc;
    const tripName = formatTripKey(entry.tripName);
    if (!acc[tripName]) {
      acc[tripName] = { name: tripName, total: 0, count: 0 };
    }
    acc[tripName].total += Number(entry.amount || 0);
    acc[tripName].count += 1;
    return acc;
  }, {});

  const tripList = Object.values(trips).sort((a, b) => b.total - a.total);

  if (tripList.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl bg-paper-card px-5 py-4 border border-ink/10 shadow-[0_10px_30px_-20px_rgba(36,48,74,0.35)]">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-display text-lg font-medium text-ink">Trip Summary</h2>
        <span className="text-xs rounded-full border border-ink/10 bg-paper px-3 py-1 text-muted-text">
          Travel only
        </span>
      </div>

      <div className="space-y-3">
        {tripList.map((trip) => (
          <div key={trip.name} className="rounded-lg border border-ink/10 bg-paper px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-ink">{trip.name}</p>
                <p className="text-xs text-muted-text mt-1">{trip.count} entries</p>
              </div>
              <p className="font-mono font-semibold text-ink">{formatCurrency(trip.total)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
