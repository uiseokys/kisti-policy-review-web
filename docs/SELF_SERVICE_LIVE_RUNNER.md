# Live self-service synthetic validation

This runner exercises the actual `rokntsfyobsvfaqqkwtw` Supabase project through its deployed `team-access` Edge Function and public SDK sessions. It uses only generated synthetic labels and source fixtures. It never needs or reads a service-role key. Run it before activating the teammate project, while `review_access_settings` has no row.

## Preparation

From the repository root:

```sh
node scripts/test-self-service-live.mjs --prepare
```

This writes `local-data/live-test/setup-test.sql`, `participation-links.html`, and `state.json`. The ignored directory is mode `0700`; each file is mode `0600`. The SQL contains only invitation hashes. The HTML and state contain private invitation fragments; state also contains four random passwords. Keep these files local and do not paste their contents into logs, Git, chat, or public documents. The generator refuses to replace an existing test directory.

Apply `setup-test.sql` in the SQL Editor of the exact project above, after migrations `001`, `002`, and `003`. The setup insert fails if another self-service project is active. It creates a synthetic test project and four unused seats, without creating Auth users.

## Live run

Ensure `.env.local` contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for that project. Then run:

```sh
RUN_SELF_SERVICE_INTEGRATION=1 node scripts/test-self-service-live.mjs --run
```

Without that exact gate, `--run` and `--export` print `SKIP` and do no network work. `--prepare` writes local files only. The runner checks the configured URL against the fixed project reference before it calls the network.

The run registers four synthetic profiles through `team-access` with the production Origin, then uses the returned tokens in public Supabase clients. On rerun it logs into existing profiles and resumes from `state.json`. It checks 18 balanced assignments, totals `164/164/163`, source ranges, membership RLS, cross-member/admin annotation isolation, direct-write denial, concurrent writes, CAS and replay, progress downgrade, sync report sequence gating, a real admin Realtime event, returning login, and all 491 complete server annotations. It submits all 18 assignments, confirms pending and incomplete submission gates, and confirms export remains denied while the blind phase is open. Bulk saves use four concurrent RPC calls; a failed mid-run may be rerun safely because current versions are reread.

Successful `--run` writes `local-data/live-test/finalize-test.sql`. Apply this private SQL in the same project. It only sets `blind_closed = true` for the generated synthetic project UUID. Then run:

```sh
RUN_SELF_SERVICE_INTEGRATION=1 node scripts/test-self-service-live.mjs --export
```

`--export` checks all 491 locked annotations through the admin export RPC, confirms direct annotation RLS still denies admin reads, merges the three R1 slices into an 81-row synthetic CSV, and runs `verify_csv.py`. If the known local official blind validator is available, it also invokes it through the wrapper. The temporary CSV files are removed. Successful export writes `local-data/live-test/deactivate-test.sql`.

Apply `deactivate-test.sql` after reviewing the PASS result. It removes only the `review_access_settings` row for the generated test project UUID. It deliberately leaves the synthetic project and Auth users for audit; no broad or secret-key cleanup is attempted. Once deactivated, prepare the real teammate project through its separate setup flow.

Only aggregate PASS/SKIP messages and fixed failure codes go to the console. The runner never prints invitation fragments, passwords, access tokens, public key values, remote error payloads, or annotation rows. If a stage fails, inspect `state.json` locally and rerun the same command after addressing the cause. Do not regenerate the private setup while it is active.
