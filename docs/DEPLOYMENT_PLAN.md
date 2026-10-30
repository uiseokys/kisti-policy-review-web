# Supabase and GitHub Pages rollout

User requested actual Supabase connection and GitHub Pages deployment, with ordered account/setup actions. This authorizes necessary app-only Git initialization, commits and push for deployment; it does not authorize uploading research data or removing the real-data sync block.

## Current state

- App has local synthetic pilot verification and 3-member source-group allocation.
- GitHub CLI read-only authenticated request verified account `uiseokys`. A sandbox-only auth status falsely reported invalid; the unsandboxed read-only API request succeeded. Do not ask the user to re-authenticate unless a later real request fails.
- Supabase project `rokntsfyobsvfaqqkwtw` exists; user entered URL and public key in private `.env.local`, validated without printing values. No test secret or management token. Supabase connector tools currently return Unknown tool; use another authorized access method.
- User approved public repository; created `https://github.com/uiseokys/kisti-policy-review-web`. Local app-only Git repository initialized, no commit/push yet. GitHub account public id243684036, login/nameuiseokys; use repository-local noreply email for commit metadata.
- Latest steering supersedes manual account creation: user wants teammates to choose their seat and set name/password on the site, then immediately work. No precreated reviewer/admin Auth users or UID entry. Implement secure self-service onboarding and returning name/password access, using per-seat private invitation links.

## Work

- [x] Worker: deployment configuration preflight; 23 tests, unsafe config stops deployment.
- [x] Worker: legacy local-only validated UUID bootstrap SQL generator + tests (retained optional manual path; latest request uses self-service instead).
- [x] Root: hide local demo entry when Supabase configured; select team mode for team-only account/project.
- [ ] Self-service onboarding: see SELF_SERVICE_DESIGN.md. Update signup, SQL claim/rate limits, Edge Function, fresh project+hashed invitations and private link generation.
- [ ] Root: verify app-only source manifest, tests/build/security scan, initialize Git; after visibility approval create target repository and publish static app with required public config.
- [ ] Root: after Supabase exists, apply migrations/bootstrap, test actual Auth/RLS/RPC/Realtime using synthetic data, create/assign evaluator accounts without exposing passwords, deploy and verify live login/progress.

## Constraints

No minutes, actual CSV, source mapping, real derived labels or secrets enter GitHub/cloud. Only synthetic app and synthetic labels may be online. Keep `.env.local`, generated bootstrap/config, original research files and server-only test key out of source control. Public browser values may be GitHub Actions repository variables; privileged secrets may not. Account creation/password entry/terms acceptance remain user actions. No sending invitations/messages to teammates without explicit user authorization. Never label an unrun remote/device test as passed.
