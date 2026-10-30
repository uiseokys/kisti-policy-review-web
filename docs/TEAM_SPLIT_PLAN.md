# Three-member allocation change

The user explicitly requests implementation: each of policy issue review (R1=81), independent review (R2=24), and exploratory review (H1=68) must be split into thirds across three teammates. Continue the previously authorized implementation workflow without another approval gate. Keep the existing official independent design available separately, and keep all real-data cloud restrictions.

## Design

Replace the optional balanced mode's merged blind group with separate source roles. Main group totals are R1 27/27/27, R2 8/8/8, H1 23/23/22: main work 58/58/57. Also retain thirds for the three auxiliary groups. Use a continuous round-robin remainder cursor over R1 81, R2 24, H1 68, R1_DEDUP 8, S1 300, C1 10 to keep grand totals 164/164/163. Each group is partitioned into disjoint contiguous source-row slices after calculating its three counts. Source roles and task validators stay separate. Codes are B1_R1 through B3_C1 (18 assignments), in a new synthetic project; original official assignments and any old balanced project are untouched.

For synthetic data, item IDs represent original source-row indices, so members receive different IDs within each source group. For later local CSV use, allow the full source-group CSV and automatically select the signed-in member's slice, preserving original IDs/cells/order. Already split CSVs remain supported. Real imports remain local and cannot sync.

## Tasks

- [x] Root: shared allocation definitions + tests for exact counts, kind separation, non-overlap/coverage; demo backend and synthetic source ID alignment; tests for full-CSV automatic partition.
- [x] Backend worker: additive migration accepting new balanced role codes with kind constraints; fresh seed with 18 assignments and disjoint item IDs; SQL tests for exact counts/coverage/owner isolation. Original migration and existing official seed unchanged.
- [x] Root: use 3인 균등 분담 name, source-role labels and per-member work counts in review/admin views; local CSV partition on import. Original official mode retained.
- [x] Root: full local tests, production build, browser check for each team member and admin, setup docs, independent review. Remote Supabase remains unconfigured/NOT RUN.

No Git commit/push, cloud deployment, source-data transfer, or changes in research repositories. New seed must create a separate project and must not reassign existing rows. Old balanced/demo storage is preserved by distinct assignment/project IDs.

## Completion ledger

2026-10-30 18:43 KST: complete within locally available scope. Full suite 55/55 across 14 files, TypeScript/Vite build and frontend secret scan passed. Synthetic CSV checks 10 and unmodified official validators 5/5 passed. Browser QA confirmed own source ranges for all three teammates and safe admin summary auto-update from 3 to 4 saved items. Added complete 491-item/18-session/six-CSV team workflow test. Independent read-only final review found no Critical/Important findings. Actual Supabase Auth/PostgREST/Realtime and physical-device checks remain NOT RUN.
