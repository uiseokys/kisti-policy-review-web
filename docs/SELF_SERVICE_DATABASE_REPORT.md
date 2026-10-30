# Self-service database verification

Migration `202610300003_self_service.sql` adds private active-project settings, hashed invitations and minute attempt buckets. The three tables have RLS enabled and all privileges revoked from PUBLIC, anon and authenticated. The service role receives direct privileges and relies on Supabase's normal BYPASSRLS attribute. No client-readable RLS policy is added.

`take_review_access_attempt(p_seat text,p_action text)` and `claim_review_access(p_invite_id uuid,p_user_id uuid,p_display_name text,p_login_email text)` are security-definer functions with fixed `pg_catalog,public` search paths and service-role-only execution. The rate limiter uses one atomic UPSERT per request and limits login to 10 and registration to 5 attempts per minute/project/seat. Its count saturates above the limit to avoid overflow. The Edge caller must verify an invitation before consuming a registration attempt, as required by the design.

Claims lock the singleton settings row FOR SHARE and invitation row FOR UPDATE, verify the active project and expiry, validate identity fields, and record membership and assignments in the same transaction. A claim by the same user returns without duplicating work or rewriting the saved name/email; a different user is rejected. An error after updating an invitation rolls back the entire statement. Admin claims create only admin membership. Reviewer claims create six synthetic balanced assignments with these counts and disjoint contiguous source IDs:

| Source | member1 | member2 | member3 |
| --- | ---: | ---: | ---: |
| R1 | 27 | 27 | 27 |
| R2 | 8 | 8 | 8 |
| H1 | 23 | 23 | 22 |
| R1_DEDUP | 3 | 2 | 3 |
| S1 | 100 | 100 | 100 |
| C1 | 3 | 4 | 3 |
| Total | 164 | 164 | 163 |

Only opaque item IDs and assignment metadata are created. The migration does not alter migrations 001/002, original assignments, label assessment, scoring, existing RLS policies or publications.

## Observed local verification

- RED: the initial PGlite run failed all nine original tests because the self-service tables and RPCs did not yet exist; the explicit schema assertion received an empty result.
- GREEN: `pnpm test tests/selfServiceDatabase.test.ts` passed **10/10** tests after implementation and an added queued competing-claim check.
- The fixture applies actual migrations 001, 002 and 003, with an `auth.uid()` stub and anon/authenticated/service_role roles. Service-role grants and real SQL permission errors are exercised.
- Coverage includes all 18 assignments, exact kinds/counts/source boundaries, all 491 rows without duplicate source coverage, automatic progress rows, no annotation payload creation, admin isolation, anon/authenticated read/write/RPC denial, same-user idempotency, competing-user rejection, expired/unknown/inactive-project invitations, invalid identity values, claim rollback, attempt limits, seat/action isolation and a fresh minute bucket.

The focused database suite is the scope of this subtask; the coordinating implementation runs the full project suite. PGlite queues requests within one process, so the queued tests verify serialized outcomes and transaction atomicity, not a multi-connection PostgreSQL stress test. Real Supabase Auth/PostgREST/RLS/Realtime and concurrent cloud registration have not been run by this database subtask. No remote tools, research files, real source rows or cloud deployment were used.
