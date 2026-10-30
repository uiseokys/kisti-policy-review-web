# Self-service team access

Latest user instruction: teammates must not require administrator-created email accounts. On their first visit choose a team seat, set their name/password directly on the site and start work. Returning teammates recover the same account/work using seat+name+password. Keep existing Auth/RLS; never put service credentials in the browser. User approved app-only public GitHub repository. Real CSV/source/derived-label cloud restrictions remain.

## UX and boundaries

- Four private invitations: member1/member2/member3/admin. A private link contains `#join=<random256btoken>&seat=member1`. Fragment stays client-side. No invitations in Git, logs, chat or public Pages files. Owner receives an ignored local file with links and forwards them themselves.
- Public landing offers member cards and returning access. With a private invitation the chosen seat is preselected and initial registration asks name/password/password confirmation. A used/wrong/expired invitation cannot claim another seat. Returning access requires seat+name+password. No email input. Registration auto-signs in via Supabase tokens.
- Anonymous open seat claiming is not allowed: anyone seeing a public URL must not steal reviewer/admin slots. Invite is consumed on successful registration. Returning name/password works without invite.
- Admin gets a separate private link; it is not a publicly claimable role. Existing local demo entry remains available only without a configured Supabase client.

## Shared interface

Edge Function name `team-access`, `verify_jwt=false` because it performs its own invite/password authentication. Client invokes body:

`{action:'register'|'login',seat:'member1'|'member2'|'member3'|'admin',name:string,password:string,invite?:string}`.

Success: `{access_token:string,refresh_token:string}` (then client `auth.setSession`). Failure: `{error:string}` with appropriate4xx/429/503, no names/emails/tokens/passwords in logs. Password >=8 characters, <=128; display name NFC/trimmed 2..40 chars. Reject unknown fields. CORS requires exact `KISTI_APP_ORIGIN` server env (production https://uiseokys.github.io). Default-deny if missing. OPTIONS supports POST plus SDK headers. Deno built-in SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY stay server-side.

## Database migration003

- `review_access_settings`: singleton boolean id=true PK, `project_id` FK review_projects. Only one active self-service project. No anon/authenticated read/write; service_role only.
- `review_access_invites`: `id uuid PK default gen_random_uuid`, project_id FK, `seat text` in4allowed, token_hash text unique (64 lowercase SHA256 hex), expires_at timestamptz, user_id uuid nullable, display_name text nullable, login_email text nullable; unique(project_id,seat). RLS enabled; public/anon/authenticated fully revoked; service_role direct access allowed. Store only hash of private join token.
- `review_access_attempts`: primary key(project_id,seat,action,bucket timestamptz), count integer. RLS enabled/no public access. RPC `take_review_access_attempt(p_seat text,p_action text) returns boolean`: service_role-only, current active project, minute bucket, limit10login/minute and5register/minute per-seat; atomic increment. Caller validates unknown invitation BEFORE consuming registration attempt to prevent public DoS. No IP/name/password stored.
- RPC `claim_review_access(p_invite_id uuid,p_user_id uuid,p_display_name text,p_login_email text) returns void`: service_role-only execute, security definer fixed search_path. Lock invite FOR UPDATE; current active project, unexpired, unclaimed (sameuser idempotently returns). Validate name/email/userUUID. Atomically set claim, add reviewer/admin membership; reviewer claim creates6balanced assignments with codes Bn_R1/R2/H1/R1_DEDUP/S1/C1 using exact allocation matrix and disjoint contiguous original source IDs. Admin claim adds only admin membership. No source data. Reject expired/alreadyclaimed otheruser, no duplicate membership/assignments on retry. Existing official/legacy projects untouched. New migration does not alter existing RLS/publications/scoring.

## Edge implementation

Read singleton settings via service-role SDK. For register hash invite token with SHA256 and locate matching seat/project row, validate not claimed/expired; rate limit; create Auth user with random internal alias email `review-<uuid>@kisti-review.invalid`, password, email_confirm:true and display_name metadata. Then call claim RPC. On claim failure re-read invite: if committed to same new user treat as success; otherwise remove only the just-created unclaimed Auth user, never another user. Login reads only selected seat of active project; normalize/compare display name; rate limit then use public auth client signInWithPassword with stored internal alias. Registration uses that same sign-in to return tokens only after DB claim succeeds. Do not disable email confirmation globally or change account/security settings. No external emails sent.

## Preparation and rollout

Generator creates random projectUUID, 4x256b tokens, SHA256 hashes, expires7days; writes private ignored local-data/self-service-setup.sql and participation-links.html mode0600. Setup SQL inserts singleton/project4emptyinvitations, never precreatesAuthusers, nooverwriteexistingactiveproject. Link file uses eventual GitHubPages URL. Secret tokens only in local link file. After migrations001/002/003 and setup SQL, deploy EdgeFunction with server env KISTI_APP_ORIGIN; no service key in frontend/Git. Then publish Pages with alreadyvalidated public URL/key.

## Verification

PGlite actual migrations prove atomic one-seat claim, all3counts/ranges, adminroleisolation, no anonymous/authenticated invite access, expiration/replay/idempotency and rate limits. Edge handler injectable service boundary tests verify validation, no public privilege, random aliases, cleanup after race, password login and token propagation. UI verifies invitation registration+auto session, returning seat/name/password, and no local demo under real config. Actual cloud Auth/RLS/RPC/Realtime must run after provision; do not claim until observed.
