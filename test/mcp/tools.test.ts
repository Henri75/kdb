import { describe, expect, it } from 'vitest';
import { SOURCE_TYPES, TOOLS } from '../../packages/mcp/src/tools.js';

describe('MCP tool registry', () => {
  it('exposes the expected tools', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'atlas_ask',
      'atlas_component_history',
      'atlas_components',
      'atlas_entry',
      'atlas_projects',
      'atlas_reindex',
      'atlas_search',
      'atlas_session',
      'atlas_status',
      'atlas_timeline',
    ]);
  });

  // The product is Atlas; "KDB" is one of the four things it indexes. Tools name
  // the product, source types name the data, and conflating them is exactly the
  // bug a well-meaning global rename introduces — silently, since a bad source
  // type just returns no hits. These two guard the boundary in both directions.
  it('every tool is atlas_*, never kdb_* (tools name the product)', () => {
    for (const t of TOOLS) {
      expect(t.name.startsWith('atlas_'), `${t.name} must be atlas_*`).toBe(true);
      expect(t.name.startsWith('kdb_'), `${t.name} must not be kdb_*`).toBe(false);
    }
  });

  it('the KDB source types keep their kdb_ prefix (they name the data)', () => {
    // Pinned against the exported enum, not against request() — request() just
    // serialises whatever it is handed, so it would happily pass a renamed type
    // straight through to an API that rejects it, and the search would return
    // nothing with no error anywhere.
    expect([...SOURCE_TYPES]).toEqual([
      'kdb_changelog', 'kdb_session', 'kdb_component', 'kdb_backlog',
      'kdb_report', 'claude_session', 'git_commit', 'doc',
    ]);
  });

  it('atlas_entry fetches one full entry by id', () => {
    const t = TOOLS.find((t) => t.name === 'atlas_entry')!;
    expect(t.request({ entry_id: 2018 }).path).toBe('/api/entries/2018');
  });

  it('every tool has a description and a request mapper', () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(typeof t.request).toBe('function');
    }
  });

  it('atlas_search maps args to query string', () => {
    const t = TOOLS.find((t) => t.name === 'atlas_search')!;
    const { path } = t.request({ query: 'video import bug', project: 'deepcast', limit: 5 });
    expect(path).toBe('/api/search?q=video+import+bug&project=deepcast&limit=5');
  });

  /** A silently dropped filter would give agents wrong answers, not an error. */
  it('atlas_search forwards the kind filter', () => {
    const t = TOOLS.find((t) => t.name === 'atlas_search')!;
    expect(t.request({ query: 'qdrant', kind: 'insight' }).path).toBe(
      '/api/search?q=qdrant&kind=insight',
    );
  });

  it('atlas_search forwards doc_status as the docStatus param', () => {
    const t = TOOLS.find((t) => t.name === 'atlas_search')!;
    expect(t.request({ query: 'auth flow', doc_status: 'active' }).path).toBe(
      '/api/search?q=auth+flow&docStatus=active',
    );
  });

  it('atlas_ask posts a JSON body', () => {
    const t = TOOLS.find((t) => t.name === 'atlas_ask')!;
    const { path, init } = t.request({ question: 'what changed?' });
    expect(path).toBe('/api/ask');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ question: 'what changed?' });
  });

  it('atlas_component_history URL-encodes path params', () => {
    const t = TOOLS.find((t) => t.name === 'atlas_component_history')!;
    const { path } = t.request({ project: 'deepcast', component: 'video import' });
    expect(path).toBe('/api/projects/deepcast/components/video%20import');
  });
});
