import { useCallback, useMemo } from 'react';
import { usePersistentState } from './usePersistentState';

/**
 * The selected projects — the app's one answer to "what am I looking at?".
 *
 * Project usage in Atlas has two shapes, and this hook serves both without
 * forcing either to change:
 *
 *  - **A filter.** Search, Ask and Timeline narrow their results to *any of*
 *    the selected projects. They read `projects`.
 *  - **A resource.** Components and Sessions *browse* one project — a component
 *    named `ui` in two projects is two different things, and merging them would
 *    be a lie. They read `project`, which is non-null only when exactly one is
 *    selected, and otherwise show their existing "pick a project" state.
 *
 * Exposing both shapes from one source is what keeps this from becoming a
 * 39-call-site refactor: the per-project views keep their `string` contract
 * untouched, and only the multi-capable views learn the new one.
 */
export interface Scope {
  /** Every selected project. Empty means *all projects*, not *none*. */
  projects: string[];
  /** The single selected project, or null at 0 or 2+. */
  project: string | null;
  /** True when nothing is selected — i.e. the scope spans everything. */
  isAll: boolean;
  /** True when results can span projects, so rows need a project tag. */
  isMulti: boolean;
  toggle: (slug: string) => void;
  remove: (slug: string) => void;
  /** Replace the whole selection (used by "browse this one" affordances). */
  set: (slugs: string[]) => void;
  clear: () => void;
}

export function useScope(): Scope {
  const [projects, setProjects] = usePersistentState<string[]>('atlas.scope.projects', []);

  const toggle = useCallback(
    (slug: string) =>
      setProjects((prev) =>
        prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
      ),
    [setProjects],
  );

  const remove = useCallback(
    (slug: string) => setProjects((prev) => prev.filter((s) => s !== slug)),
    [setProjects],
  );

  const clear = useCallback(() => setProjects([]), [setProjects]);

  return useMemo(
    () => ({
      projects,
      // Exactly one, or nothing. Two selected projects do not "mean" the first.
      project: projects.length === 1 ? projects[0]! : null,
      isAll: projects.length === 0,
      // An unscoped search also spans projects, so it needs the tag just as much
      // as an explicit multi-selection does.
      isMulti: projects.length !== 1,
      toggle,
      remove,
      set: setProjects,
      clear,
    }),
    [projects, toggle, remove, setProjects, clear],
  );
}

/** The wire format for the project filter: a list, or undefined for "all". */
export function scopeParam(projects: string[]): string | undefined {
  return projects.length ? projects.join(',') : undefined;
}
