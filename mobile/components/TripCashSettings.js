import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import PickerField from './PickerField';
import DateField from './DateField';
import { notify, confirmAsync } from '../lib/dialogs';
import { saveStartingCash, addExpense, deleteExpense, deleteCashMovementFromDb } from '../lib/firebase';
import { getTripCurrencies, localCurrencyOf, formatCurrency, parseAmountInput, isCashExchange, isValidISODate, todayISO } from '../lib/utils';
import { belongsToTrip, carryOverOptions, formatRate, isPricedStartingCash, parseRateInput, priceCashExchange, runTripCash, startingCashReplaced } from '../lib/tripCash';

const fieldLabel = 'font-body-semibold text-2xs uppercase tracking-wider text-muted-text mb-1';
const inputBox = 'font-mono text-base text-ink border border-ink/15 rounded-lg px-3 py-2.5 bg-paper shadow-2xs';
const dateBox = 'font-body-medium text-sm text-ink border border-ink/15 rounded-lg px-3 py-2.5 bg-paper shadow-2xs w-full';
const sectionTitle = 'font-body-semibold text-sm text-ink mb-2';
const hint = 'font-body text-2xs text-muted-text';
const half = 'w-full sm:w-[calc(50%-6px)]';

const quantity = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const EMPTY = { amount: '', rate: '', owner: '', currency: null, editingId: null, carriedFrom: null };

