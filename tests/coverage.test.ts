import { describe, expect, it } from 'vitest';
import { computeCoverage, type CoverageItem } from '../src/modules/documents/coverage';

const item = (id: string, over: Partial<CoverageItem> = {}): CoverageItem => ({
  id,
  title: `Obligation ${id}`,
  ruleCode: `RULE-${id}`,
  status: 'UPCOMING',
  dueDate: '2026-10-31',
  evidenceRequired: ['Acknowledgement'],
  ...over,
});

describe('evidence coverage', () => {
  it('is 0% when nothing has been uploaded', () => {
    // The bug: a company with zero documents reported 60%, because the edge
    // counted obligations that *require* evidence as obligations that *have*
    // it. Coverage is what is on file, not what is asked for.
    const items = Array.from({ length: 136 }, (_, i) => item(String(i)));
    const c = computeCoverage(items, new Set());
    expect(c.coveragePct).toBe(0);
    expect(c.itemsWithEvidence).toBe(0);
    expect(c.itemsRequiringEvidence).toBe(136);
  });

  it('counts only obligations with a document actually attached', () => {
    const items = [item('a'), item('b'), item('c'), item('d')];
    expect(computeCoverage(items, new Set(['a', 'c'])).coveragePct).toBe(50);
  });

  it('ignores obligations that ask for nothing, in both halves', () => {
    // MSME, GST, DPIIT, ESI, EPF, MCA and KYC obligations carry a document.
    // Ones that carry none cannot be documented and must not drag the figure
    // down, nor be counted as covered.
    const items = [
      item('needs-1'),
      item('needs-2'),
      item('needs-nothing', { evidenceRequired: [] }),
    ];
    const c = computeCoverage(items, new Set(['needs-1']));
    expect(c.totalItems).toBe(3);
    expect(c.itemsRequiringEvidence).toBe(2);
    expect(c.coveragePct).toBe(50);
  });

  it('reports 100% when nothing requires evidence at all', () => {
    // Not zero: there is nothing outstanding.
    const items = [item('x', { evidenceRequired: [] })];
    expect(computeCoverage(items, new Set()).coveragePct).toBe(100);
  });

  it('chases only what is already completed or overdue', () => {
    // An obligation that is not due yet is not a missing document.
    const items = [
      item('done', { status: 'COMPLETED' }),
      item('late', { status: 'OVERDUE' }),
      item('later', { status: 'UPCOMING' }),
      item('due', { status: 'DUE' }),
    ];
    const missing = computeCoverage(items, new Set()).missing.map((m) => m.id);
    expect(missing.sort()).toEqual(['done', 'late']);
  });

  it('names what each missing obligation expects', () => {
    const items = [item('u', { status: 'OVERDUE', evidenceRequired: ['Udyam certificate'] })];
    expect(computeCoverage(items, new Set()).missing[0]!.expected).toEqual(['Udyam certificate']);
  });

  it('is 100% only when every requiring obligation has a file', () => {
    const items = [item('a'), item('b')];
    expect(computeCoverage(items, new Set(['a', 'b'])).coveragePct).toBe(100);
    expect(computeCoverage(items, new Set(['a', 'b'])).missing).toEqual([]);
  });
});

describe('the Node and edge copies agree', () => {
  it('compute the same coverage', async () => {
    // These two disagreed completely in production: one counted documents, the
    // other counted requirements, and the browser saw the wrong one.
    const edge = await import('../supabase/functions/_shared/coverage');
    const items = [
      item('a', { status: 'COMPLETED' }),
      item('b', { status: 'OVERDUE' }),
      item('c', { status: 'UPCOMING' }),
      item('d', { evidenceRequired: [] }),
    ];
    for (const documented of [new Set<string>(), new Set(['a']), new Set(['a', 'b', 'c'])]) {
      expect(edge.computeCoverage(items as any, documented)).toEqual(computeCoverage(items, documented));
    }
  });
});
