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
export default function AskQuestion({ entries, ledger, dbMembers = [], dbCategories = [], currentCurrency = 'INR' }) {
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

  const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-muted-text mb-1.5';
  const inputClass =
    'w-full h-11 px-3.5 text-sm sm:text-base rounded-xl border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs transition-all flex items-center';

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor="askQuestion" className={`${labelClass} mb-0`}>
          ✨ Ask about this data
        </label>
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
          placeholder="e.g. compare Food and Groceries this month"
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

      {thread.length > 0 && (
        <div className="mt-3 pt-3 border-t border-ink/10 space-y-3">
          {thread.map((t) => (
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
          ))}
        </div>
      )}
    </section>
  );
}
