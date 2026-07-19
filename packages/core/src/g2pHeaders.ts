/**
 * Outbound identity for every LLM/embedding call we make.
 *
 * G2P attributes each request to a caller via `X-G2P-Client-Id` and rolls that
 * up in its stats dashboard (unique clients, per-client volume/cost). Without
 * it KDB's traffic lands in the anonymous bucket alongside every other tool
 * pointed at the same proxy, which is what made per-consumer accounting
 * impossible to read.
 *
 * The header is purely additive: G2P reads it in `IdentityMiddleware` *after*
 * auth resolution, sanitises control characters and truncates to 128 bytes
 * rather than rejecting. A non-G2P OpenAI-compatible endpoint ignores an
 * unknown header. So sending it is safe everywhere, and there is no provider
 * check here on purpose.
 */

/** Matches G2P's own `maxClientIDLen`; we truncate so it doesn't have to. */
const MAX_CLIENT_ID_LEN = 128;

/** Used when nothing is configured, so stats work out of the box. */
export const DEFAULT_G2P_CLIENT_ID = 'Atlas';

/** Header name as G2P declares it (`pkg/api/request_constraints.go`). */
export const CLIENT_ID_HEADER = 'X-G2P-Client-Id';

/**
 * Build the client-id header, or `{}` when identification is switched off.
 *
 * An explicitly empty `clientId` suppresses the header — the escape hatch for
 * anyone who wants their traffic anonymous. `undefined` means "not configured"
 * and falls back to the default, which is the common case. This distinction is
 * why `config.ts` reads `KDB_G2P_CLIENT_ID` raw instead of through `opt()`,
 * which would collapse '' to undefined and silently re-apply the default.
 */
export function g2pClientHeaders(clientId: string | undefined): Record<string, string> {
  const raw = clientId ?? DEFAULT_G2P_CLIENT_ID;
  const value = sanitizeClientId(raw);
  return value ? { [CLIENT_ID_HEADER]: value } : {};
}

/**
 * Mirror G2P's server-side sanitising: strip control characters (they corrupt
 * log lines and the dashboard dropdown) and bound the length. Doing it here
 * too means what we send is exactly what G2P records, so a client id read off
 * the dashboard can be matched back to this config without guesswork.
 */
function sanitizeClientId(s: string): string {
  const stripped = Array.from(s.trim())
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  return stripped.slice(0, MAX_CLIENT_ID_LEN);
}
