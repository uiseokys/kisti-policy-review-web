# Three-member split: database implementation report

Status: implemented and verified locally against PGlite PostgreSQL. Remote Supabase was not configured or changed.

## Additive database changes

- `202610300002_team_split.sql` extends the balanced assignment role constraint to accept `B1_` through `B3_` with separate `R1`, `R2`, `H1`, `R1_DEDUP`, `S1`, and `C1` suffixes. Each new suffix is constrained to its source kind. Existing official roles and legacy balanced roles such as `B1_BLIND` remain valid.
- `synthetic_team_split.sql` is a separate optional seed. It requires replacement of three reviewer Auth UUID placeholders and one administrator Auth UUID placeholder. It creates a new project named **Synthetic team split pilot**, without updating existing projects or assignments.
- The seed uses a continuous round-robin remainder cursor across six source groups. Within each group, each reviewer receives a contiguous, non-overlapping source-row range. Item IDs retain source-row numbers (`item-001` through the group's final row); positions begin at 1 inside each assignment.

| Source | Kind | Member 1 | Member 2 | Member 3 |
| --- | --- | ---: | ---: | ---: |
| R1 | blind | 27 | 27 | 27 |
| R2 | blind | 8 | 8 | 8 |
| H1 | e3b | 23 | 23 | 22 |
| R1_DEDUP | dedup | 3 | 2 | 3 |
| S1 | sample | 100 | 100 | 100 |
| C1 | committee | 3 | 4 | 3 |
| **Total** | | **164** | **164** | **163** |

## Verification

- `tests/teamSplitDatabase.test.ts` applies the base migration, additive migration, official seed, and new seed to PGlite. It checks the separate projects, 18 assignment codes and kinds, exact count matrix, full unique coverage of all 491 source rows, contiguous member ranges, owner saves at both R1 slice edges, rejection of neighboring items and another member's assignment, reviewer/admin RLS visibility, legacy balanced role acceptance, and rejection of mismatched new role kinds.
- Focused test: 6 passed.
- Full local Vitest suite: 12 files, 49 tests passed.
- TypeScript check (`tsc --noEmit`): passed.

This verification used synthetic IDs only. No research data, real data files, cloud deployment, or remote database was accessed.
