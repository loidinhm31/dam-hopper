# Browser Cross-Site Native Media Research

## Constraints

- Native `<video>`/`<img>` cannot set `Authorization`.
- Missing `crossorigin` uses native no-CORS fetching with credentials policy; `crossorigin="use-credentials"` requests credentialed CORS but cookie policy still applies.
- `SameSite=None; Secure` permits cross-site cookie eligibility, not guaranteed delivery when third-party cookies are blocked.
- `Partitioned` (CHIPS) binds cookie to top-level site. This blocks a copied stream URL when opened under another top-level site/browser while preserving native media requests in the issuer site.
- Credentialed CORS requires exact allowed origin, `Access-Control-Allow-Credentials: true`, and `Vary: Origin`; never `*`/arbitrary reflection.
- CORS does not block curl and `Origin`/`Referer` are not authentication.

Sources:

- WHATWG CORS settings: https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attributes
- Fetch credentials/CORS: https://fetch.spec.whatwg.org/#concept-request-credentials-mode
- MDN Set-Cookie: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
- MDN third-party cookies: https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies
- MDN credentialed CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#credentialed_requests_and_wildcards
- OWASP CSRF: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- RFC 9110 Range: https://datatracker.ietf.org/doc/html/rfc9110#name-range-requests

## Options

| Option | Result |
|---|---|
| Bearer capability URL | Most compatible; fails replay-prevention requirement. |
| Auth/session cookie | Minimal native streaming change; unpartitioned third-party cookies may be blocked. |
| Partitioned media cookie | Selected for supported cross-site clients; link fails outside top-level partition. |
| Fetch to Blob | Bad for large videos; buffers file and loses native seeking efficiency. |
| Service Worker proxy | Can inject bearer and preserve streamed ranges; much more lifecycle/Tauri complexity. |
| MSE/manual ranges | Codec/buffering complexity; YAGNI. |
| Signed URL | Still transferable; does not meet session binding. |

## Selected approach

- Authenticated issue fetch sets/refreshes a random partitioned HttpOnly media-session cookie.
- Ticket is server-side bound to cookie/session; stream requires both URL ticket and cookie.
- Keep URL free of JWT/session proof. Cookie is not JavaScript-readable.
- Keep native player/image and direct download; verify anchor navigation sends partitioned cookie in target engines.
- Explicitly gate Chromium/Edge and supported Tauri WebView2 first. Other engines must pass real tests before support claim.
- No fallback to capability-only stream. If cookie unavailable, show actionable unsupported/privacy-setting error after issue/probe flow.

## Security rules

- Stream GET/HEAD remains read-only; cookie + ticket both required.
- Issue/revoke/logout use bearer auth and exact configured Origin. JSON/custom header plus Fetch Metadata can supplement CSRF defense.
- Missing/wrong cookie returns non-disclosing `404`; never authorize from Origin/Referer.
- `Cache-Control: private, no-store`; redact ticket path from logs and diagnostics.
- Cookie must be `Secure` remotely; HTTPS is deployment prerequisite.

## Browser validation

- Two top-level origins and two isolated contexts.
- Issue under allowed origin; GET/HEAD and repeated single Range/If-Range succeed.
- Paste URL top-level, foreign origin/context, and curl: fail.
- Image decode and video seek remain native; direct download succeeds only in owning partition.
- Block third-party cookies; verify partitioned cookie still works in supported Chromium.
- Test profile switch, logout, expiry, cookie clearing, server restart.
- Qualify packaged Tauri per WebView engine; no documentation claim before evidence.

## Unresolved questions

1. Minimum Chromium/Edge/WebView2 versions?
2. Is Safari/Firefox mandatory for first release?
3. If anchor download omits partitioned cookie in any target, accept authenticated fetch-stream fallback or disable download there?
