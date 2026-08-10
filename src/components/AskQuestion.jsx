import { useState } from 'react';
import { generateStructured, generateDigest } from '../firebase';
import {
  buildAskQuestionSchema,
  buildAskQuestionPrompt,
  buildAskAnswerNarrationPrompt,
  resolveAskQuery,
  todayISO,
} from '../utils';

// Read-only by design, even for a compound question: the AI decides WHAT
// to look up (a list of schema-constrained query specs, so a question
// like "compare X and Y, highest and lowest of each" becomes several
// small queries instead of one), resolveAskQuery computes every fact
// deterministically with the same functions the rest of the app already
// trusts, and only the phrasing of the final sentence is left to the AI -
// constrained to just those already-correct facts. Never writes anything
// back to the ledger, and each question's answer never depends on a
// previous one, so there's no hidden context to reason about.
//
// Floats as a chat-bubble FAB (bottom-right) rather than living inline in
// the page, so it's reachable from anywhere without scrolling and doesn't
// compete for space with Add Entry - z-40 keeps it below the app's
// full-screen modals (Settings, Trip Settings, category drilldown), which
// all use z-50.
export default function AskQuestion({ entries, ledger, dbMembers = [], dbCategories = [], currentCurrency = 'INR' }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState([]);

  async function handleAsk() {
    const text = question.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    setThread((prev) => [...prev, { id, question: text, status: 'loading', answer: '', error: '' }]);
    setQuestion('');
    try {
      const schema = buildAskQuestionSchema({ categories: dbCategories, members: dbMembers });
      const prompt = buildAskQuestionPrompt(text, { categories: dbCategories, members: dbMembers, today: todayISO() });
      const { queries } = await generateStructured(prompt, schema);
      const facts = queries.map((spec) => resolveAskQuery(spec, entries, ledger, dbMembers, currentCurrency));
      const answer = await generateDigest(buildAskAnswerNarrationPrompt(text, facts));
      setThread((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'done', answer } : t)));
    } catch (err) {
      const error = err?.message || 'Could not answer that.';
      setThread((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'error', error } : t)));
    }
  }

  const inputClass =
    'w-full h-11 px-3.5 text-sm rounded-xl border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs transition-all flex items-center';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-40 w-14 h-14 rounded-full bg-ledger-green text-white shadow-lg hover:bg-ledger-green/90 active:scale-95 transition-all flex items-center justify-center text-2xl"
        aria-label={open ? 'Close chat' : 'Ask about this data'}
        aria-expanded={open}
      >
        {open ? '✕' : '💬'}
      </button>

      {open && (
        <div className="fixed bottom-[5.5rem] sm:bottom-24 right-3 sm:right-6 left-3 sm:left-auto z-40 sm:w-96 max-h-[70vh] rounded-2xl bg-paper-card border border-ink/15 shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between bg-paper/60 shrink-0">
            <p className="font-display font-bold text-ink text-sm">✨ Ask about this data</p>
            {thread.length > 0 && (
              <button
                type="button"
                onClick={() => setThread([])}
                className="text-xs font-semibold text-muted-text hover:text-ink underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-24">
            {thread.length === 0 ? (
              <p className="text-xs text-muted-text">
                Try "compare Food and Groceries this month" or "top 3 biggest expenses".
              </p>
            ) : (
              thread.map((t) => (
                <div key={t.id}>
                  <p className="text-sm font-semibold text-ink">{t.question}</p>
                  {t.status === 'loading' && (
                    <p className="text-xs text-muted-text mt-0.5">✨ Thinking...</p>
                  )}
                  {t.status === 'done' && (
                    <p className="text-sm text-ink mt-0.5">{t.answer}</p>
                  )}
                  {t.status === 'error' && (
                    <p className="text-xs text-stamp-red mt-0.5">{t.error}</p>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-ink/10 shrink-0 bg-paper/60">
            <div className="flex gap-2">
              <input
                id="askQuestion"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
                className={inputClass}
                placeholder="Ask a question..."
                autoFocus
              />
              <button
                type="button"
                onClick={handleAsk}
                disabled={!question.trim()}
                className="shrink-0 h-11 px-4 rounded-xl bg-ledger-green text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
              >
                Ask
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
