import { describe, expect, it } from 'vitest';
import { selectedProjects } from '@atlas/core';

/**
 * One rule, shared by both search paths (Qdrant and the Postgres FTS fallback).
 * They degrade into one another at runtime, so a filter that resolved
 * differently depending on which backend answered would be a vicious bug — hence
 * a single helper rather than the same precedence written twice.
 */
describe('selectedProjects', () => {
  it('returns the plural list when given', () => {
    expect(selectedProjects({ projects: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('falls back to the singular for back-compat (CLI, MCP)', () => {
    expect(selectedProjects({ project: 'a' })).toEqual(['a']);
  });

  it('lets the plural win over the singular', () => {
    expect(selectedProjects({ project: 'ignored', projects: ['a'] })).toEqual(['a']);
  });

  it('treats an empty plural as absent, not as "no projects"', () => {
    // `projects: []` must mean "unconstrained", never "match nothing" — the
    // latter would make an empty scope silently return zero results.
    expect(selectedProjects({ projects: [], project: 'a' })).toEqual(['a']);
    expect(selectedProjects({ projects: [] })).toEqual([]);
  });

  it('returns nothing when no project filter is set at all', () => {
    expect(selectedProjects({})).toEqual([]);
  });
});
