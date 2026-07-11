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

/** `[3]` or `[3, 7]` → superscript citation spans. Runs on sanitized HTML. */
function citationize(html: string): string {
  return html.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, nums: string) => {
    const spans = nums
      .split(',')
      .map((n) => n.trim())
      .map((n) => `<sup class="kdb-cite">[${n}]</sup>`)
      .join('');
    return spans;
  });
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    // marked.parse is sync for string input with no async extensions.
    const raw = marked.parse(text, { async: false }) as string;
    const clean = DOMPurify.sanitize(raw, {
      // No event handlers, no <script>/<style>, no data:/javascript: URLs.
      USE_PROFILES: { html: true },
    });
    return citationize(clean);
  }, [text]);

  return <div className="kdb-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
