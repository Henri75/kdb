// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from '../../packages/ui/src/components/Markdown';

afterEach(cleanup);

/**
 * The Ask answer is model output synthesized from arbitrary indexed content
 * (session transcripts included), so it is untrusted. These pin the pipeline:
 * markdown renders, citations become superscripts, and injected markup is
 * stripped before it can reach the DOM.
 */
describe('Markdown', () => {
  it('renders markdown structure as HTML', () => {
    const { container } = render(<Markdown text={'## Heading\n\n- one\n- two\n\n**bold**'} />);
    expect(container.querySelector('h2')?.textContent).toBe('Heading');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('turns [n] and [n, m] citations into superscripts', () => {
    const { container } = render(<Markdown text={'grounded [1] and combined [2, 3]'} />);
    const sups = container.querySelectorAll('sup.kdb-cite');
    // [1], [2], [3] — the comma list expands to one sup each.
    expect(sups).toHaveLength(3);
    expect([...sups].map((s) => s.textContent)).toEqual(['[1]', '[2]', '[3]']);
  });

  it('strips a script tag from untrusted answer text', () => {
    const { container } = render(
      <Markdown text={'safe text<script>window.__xss = 1</script> after'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('__xss');
  });

  it('strips an inline event handler from injected markup', () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} />);
    const img = container.querySelector('img');
    // The tag may survive; the handler must not.
    expect(img?.getAttribute('onerror')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
  });

  it('renders a fenced code block', () => {
    const { container } = render(<Markdown text={'```\nnexus-ctl drain podcast\n```'} />);
    expect(container.querySelector('pre code')?.textContent).toContain('nexus-ctl drain');
  });
});

/**
 * Citations are interactive, and that interactivity must not become an injection
 * vector: the transform still runs on already-sanitized HTML, and the only thing
 * interpolated into it is a run of digits.
 */
describe('Markdown — citation links', () => {
  const known = new Set([1, 2]);

  it('links a citation that has a matching source', () => {
    const { container } = render(<Markdown text="grounded [1]" citations={known} />);
    const cite = container.querySelector('sup.kdb-cite-link');
    expect(cite?.getAttribute('data-cite')).toBe('1');
    expect(cite?.getAttribute('role')).toBe('button');
  });

  it('leaves a citation with no source inert', () => {
    // Models invent citations. A [9] with two sources must not become a control
    // that navigates nowhere.
    const { container } = render(<Markdown text="invented [9]" citations={known} />);
    expect(container.querySelector('sup.kdb-cite-link')).toBeNull();
    expect(container.querySelector('sup.kdb-cite')?.textContent).toBe('[9]');
  });

  it('reports the citation number when one is activated', async () => {
    const seen: number[] = [];
    const { container } = render(
      <Markdown text="see [2]" citations={known} onCite={(n) => seen.push(n)} />,
    );
    (container.querySelector('sup.kdb-cite-link') as HTMLElement).click();
    expect(seen).toEqual([2]);
  });

  it('never emits an inline event handler', () => {
    // The click path is a delegated React listener reading data-cite. An inline
    // onclick would be both stripped by DOMPurify and an injection vector.
    const { container } = render(<Markdown text="a [1] b" citations={known} />);
    expect(container.innerHTML).not.toContain('onclick');
  });

  it('does not let injected markup ride in on a citation', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror="alert(1)"> [1]'} citations={known} />,
    );
    expect(container.innerHTML).not.toContain('onerror');
    // The legitimate citation still linkifies.
    expect(container.querySelector('sup.kdb-cite-link')).toBeTruthy();
  });

  it('renders citations without links when no source list is supplied', () => {
    // Backwards compatible: the amber superscript still renders.
    const { container } = render(<Markdown text="plain [1]" />);
    expect(container.querySelector('sup.kdb-cite')).toBeTruthy();
    expect(container.querySelector('sup.kdb-cite-link')).toBeNull();
  });
});

/**
 * Found in a real browser, invisible to a single-snapshot test: passing a fresh
 * `new Set()` each render gave the memo a new dependency identity every time, so
 * the answer was re-parsed and its DOM replaced continuously — the citation
 * elements were destroyed and rebuilt faster than they could be clicked.
 * The memo must key on the set's *contents*, not its identity.
 */
describe('Markdown — render stability', () => {
  it('reuses the parsed HTML when an equal-but-new citation Set is passed', () => {
    const { container, rerender } = render(
      <Markdown text="cited [1]" citations={new Set([1])} />,
    );
    const first = container.querySelector('sup.kdb-cite-link');

    // Exactly what a parent does when it builds the set inline in render.
    rerender(<Markdown text="cited [1]" citations={new Set([1])} />);
    const second = container.querySelector('sup.kdb-cite-link');

    // Same node object: the subtree was not rebuilt.
    expect(second).toBe(first);
  });

  it('re-renders when the citation set genuinely changes', () => {
    const { container, rerender } = render(<Markdown text="a [1] b [2]" citations={new Set([1])} />);
    expect(container.querySelectorAll('sup.kdb-cite-link')).toHaveLength(1);

    rerender(<Markdown text="a [1] b [2]" citations={new Set([1, 2])} />);
    expect(container.querySelectorAll('sup.kdb-cite-link')).toHaveLength(2);
  });
});
