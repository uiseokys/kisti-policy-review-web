# Local three-member Supabase bootstrap

Status: SQL preparation and PostgreSQL/WASM verification completed locally. No Supabase project, Auth users, cloud migration, or remote test was created or run.

1. In a Supabase project, create three reviewer Auth users and one administrator Auth user. Obtain their four distinct Auth UUIDs. Do not put passwords or a privileged API key in this configuration.
2. Put `KISTI_REVIEWER_1_ID`, `KISTI_REVIEWER_2_ID`, `KISTI_REVIEWER_3_ID`, and `KISTI_ADMIN_ID` in `.env.local` or the shell environment. Shell values take precedence. The checked-in `.env.example` contains blank names only.
3. Run `node scripts/prepare-supabase.mjs` from the app directory. It validates canonical, distinct, non-template UUIDs and writes `local-data/supabase-team-seed.sql` with permissions `0600`. The generated file is ignored by Git and an existing file will not be overwritten. To regenerate, inspect and remove the prior generated file yourself first.
4. Once the project exists, apply `supabase/migrations/202610300001_review.sql` and then `supabase/migrations/202610300002_team_split.sql` through the approved project administrator path. Then inspect the generated SQL and apply it separately. The generator never connects to Supabase or executes SQL.
5. Confirm the new `Synthetic team split pilot` project has 18 assignments, six per reviewer, and item totals of 164, 164, and 163. Use the read-only query below; then run the real integration tests and physical-device checks described in `SUPABASE.md` before describing remote behavior as verified.

```sql
select p.id, a.reviewer_id, count(distinct a.id) as assignments,
       count(i.item_id) as items
from public.review_projects p
join public.review_assignments a on a.project_id = p.id
join public.review_items i on i.assignment_id = a.id
where p.name = 'Synthetic team split pilot'
group by p.id, a.reviewer_id
order by p.id, a.reviewer_id;
```

Local verification: `tests/bootstrap.test.ts` executes the actual two migration files and generated seed in PGlite, then checks all 18 assignments and the 164/164/163 split. It also tests invalid UUID rejection, declaration-only replacement, private file permissions, and refusal to overwrite. This does not exercise hosted Auth, PostgREST, RLS enforcement through the API, or Realtime.
