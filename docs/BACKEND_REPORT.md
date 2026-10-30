# Backend verification report

Date: 2026-10-30. Scope: synthetic-only Supabase contract, PostgreSQL/WASM tests, and real integration runner.

- Migration: `supabase/migrations/202610300001_review.sql` creates RLS-protected tables, server-only label validation, CAS and idempotent mutation receipts, per-device advisory sync state with increasing report sequences, server-computed progress and a submitted/closed-blind export gate. Delayed lower-sequence reports are ignored without updating progress. Direct authenticated annotation writes and administrator annotation SELECT are denied. `review_progress` is the only review table added to Realtime.
- Official seed: `supabase/seeds/synthetic_official.sql` uses six required role codes with totals 81, 24, 68, 8, 300, 10, assigned to three reviewers (R1/R1_DEDUP/S1, R2/C1, H1) and opaque IDs beginning `item-001`. Its UUID placeholder guard prevents unedited execution. The optional standalone balanced seed creates 15 assignments, five kinds and a 164/164/163 global round-robin split in a separate project.
- Local SQL test: PGlite executes the actual migration and substituted copies of both synthetic seeds. It verifies CAS, replay/mutation reuse, validated completion/downgrade, reviewer isolation, direct-write denial, multi-device pending/conflict/error submit blocking, delayed lower-sequence `saved` reports, lock, closed-blind export, the official 491 rows and the separate balanced 491 rows with 164/164/163 ownership. An isolated migration test rejects a preexisting `FOR TABLES IN SCHEMA public` publication, and another verifies that an explicit publication contains only `review_progress` among review tables.
- Real integration: `scripts/test-supabase.mjs` is runnable only with `RUN_SUPABASE_INTEGRATION=1`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_TEST_SECRET_KEY`. It loads `.env.local` for CLI use, redacts keys from errors, tests concurrent R1/R2 writes, H1 fresh SDK session restoration and synthetic locked-export-to-CSV verification, then cleans up its own project, Auth users and temporary CSV files.

Remote Supabase Auth, Realtime and RLS tests: **NOT RUN** because no configured Supabase project and test secret were supplied. Local PGlite tests do not prove Supabase deployment settings or Realtime delivery. Real-data cloud sync remains disabled; source CSV and text remain local in IndexedDB.

| Test surface | Status | What it establishes |
| --- | --- | --- |
| PGlite migration/RLS contract | Passed locally | SQL behavior and publication guard in PostgreSQL/WASM |
| Synthetic local CSV and official validators | Passed locally | Source preservation and label format on constructed data |
| Live Supabase runner | **NOT RUN** | Requires a configured disposable Supabase project; would exercise Auth, RLS, Realtime, multiple reviewer accounts, new SDK session, export and CSV |
| Physical browsers/devices, offline transitions and conflict UI | Manual check pending | SDK client simulation and local unit tests are not physical-device proof |
