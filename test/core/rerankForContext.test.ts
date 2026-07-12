import { describe, expect, it } from 'vitest';
import { rerankForContext } from '@atlas/core';
import type { SearchHit } from '@atlas/core';

/**
 * The regression these guard: a tool that indexes its own operators'
 * conversations ranks debugging transcripts about "feature X" above the doc
 * that explains X, because the transcript echoes the question verbatim. Ask
 * then answers from chatter. rerankForContext must promote the doc into the
 * window and stop sessions from filling it.
 */

const hit = (id: number, score: number, sourceType: SearchHit['sourceType']): SearchHit => ({
  entryId: id,
  score,
  projectSlug: 'p',
  sourceType,
  title: `t${id}`,
  snippet: 's',
  sourcePath: `/x${id}`,
});

describe('rerankForContext', () => {
  it('promotes an authoritative doc over higher-scoring session chatter', () => {
    // Sessions out-score the doc on raw relevance, exactly the drain-feature bug.
    const pool = [
      hit(1, 0.99, 'claude_session'),
      hit(2, 0.98, 'claude_session'),
      hit(3, 0.97, 'claude_session'),
      hit(4, 0.6, 'doc'), // the block that actually explains the feature
    ];
    const out = rerankForContext(pool, 4);
    expect(out.map((h) => h.entryId)).toContain(4);
    // With the weight, the doc (0.6*1.35=0.81) beats a 0.8-weighted session.
    expect(out[0].sourceType).toBe('doc');
  });

  it('caps claude_session blocks at half the window when better types exist', () => {
    const pool = [
      hit(1, 0.99, 'claude_session'),
      hit(2, 0.98, 'claude_session'),
      hit(3, 0.97, 'claude_session'),
      hit(4, 0.96, 'claude_session'),
      hit(5, 0.5, 'doc'),
      hit(6, 0.5, 'kdb_component'),
    ];
    const out = rerankForContext(pool, 4);
    const sessions = out.filter((h) => h.sourceType === 'claude_session').length;
    expect(sessions).toBeLessThanOrEqual(2); // floor(4 * 0.5)
    // Freed slots go to the authoritative sources.
    expect(out.some((h) => h.sourceType === 'doc')).toBe(true);
    expect(out.some((h) => h.sourceType === 'kdb_component')).toBe(true);
  });

  it('still fills the window from sessions when nothing else matches', () => {
    const pool = [
      hit(1, 0.9, 'claude_session'),
      hit(2, 0.8, 'claude_session'),
      hit(3, 0.7, 'claude_session'),
    ];
    const out = rerankForContext(pool, 3);
    // A genuinely session-only answer must not be starved by the cap.
    expect(out).toHaveLength(3);
  });

  it('never returns more than k', () => {
    const pool = Array.from({ length: 20 }, (_, i) => hit(i, 1 - i / 100, 'doc'));
    expect(rerankForContext(pool, 8)).toHaveLength(8);
  });
});
