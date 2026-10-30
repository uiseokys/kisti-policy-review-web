import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

type AssignmentRow = {
  role_code: string;
  kind: string;
  total: number;
  actual: number;
  first_id: string;
  last_id: string;
  first_position: number;
  last_position: number;
};

const reviewerIds = [1, 2, 3].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const adminId = '00000000-0000-4000-8000-000000000009';
const expectedGroups = [
  { source: 'R1', kind: 'blind', counts: [27, 27, 27], size: 81, bounds: [[1, 27], [28, 54], [55, 81]] },
  { source: 'R2', kind: 'blind', counts: [8, 8, 8], size: 24, bounds: [[1, 8], [9, 16], [17, 24]] },
  { source: 'H1', kind: 'e3b', counts: [23, 23, 22], size: 68, bounds: [[1, 23], [24, 46], [47, 68]] },
  { source: 'R1_DEDUP', kind: 'dedup', counts: [3, 2, 3], size: 8, bounds: [[1, 3], [4, 5], [6, 8]] },
  { source: 'S1', kind: 'sample', counts: [100, 100, 100], size: 300, bounds: [[1, 100], [101, 200], [201, 300]] },
  { source: 'C1', kind: 'committee', counts: [3, 4, 3], size: 10, bounds: [[1, 3], [4, 7], [8, 10]] },
] as const;

