# Self-service Edge implementation report

## Implemented

- `team-access` requires the exact configured `KISTI_APP_ORIGIN` for `POST` and `OPTIONS`; missing or invalid configuration denies requests. Its only data method is `POST` and its CORS allowlist covers the Supabase SDK headers.
- The handler accepts only the documented action, seat, name, password, and registration invitation fields. It normalizes display names with NFC and trim, enforces 2–40 name characters and 8–128 password characters, and returns generic error bodies without logging request data.
- Registration hashes the private invitation with SHA-256 and verifies its active project, seat, claim status, and expiration before consuming a rate-limit attempt. It creates one Auth user with a random `review-<uuid>@kisti-review.invalid` alias and confirmed email, then invokes `claim_review_access`. A lost RPC acknowledgement is resolved by re-reading the invite. It deletes the newly created Auth user only when the fresh row has a non-null, different owner. A null owner, missing row, or failed re-read leaves the user untouched and returns 503 because the claim may still commit.
- Login uses the chosen active-project seat, compares the normalized name without case, consumes the seat's login limit, and signs in with the internal alias. Registration signs in only after the claim succeeds. Both success paths return just access and refresh tokens.
- The Edge entry point uses a service-role client for private tables, RPCs, and Auth administration, and a separate anon-key client for password sign-in. Both disable session persistence and refresh. `supabase/config.toml` sets `verify_jwt = false` for this function so its own invitation and password checks can run.

## Verification

- `pnpm exec vitest run tests/selfServiceEdge.test.ts`: 17 passed. Cases cover origin and method denial, strict fields, unknown/used/expired invitations before rate limiting, alias and token flow, lost RPC acknowledgement, safe handling of pending, missing, and unreadable claim status, confirmed competing claims and cleanup, normalized login, generic credential errors, and 429. The pending-claim and missing-row cases failed before the recovery fix and pass after it.
- Focused `tsc --noEmit` for `handler.ts` and `selfServiceEdge.test.ts`: passed.
- The Deno entry point passed a focused strict TypeScript check against the installed Supabase SDK types and a temporary in-memory Deno API shim. The real Deno runtime was unavailable locally.
- Full project `tsc --noEmit -p tsconfig.json`: passed after the frontend component was added. The Deno entry point is outside the root TypeScript project and was checked separately as noted above.

Cloud Auth, database RPC, CORS deployment, and live RLS behavior still require verification after provisioning.
