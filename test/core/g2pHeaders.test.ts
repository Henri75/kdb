import { describe, expect, it } from 'vitest';
import {
  CLIENT_ID_HEADER,
  DEFAULT_G2P_CLIENT_ID,
  g2pClientHeaders,
} from '../../packages/core/src/g2pHeaders.js';

describe('g2pClientHeaders', () => {
  it('defaults to the shared client id when nothing is configured', () => {
    expect(g2pClientHeaders(undefined)).toEqual({ [CLIENT_ID_HEADER]: 'Atlas' });
  });

  /**
   * The value is echoed verbatim into G2P's dashboard, so casing is part of the
   * contract, not cosmetics: 'atlas' and 'Atlas' would show up as two separate
   * clients. Asserted literally rather than against the constant so that
   * changing the constant cannot silently redefine what "correct" means.
   */
  it('sends the client id with its exact casing preserved', () => {
    expect(DEFAULT_G2P_CLIENT_ID).toBe('Atlas');
    expect(g2pClientHeaders('Atlas')[CLIENT_ID_HEADER]).toBe('Atlas');
  });

  it('uses an operator override in place of the default', () => {
    expect(g2pClientHeaders('atlas-staging')).toEqual({ [CLIENT_ID_HEADER]: 'atlas-staging' });
  });

  it('omits the header entirely when explicitly set to empty', () => {
    expect(g2pClientHeaders('')).toEqual({});
  });

  it('treats a whitespace-only id as opting out rather than sending blanks', () => {
    expect(g2pClientHeaders('   ')).toEqual({});
  });

  /**
   * G2P strips control characters server-side; mirroring that here keeps what
   * we send byte-identical to what the dashboard records. A raw newline would
   * otherwise forge a second line in the proxy's request log.
   */
  it('strips control characters', () => {
    expect(g2pClientHeaders('at\nlas')[CLIENT_ID_HEADER]).toBe('atlas');
  });

  it('truncates to the 128-byte bound G2P enforces', () => {
    const value = g2pClientHeaders('a'.repeat(200))[CLIENT_ID_HEADER]!;
    expect(value).toHaveLength(128);
  });
});
