// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ScopeBar } from '../../packages/ui/src/components/ScopeBar';
import type { Scope } from '../../packages/ui/src/useScope';
import type { ProjectRow } from '../../packages/ui/src/types';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

/**
 * The scope bar answers "what am I looking at?". It replaced the project list in
 * the sidebar because placement encodes authority: a filter above the content
 * governs it, while one in a side rail reads as a peer of the navigation. With
 * ~50 projects, a selected row scrolled out of the rail is simply invisible —
 * which was the original complaint. A chip up here always shows.
 *
 * These assertions are inherited from the old sidebar suite: the behaviours did
 * not go away, they moved.
 */

const projects: ProjectRow[] = [
  { slug: 'atlas', rootPath: '/code/atlas', entryCount: 12000, hasKdb: true },
  { slug: 'deepcast', rootPath: '/code/deepcast', entryCount: 129000, hasKdb: true },
  { slug: 'webapp', rootPath: '/code/webapp', entryCount: 900, hasKdb: false },
] as ProjectRow[];

/** A real Scope, so selection behaviour is exercised rather than mocked away. */
function Harness({
  initial = [],
  onProjects,
}: {
  initial?: string[];
  onProjects?: (p: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [favorites, setFavorites] = useState<string[]>([]);

  const commit = (next: string[]) => {
    setSelected(next);
    onProjects?.(next);
  };

  const scope: Scope = {
    projects: selected,
    project: selected.length === 1 ? selected[0]! : null,
    isAll: selected.length === 0,
    isMulti: selected.length !== 1,
    toggle: (slug) =>
      commit(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]),
    remove: (slug) => commit(selected.filter((s) => s !== slug)),
    set: commit,
    clear: () => commit([]),
  };

  return (
    <ScopeBar
      scope={scope}
      projects={projects}
      favorites={favorites}
      onToggleFavorite={(slug) =>
        setFavorites((prev) =>
          prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
        )
      }
    />
  );
}

const openPicker = () => fireEvent.click(screen.getByLabelText('Add a project to the scope'));

describe('ScopeBar — showing the selection', () => {
  it('says "all projects" when nothing is selected', () => {
    render(<Harness />);
    expect(screen.getByText('all projects')).toBeTruthy();
  });

  it('shows a chip for every selected project', () => {
    render(<Harness initial={['deepcast', 'atlas']} />);
    // The point of the whole redesign: the selection is on screen, always.
    expect(screen.getByLabelText('Remove deepcast from scope')).toBeTruthy();
    expect(screen.getByLabelText('Remove atlas from scope')).toBeTruthy();
  });

  it('removing a chip drops that project from the scope', () => {
    const seen: string[][] = [];
    render(<Harness initial={['deepcast', 'atlas']} onProjects={(p) => seen.push(p)} />);
    fireEvent.click(screen.getByLabelText('Remove deepcast from scope'));
    expect(seen.at(-1)).toEqual(['atlas']);
  });

  it('reports how much of the index the scope covers', () => {
    render(<Harness initial={['atlas']} />);
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('clears back to all projects', () => {
    const seen: string[][] = [];
    render(<Harness initial={['atlas']} onProjects={(p) => seen.push(p)} />);
    fireEvent.click(screen.getByTitle('Search every project'));
    expect(seen.at(-1)).toEqual([]);
  });

  it('surfaces a note when the view cannot honour the selection', () => {
    // Components/Sessions browse one project. A 2-project scope must be *shown*
    // to be unhonoured, never silently ignored.
    render(
      <ScopeBar
        scope={{
          projects: ['a', 'b'],
          project: null,
          isAll: false,
          isMulti: true,
          toggle: vi.fn(),
          remove: vi.fn(),
          set: vi.fn(),
          clear: vi.fn(),
        }}
        projects={projects}
        favorites={[]}
        onToggleFavorite={vi.fn()}
        note="Components browses one project — pick one below"
      />,
    );
    expect(screen.getByText(/Components browses one project/)).toBeTruthy();
  });
});

describe('ScopeBar — picking projects', () => {
  it('adds a project to the scope', () => {
    const seen: string[][] = [];
    render(<Harness onProjects={(p) => seen.push(p)} />);
    openPicker();
    fireEvent.click(screen.getByTitle('/code/atlas'));
    expect(seen.at(-1)).toEqual(['atlas']);
  });

  it('accumulates several projects rather than replacing the selection', () => {
    const seen: string[][] = [];
    render(<Harness initial={['deepcast']} onProjects={(p) => seen.push(p)} />);
    openPicker();
    fireEvent.click(screen.getByTitle('/code/atlas'));
    expect(seen.at(-1)).toEqual(['deepcast', 'atlas']);
  });

  it('clicking an already-selected project removes it', () => {
    const seen: string[][] = [];
    render(<Harness initial={['atlas']} onProjects={(p) => seen.push(p)} />);
    openPicker();
    fireEvent.click(screen.getByTitle('/code/atlas'));
    expect(seen.at(-1)).toEqual([]);
  });

  it('narrows the list to matching projects', () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'deep' },
    });
    expect(screen.getByTitle('/code/deepcast')).toBeTruthy();
    expect(screen.queryByTitle('/code/webapp')).toBeNull();
  });

  it('highlights the matched span inside the project name', () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'deep' },
    });
    expect(screen.getByTitle('/code/deepcast').querySelector('mark')?.textContent).toBe('deep');
  });

  it('says how many it hid rather than silently truncating', () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'deep' },
    });
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('says so when nothing matches', () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No project matches/)).toBeTruthy();
  });
});

describe('ScopeBar — favourites', () => {
  const rowOrder = () =>
    [...document.querySelectorAll('[title^="/code/"]')].map((el) => el.textContent);

  it('pins a favourited project above the rest', () => {
    render(<Harness />);
    openPicker();
    fireEvent.click(screen.getByLabelText('Favourite webapp'));

    expect(screen.getByText('★ Favourites')).toBeTruthy();
    // webapp sorts last but leads once starred.
    expect(rowOrder()[0]).toContain('webapp');
  });

  it('unfavouriting returns it to the main list', () => {
    render(<Harness />);
    openPicker();
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
    render(<Harness />);
    openPicker();
    fireEvent.click(screen.getByLabelText('Favourite webapp'));
    expect(screen.getByText('★ Favourites')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Filter projects…'), {
      target: { value: 'a' }, // matches all three
    });

    expect(screen.queryByText('★ Favourites')).toBeNull();
    expect(rowOrder()[0]).toContain('atlas');
    // ...but the favourite keeps its star, so it stays recognisable.
    expect(screen.getByLabelText('Unfavourite webapp')).toBeTruthy();
  });

  it('starring a project does not also select it', () => {
    const seen: string[][] = [];
    render(<Harness onProjects={(p) => seen.push(p)} />);
    openPicker();
    fireEvent.click(screen.getByLabelText('Favourite atlas'));
    expect(seen).toEqual([]); // the star is its own control
  });
});
