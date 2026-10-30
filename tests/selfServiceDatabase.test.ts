import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync } from 'node:fs';

const migration = 'supabase/migrations/202610300003_self_service.sql';
const project = '00000000-0000-4000-8000-000000000100';
const users = [1, 2, 3, 4].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const invitations = [11, 12, 13, 14].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const seats = ['member1', 'member2', 'member3', 'admin'];
const groups = [
  { source: 'R1', kind: 'blind', size: 81, counts: [27, 27, 27], bounds: [[1, 27], [28, 54], [55, 81]] },
  { source: 'R2', kind: 'blind', size: 24, counts: [8, 8, 8], bounds: [[1, 8], [9, 16], [17, 24]] },
  { source: 'H1', kind: 'e3b', size: 68, counts: [23, 23, 22], bounds: [[1, 23], [24, 46], [47, 68]] },
  { source: 'R1_DEDUP', kind: 'dedup', size: 8, counts: [3, 2, 3], bounds: [[1, 3], [4, 5], [6, 8]] },
  { source: 'S1', kind: 'sample', size: 300, counts: [100, 100, 100], bounds: [[1, 100], [101, 200], [201, 300]] },
  { source: 'C1', kind: 'committee', size: 10, counts: [3, 4, 3], bounds: [[1, 3], [4, 7], [8, 10]] },
] as const;

