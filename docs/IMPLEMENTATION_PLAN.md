# KISTI Policy Review implementation plan

The user's detailed request is the approved specification. Build a new React + TypeScript + Vite application for GitHub Pages, using Supabase Auth/PostgreSQL/Realtime. No research files, original minutes or CSV are copied into this project. Existing research repositories remain untouched. No commit, push, cloud provisioning or real-data transmission is performed.

## Architecture and binding decisions

- Official assignments remain R1=81, R2=24, H1=68, R1_DEDUP=8, S1=300, C1=10 (491 total). Balanced assignments are an optional separate mode and excluded from official totals.
- Only opaque IDs and allowlisted labels can enter the cloud. Real-data imports stay in browser IndexedDB and cannot synchronize. Synthetic cloud projects are explicitly seeded by an administrator; client input cannot elevate their data classification.
- Auth is Supabase email/password, no frontend privileged key. RLS restricts annotation reads to the assigned reviewer. Admin receives safe progress summaries via Realtime, not annotation rows. Final labels can be exported only after session lock AND blind phase closure.
- Save: persist local drafts immediately, debounce 750ms, flush on navigation. A server ACK is required before saved status. Version compare-and-swap and mutation IDs prevent silent lost updates and duplicate saves. Changes during an in-flight save must remain pending.
- Progress uses validated committed server labels, never optimistic client state. Official guide adds conditional fields beyond the existing validators' coarse labelled counter: blind yes requires act+evidence, e3b yes requires evidence, sample yes requires name+act, committee no requires corrected committee. Empty/non-applicable fields remain empty. Notes are optional.
- Submit requires zero local queue and a server transaction that validates all assigned rows before locking. Other-device stale writes are rejected and their local drafts retained; no claim that a server can observe unreported offline edits on another device.
- Source CSV stays local. Merge by ID into the unchanged original header, row order and source fields; do not alter official scoring. Provide local official-validator integration. Admin cannot export unlocked/active-blind results.

## Tasks and file ownership

1. Domain validation + SQL migrations/RLS/RPCs + database contract tests (backend agent).
2. IndexedDB outbox + concurrency-safe sync engine and behavioral tests (sync agent).
3. Auth UI, review workspace, admin dashboard, synthetic local backend, CSV import/export and GitHub workflows (root).
4. Integrate, execute local tests/build, browser QA, independent security/concurrency review, fix findings.
5. Document Supabase setup and real integration test command. Without configured Supabase, mark remote DB/Realtime/device tests NOT RUN, never passed.

## Verification

Meaningful tests cover invalid/incomplete labels; edit during save; durable offline reload; retry/idempotency; dual-client conflict and explicit resolution; cross-reviewer isolation; server-only completion; final lock/export; strict original CSV preservation. SQL is exercised using local PostgreSQL/WASM where supported. A separately gated real Supabase integration runner must create synthetic users, write/re-read actual rows, subscribe to safe progress, test authorization/CAS/submission, and clean up only its own synthetic project.

## Ledger

- 2026-10-30: New isolated project directory, no existing Git repository. No worktree or commits are needed. Supabase is not yet provisioned; user explicitly authorized completing local functionality first.
- Ruling: New GitHub Pages app rather than Sites hosting, because the user explicitly selected that deployment platform.
- Ruling: Domain/SQL and outbox modules can be implemented concurrently with disjoint ownership and a shared contracts.ts; no agent edits another owner's files.
- Ruling: Real-data cloud sync remains unavailable until a separate explicit policy approval and reviewed migration. A browser toggle alone cannot authorize it.
- 2026-10-30: Implemented app, migration/RLS/RPCs, durable outbox, CSV tools and Pages workflows. Final local suite 40/40, production build and secret scan pass; synthetic CSV checks 10 and unmodified official validators 5/5 pass. Full synthetic 491-item workflow covered.
- Browser QA: committed labels and offline drafts survive refresh; reconnect drains pending; admin local practice auto-updates 2→3; same-browser duplicate writer blocked and resumes after lock release. No remote DB/physical-device success is claimed.
- Independent security review findings fixed: broad Realtime publications rejected, submission input guard, navigation flush/recovery, Web Locks ownership through durable teardown with abortable wait, terminal retry, monotonic persisted advisory report sequence rejecting stale reports server-side. No remaining Critical/Important finding in final narrow review.
- Remaining external dependency: user provisions Supabase and provides local configuration. `test:supabase` currently reports SKIP / NOT RUN. README and SUPABASE.md explain setup, required environment variable names, synthetic test runner and manual physical-device scenarios. No permission question is needed for completed local work.
