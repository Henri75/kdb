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
