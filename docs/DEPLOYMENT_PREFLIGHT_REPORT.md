# GitHub Pages deployment preflight

The Pages job now runs `pnpm run check:deployment` immediately after installing dependencies, before tests, build, artifact upload, or deployment. Missing or unsafe public Supabase configuration stops the job. The Pages job receives these GitHub Actions **repository or `github-pages` environment variables**:

- `VITE_SUPABASE_URL`: HTTPS Supabase project origin, with no credentials, path, query, or fragment.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: a public `sb_publishable_...` key or a legacy `anon` JWT. A `sb_secret_...` key or `service_role` JWT is rejected.
- `VITE_BASE_PATH`: set automatically to `/${{ github.event.repository.name }}/` by the workflow. `/` is also accepted for a root Pages site.

The validator checks only environment variables. It prints variable names and generic failure reasons, never configured values. Public browser values are expected in GitHub Actions **Variables**, not Secrets; privileged credentials must not be supplied to the browser build. The workflow runs synthetic tests and the official export preservation test before building, then scans the built output for privileged key patterns before upload.

Local verification on 2026-10-30: the 23 focused deployment tests passed; the empty-environment CLI exited nonzero and listed missing variable names; the official export and secret-scan tests passed. Full-suite and build verification were blocked while the parallel synthetic bootstrap implementation was in progress: `tests/bootstrap.test.ts` failed in its import setup, and TypeScript reported TS7053 in that test. Re-run `pnpm test`, `pnpm run test:export`, `pnpm run build`, and `pnpm run check:secrets` after the bootstrap files are complete.

This preflight verifies configuration shape, not remote project existence, authentication, RLS, or a live Pages deployment. Those require the selected Supabase project and repository setup.
