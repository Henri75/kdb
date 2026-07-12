// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sidebar } from '../../packages/ui/src/components/Sidebar';
import type { ProjectRow } from '../../packages/ui/src/types';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const projects: ProjectRow[] = [
  { slug: 'atlas', rootPath: '/code/atlas', entryCount: 12000, hasKdb: true },
  { slug: 'deepcast', rootPath: '/code/deepcast', entryCount: 8000, hasKdb: true },
  { slug: 'webapp', rootPath: '/code/webapp', entryCount: 900, hasKdb: false },
] as ProjectRow[];

const renderSidebar = (over: Partial<Parameters<typeof Sidebar>[0]> = {}) =>
  render(
    <Sidebar
      projects={projects}
      project=""
      view="search"
      stats={null}
      onProject={() => {}}
      onView={() => {}}
      onReindex={() => {}}
      {...over}
    />,
  );

/** The project rows, in the order they appear in the DOM. */
const rowOrder = () =>
  [...document.querySelectorAll('[title^="/code/"]')].map((el) => el.textContent);

describe('Sidebar — project filter', () => {
  it('narrows the list to matching projects', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'deep' },
    });

    // The row survives; `webapp` is gone. (The name is asserted via the row's
    // path title, because Highlight splits the matched span into its own <mark>
    // — the slug is no longer a single text node.)
    expect(screen.getByTitle('/code/deepcast')).toBeTruthy();
    expect(screen.queryByTitle('/code/webapp')).toBeNull();
  });

  it('highlights the matched span inside the project name', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'deep' },
    });

    const mark = screen.getByTitle('/code/deepcast').querySelector('mark');
    expect(mark?.textContent).toBe('deep');
  });

  it('says how many it hid rather than silently truncating', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'deep' },
    });
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('says so when nothing matches', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No project matches/)).toBeTruthy();
  });
});

describe('Sidebar — favourites', () => {
  it('pins a favourited project above the rest', () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText('Favourite webapp'));

    expect(screen.getByText('★ Favourites')).toBeTruthy();
    // webapp is last alphabetically but first once starred.
    expect(rowOrder()[0]).toContain('webapp');
  });

  it('persists across a remount', () => {
    const { unmount } = renderSidebar();
    fireEvent.click(screen.getByLabelText('Favourite deepcast'));
    unmount();

    renderSidebar();
    expect(screen.getByLabelText('Unfavourite deepcast')).toBeTruthy();
    expect(rowOrder()[0]).toContain('deepcast');
  });

  it('unfavouriting returns it to the main list', () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText('Favourite webapp'));
    fireEvent.click(screen.getByLabelText('Unfavourite webapp'));

    expect(screen.queryByText('★ Favourites')).toBeNull();
    expect(rowOrder()[0]).toContain('atlas');
  });

  /**
   * The interaction that matters: a pinned group while filtering would push a
   * better match *below* a worse-matching favourite, breaking the only promise a
   * filter makes — that what you typed is at the top.
   */
  it('flattens the grouping while filtering so the best match leads', () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText('Favourite webapp'));
    expect(screen.getByText('★ Favourites')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'a' }, // matches atlas, deepcast and webapp
    });

    // Grouping is gone; the favourite is no longer hoisted above the others.
    expect(screen.queryByText('★ Favourites')).toBeNull();
    expect(rowOrder()[0]).toContain('atlas');
    // ...but it keeps its star, so it is still recognisable.
    expect(screen.getByLabelText('Unfavourite webapp')).toBeTruthy();
  });

  it('selecting a project is not triggered by starring it', () => {
    const picked: string[] = [];
    renderSidebar({ onProject: (s) => picked.push(s) });

    fireEvent.click(screen.getByLabelText('Favourite atlas'));
    expect(picked).toEqual([]); // the star is its own control

    fireEvent.click(within(screen.getByTitle('/code/atlas')).getByText('atlas'));
    expect(picked).toEqual(['atlas']);
  });
});
