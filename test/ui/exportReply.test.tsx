// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { toMarkdown, type Exportable } from '../../packages/ui/src/components/ExportReply';
import type { AskSource } from '../../packages/ui/src/types';

/**
 * The markdown serialization is the shared contract: the PDF renderer consumes
 * the same `Exportable`, so pinning this pins both exports against drift.
 */

const source = (n: number, over: Partial<AskSource> = {}): AskSource => ({
  n,
  entryId: n * 10,
  title: `finding ${n}`,
  projectSlug: 'deepcast',
  sourceType: 'kdb_component',
  sourcePath: `/repo/kdb/components/api.log`,
  occurredAt: '2026-07-09T12:25:00Z',
  ...over,
});

describe('toMarkdown', () => {
  it('carries the question, the answer and every source', () => {
    const reply: Exportable = {
      question: 'what broke?',
      content: 'The pool drained [1] and the retry masked it [2].',
      sources: [source(1), source(2, { title: 'retry masked it' })],
    };

    const md = toMarkdown(reply);

    expect(md).toContain('# what broke?');
    expect(md).toContain('The pool drained [1]');
    expect(md).toContain('## Sources');
    // Every citation in the body must resolve in the exported footnotes.
    expect(md).toContain('[1] **finding 1**');
    expect(md).toContain('[2] **retry masked it**');
    expect(md).toContain('/repo/kdb/components/api.log');
  });

  it('keeps the [n] markers so citations still resolve outside the app', () => {
    const md = toMarkdown({
      content: 'grounded [1]',
      sources: [source(1)],
    });
    // The body's [1] and the footnote's [1] are the whole point of the export.
    expect(md.match(/\[1\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('records the project, source type and date of each citation', () => {
    const md = toMarkdown({ content: 'x [1]', sources: [source(1)] });
    expect(md).toContain('`deepcast`');
    expect(md).toContain('kdb_component');
    expect(md).toContain('2026-07-09');
  });

  it('omits the Sources section when an answer cites nothing', () => {
    const md = toMarkdown({ content: 'no citations here', sources: [] });
    expect(md).not.toContain('## Sources');
    expect(md.trim()).toBe('no citations here');
  });

  it('survives a source with no timestamp', () => {
    const md = toMarkdown({
      content: 'x [1]',
      sources: [source(1, { occurredAt: undefined })],
    });
    expect(md).toContain('[1] **finding 1**');
    // No dangling separator where the date would have been.
    expect(md).not.toContain('· \n');
  });
});
