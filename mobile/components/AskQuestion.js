import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { usePathname } from 'expo-router';
import { subscribeToExpenses, subscribeToCategories, subscribeToMembers, subscribeToTrips, generateStructured, generateDigest } from '../lib/firebase';
import { buildAskQuestionSchema, buildAskQuestionPrompt, buildAskAnswerNarrationPrompt, resolveAskQuery, todayISO } from '../lib/utils';
import { reportError } from '../lib/errorReporting';

const DEFAULT_EXAMPLES = ['Top 3 Biggest Expense of the month', 'How is Grocery expense compared to last month'];

// RN port of web's AskQuestion.jsx - a floating chat FAB, mounted once in
// app/(tabs)/_layout.js so it persists (and keeps its thread) across tab
// switches, rather than remounting per-screen the way GlobalSearch does.
// Self-contained data (subscribes to both ledgers, categories, trips,
// members itself) for the same reason GlobalSearch is: reachable from
// anywhere without every screen threading its own data down to it.
//
// currentContext here is derived from the active route only (household/
// travel/payments/cards) - web additionally knows which trip is selected
// on the Travel tab and defaults ambiguous questions to it. Mobile doesn't
// have that selection surfaced outside travel.js's own local state, so a
// question like "biggest expense" defaults to "whichever trip/ledger you
// name, or household if you don't" instead of "this trip" - a minor UX
// nicety lost, not a functional gap: naming a trip explicitly still works.
export default function AskQuestion() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState([]);
  const [householdEntries, setHouseholdEntries] = useState([]);
  const [travelEntries, setTravelEntries] = useState([]);
  const [categories, setCategories] = useState({ household: [], travel: [] });
  const [members, setMembers] = useState([]);
  const [trips, setTrips] = useState([]);

  useEffect(() => subscribeToExpenses('household', setHouseholdEntries, (err) => reportError(err, 'Could not load household entries')), []);
  useEffect(() => subscribeToExpenses('travel', setTravelEntries, (err) => reportError(err, 'Could not load travel entries')), []);
  useEffect(
    () =>
      subscribeToCategories((data) => {
        setCategories({ household: data.household || [], travel: data.travel || [] });
      }, (err) => reportError(err, 'Could not load categories')),
    [],
  );
  useEffect(
    () =>
      subscribeToMembers(
        (data) => data.members?.length && setMembers(data.members),
        (err) => reportError(err, 'Could not load members'),
      ),
    [],
  );
  useEffect(() => subscribeToTrips(setTrips, (err) => reportError(err, 'Could not load trips')), []);

  const allEntries = [...householdEntries, ...travelEntries];
  const allCategories = Array.from(new Set([...categories.household, ...categories.travel]));
  const tripNames = trips.map((t) => t.name);

  const isTravel = pathname === '/travel';
  const isPayments = pathname === '/payments';
  const currentContext = isTravel
    ? 'Travel ledger (no specific trip selected)'
    : isPayments
      ? 'Payments tab (no single ledger in view - default to household)'
      : 'Household ledger';
  const currentContextLabel = isTravel ? 'Travel' : isPayments ? 'Payments (defaults to Household)' : 'Household';
  const exampleQuestions = isTravel
    ? tripNames.length >= 2
      ? [`Compare ${tripNames[0]} and ${tripNames[1]} trip expenses`, `In which trip did I spend more on Food?`]
      : tripNames.length === 1
        ? [`Biggest expense of my ${tripNames[0]} trip`, `Top 3 biggest travel expenses`]
        : ['In which trip did I spend more on Food?', 'Top 3 biggest travel expenses']
    : isPayments
      ? ['Who owes who right now?', 'Total household spend this month']
      : DEFAULT_EXAMPLES;

  async function askText(rawText) {
    const text = rawText.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    setThread((prev) => [...prev, { id, question: text, status: 'loading', answer: '', error: '' }]);
    setQuestion('');
    try {
      const schema = buildAskQuestionSchema({ categories: allCategories, members, trips: tripNames });
      const prompt = buildAskQuestionPrompt(text, {
        categories: allCategories,
        members,
        trips: tripNames,
        today: todayISO(),
        currentContext,
      });
      const { queries } = await generateStructured(prompt, schema);
      const facts = queries.map((spec) => resolveAskQuery(spec, allEntries, members));
      const answer = await generateDigest(buildAskAnswerNarrationPrompt(text, facts));
      setThread((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'done', answer } : t)));
    } catch (err) {
      const error = err?.message || 'Could not answer that.';
      setThread((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'error', error } : t)));
    }
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="absolute bottom-24 right-4 w-14 h-14 rounded-full bg-ledger-green items-center justify-center"
        style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 6 }}
      >
        <Text style={{ fontSize: 22 }}>{open ? '✕' : '✨'}</Text>
      </Pressable>

      {open && (
        <View
          className="absolute bottom-40 left-4 right-4 md:left-auto md:w-96 rounded-2xl bg-paper-card border border-ink/15 overflow-hidden"
          style={{ maxHeight: '60%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 }}
        >
          <View className="px-4 py-3 border-b border-ink/10 flex-row items-center justify-between bg-paper/60">
            <View className="flex-1">
              <Text className="font-display text-sm text-ink">✨ Ask about this data</Text>
              <Text className="font-body text-2xs text-muted-text mt-0.5">
                Defaults to: <Text className="font-body-semibold">{currentContextLabel}</Text>
              </Text>
            </View>
            {thread.length > 0 && (
              <Pressable onPress={() => setThread([])} hitSlop={6}>
                <Text className="font-body-semibold text-xs text-muted-text underline">Clear</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setOpen(false)} hitSlop={8} className="w-7 h-7 rounded-full border border-ink/15 bg-paper items-center justify-center ml-2">
              <Text className="font-body-semibold text-xs text-ink">✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled" style={{ minHeight: 96 }}>
            {thread.length === 0 ? (
              <View>
                <Text className="font-body text-xs text-muted-text mb-2">Try one of these, or ask your own:</Text>
                <View style={{ gap: 6 }}>
                  {exampleQuestions.map((example) => (
                    <Pressable
                      key={example}
                      onPress={() => askText(example)}
                      className="px-3 py-2 rounded-lg border border-ledger-green/25 bg-ledger-green/5"
                    >
                      <Text className="font-body text-xs text-ink">{example}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              thread.map((t) => (
                <View key={t.id} className="mb-3">
                  <Text className="font-body-semibold text-sm text-ink">{t.question}</Text>
                  {t.status === 'loading' && <Text className="font-body text-xs text-muted-text mt-0.5">✨ Thinking...</Text>}
                  {t.status === 'done' && <Text className="font-body text-sm text-ink mt-0.5">{t.answer}</Text>}
                  {t.status === 'error' && <Text className="font-body text-xs text-stamp-red mt-0.5">{t.error}</Text>}
                </View>
              ))
            )}
          </ScrollView>

          <View className="p-3 border-t border-ink/10 bg-paper/60 flex-row gap-2">
            <TextInput
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={() => askText(question)}
              placeholder="Ask a question..."
              className="flex-1 font-body-medium text-sm text-ink border border-ink/15 rounded-xl px-3.5 bg-paper shadow-2xs"
              style={{ height: 44 }}
            />
            <Pressable
              onPress={() => askText(question)}
              disabled={!question.trim()}
              className="shrink-0 min-h-11 px-4 rounded-xl bg-ledger-green items-center justify-center disabled:opacity-50"
            >
              <Text className="font-body-semibold text-sm text-white">Ask</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}
