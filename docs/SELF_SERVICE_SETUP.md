# Self-service team setup

This rollout uses one synthetic review project and four private invitations: `member1`, `member2`, `member3`, and `admin`. Teammates create their own name and password from their invitation link. Do not create Supabase Auth users or ask teammates for email addresses in advance.

## 1. Check the public configuration

The Supabase project is `rokntsfyobsvfaqqkwtw`. The browser uses only its project URL and public publishable/anon key from the private local `.env.local`; the service-role key stays inside Supabase Edge Functions. The approved Pages address is `https://uiseokys.github.io/kisti-policy-review-web/`.

Use only synthetic test data in this deployment. Do not upload research CSVs, source mappings, minutes, or derived labels.

## 2. Apply database migrations

In the Supabase SQL Editor for that project, apply these files **in order**, each once:

1. `supabase/migrations/202610300001_review.sql`
2. `supabase/migrations/202610300002_team_split.sql`
3. `supabase/migrations/202610300003_self_service.sql`

Confirm each transaction succeeds before proceeding. These migrations define the project, team review tables, private invitation tables, and server-side claim/rate-limit functions. Do not run the older `prepare-supabase.mjs` seed for this self-service project; it expects manually created Auth user IDs.

## 3. Create and apply the private setup SQL

From the repository root, shortly before invitations will be sent, run:

```sh
node scripts/prepare-self-service.mjs
```

The generator creates `local-data/self-service-setup.sql` and `local-data/participation-links.html`, each with mode `0600`. The directory is Git ignored. It refuses to overwrite either file. The SQL has a fresh project UUID and four SHA-256 invitation hashes, with expiration seven days after generation. Raw invitation tokens appear only in the HTML link sheet.

Apply `local-data/self-service-setup.sql` in the same Supabase SQL Editor after all three migrations. It inserts one synthetic project, selects it as the active self-service project, and creates four unclaimed invitation rows. The transaction stops if an active self-service project already exists. It creates no Auth users.

Keep both files local. Do not paste the HTML, its links, or the SQL into Git, public Pages, chat, issue trackers, or logs. If setup fails, inspect the database state before retrying; running the generator again is intentionally blocked while either private file exists.

## 4. Deploy the `team-access` Edge Function

Deploy the repository's `supabase/functions/team-access` function to the same Supabase project. Set its server environment variable exactly:

```text
KISTI_APP_ORIGIN=https://uiseokys.github.io
```

Configure the `team-access` function with `verify_jwt=false`: its handler validates invitations and passwords itself before it returns a Supabase session. Leave the built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` on the server. Never place the service-role key in frontend code, GitHub variables, or the local link sheet. The function rejects requests if `KISTI_APP_ORIGIN` is missing or different.

## 5. Publish and verify the site

Publish the app to the approved public GitHub repository and Pages address with the Supabase project URL and **public** key embedded for the browser. Open `https://uiseokys.github.io/kisti-policy-review-web/` and verify it loads the Supabase-backed team entry. A public visitor without an invitation must not be able to claim a seat.

Before inviting teammates, verify with synthetic data that one invitation registers only its named seat, registration signs in, returning access works with the same seat/name/password, an expired or reused invitation fails, and admin access is separate from reviewer access. Also check Auth, RLS, claim RPC, and live progress against the actual Supabase project. Local tests alone do not prove cloud behavior.

## 6. Forward the four private links

Open `local-data/participation-links.html` **locally**. Send each person only their assigned link. The admin link goes only to the administrator. The fragment after `#` carries the private token and seat; do not put any of these URLs in Git, a public document, or this guide.

Each teammate opens their link, confirms the preselected seat, enters a display name of 2–40 characters and a password of 8–128 characters, then starts work. On later visits they choose their seat and use the same name/password. No email address or administrator-created Auth user is needed. An unused link expires seven days after the generator ran; if it expires, arrange a controlled invitation rotation instead of rerunning the original setup SQL against an active project.
