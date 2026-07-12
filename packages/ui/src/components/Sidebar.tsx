import { useMemo, useState } from 'react';
import type { ProjectRow, Stats } from '../types';
import { Eyebrow, FilterInput, Highlight, matches } from './ui';
import { compact, duration, exact, relativeTime } from '../format';
import { usePersistentState } from '../usePersistentState';

export type View = 'dashboard' | 'search' | 'timeline' | 'components' | 'sessions';

const VIEWS: { key: View; label: string; hotkey: string }[] = [
  { key: 'dashboard', label: 'Overview', hotkey: '1' },
  { key: 'search', label: 'Search & Ask', hotkey: '2' },
  { key: 'timeline', label: 'Timeline', hotkey: '3' },
  { key: 'components', label: 'Components', hotkey: '4' },
  { key: 'sessions', label: 'Sessions', hotkey: '5' },
];

/**
 * Shown only while the vector collection is being rebuilt (model switch or a
 * resumed backfill). Search still works, but against a partial collection —
 * say so, or an incomplete result set reads as "nothing found".
 */
function BackfillBar({ backfill }: { backfill: NonNullable<Stats['backfill']> }) {
  const pct = Math.min(100, Math.round((backfill.done / Math.max(1, backfill.total)) * 100));
  const left = duration(backfill.etaSec);
  return (
    <div className="pt-1.5" role="status">
      <div className="flex justify-between mb-1" style={{ color: 'var(--color-kdb)' }}>
        <span>re-embedding index</span>
        <span>{backfill.etaSec > 30 ? `~${left} left` : 'finishing'}</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-line)' }}>
        <div
          className="h-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: 'var(--color-kdb)' }}
        />
      </div>
      <div className="mt-1" title={`${exact(backfill.done)} of ${exact(backfill.total)}`}>
        {compact(backfill.done)}/{compact(backfill.total)} · results are incomplete until this
        finishes
      </div>
    </div>
  );
}

/** One project row. The star is a separate control so it never selects the project. */
function ProjectButton({
  p,
  active,
  needle,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  p: ProjectRow;
  active: boolean;
  needle: string;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      className={`group/p flex items-baseline gap-2 rounded-md text-[13px] ${
        active ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel'
      }`}
    >
      <button
        onClick={onSelect}
        className="flex-1 min-w-0 flex items-baseline gap-2 text-left px-2.5 py-1"
        title={p.rootPath}
      >
        <span
          className="size-1.5 rounded-full shrink-0 self-center"
          style={{ background: p.hasKdb ? 'var(--color-kdb)' : 'var(--color-line)' }}
        />
        <span className="truncate flex-1">
          <Highlight text={p.slug} needle={needle} />
        </span>
        {/* Compact so the column aligns and stops jittering; exact on hover. */}
        <span
          className="font-mono text-[10px] text-faint tabular-nums"
          title={`${exact(p.entryCount)} entries`}
        >
          {compact(p.entryCount)}
        </span>
      </button>
      <button
        onClick={onToggleFavorite}
        // A favourite stays visible; an unstarred one appears on hover, so 90
        // hollow stars don't compete with the project names for attention.
        className={`pr-2 text-[11px] leading-none transition-opacity ${
          favorite
            ? 'opacity-100'
            : 'opacity-0 group-hover/p:opacity-100 focus:opacity-100 text-faint hover:text-ink'
        }`}
        style={favorite ? { color: 'var(--color-kdb)' } : undefined}
        title={favorite ? 'Remove from favourites' : 'Add to favourites'}
        aria-label={favorite ? `Unfavourite ${p.slug}` : `Favourite ${p.slug}`}
        aria-pressed={favorite}
      >
        {favorite ? '★' : '☆'}
      </button>
    </div>
  );
}

