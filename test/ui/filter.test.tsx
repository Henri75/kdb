// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton, FilterInput, Highlight, MultiSelect, matches } from '../../packages/ui/src/components/ui';

afterEach(cleanup);

describe('matches', () => {
  it('is case-insensitive and matches substrings', () => {
    expect(matches('PgBouncer crash-loop', 'bouncer')).toBe(true);
    expect(matches('PgBouncer', 'qdrant')).toBe(false);
  });

  it('an empty needle matches everything, including undefined text', () => {
    expect(matches(undefined, '')).toBe(true);
    expect(matches(undefined, 'x')).toBe(false);
  });
});

describe('Highlight', () => {
  it('marks every occurrence', () => {
    const { container } = render(<Highlight text="fix the fix" needle="fix" />);
    expect(container.querySelectorAll('mark')).toHaveLength(2);
  });

  it('preserves the original casing of the matched text', () => {
    render(<Highlight text="PgBouncer" needle="pgbouncer" />);
    expect(screen.getByText('PgBouncer').tagName).toBe('MARK');
  });

  /** A needle is user text, never a pattern. */
  it('treats regex metacharacters literally', () => {
    const { container } = render(<Highlight text="a.b and axb" needle="a.b" />);
    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.querySelector('mark')!.textContent).toBe('a.b');
  });

  it('renders plain text when there is no needle', () => {
    const { container } = render(<Highlight text="untouched" needle="" />);
    expect(container.querySelector('mark')).toBeNull();
  });
});

describe('FilterInput', () => {
  it('reports how much a filter hid', () => {
    render(<FilterInput value="x" onChange={() => {}} placeholder="Filter…" count={{ shown: 3, total: 40 }} />);
    expect(screen.getByText('3 of 40')).toBeTruthy();
  });

  it('shows just the total when nothing is filtered out', () => {
    render(<FilterInput value="" onChange={() => {}} placeholder="Filter…" count={{ shown: 40, total: 40 }} />);
    expect(screen.getByText('40')).toBeTruthy();
  });

  it('clears the filter', () => {
    const onChange = vi.fn();
    render(<FilterInput value="x" onChange={onChange} placeholder="Filter…" />);
    fireEvent.click(screen.getByText('clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('MultiSelect', () => {
  const OPTS = ['doc', 'git_commit', 'claude_session'] as const;

  it('summarizes the selection on the trigger: all / one / count', () => {
    const { rerender } = render(
      <MultiSelect options={OPTS} selected={[]} onChange={() => {}} allLabel="all sources" label="Source" />,
    );
    expect(screen.getByLabelText('Source').textContent).toContain('all sources');

    rerender(
      <MultiSelect options={OPTS} selected={['doc']} onChange={() => {}} allLabel="all sources" label="Source" />,
    );
    expect(screen.getByLabelText('Source').textContent).toContain('doc');

    rerender(
      <MultiSelect options={OPTS} selected={['doc', 'git_commit']} onChange={() => {}} allLabel="all sources" label="Source" />,
    );
    expect(screen.getByLabelText('Source').textContent).toContain('2 selected');
  });

  it('toggles an option into the selection', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={OPTS} selected={['doc']} onChange={onChange} allLabel="all sources" label="Source" />);
    fireEvent.click(screen.getByLabelText('Source')); // open
    // Rows render as "☐ git_commit"; match on substring.
    fireEvent.click(screen.getByText((t) => t.includes('git_commit')));
    expect(onChange).toHaveBeenCalledWith(['doc', 'git_commit']);
  });

  it('the all row resets to an empty selection', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={OPTS} selected={['doc']} onChange={onChange} allLabel="all sources" label="Source" />);
    fireEvent.click(screen.getByLabelText('Source'));
    // The popover's "all sources" row is "● all sources" / "○ all sources";
    // the bare "all sources" (the trigger) is separate.
    const allRow = screen.getByText((t) => /[●○]\s*all sources/.test(t));
    fireEvent.click(allRow);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('CopyButton', () => {
  it('writes the given text to the clipboard on click', () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyButton text="paste me" />);
    fireEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('paste me');
    vi.unstubAllGlobals();
  });
});
