# Deployment security

The public GitHub Pages site contains only the Worker endpoint URL and public profile information. Production OpenRouter/Resend credentials, the upstream base URL, and the visitor hashing secret live in Cloudflare Worker Secret bindings. The Jekyll build does not receive these values. Local development credentials, when used, stay in an external user configuration directory, outside this repository.

## Enforced boundaries

- Exact production origin allowlist; JSON-only agent requests; bounded request bodies; generic provider error messages. API responses disable caching and content sniffing. Both health checks and agent requests pass rate limits before accessing storage.
- Durable Object transactions enforce 20 admitted questions per visitor/IP per UTC day and 1,000 questions across the entire site per UTC day. The site cap survives restarts and applies across edge locations. Health checks and action continuations do not count as new questions.
- Per-location rate-limit bindings provide additional burst protection (60 requests/minute per IP, 180/minute for this service at a location). These approximate rate limits are not the global daily cap.
- Authenticated encrypted continuation tokens bind to the browser identifier and origin, expire, and have replay protection, including across midnight. A browser cannot substitute a source result or email payload for a server-side operation.
- External reads use server-owned source catalogs, public URL/address checks, validated redirect targets, and response/time limits. Search uses the server's OpenRouter plugin, with up to ten search attempts per question (including retries) and five results per search. Search output is evidence, never permission to send email or change scope.
- Email has a fixed secret-configured recipient/sender, verbatim visitor text checks, a separate two-per-day visitor/IP limit, and persistent idempotency. Ordinary research tool lists never include email delivery.
- Model generation retries transient network/HTTP failures and malformed actions at most twice with backoff (three attempts total per generation). Retries happen inside the admitted action, without replaying quota reservations, source reads or email delivery. Auth/payment failures, site/visitor limits and security rejections are not retried. Search retries share the ten-attempt search budget. Retries can incur additional provider token/parser charges; the daily question cap is not a monetary cap. Citation repair remains limited to one rewrite.
- Backend source, environment files, local databases, and deployment caches are excluded from the generated site. Git excludes runtime credentials, databases, and private key files. Version preview URLs are disabled.

## Before publishing

Run `node --test _agent/*.test.mjs`, build Jekyll, then run `node _agent/scan-secrets.mjs --history --site`. The scanner reports paths/rules only. If an external development env file is loaded, it also checks for those exact configured values. CI repeats the generic source/history scan and tests with read-only GitHub permissions and no production secrets. CI scans do not replace the local pre-push scan: a push has already uploaded its contents before CI runs.

## Limits of the protection

This is an anonymous public API. CORS is browser isolation, not authentication: scripts can forge Origin headers. IP/browser quotas cannot uniquely identify a person and shared networks can share a quota. Distributed abuse can still exhaust the site's 1,000-question allowance. The global count limits admitted questions, not dollars; keep a provider spending limit as the final monetary ceiling. Turnstile or authenticated access would be additional defenses if anonymous abuse becomes a problem.

Prompt scope checks are model judgments, not an absolute security boundary. The model never receives API keys, cannot choose the email recipient, and cannot run arbitrary code. The Worker checks public DNS before URL fetches, but this is not socket-level DNS pinning; its fetch runs in Cloudflare's network rather than the owner's machine. No audit can guarantee zero vulnerabilities. Rotate a credential at its provider if it is ever exposed, then update its Worker Secret; deleting it from source alone does not revoke it.
