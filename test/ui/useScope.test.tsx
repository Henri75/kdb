// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { scopeParam, useScope } from '../../packages/ui/src/useScope';

beforeEach(() => localStorage.clear());

/**
 * One hook, two shapes — that is the whole point.
 *
 * Search, Ask and Timeline *filter* by project and take any number of them.
 * Components and Sessions *browse* one: a component named `ui` in two projects
 * is two different things, and merging them would be a lie. So `project` is
 * non-null only when the selection is unambiguous, and those views fall back to
 * their picker otherwise. Exposing both shapes from one source is what kept this
 * from becoming a 39-call-site refactor.
 */
describe('useScope', () => {
  it('starts unscoped, meaning all projects', () => {
    const { result } = renderHook(() => useScope());
    expect(result.current.projects).toEqual([]);
    expect(result.current.isAll).toBe(true);
    expect(result.current.project).toBeNull();
  });

  it('exposes the single project when exactly one is selected', () => {
    const { result } = renderHook(() => useScope());
    act(() => result.current.toggle('atlas'));

    expect(result.current.projects).toEqual(['atlas']);
    expect(result.current.project).toBe('atlas');
    expect(result.current.isAll).toBe(false);
    expect(result.current.isMulti).toBe(false);
  });

  /**
   * The tempting shortcut is `projects[0] ?? null` — "just use the first one".
   * That would let Components show deepcast's components while the scope bar
   * says "deepcast + atlas": the view would be lying about what it shows.
   */
  it('reports NO single project once two are selected', () => {
    const { result } = renderHook(() => useScope());
    act(() => result.current.toggle('deepcast'));
    act(() => result.current.toggle('atlas'));

    expect(result.current.projects).toEqual(['deepcast', 'atlas']);
    expect(result.current.project).toBeNull();
    expect(result.current.isMulti).toBe(true);
  });

  /**
   * An unscoped search also spans projects, so its rows need the project tag
   * just as much as an explicit multi-selection does. `isMulti` is therefore
   * "not exactly one", not "more than one".
   */
  it('treats an empty scope as multi, because results can still span projects', () => {
    const { result } = renderHook(() => useScope());
    expect(result.current.isMulti).toBe(true);
  });

  it('toggling an already-selected project removes it', () => {
    const { result } = renderHook(() => useScope());
    act(() => result.current.toggle('atlas'));
    act(() => result.current.toggle('atlas'));
    expect(result.current.projects).toEqual([]);
  });

  it('removes one project without disturbing the others', () => {
    const { result } = renderHook(() => useScope());
    act(() => result.current.set(['a', 'b', 'c']));
    act(() => result.current.remove('b'));
    expect(result.current.projects).toEqual(['a', 'c']);
  });

  it('clears back to all projects', () => {
    const { result } = renderHook(() => useScope());
    act(() => result.current.set(['a', 'b']));
    act(() => result.current.clear());
    expect(result.current.isAll).toBe(true);
  });

  it('survives a reload', () => {
    const first = renderHook(() => useScope());
    act(() => first.result.current.set(['deepcast', 'atlas']));
    first.unmount();

    const second = renderHook(() => useScope());
    expect(second.result.current.projects).toEqual(['deepcast', 'atlas']);
  });
});

describe('scopeParam', () => {
  it('joins the selection for the wire', () => {
    expect(scopeParam(['a', 'b'])).toBe('a,b');
  });

  /**
   * Undefined, not an empty string: the API must apply *no* project constraint,
   * and `project=` would be a filter for a project named "".
   */
  it('is undefined when the scope is all projects', () => {
    expect(scopeParam([])).toBeUndefined();
  });
});
