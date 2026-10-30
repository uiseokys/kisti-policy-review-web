# Supabase and GitHub Pages rollout

User requested actual Supabase connection and GitHub Pages deployment, with ordered account/setup actions. This authorizes necessary app-only Git initialization, commits and push for deployment; it does not authorize uploading research data or removing the real-data sync block.

## Current state

- App has local synthetic pilot verification and 3-member source-group allocation.
- GitHub CLI read-only authenticated request verified account `uiseokys`. A sandbox-only auth status falsely reported invalid; the unsandboxed read-only API request succeeded. Do not ask the user to re-authenticate unless a later real request fails.
- Supabase project `rokntsfyobsvfaqqkwtw` exists; user entered URL and public key in private `.env.local`, validated without printing values. No test secret or management token. Supabase connector tools currently return Unknown tool; use another authorized access method.
- User approved public repository; created `https://github.com/uiseokys/kisti-policy-review-web`. Initial app-only commit382b26e pushed and CI/Pages succeeded. GitHub account public id243684036, login/nameuiseokys; repository-local noreply commit metadata only, no global Git configuration changed.
- Latest steering supersedes manual account creation: user wants teammates to choose their seat and set name/password on the site, then immediately work. No precreated reviewer/admin Auth users or UID entry. Implement secure self-service onboarding and returning name/password access, using per-seat private invitation links.

## Work

- [x] Worker: deployment configuration preflight; 23 tests, unsafe config stops deployment.
- [x] Worker: legacy local-only validated UUID bootstrap SQL generator + tests (retained optional manual path; latest request uses self-service instead).
- [x] Root: hide local demo entry when Supabase configured; select team mode for team-only account/project.
- [x] Self-service onboarding implemented and security reviewed; lost-ACK race fixed. On-site name/password registration with private per-seat links, no precreated human accounts.
- [x] App-only manifest checked, Git initialized, user-approved public repo created, public configuration set via stdin, commit382b26e pushed, CI and Pages succeeded. No private config or source data uploaded.
- [x] Live schema001002003 and EdgeFunctionteam-access deployed via authenticated Dashboard UI (connector unavailable). Exact source editor content verified before deploy. Origin configured; own invite/password authorization replaces legacy public-key JWT gateway requirement.
- [x] Actual synthetic Auth/RLS/RPC/Realtime validation passed; all491items saved,18sessionslocked,export491/R1CSV81officialvalidator passed. Browser admin100% and team3tab-close restore verified.
- [x] Synthetic test project deactivated without deleting its audit data. Fresh actual team workspace activated,4unclaimed seats/0labels. Private600participation-links.txt/html prepared. Final UI plan denominator fix reviewed, 124tests/build/security scan passed; release source ready for final push.

## Constraints

No minutes, actual CSV, source mapping, real derived labels or secrets enter GitHub/cloud. Only synthetic app and synthetic labels may be online. Keep `.env.local`, generated bootstrap/config, original research files and server-only test key out of source control. Public browser values may be GitHub Actions repository variables; privileged secrets may not. Account creation/password entry/terms acceptance remain user actions. No sending invitations/messages to teammates without explicit user authorization. Never label an unrun remote/device test as passed.
