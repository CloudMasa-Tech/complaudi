import { useState, type FormEvent } from 'react';
import { ApiError, post } from '../api/client';
import { useCompanies } from '../auth/CompanyContext';
import type { CopilotAnswer } from '../api/types';
import { AuthorityTag, Badge, Card, ErrorNote, Spinner, fmtDate } from '../components/ui';

const SUGGESTIONS = [
  'When is my GST annual return due?',
  'Do I need to deduct provident fund?',
  'Is a tax audit required for us?',
  'What happens if I miss director KYC?',
  'Which MCA forms do we file each year?',
  'What are the MSME payment rules?',
];

export function Copilot() {
  const { selectedId, selected, companies } = useCompanies();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyId = selectedId ?? (companies.length === 1 ? companies[0]!.id : null);

  async function ask(q: string) {
    if (q.trim().length < 3) return;
    setQuestion(q);
    setBusy(true);
    setError(null);
    try {
      setAnswer(await post<CopilotAnswer>('/copilot/ask', { question: q, companyId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the copilot');
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void ask(question); };

  return (
    <>
      <Card>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <form className="row" onSubmit={submit}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about a filing, a deadline, a threshold or a penalty…"
              autoFocus
            />
            <button className="btn-primary" type="submit" disabled={busy || question.trim().length < 3}>
              {busy ? <Spinner /> : 'Ask'}
            </button>
          </form>

          <div className="row row-wrap" style={{ gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="suggest" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>

          <span className="tiny dim">
            {companyId
              ? `Answers are evaluated against ${selected?.legalName ?? companies[0]?.legalName}.`
              : 'Pick a company in the header to get answers specific to its profile.'}
          </span>
        </div>
      </Card>

      {error && <ErrorNote error={error} />}

      {answer && (
        <>
          <Card
            title={answer.question}
            note={`${answer.provider} · ${answer.confidence} confidence`}
          >
            <div className="card-body">
              <p className="answer">{answer.answer}</p>
            </div>
          </Card>

          {answer.citations.length > 0 && (
            <Card title="Sources" note={`${answer.citations.length} rules matched`}>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {answer.citations.map((c) => (
                  <div key={c.ruleCode} className="citation">
                    <div className="row" style={{ gap: 7 }}>
                      <AuthorityTag value={c.authority} />
                      {c.form && <span className="auth-tag">{c.form}</span>}
                      <span className="mono dim">{c.ruleCode}</span>
                      <span style={{ marginLeft: 'auto' }}>
                        {c.appliesToThisCompany === null ? (
                          <span className="tiny dim">not evaluated</span>
                        ) : (
                          <Badge value={c.appliesToThisCompany ? 'COMPLETED' : 'WAIVED'}>
                            {c.appliesToThisCompany ? 'Applies to you' : 'Not applicable'}
                          </Badge>
                        )}
                      </span>
                    </div>
                    <span style={{ fontWeight: 550 }}>{c.title}</span>
                    <span className="tiny muted">{c.legalReference}</span>
                    {c.nextDueDate && (
                      <span className="tiny">Next due <strong>{fmtDate(c.nextDueDate)}</strong></span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="alert">{answer.disclaimer}</div>
        </>
      )}
    </>
  );
}
