import { formatCurrency, normalizeLedger } from '../utils';

function formatTripKey(tripName) {
  return tripName?.trim() || 'General Trip Expenses';
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
    <section className="panel-card px-5 py-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-display text-lg font-bold text-ink">Trip Summary</h2>
        <span className="text-xs rounded-full border border-ink/10 bg-paper px-3 py-1 text-muted-text font-medium">
          Travel Ledger
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tripList.map((trip) => (
          <div key={trip.name} className="rounded-lg border border-ink/10 bg-paper px-3.5 py-3 shadow-2xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-ink text-sm">{trip.name}</p>
                <p className="text-xs text-muted-text mt-0.5">{trip.count} {trip.count === 1 ? 'entry' : 'entries'}</p>
              </div>
              <p className="font-mono font-bold text-ink text-base">{formatCurrency(trip.total)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