function AmountField({ label, value, onChange, placeholder = '0' }) {
  return (
    <View className={half}>
      <Text className={fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder={placeholder} aria-label={label} className={inputBox} style={{ minWidth: 0 }} />
    </View>
  );
}

function Row({ title, detail, children }) {
  return (
    <View className="flex-row items-center justify-between rounded-lg border border-ink/10 bg-paper px-3 py-2 mb-1.5" style={{ gap: 10 }}>
      <View className="flex-1 min-w-0">
        <Text className="font-mono-bold text-xs text-ink">{title}</Text>
        {detail ? <Text className={`${hint} mt-0.5`}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Action({ label, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" className="min-h-9 justify-center">
      <Text className="font-body-semibold text-xs text-muted-text underline">{label}</Text>
    </Pressable>
  );
}

// A trip's Starting Cash and Exchange Cash (see lib/tripCash.js for what they do to prices and totals). Saves are not
// awaited: offline they are queued, and the form must not sit waiting for a connection.
export default function TripCashSettings({ trip, trips = [], entries = [], movements = [], members = [], onSaveError }) {
  const currencies = getTripCurrencies(trip);
  const main = currencies[0];
  const [form, setForm] = useState(EMPTY);
  const [exchange, setExchange] = useState({ from: null, to: null, given: '', received: '', date: todayISO() });
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));

  const mine = movements.filter((m) => belongsToTrip(m, trip.id, trip.name));
  const openings = mine.filter((m) => m.type === 'opening');
  const tripEntries = entries.filter((e) => belongsToTrip(e, trip.id, trip.name));
  const exchanges = tripEntries.filter(isCashExchange).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const walk = runTripCash({ entries: tripEntries, movements: mine, primaryCurrency: main });

  const currency = currencies.includes(form.currency) ? form.currency : currencies.find((c) => c !== 'INR') || main;
  const amount = parseAmountInput(form.amount);
  const rate = form.rate.trim() ? parseRateInput(form.rate) : null;
  const owner = members.includes(form.owner) ? form.owner : '';
  const leftovers = form.editingId ? [] : carryOverOptions({ entries, movements, trips, tripId: trip.id, currencies });

  function save() {
    if (!(amount > 0)) return notify('Check the amount', 'Enter an amount like 600 or 20,000.');
    if (form.rate.trim() && !rate) return notify('Check the rate', `Enter the rupees paid for 1 ${currency}, like 91 or 0.0036.`);
    if (rate && !owner) return notify('Pick the owner', 'With a rupee rate, say whose cash it is.');
    const record = { tripId: trip.id, currency, amount, rate: rate || null, owner: rate ? owner : null, date: trip.startDate || todayISO(), carriedFrom: form.carriedFrom };
    saveStartingCash(record, startingCashReplaced(mine, record, main, form.editingId)).catch((err) => onSaveError?.(err));
    setForm(EMPTY);
  }

  async function remove(record, title, message) {
    if (!(await confirmAsync({ title, message, confirmLabel: 'Remove' }))) return;
    deleteCashMovementFromDb(record.id).catch((err) => onSaveError?.(err));
    if (form.editingId === record.id) setForm(EMPTY);
  }

  const from = currencies.includes(exchange.from) ? exchange.from : currencies.find((c) => c !== main) || main;
  const to = currencies.includes(exchange.to) && exchange.to !== from ? exchange.to : currencies.find((c) => c !== from);
  const given = parseAmountInput(exchange.given);
  const received = parseAmountInput(exchange.received);

  const priced = isValidISODate(exchange.date)
    ? priceCashExchange({ entries: tripEntries, movements: mine, primaryCurrency: main, target: { date: exchange.date, fromCurrency: from, fromAmount: given, toCurrency: to, toAmount: received } })
    : null;
  const owners = (parts) => parts.map((p) => `${formatCurrency(p.amount)} paid by ${p.owner}`).join(' and ');
  const exchangeEffect = !priced
    ? null
    : !priced.covered
      ? `Not enough recorded ${from} cash. Add it under Starting Cash with a rate and owner, or record its ATM withdrawal, first.`
      : priced.ownParts.length
        ? `Adds ${owners(priced.ownParts)}, split equally. Spending the ${to} then adds nothing.`
        : `Adds nothing: this ${from} was already counted.`;

  // Saved as a travel entry, like an ATM withdrawal: it shows in the passbook, where its split can be changed.
  function recordExchange() {
    if (!(given > 0) || !(received > 0)) return notify('Check the amounts', 'Enter what was handed over and what was received.');
    if (!isValidISODate(exchange.date)) return notify('Check the date', 'Use the format YYYY-MM-DD.');
    if (!priced?.covered) return notify('Not enough recorded cash', exchangeEffect);
    addExpense({
      amount: priced.amount,
      payer: priced.ownParts[0]?.owner || members[0],
      category: 'Misc',
      split: true,
      splitType: 'shared',
      owedBy: null,
      note: `${from} to ${to} Cash Exchange`,
      date: exchange.date,
      ledger: 'travel',
      tripId: trip.id,
      paymentMethod: null,
      isWithdrawal: true,
      localAmount: received,
      localCurrency: to,
      exchangedFrom: { currency: from, amount: given },
    }).catch((err) => onSaveError?.(err));
    setExchange((x) => ({ ...x, given: '', received: '' }));
  }

  async function removeExchange(entry) {
    if (!(await confirmAsync({ title: 'Remove Exchange', message: 'Remove this exchange and its passbook entry? Cash purchases it paid for will no longer be priced from it.', confirmLabel: 'Remove' }))) return;
    deleteExpense(entry.id).catch((err) => onSaveError?.(err));
  }

  // What each recorded exchange added, so the person can check it did what they expected.
  const effectOf = (entry) => {
    const short = walk.byEntry.get(entry.id)?.short;
    return [
      entry.ownCash?.length ? `Added ${owners(entry.ownCash)}` : 'Added nothing',
      short ? `${quantity(short)} ${entry.exchangedFrom.currency} more than recorded cash` : null,
    ].filter(Boolean).join(' · ');
  };

  return (
    <>
      <View className="border-t border-ink/10 pt-4 mt-5 mb-5">
        <Text className={sectionTitle}>Starting Cash</Text>
        <Text className={`${hint} mb-2`}>
          Cash taken along from before the trip. Nothing is added to the trip when you save it. With a rupee rate and an owner,
          it counts as it is spent or exchanged, as paid by the owner. Without a rate it only counts the cash.
        </Text>

        {openings.map((m) => {
          const code = localCurrencyOf(m, main);
          const left = walk.leftover.find((x) => x.currency === code && x.owner === m.owner);
          const priced = isPricedStartingCash(m);
          return (
            <Row
              key={m.id}
              title={`${quantity(m.amount)} ${code}${priced ? ` · ${m.owner} · ₹${formatRate(m.rate)}` : ''}`}
              detail={
                priced
                  ? `${formatCurrency(m.amount * m.rate)} in all · ${quantity(left?.local || 0)} ${code} of ${m.owner}'s cash left${m.carriedFrom?.tripName ? ` · from ${m.carriedFrom.tripName}` : ''}`
                  : 'No rupee rate: spending it is not priced.'
              }
            >
              <Action
                label="Edit"
                onPress={() =>
                  setForm({ amount: String(m.amount), rate: m.rate ? formatRate(m.rate) : '', owner: m.owner || '', currency: code, editingId: m.id, carriedFrom: m.carriedFrom || null })
                }
              />
              <Action label="Remove" onPress={() => remove(m, 'Remove Starting Cash', `Remove the ${quantity(m.amount)} ${code} starting cash? Purchases and exchanges it paid for will no longer be priced from it.`)} />
            </Row>
          );
        })}

        {leftovers.map((x) => (
          <Pressable
            key={`${x.tripId}-${x.currency}-${x.owner}`}
            onPress={() => setForm({ amount: String(x.local), rate: formatRate(x.rate), owner: x.owner, currency: x.currency, editingId: null, carriedFrom: { tripId: x.tripId, tripName: x.tripName } })}
            accessibilityRole="button"
            className="min-h-11 rounded-lg border border-ledger-green/30 bg-ledger-green/10 px-3 py-2 mb-1.5 justify-center"
          >
            <Text className="font-body-semibold text-xs text-ledger-green">
              Use Leftover: {quantity(x.local)} {x.currency} · {x.owner} · ₹{formatRate(x.rate)}
            </Text>
            <Text className={hint}>Unspent on {x.tripName}. Fills the form below, where you can change it before saving.</Text>
          </Pressable>
        ))}

        <View className="flex-row flex-wrap mt-1" style={{ gap: 12 }}>
          {currencies.length > 1 && (
            <View className="w-full">
              <PickerField label="Currency" value={currency} options={currencies} onChange={(c) => set({ currency: c })} />
            </View>
          )}
          <AmountField label={`Amount (${currency})`} value={form.amount} onChange={(v) => set({ amount: v })} />
          <AmountField label={`Rate (₹ per 1 ${currency})`} value={form.rate} onChange={(v) => set({ rate: v })} placeholder="Optional" />
          {form.rate.trim() ? (
            <View className="w-full">
              <PickerField label="Whose Cash" value={owner || 'Select...'} options={members} onChange={(v) => set({ owner: v })} />
              {amount > 0 && rate ? <Text className={`${hint} mt-1`}>Worth {formatCurrency(amount * rate)}, counted only as it is spent or exchanged.</Text> : null}
            </View>
          ) : null}
          <Pressable onPress={save} className="w-full min-h-11 rounded-lg bg-ledger-green items-center justify-center">
            <Text className="font-body-semibold text-sm text-white">{form.editingId ? 'Save Changes' : 'Save Starting Cash'}</Text>
          </Pressable>
          {form.editingId || form.carriedFrom ? (
            <Pressable onPress={() => setForm(EMPTY)} className="w-full min-h-10 rounded-lg border border-ink/15 items-center justify-center">
              <Text className="font-body-semibold text-sm text-ink">Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View className="border-t border-ink/10 pt-4 mb-5">
        <Text className={sectionTitle}>Exchange Cash</Text>
        {currencies.length < 2 ? (
          <Text className={hint}>Add a second currency under Other Currencies to record changing one into the other.</Text>
        ) : (
          <>
            <Text className={`${hint} mb-2`}>
              For cash changed at a money changer. It works like an ATM withdrawal: the rupee cost of the cash handed over is
              added to the trip now, as paid by its owner, and spending the new cash adds nothing. It is split equally; edit
              it in the passbook to change that.
            </Text>
            {exchanges.map((m) => (
              <Row key={m.id} title={`${quantity(m.exchangedFrom.amount)} ${m.exchangedFrom.currency} → ${quantity(m.localAmount)} ${m.localCurrency}`} detail={`${m.date} · ${effectOf(m)}`}>
                <Action label="Remove" onPress={() => removeExchange(m)} />
              </Row>
            ))}
            <View className="flex-row flex-wrap mt-1" style={{ gap: 12 }}>
              <View className={half}>
                <PickerField label="From" value={from} options={currencies} onChange={(c) => setExchange((x) => ({ ...x, from: c }))} />
              </View>
              <AmountField label={`Given (${from})`} value={exchange.given} onChange={(v) => setExchange((x) => ({ ...x, given: v }))} />
              <View className={half}>
                <PickerField label="To" value={to} options={currencies.filter((c) => c !== from)} onChange={(c) => setExchange((x) => ({ ...x, to: c }))} />
              </View>
              <AmountField label={`Received (${to})`} value={exchange.received} onChange={(v) => setExchange((x) => ({ ...x, received: v }))} />
              <View className="w-full">
                <Text className={fieldLabel}>Date</Text>
                <DateField value={exchange.date} onChange={(v) => setExchange((x) => ({ ...x, date: v }))} className={dateBox} />
                {priced ? (
                  <>
                    <Text className={`${hint} mt-1`}>{received >= given ? `1 ${from} = ${quantity(received / given)} ${to}` : `1 ${to} = ${quantity(given / received)} ${from}`}</Text>
                    <Text className={`font-body-semibold text-2xs mt-1 ${priced.covered ? 'text-ledger-green' : 'text-stamp-red'}`}>{exchangeEffect}</Text>
                  </>
                ) : null}
              </View>
              <Pressable onPress={recordExchange} className="w-full min-h-11 rounded-lg border border-ink/15 items-center justify-center">
                <Text className="font-body-semibold text-sm text-ink">Record Exchange</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </>
  );
}
