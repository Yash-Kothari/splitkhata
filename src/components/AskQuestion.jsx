import { useState } from 'react';
import { generateStructured } from '../firebase';
import { buildAskQuestionSchema, buildAskQuestionPrompt, resolveAskQuery, todayISO } from '../utils';

// Read-only by design: the AI only ever decides WHAT to compute (via a
// schema-constrained query spec), never computes or phrases the answer
// itself - resolveAskQuery in utils.js does the actual math with the same
// functions the rest of the app already trusts, and never writes anything
// back to the ledger.
export default function AskQuestion({ entries, ledger, dbMembers = [], dbCategories = [], currentCurrency = 'INR' }) {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState({ state: 'idle', answer: '', error: '' });

  async function handleAsk() {
    const text = question.trim();
    if (!text) return;
    setStatus({ state: 'loading', answer: '', error: '' });
    try {
      const schema = buildAskQuestionSchema({ categories: dbCategories, members: dbMembers });
      const prompt = buildAskQuestionPrompt(text, { categories: dbCategories, members: dbMembers, today: todayISO() });
      const spec = await generateStructured(prompt, schema);
      const answer = resolveAskQuery(spec, entries, ledger, dbMembers, currentCurrency);
      setStatus({ state: 'done', answer, error: '' });
    } catch (err) {
      setStatus({ state: 'error', answer: '', error: err?.message || 'Could not answer that.' });
    }
  }

  const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-muted-text mb-1.5';
  const inputClass =
    'w-full h-11 px-3.5 text-sm sm:text-base rounded-xl border border-ink/15 bg-paper text-ink font-medium focus:outline-none focus:ring-2 focus:ring-ledger-green/40 shadow-2xs transition-all flex items-center';

  return (
    <section className="panel-card px-4 sm:px-5 py-4">
      <label htmlFor="askQuestion" className={labelClass}>
        ✨ Ask about this data
      </label>
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
          placeholder="e.g. how much did we spend on Food this month?"
        />
        <button
          type="button"
          onClick={handleAsk}
          disabled={!question.trim() || status.state === 'loading'}
          className="shrink-0 h-11 px-4 rounded-xl bg-ledger-green text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ledger-green/90 transition-colors"
        >
          {status.state === 'loading' ? '...' : 'Ask'}
        </button>
      </div>
      {status.state === 'done' && (
        <p className="text-sm text-ink mt-2 font-medium">{status.answer}</p>
      )}
      {status.state === 'error' && (
        <p className="text-xs text-stamp-red mt-1.5">{status.error}</p>
      )}
    </section>
  );
}
