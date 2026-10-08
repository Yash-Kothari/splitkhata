import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Card from './Card';
import { formatCurrency } from '../lib/utils';

function shortDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function dueText(billed) {
  if (billed.overdue) return `overdue since ${shortDate(billed.dueDate)}`;
  if (billed.daysUntilDue === 0) return 'due today';
  return `due ${shortDate(billed.dueDate)}`;
}

const labelClass = 'font-body-semibold text-2xs text-muted-text uppercase tracking-wider';

// What each person owes the card companies right now across their cards: the
// statement still building up (an estimate from this cycle's transactions so
// far) and the last statement that has closed but isn't marked paid. Tap a
// person for the card-by-card split. Styled like the other Cards-tab cards
// (p-4 card, display-font title, small-caps labels, mono numbers, inset
// tiles). `summary` comes from computeCardBillSummary.
export default function CardBillsSummary({ summary, onMarkPaid }) {
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState({});
  if (!summary || summary.people.length === 0) return null;

  return (
    <Card className="p-4 mb-4">
      <Text className="font-display text-lg text-ink">Estimated Card Bills</Text>
      <Text className="font-body text-2xs text-muted-text mb-3">
        Next statement is this cycle so far. Billed is a statement already received and not yet marked paid.
      </Text>

      {summary.people.map((p) => {
        const isOpen = Boolean(open[p.owner]);
        return (
          <View key={p.owner} className="rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5 mb-3">
            <Pressable onPress={() => setOpen((o) => ({ ...o, [p.owner]: !o[p.owner] }))}>
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className="font-body-semibold text-sm text-ink">{p.owner}</Text>
                {p.hasNext ? (
                  <View className="px-2.5 py-1 rounded-md bg-paper border border-ink/10">
                    <Text className="font-body-semibold text-xs text-muted-text">{isOpen ? 'Hide cards' : 'Show cards'}</Text>
                  </View>
                ) : null}
              </View>
              <View className="flex-row gap-3">
                {p.hasNext && (
                  <View className="flex-1">
                    <Text className={labelClass}>Next statement</Text>
                    <Text className="font-mono-bold text-ink text-lg">{formatCurrency(p.nextTotal)}</Text>
                  </View>
                )}
                {p.billedTotal > 0 && (
                  <View className="flex-1">
                    <Text className={labelClass}>Billed, unpaid</Text>
                    <Text className="font-mono-bold text-ink text-lg">{formatCurrency(p.billedTotal)}</Text>
                  </View>
                )}
              </View>
            </Pressable>

            {p.cards.some((c) => c.statementOnly) && (
              <View className="mt-2.5 pt-2.5 border-t border-ink/10">
                {p.cards
                  .filter((c) => c.statementOnly)
                  .flatMap((c) => c.statements.map((st) => ({ ...st, cardName: c.name })))
                  .map((st) => (
                    <View key={st.txnId} className="flex-row items-center justify-between mb-2" style={{ gap: 8 }}>
                      <View className="flex-1">
                        <Text className="font-body-semibold text-xs text-ink" numberOfLines={1}>
                          {st.cardName}
                        </Text>
                        <Text className={`font-body text-2xs ${st.overdue ? 'text-stamp-red' : 'text-muted-text'}`}>
                          Statement {shortDate(st.date)}, {dueText(st)}
                        </Text>
                      </View>
                      <Text className={`font-mono-bold text-xs ${st.overdue ? 'text-stamp-red' : 'text-ink'}`}>{formatCurrency(st.amount)}</Text>
                      {onMarkPaid ? (
                        <Pressable
                          onPress={async () => {
                            setBusy(st.txnId);
                            try {
                              await onMarkPaid(st.txnId);
                            } finally {
                              setBusy(null);
                            }
                          }}
                          disabled={busy === st.txnId}
                          className="px-2.5 py-1 rounded-md bg-paper border border-ink/10"
                        >
                          <Text className="font-body-semibold text-xs text-muted-text">{busy === st.txnId ? '...' : 'Mark paid'}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
              </View>
            )}

            {isOpen && (
              <View className="mt-2.5 pt-2.5 border-t border-ink/10">
                {p.cards.filter((c) => !c.statementOnly).map((c) => (
                  <View key={c.cardId} className="mb-2">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-body-semibold text-xs text-ink flex-1 pr-2" numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text className="font-mono-bold text-xs text-ink">{formatCurrency(c.next.amount)}</Text>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="font-body text-2xs text-muted-text">Next statement, closes {shortDate(c.next.closesOn)}</Text>
                    </View>
                    {c.billed ? (
                      <View className="flex-row items-center justify-between">
                        <Text className={`font-body text-2xs ${c.billed.overdue ? 'text-stamp-red' : 'text-muted-text'}`}>
                          Billed, {dueText(c.billed)}
                        </Text>
                        <Text className={`font-mono-bold text-2xs ${c.billed.overdue ? 'text-stamp-red' : 'text-ink'}`}>
                          {formatCurrency(c.billed.amount)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {summary.people.length > 1 ? (
        <View className="rounded-xl bg-ledger-green/10 px-3.5 py-2.5">
          <Text className="font-body-semibold text-2xs text-ledger-green uppercase tracking-wider">All cards, next statements</Text>
          <Text className="font-mono-bold text-ledger-green text-2xl">{formatCurrency(summary.nextTotal)}</Text>
          {summary.billedTotal > 0 ? (
            <Text className="font-body text-2xs text-muted-text mt-0.5">
              Plus <Text className="font-mono-bold text-ink">{formatCurrency(summary.billedTotal)}</Text> already billed and unpaid
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
