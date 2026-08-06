import { formatCurrency, normalizeLedger, PERSON_COLORS } from '../utils';

function formatTripKey(tripName) {
  return tripName?.trim() || 'General Trip Expenses';
}

// Each member's share of trip cost - not who paid, but who it's ultimately
// attributed to: personal expenses count fully against the payer, "owed"
// expenses count fully against whoever owes it back, and shared expenses
// split evenly. Mirrors the Excel's "Total Kruti / Total Yash" panel.
function computeMemberTotals(tripEntries, members) {
  const totals = Object.fromEntries(members.map((m) => [m, 0]));
  for (const entry of tripEntries) {
    const amount = Number(entry.amount || 0);
    if (!amount) continue;
    if (!entry.split) {
      if (members.includes(entry.payer)) totals[entry.payer] += amount;
    } else if (entry.splitType === 'owed' && entry.owedBy) {
      if (members.includes(entry.owedBy)) totals[entry.owedBy] += amount;
    } else {
      const share = amount / members.length;
      members.forEach((m) => {
        totals[m] += share;
      });
    }
  }
  return totals;
}

export default function TravelSummaryCard({ entries, ledger, dbMembers = [], trips = [] }) {
  if (normalizeLedger(ledger) !== 'travel') return null;

  const currencyByTrip = Object.fromEntries(trips.map((t) => [t.name, t.currency || 'INR']));

  const tripGroups = entries.reduce((acc, entry) => {
    if (normalizeLedger(entry?.ledger) !== 'travel') return acc;
    if (entry.splitType === 'settlement') return acc;
    const tripName = formatTripKey(entry.tripName);
    if (!acc[tripName]) {
      acc[tripName] = { name: tripName, total: 0, count: 0, entries: [] };
    }
    acc[tripName].total += Number(entry.amount || 0);
    acc[tripName].count += 1;
    acc[tripName].entries.push(entry);
    return acc;
  }, {});

  const tripList = Object.values(tripGroups)
    .map((trip) => ({
      ...trip,
      currency: currencyByTrip[trip.name] || 'INR',
      memberTotals: computeMemberTotals(trip.entries, dbMembers),
    }))
    .sort((a, b) => b.total - a.total);

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
              <p className="font-mono font-bold text-ink text-base">{formatCurrency(trip.total, trip.currency)}</p>
            </div>
            {dbMembers.length > 0 && (
              <div className="mt-2.5 pt-2.5 border-t border-ink/10 flex flex-wrap gap-x-3 gap-y-1">
                {dbMembers.map((member) => (
                  <div key={member} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: PERSON_COLORS[member] || '#3D7068' }}
                    />
                    <span className="text-muted-text">{member}</span>
                    <span className="font-mono font-semibold text-ink">{formatCurrency(trip.memberTotals[member] || 0, trip.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
