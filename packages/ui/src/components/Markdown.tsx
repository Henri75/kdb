import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Render an LLM answer (markdown) as sanitized HTML.
 *
 * The answer is model output synthesized from arbitrary indexed content
 * (session transcripts included), so it is untrusted: prompt-injected markup
 * must never reach the DOM. The pipeline is therefore parse → sanitize →
 * inject, never raw HTML. After sanitizing we turn `[n]` citation markers into
 * amber superscripts to match the rest of the UI — done as a string transform
 * on already-sanitized HTML so it cannot reintroduce markup.
 */

// GFM on (tables, strikethrough); no raw HTML passthrough — everything renders
// from markdown, and DOMPurify is the backstop for anything that slips.
marked.setOptions({ gfm: true, breaks: true });

/**
 * `[3]` or `[3, 7]` → superscript citation spans. Runs on sanitized HTML.
 *
 * Security: the only thing interpolated is `n`, and it is matched by `\d+` — a
 * run of digits cannot carry markup. `known` gates which numbers become
 * *buttons*: a citation the model invented (`[99]` with 8 sources) stays inert
 * text rather than a control that navigates nowhere.
 */
function citationize(html: string, known: ReadonlySet<number>): string {
  return html.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (whole, nums: string) => {
    // Inside a fenced code block a `[1]` is array syntax, not a citation. The
    // check is crude but the failure mode is benign: an un-linked marker.
    return nums
      .split(',')
      .map((n) => n.trim())
      .map((n) => {
        const num = Number(n);
        if (!known.has(num)) return `<sup class="kdb-cite">[${n}]</sup>`;
        // data-cite is read by a delegated click handler on the container; no
        // inline handler, so this survives DOMPurify's rules by construction.
        return (
          `<sup class="kdb-cite kdb-cite-link" data-cite="${num}" ` +
          `role="button" tabindex="0" aria-label="Jump to source ${num}">[${n}]</sup>`
        );
      })
      .join('');
  }) as string & typeof whole;
}

export function Markdown({
  text,
  /** Citation numbers that map to a real source. Others render as inert text. */
  citations,
  /** Called with the citation number when a marker is activated. */
  onCite,
  /** Hover/focus a marker: the source's number, or null on leave. */
  onCitePeek,
}: {
  text: string;
  citations?: ReadonlySet<number>;
  onCite?: (n: number) => void;
  onCitePeek?: (n: number | null, at?: { x: number; y: number }) => void;
}) {
  /**
   * Memoise on a stable *primitive*, not on the Set's identity.
   *
   * Callers naturally build this set inline (`new Set(sources.map(s => s.n))`),
   * which yields a fresh object every render. Depending on that identity meant
   * the memo never hit: every render re-parsed the markdown and replaced the
   * whole subtree, so the citation elements were continuously destroyed and
   * recreated — they could not even be clicked reliably. Keying on the sorted
   * numbers makes the cache depend on the set's *contents*.
   */
  const citeKey = citations ? [...citations].sort((a, b) => a - b).join(',') : '';

  /**
   * Memoise the `{__html}` *object*, not just the string inside it.
   *
   * React compares props by identity, so a fresh `{__html: html}` literal each
   * render counts as a change and re-sets `innerHTML` — destroying and rebuilding
   * every child node even when the markup is byte-identical. Since the citation
   * markers live in that subtree, they were being recreated under the user's
   * cursor. Holding the object stable keeps the DOM untouched between renders.
   */
  const markup = useMemo(() => {
    // marked.parse is sync for string input with no async extensions.
    const raw = marked.parse(text, { async: false }) as string;
    const clean = DOMPurify.sanitize(raw, {
      // No event handlers, no <script>/<style>, no data:/javascript: URLs.
      USE_PROFILES: { html: true },
    });
    const known = new Set(citeKey ? citeKey.split(',').map(Number) : []);
    return { __html: citationize(clean, known) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, citeKey]);

  /**
   * One delegated listener rather than a handler per marker: the HTML is
   * injected as a string, so there is nothing to attach React props to. It also
   * means no inline `onclick` — which DOMPurify would strip anyway, and which
   * would be an injection vector if it didn't.
   */
  const citeAt = (e: { target: EventTarget | null }): number | null => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-cite]');
    const n = Number(el?.getAttribute('data-cite'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return (
    <div
      className="kdb-md"
      onClick={(e) => {
        const n = citeAt(e);
        if (n !== null) onCite?.(n);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const n = citeAt(e);
        if (n === null) return;
        e.preventDefault(); // Space would scroll the page.
        onCite?.(n);
      }}
      onMouseOver={(e) => {
        const n = citeAt(e);
        if (n !== null) {
          const r = (e.target as HTMLElement).getBoundingClientRect();
          onCitePeek?.(n, { x: r.left + r.width / 2, y: r.top });
        }
      }}
      onMouseOut={(e) => {
        if (citeAt(e) !== null) onCitePeek?.(null);
      }}
      onFocus={(e) => {
        const n = citeAt(e);
        if (n !== null) {
          const r = (e.target as HTMLElement).getBoundingClientRect();
          onCitePeek?.(n, { x: r.left + r.width / 2, y: r.top });
        }
      }}
      onBlur={(e) => {
        if (citeAt(e) !== null) onCitePeek?.(null);
      }}
      dangerouslySetInnerHTML={markup}
    />
  );
}