export function Sidebar({
  projects,
  project,
  view,
  stats,
  onProject,
  onView,
  onReindex,
}: {
  projects: ProjectRow[];
  project: string;
  view: View;
  stats: Stats | null;
  onProject: (slug: string) => void;
  onView: (v: View) => void;
  onReindex: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [favorites, setFavorites] = usePersistentState<string[]>('atlas.projects.favorites', []);

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const toggleFavorite = (slug: string) =>
    setFavorites((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );

  const shown = useMemo(
    () => projects.filter((p) => matches(p.slug, filter)),
    [projects, filter],
  );

  /**
   * Favourites are pinned while browsing, but the grouping *flattens* while
   * filtering: a pinned group would push a better match below a worse-matching
   * favourite, which breaks the one promise a filter makes — that what you typed
   * is at the top. Filtered rows keep their star; they just aren't hoisted.
   */
  const filtering = filter.trim().length > 0;
  const favShown = filtering ? [] : shown.filter((p) => favSet.has(p.slug));
  const restShown = filtering ? shown : shown.filter((p) => !favSet.has(p.slug));

  const row = (p: ProjectRow) => (
    <ProjectButton
      key={p.slug}
      p={p}
      active={project === p.slug}
      needle={filter}
      favorite={favSet.has(p.slug)}
      onSelect={() => onProject(p.slug)}
      onToggleFavorite={() => toggleFavorite(p.slug)}
    />
  );

  return (
    <aside className="w-60 shrink-0 border-r border-line flex flex-col h-screen sticky top-0">
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <h1 className="font-display font-bold text-[17px] tracking-tight">
          Atlas
        </h1>
        <p className="font-mono text-[10px] text-faint mt-0.5">project memory, searchable</p>
      </div>

      <nav className="px-2 py-3 border-b border-line" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => onView(v.key)}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[13px] ${
              view === v.key ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel'
            }`}
          >
            <span>{v.label}</span>
            <kbd className="font-mono text-[10px] text-faint">{v.hotkey}</kbd>
          </button>
        ))}
      </nav>

      <div className="px-2 py-3 flex-1 overflow-y-auto min-h-0">
        <div className="px-2.5">
          <Eyebrow>Projects</Eyebrow>
        </div>

        <div className="px-1">
          <FilterInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter projects…"
            count={{ shown: shown.length, total: projects.length }}
          />
        </div>

        <button
          onClick={() => onProject('')}
          className={`w-full text-left px-2.5 py-1 rounded-md text-[13px] ${
            project === '' ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel'
          }`}
        >
          all projects
        </button>

        {favShown.length > 0 && (
          <>
            <div className="px-2.5 mt-3 mb-1">
              <span className="font-display uppercase tracking-[0.18em] text-[10px] text-faint">
                ★ Favourites
              </span>
            </div>
            {favShown.map(row)}
            <div className="mx-2.5 my-2 border-t border-line" />
          </>
        )}

        {restShown.map(row)}

        {shown.length === 0 && (
          <p className="px-2.5 py-3 text-[12px] text-faint">
            No project matches “{filter}”.
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-line font-mono text-[10px] text-faint space-y-1">
        {stats && (
          <>
            <div title={`${exact(stats.entries)} entries · ${exact(stats.chunks)} chunks`}>
              {compact(stats.entries)} entries · {compact(stats.chunks)} chunks
            </div>
            <div>
              embedder {stats.embedder} ·{' '}
              {stats.recentErrors > 0 ? (
                <span
                  style={{ color: 'var(--color-report)' }}
                  title={`${exact(stats.errors)} lifetime`}
                >
                  {compact(stats.recentErrors)} errors/hr
                </span>
              ) : (
                <span title={`${exact(stats.errors)} lifetime`}>no recent errors</span>
              )}
            </div>
            <div title={stats.lastRunAt ?? undefined}>
              indexed {relativeTime(stats.lastRunAt)}
              {stats.pending ? ` · ${compact(stats.pending)} queued` : ''}
            </div>
            {stats.backfill && <BackfillBar backfill={stats.backfill} />}
          </>
        )}
        <button
          onClick={onReindex}
          className="mt-1 w-full py-1 rounded border border-line text-muted hover:border-faint hover:text-ink"
        >
          Reindex now
        </button>
      </div>
    </aside>
  );
}
