// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../packages/ui/src/App';

const fixtures: Record<string, unknown> = {
  '/api/projects': [
    // Large enough to prove the sidebar compacts it.
    { slug: 'deepcast', name: 'DeepCast', rootPath: '/x/DeepCast', hasKdb: true, entryCount: 81633 },
  ],
  '/api/stats': {
    projects: 1, entries: 142555, chunks: 157135, errors: 0, recentErrors: 0,
    bySource: {}, embedder: 'ollama/nomic-embed-text', collection: 'kdbscope_x',
    pending: 0, queue: null, backfill: null,
  },
  '/api/dashboard': {
    projects: 1, entries: 142555, chunks: 157135, sessions: 485,
    errors: 0, recentErrors: 0, bySource: { claude_session: 123635 },
    embedder: 'ollama/nomic-embed-text', collection: 'kdbscope_x',
    pending: 0, queue: null, backfill: null,
    health: { postgres: true, qdrant: true, redis: true, ollama: true },
    vectors: { points: 157369, vectors: 314201, segments: 7 },
    storage: {
      postgresBytes: 245_298_879,
      qdrantBytes: 2_515_421_157,
      redisMemoryBytes: 4_378_216,
      collections: [{ name: 'kdbscope_x', bytes: 1_414_856_704, active: true }],
    },
  },
};

const stubOk = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => fixtures[String(url).split('?')[0]!] ?? {},
      text: async () => '',
    })),
  );

afterEach(cleanup);

describe('App shell', () => {
  /**
   * The rail holds *views only* now. Projects moved to the scope bar above the
   * content, because "how am I looking" and "what am I looking at" are different
   * axes and stacking them in one column is what made the panel hard to read.
   */
  it('renders a views-only rail, with the index stats in the footer', async () => {
    stubOk();
    render(<App />);
    expect(screen.getByText('Atlas')).toBeTruthy();
    // "Overview" is both the nav item and the page heading.
    expect(screen.getAllByText('Overview').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Search & Ask')).toBeTruthy();
    // Index stats still live in the rail's footer (matched on the title, since
    // the line itself is split across several elements).
    await waitFor(() =>
      expect(screen.getByTitle(/142,555 entries · 157,135 chunks/)).toBeTruthy(),
    );
    // The project list is NOT in the rail any more — it moved to the scope bar.
    expect(screen.queryByText('deepcast')).toBeNull();
  });

  /** The overview is global by definition; a scope bar over it would imply a filter it never applies. */
  it('shows no scope bar on the overview', async () => {
    stubOk();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Services')).toBeTruthy());
    expect(screen.queryByLabelText('Add a project to the scope')).toBeNull();
  });

  it('shows the scope bar on the views a project actually filters', async () => {
    stubOk();
    render(<App />);
    fireEvent.click(await screen.findByText('Search & Ask'));
    await waitFor(() =>
      expect(screen.getByLabelText('Add a project to the scope')).toBeTruthy(),
    );
    // Nothing selected means everything — said out loud, not left blank.
    expect(screen.getByText('all projects')).toBeTruthy();
  });

  /** Arriving, the question is "is this healthy and what's in it?" */
  it('lands on the overview, not on an empty search box', async () => {
    stubOk();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Services')).toBeTruthy());
    expect(screen.queryByText('Ask your codebases what happened.')).toBeNull();
  });

  it('reaches the search view from the overview', async () => {
    stubOk();
    render(<App />);
    const cta = await screen.findByText('Search & Ask →');
    fireEvent.click(cta);
    // Search is the default mode: Ask is now a deliberate choice on the mode
    // switch, not a hidden ⌘Enter on a shared box.
    await waitFor(() =>
      expect(screen.getByText('Search everything you have built.')).toBeTruthy(),
    );
  });

  /**
   * A dead backend used to be swallowed into an empty project list, so "no
   * projects indexed" and "cannot reach the API" looked identical — which is
   * what made a 502 look like a broken sidebar.
   */
  it('says the API is unreachable instead of rendering an empty index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('alert')[0]!.textContent).toMatch(/Cannot reach the API/));
  });
});
