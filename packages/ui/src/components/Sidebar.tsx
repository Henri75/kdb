import type { ProjectRow, Stats } from '../types';
import { Eyebrow } from './ui';
import { compact, duration, exact, relativeTime } from '../format';

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
  return (
    <aside className="w-60 shrink-0 border-r border-line flex flex-col h-screen sticky top-0">
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <h1 className="font-display font-bold text-[17px] tracking-tight">
          KDB<span style={{ color: 'var(--color-kdb)' }}>Scope</span>
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

      <div className="px-2 py-3 flex-1 overflow-y-auto">
        <div className="px-2.5">
          <Eyebrow>Projects</Eyebrow>
        </div>
        <button
          onClick={() => onProject('')}
          className={`w-full text-left px-2.5 py-1 rounded-md text-[13px] ${
            project === '' ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel'
          }`}
        >
          all projects
        </button>
        {projects.map((p) => (
          <button
            key={p.slug}
            onClick={() => onProject(p.slug)}
            className={`w-full flex items-baseline gap-2 text-left px-2.5 py-1 rounded-md text-[13px] ${
              project === p.slug ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel'
            }`}
            title={p.rootPath}
          >
            <span
              className="size-1.5 rounded-full shrink-0 self-center"
              style={{ background: p.hasKdb ? 'var(--color-kdb)' : 'var(--color-line)' }}
            />
            <span className="truncate flex-1">{p.slug}</span>
            {/* Compact so the column aligns and stops jittering; exact on hover. */}
            <span
              className="font-mono text-[10px] text-faint tabular-nums"
              title={`${exact(p.entryCount)} entries`}
            >
              {compact(p.entryCount)}
            </span>
          </button>
        ))}
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