const fillSeedUsers = (path: string) => {
  let seed = readFileSync(path, 'utf8');
  for (let n = 1; n <= 6; n++) {
    const digit = String(n);
    const placeholder = `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
    seed = seed.replaceAll(placeholder, reviewerIds[(n - 1) % 3]);
  }
  return seed.replace("administrator uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'", `administrator uuid:='${adminId}'`);
};

describe('three-member synthetic split in PostgreSQL WASM', () => {
  let db: PGlite;
  let projectId: string;
  let assignments: AssignmentRow[];

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await db.exec(readFileSync('supabase/migrations/202610300001_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610300002_team_split.sql', 'utf8'));
    await db.exec(fillSeedUsers('supabase/seeds/synthetic_official.sql'));
    await db.exec(fillSeedUsers('supabase/seeds/synthetic_team_split.sql'));
    projectId = (await db.query<{ id: string }>(`select id from review_projects where name='Synthetic team split pilot'`)).rows[0].id;
    assignments = (await db.query<AssignmentRow>(`select a.role_code,a.kind,a.total,count(i.*)::integer actual,
      min(i.item_id) first_id,max(i.item_id) last_id,min(i.position) first_position,max(i.position) last_position
      from review_assignments a join review_items i on i.assignment_id=a.id
      where a.project_id=$1 group by a.id order by a.role_code`, [projectId])).rows;
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it('keeps the official project and creates 18 balanced source assignments in a separate project', async () => {
    const projects = (await db.query<{ name: string; assignments: number }>(`select p.name,count(a.id)::integer assignments
      from review_projects p join review_assignments a on a.project_id=p.id group by p.id order by p.name`)).rows;
    expect(projects).toEqual([
      { name: 'Synthetic official pilot', assignments: 6 },
      { name: 'Synthetic team split pilot', assignments: 18 },
    ]);
    expect(assignments).toHaveLength(18);
    expect((await db.query<{ mode: string }>(`select distinct mode from review_assignments where project_id=$1`, [projectId])).rows).toEqual([{ mode: 'balanced' }]);
  });

  it('allocates exact counts with a continuous remainder cursor and matching kinds', () => {
    for (const group of expectedGroups) {
      for (let member = 1; member <= 3; member++) {
        const row = assignments.find((a) => a.role_code === `B${member}_${group.source}`);
        expect(row, `B${member}_${group.source}`).toMatchObject({ kind: group.kind, total: group.counts[member - 1], actual: group.counts[member - 1] });
      }
    }
    expect([1, 2, 3].map((member) => assignments.filter((a) => a.role_code.startsWith(`B${member}_`)).reduce((n, a) => n + a.total, 0))).toEqual([164, 164, 163]);
  });

  it('covers every original source row once in contiguous disjoint member slices', async () => {
    for (const group of expectedGroups) {
      const rows = assignments.filter((a) => a.role_code.endsWith(`_${group.source}`));
      expect(rows).toHaveLength(3);
      for (let member = 1; member <= 3; member++) {
        const row = rows.find((a) => a.role_code === `B${member}_${group.source}`)!;
        const [first, last] = group.bounds[member - 1];
        expect([row.first_id, row.last_id, row.first_position, row.last_position]).toEqual([
          `item-${String(first).padStart(3, '0')}`, `item-${String(last).padStart(3, '0')}`, 1, group.counts[member - 1],
        ]);
      }
      const coverage = (await db.query<{ count: number; unique_count: number; first: string; last: string }>(`select count(*)::integer count,
        count(distinct i.item_id)::integer unique_count,min(i.item_id) first,max(i.item_id) last
        from review_items i join review_assignments a on a.id=i.assignment_id
        where a.project_id=$1 and a.role_code in ($2,$3,$4)`, [projectId, ...[1, 2, 3].map((n) => `B${n}_${group.source}`)])).rows[0];
      expect(coverage).toEqual({ count: group.size, unique_count: group.size, first: 'item-001', last: `item-${String(group.size).padStart(3, '0')}` });
    }
  });

  it('allows owner saves at both slice edges but rejects another member item and assignment', async () => {
    const assignmentIds = (await db.query<{ role_code: string; id: string }>(`select role_code,id from review_assignments where project_id=$1 and role_code in ('B1_R1','B2_R1')`, [projectId])).rows;
    const owned = assignmentIds.find((a) => a.role_code === 'B2_R1')!.id;
    const other = assignmentIds.find((a) => a.role_code === 'B1_R1')!.id;
    await db.exec(`select set_config('request.jwt.claim.sub','${reviewerIds[1]}',false)`);
    const save = async (assignmentId: string, itemId: string) => (await db.query<{ result: { ok: boolean; type?: string } }>(
      `select public.save_review_annotation($1,$2,0,$3,'{"policy_discussion":"no"}'::jsonb) result`,
      [assignmentId, itemId, crypto.randomUUID()],
    )).rows[0].result;
    expect((await save(owned, 'item-028')).ok).toBe(true);
    expect((await save(owned, 'item-054')).ok).toBe(true);
    expect(await save(owned, 'item-027')).toMatchObject({ ok: false, type: 'forbidden' });
    expect(await save(owned, 'item-055')).toMatchObject({ ok: false, type: 'forbidden' });
    expect(await save(other, 'item-001')).toMatchObject({ ok: false, type: 'forbidden' });
  });

  it('enforces reviewer RLS while letting the administrator see all assignments and items', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub','${reviewerIds[1]}',false); set role authenticated`);
    expect((await db.query(`select * from review_assignments where project_id='${projectId}'`)).rows).toHaveLength(6);
    expect((await db.query(`select * from review_items where assignment_id in (select id from review_assignments where project_id='${projectId}')`)).rows).toHaveLength(164);
    await db.exec('reset role');
    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false); set role authenticated`);
    expect((await db.query(`select * from review_assignments where project_id='${projectId}'`)).rows).toHaveLength(18);
    expect((await db.query(`select * from review_items where assignment_id in (select id from review_assignments where project_id='${projectId}')`)).rows).toHaveLength(491);
    await db.exec('reset role');
  });

  it('retains legacy balanced codes and rejects a source role with the wrong kind', async () => {
    const probeProject = crypto.randomUUID();
    await db.query(`insert into review_projects(id,name) values($1,'Constraint probe')`, [probeProject]);
    await db.query(`insert into review_memberships values($1,$2,'reviewer')`, [probeProject, reviewerIds[0]]);
    await db.query(`insert into review_assignments(project_id,reviewer_id,role_code,kind,total,mode)
      values($1,$2,'B1_BLIND','blind',1,'balanced')`, [probeProject, reviewerIds[0]]);
    await expect(db.query(`insert into review_assignments(project_id,reviewer_id,role_code,kind,total,mode)
      values($1,$2,'B1_R1','e3b',1,'balanced')`, [probeProject, reviewerIds[0]])).rejects.toThrow(/review_assignments_check/);
    await expect(db.query(`insert into review_assignments(project_id,reviewer_id,role_code,kind,total,mode)
      values($1,$2,'B2_H1','blind',1,'balanced')`, [probeProject, reviewerIds[0]])).rejects.toThrow(/review_assignments_check/);
  });
});
