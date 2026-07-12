// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModeSwitch, ProjectTag } from '../../packages/ui/src/components/ui';

afterEach(cleanup);

/**
 * Search and Ask are not two actions on one box — they are two *modes* of one
 * instrument, producing different surfaces: a list of records you browse, or a
 * synthesized answer that opens a conversation.
 *
 * As twin submit buttons they read as peers and hid the second one behind a
 * modifier key (⌘Enter) the user had to already know about.
 */
describe('ModeSwitch', () => {
  const options = [
    { value: 'search', label: 'Search', icon: '⌕' },
    { value: 'ask', label: 'Ask', icon: '✦', accent: true },
  ];

  it('announces itself as a set of alternatives, not a pair of actions', () => {
    render(<ModeSwitch value="search" options={options} onChange={vi.fn()} label="Search or ask" />);
    // tablist/tab, so a screen reader hears "one of these", not "two buttons".
    expect(screen.getByRole('tablist', { name: 'Search or ask' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('marks exactly one mode as armed', () => {
    render(<ModeSwitch value="ask" options={options} onChange={vi.fn()} label="Mode" />);
    expect(screen.getByRole('tab', { name: /Ask/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Search/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('reports the mode the user picked', () => {
    const onChange = vi.fn();
    render(<ModeSwitch value="search" options={options} onChange={onChange} label="Mode" />);
    fireEvent.click(screen.getByRole('tab', { name: /Ask/ }));
    expect(onChange).toHaveBeenCalledWith('ask');
  });
});

describe('ProjectTag', () => {
  it('names the project a record came from', () => {
    render(<ProjectTag slug="deepcast" />);
    expect(screen.getByText('deepcast')).toBeTruthy();
  });
});
