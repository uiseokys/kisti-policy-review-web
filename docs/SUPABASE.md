# Supabase synthetic pilot setup

This release accepts **synthetic IDs and allowlisted labels only**. Original CSV data, source text, and minutes remain in browser IndexedDB; their cloud sync is disabled. Do not use a real dataset with these tables or the synthetic seed.

## Recommended self-service deployment

The current deployment uses private per-seat invitations and on-site name/password setup, without precreating teammate email accounts. Follow [SELF_SERVICE_SETUP.md](SELF_SERVICE_SETUP.md). The manual Auth UUID method below remains an optional legacy workflow.

## Optional manual account deployment

1. Create a Supabase project. In Authentication, enable email/password and create the pilot reviewers and one administrator as Auth users. Record their UUIDs. Keep email confirmation settings appropriate to the pilot.
2. In the Supabase SQL Editor, run `supabase/migrations/202610300001_review.sql` as the database owner. It creates RLS policies, guarded RPCs, safe progress summaries, and a Realtime publication entry for `review_progress` only. If the existing `supabase_realtime` publication uses `FOR ALL TABLES` or `FOR TABLES IN SCHEMA public`, the migration rejects it. Reconfigure publication scope to explicit safe tables before retrying; never publish annotation or mutation tables. Then run `supabase/migrations/202610300002_team_split.sql`. This additive migration accepts the new team-split role codes with their separate task-kind constraints; do not replace or edit the first migration.
3. Copy `supabase/seeds/synthetic_official.sql`, replace the three reviewer UUID placeholders and the administrator UUID with the Auth user UUIDs, then run that copy in SQL Editor. The untouched template fails deliberately. It creates R1 81, R2 24, H1 68, R1_DEDUP 8, S1 300, C1 10 (491 total). Reviewer 1 owns R1/R1_DEDUP/S1, reviewer 2 owns R2/C1, and reviewer 3 owns H1. Each assignment uses opaque `item-001`, `item-002`, etc. IDs and contains no source data.
4. To enable the optional **3인 균등 분담** mode, copy `supabase/seeds/synthetic_team_split.sql`, replace its three reviewer and administrator UUID placeholders with the same Auth user UUIDs, and run the copy separately. It creates a separate synthetic project with 18 assignments (`B1_R1` through `B3_C1`), one for each team member and source group. Each source group is divided into disjoint contiguous source-ID slices; R1 and R2 remain separate blind task kinds. The existing official project is unchanged. The older `synthetic_balanced.sql` seed is optional legacy data: it creates a separate 15-assignment project, remains stored if already applied, and is hidden from the new mode's assignment list.
5. Check Table Editor or SQL: `select role_code,total from public.review_assignments where mode='official' order by role_code;`. Confirm all six official roles and counts. For the new project, confirm R1 27/27/27, R2 8/8/8, H1 23/23/22, R1_DEDUP 3/2/3, S1 100/100/100, and C1 3/4/3, giving team totals of 164/164/163. Realtime must include `public.review_progress`; no raw annotation table belongs in the publication.

The app reads `review_memberships` for `project_id,role` with `user_id = auth.uid()` and uses `reviewer` or `admin` roles. RLS permits only a reviewer's assignment/annotations and admin summary progress. Direct writes from signed-in clients are revoked. Server RPCs handle validated label saves, advisory sync reports, submission and gated export. An admin cannot directly select annotation rows. `export_locked_annotations` permits the reviewer or administrator only when the assignment is submitted and `review_projects.blind_closed` is true. Closing the blind phase is a database-owner operation after protocol review; the browser cannot change it.

The default official mode retains the original independent-review design. The optional team-split mode exposes only the signed-in member's `Bn_` roles and partitions work among members; it does not itself provide an independent-review protocol. In local demo, R1, R2, and H1 entry points correspond to members 1, 2, and 3. When importing a real CSV locally, a member may select the full source-group file and the app selects that member's contiguous slice, or may supply an already split file. Original IDs, cells, and row order are preserved. Real-data cloud sync and final submission remain blocked. A source-group CSV merged from labels is appropriate only after all three member sessions are locked and the blind phase is closed.

This setup has not been run against a configured Supabase project. The remote Auth, RLS, RPC, and Realtime checks remain **NOT RUN** until a disposable project is configured and tested.

## Local configuration

Copy `.env.example` to `.env.local` and set:

```text
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Both `VITE_` values are public browser configuration. **Never place a secret key or service-role key in a `VITE_` variable.** `.env.local` is ignored by Git. Run the app with `pnpm dev` and build with `pnpm build`.

For the optional CLI integration test, add these to `.env.local` or the shell environment (not to `.env.example`, source control, or frontend code):

```text
SUPABASE_TEST_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
RUN_SUPABASE_INTEGRATION=1
```

Run `pnpm test:supabase`. The runner creates four synthetic Auth users (R1, R2, H1 and admin) and one synthetic project. It tests concurrent R1/R2 own writes and isolation, H1 label restoration after sign-out and a fresh SDK login, direct-write rejection, CAS/idempotency, validation, progress Realtime, per-device pending state, submit lock and export gate. It merges locked R1 export labels into temporary synthetic CSV files, runs `scripts/verify_csv.py` and invokes the known official blind-label validator when present. It removes its own project, users and temporary CSV files. The fresh SDK login checks server persistence across sessions; it does not prove behavior across physical browsers or devices. Without the four configured values, the runner prints `SKIP` and exits successfully; that is **not** a remote test pass. Use a disposable pilot Supabase project and inspect any reported cleanup failure.

## Sync and submission semantics

The client writes drafts to IndexedDB immediately, then calls `save_review_annotation` with an expected version and mutation UUID. The server validates fields, compares versions and stores an idempotent receipt. A mismatched version returns the current row for explicit conflict resolution. Completion and progress are recomputed from committed server labels only.

`report_review_sync_state` records an authenticated reviewer's `device_id`, pending count, state, last seen time and a required nonnegative report sequence. The browser reserves a strictly increasing sequence for each user/assignment/device in localStorage before each network call; if that durable write fails, it does not send a report. The server updates device state only when the incoming sequence exceeds the stored sequence. Thus a delayed older `saved` report cannot clear a newer `pending` or conflict report, and stale reports do not update progress. Summary state prioritizes conflict, error and pending across all known devices. A saved report from one device cannot clear another device's pending or conflict state. Submission is blocked while any known device reports pending, conflict or error, and while any item lacks a complete valid server label. Offline changes never reported by a device cannot be detected by the server; reviewers must bring each device online before final submission.