describe('private self-service access in PostgreSQL WASM', () => {
  let db: PGlite;
  const claim = (index: number, user: string | null = users[index], name: string | null = '연구원', email: string | null = `review-${users[index]}@kisti-review.invalid`) =>
    db.query('select public.claim_review_access($1,$2,$3,$4)', [invitations[index], user, name, email]);

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    await db.exec(readFileSync('supabase/migrations/202610300001_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610300002_team_split.sql', 'utf8'));
    if (existsSync(migration)) await db.exec(readFileSync(migration, 'utf8'));
  }, 30000);
  beforeEach(async () => {
    await db.exec('reset role; truncate review_projects cascade');
  });
  afterAll(async () => { await db?.close(); });

  const setup = async () => {
    await db.query('insert into review_projects(id,name) values($1,$2)', [project, 'Synthetic self-service test']);
    await db.query('insert into review_access_settings(project_id) values($1)', [project]);
    for (let i = 0; i < 4; i++) {
      await db.query(`insert into review_access_invites(id,project_id,seat,token_hash,expires_at)
        values($1,$2,$3,$4,now()+interval '1 day')`, [invitations[i], project, seats[i], String(i + 1).repeat(64)]);
    }
    await db.exec('set role service_role');
  };

  it('creates the three private RLS tables', async () => {
    const rows = (await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname,relrowsecurity
      from pg_class where relnamespace='public'::regnamespace and relname like 'review_access_%' and relkind='r' order by relname`)).rows;
    expect(rows).toEqual(['review_access_attempts', 'review_access_invites', 'review_access_settings'].map(relname => ({ relname, relrowsecurity: true })));
  });

  it('claims three reviewer seats with six assignments each and all 491 disjoint source rows', async () => {
    await setup();
    for (let i = 0; i < 3; i++) await claim(i);
    const assignments = (await db.query<{ role_code: string; kind: string; total: number; actual: number; first_id: string; last_id: string; first_position: number; last_position: number; reviewer_id: string; mode: string }>(`select a.role_code,a.kind,a.total,a.mode,a.reviewer_id,count(i.*)::integer actual,
      min(i.item_id) first_id,max(i.item_id) last_id,min(i.position) first_position,max(i.position) last_position
      from review_assignments a join review_items i on i.assignment_id=a.id where a.project_id=$1 group by a.id`, [project])).rows;
    expect(assignments).toHaveLength(18);
    for (const group of groups) {
      for (let member = 0; member < 3; member++) {
        const [first, last] = group.bounds[member];
        expect(assignments.find(a => a.role_code === `B${member + 1}_${group.source}`)).toEqual({
          role_code: `B${member + 1}_${group.source}`, kind: group.kind, mode: 'balanced', reviewer_id: users[member],
          total: group.counts[member], actual: group.counts[member], first_position: 1, last_position: group.counts[member],
          first_id: `item-${String(first).padStart(3, '0')}`, last_id: `item-${String(last).padStart(3, '0')}`,
        });
      }
      const coverage = (await db.query(`select count(*)::integer total,count(distinct i.item_id)::integer unique_count
        from review_items i join review_assignments a on a.id=i.assignment_id
        where a.project_id=$1 and a.role_code=any($2::text[])`, [project, [1, 2, 3].map(n => `B${n}_${group.source}`)])).rows[0];
      expect(coverage).toEqual({ total: group.size, unique_count: group.size });
    }
    expect(users.slice(0, 3).map(user => assignments.filter(a => a.reviewer_id === user).reduce((sum, a) => sum + a.total, 0))).toEqual([164, 164, 163]);
    expect((await db.query('select * from review_items')).rows).toHaveLength(491);
    expect((await db.query('select * from review_progress')).rows).toHaveLength(18);
    expect((await db.query('select * from review_annotations')).rows).toHaveLength(0);
    expect((await db.query('select distinct role from review_memberships')).rows).toEqual([{ role: 'reviewer' }]);
  });

  it('grants the admin invitation only admin membership without reviewer assignments', async () => {
    await setup(); await claim(3);
    expect((await db.query('select * from review_memberships')).rows).toEqual([{ project_id: project, user_id: users[3], role: 'admin' }]);
    expect((await db.query('select * from review_assignments')).rows).toHaveLength(0);
    expect((await db.query('select user_id,display_name,login_email from review_access_invites where seat=$1', ['admin'])).rows[0]).toEqual({ user_id: users[3], display_name: '연구원', login_email: `review-${users[3]}@kisti-review.invalid` });
  });

  it('permits service access but denies anonymous and authenticated reads, writes and RPCs', async () => {
    await setup();
    expect((await db.query('select * from review_access_invites')).rows).toHaveLength(4);
    await db.query('update review_access_invites set display_name=null where id=$1', [invitations[0]]);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      for (const table of ['review_access_settings', 'review_access_invites', 'review_access_attempts']) {
        await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
        await expect(db.query(`delete from ${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(claim(0)).rejects.toThrow(/permission denied/);
      await expect(db.query("select take_review_access_attempt('member1','login')")).rejects.toThrow(/permission denied/);
    }
  });

  it('returns idempotently for the same user and rejects a competing claim without altering the first account', async () => {
    await setup(); await claim(0);
    await claim(0, users[0], '다른 이름', 'changed@kisti-review.invalid');
    await expect(claim(0, users[1])).rejects.toThrow(/claimed/i);
    expect((await db.query('select user_id,display_name from review_access_invites where id=$1', [invitations[0]])).rows[0]).toEqual({ user_id: users[0], display_name: '연구원' });
    expect((await db.query('select * from review_memberships')).rows).toHaveLength(1);
    expect((await db.query('select * from review_assignments')).rows).toHaveLength(6);
    expect((await db.query('select * from review_items')).rows).toHaveLength(164);
  });

  it('admits only one of queued competing users for a single invitation', async () => {
    await setup();
    const results = await Promise.allSettled(users.map(user => claim(0, user)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(3);
    expect((await db.query('select * from review_memberships')).rows).toHaveLength(1);
    expect((await db.query('select * from review_assignments')).rows).toHaveLength(6);
    expect((await db.query('select * from review_items')).rows).toHaveLength(164);
  });

  it('rejects expired and inactive-project invitations without partial membership or claim', async () => {
    await setup();
    await db.query("update review_access_invites set expires_at=now()-interval '1 second' where id=$1", [invitations[0]]);
    await expect(claim(0)).rejects.toThrow(/expired/i);
    const other = crypto.randomUUID();
    await db.query("insert into review_projects(id,name) values($1,'Other synthetic project')", [other]);
    await db.query('update review_access_settings set project_id=$1', [other]);
    await expect(claim(1)).rejects.toThrow(/unavailable|active/i);
    await expect(db.query('select claim_review_access($1,$2,$3,$4)', [crypto.randomUUID(), users[1], '연구원', 'review-test@kisti-review.invalid'])).rejects.toThrow(/unavailable/i);
    expect((await db.query('select * from review_memberships')).rows).toHaveLength(0);
    expect((await db.query('select * from review_access_invites where user_id is not null')).rows).toHaveLength(0);
  });

  it('validates user, display name and internal login email before changing a claim', async () => {
    await setup();
    for (const name of [null, '', ' ', '\t\n', '가', '가'.repeat(41)]) await expect(claim(0, users[0], name)).rejects.toThrow(/invalid/i);
    for (const email of [null, '', '@kisti-review.invalid', 'x@other.invalid', 'x y@kisti-review.invalid']) await expect(claim(0, users[0], '연구원', email)).rejects.toThrow(/invalid/i);
    for (const user of [null, '00000000-0000-0000-0000-000000000000']) await expect(claim(0, user)).rejects.toThrow(/invalid/i);
    expect((await db.query('select * from review_memberships')).rows).toHaveLength(0);
    expect((await db.query('select * from review_access_invites where user_id is not null')).rows).toHaveLength(0);
  });

  it('rolls back the entire invitation claim when membership creation fails', async () => {
    await setup();
    await db.query("insert into review_memberships values($1,$2,'admin')", [project, users[0]]);
    await expect(claim(0)).rejects.toThrow();
    expect((await db.query('select user_id from review_access_invites where id=$1', [invitations[0]])).rows).toEqual([{ user_id: null }]);
    expect((await db.query('select * from review_assignments')).rows).toHaveLength(0);
  });

  it('atomically limits each seat/action and resets the window without counting another seat', async () => {
    await setup();
    const take = async (seat: string, action: string) => (await db.query<{ allowed: boolean }>('select take_review_access_attempt($1,$2) allowed', [seat, action])).rows[0].allowed;
    // A fixed transaction timestamp keeps this test independent of a wall-clock minute boundary.
    await db.exec('begin');
    try {
      expect(await Promise.all(Array.from({ length: 18 }, () => take('member1', 'login')))).toEqual([...Array(10).fill(true), ...Array(8).fill(false)]);
      expect(await Promise.all(Array.from({ length: 9 }, () => take('member1', 'register')))).toEqual([...Array(5).fill(true), ...Array(4).fill(false)]);
      expect(await take('member2', 'login')).toBe(true);
      expect(await take('admin', 'register')).toBe(true);
      await db.exec("update review_access_attempts set bucket=bucket-interval '1 minute'");
      expect(await take('member1', 'login')).toBe(true);
    } finally { await db.exec('rollback'); }
    await expect(take('owner', 'login')).rejects.toThrow(/invalid/i);
    await expect(take('member1', 'delete')).rejects.toThrow(/invalid/i);
    await db.exec('delete from review_access_settings');
    expect(await take('member1', 'login')).toBe(false);
  });
});
