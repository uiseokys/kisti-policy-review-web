import { afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, mkdtempSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
// @ts-expect-error The CLI is a plain Node ESM module without a declaration file.
import { buildTeamSeed } from '../scripts/prepare-supabase.mjs';

const ids = {
  KISTI_REVIEWER_1_ID: '00000000-0000-4000-8000-000000000001',
  KISTI_REVIEWER_2_ID: '00000000-0000-4000-8000-000000000002',
  KISTI_REVIEWER_3_ID: '00000000-0000-4000-8000-000000000003',
  KISTI_ADMIN_ID: '00000000-0000-4000-8000-000000000009',
};
const script = resolve('scripts/prepare-supabase.mjs');
const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('local Supabase team seed preparation', () => {
  it('rejects missing, repeated, malformed, nil and template UUIDs', () => {
    expect(() => buildTeamSeed({ ...ids, KISTI_REVIEWER_3_ID: '' })).toThrow(/KISTI_REVIEWER_3_ID/);
    expect(() => buildTeamSeed({ ...ids, KISTI_ADMIN_ID: ids.KISTI_REVIEWER_1_ID })).toThrow(/distinct/i);
    expect(() => buildTeamSeed({ ...ids, KISTI_REVIEWER_2_ID: 'not-a-uuid' })).toThrow(/KISTI_REVIEWER_2_ID/);
    expect(() => buildTeamSeed({ ...ids, KISTI_REVIEWER_1_ID: '00000000-0000-0000-0000-000000000000' })).toThrow(/KISTI_REVIEWER_1_ID/);
    expect(() => buildTeamSeed({ ...ids, KISTI_ADMIN_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).toThrow(/KISTI_ADMIN_ID/);
  });

  it('replaces only declaration UUIDs and leaves the template guard intact', () => {
    const sql = buildTeamSeed(ids);
    for (const id of Object.values(ids)) expect(sql).toContain(id);
    expect(sql).toContain("if administrator='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
    expect(sql).toContain("or left(reviewers[1]::text,8)=repeat('1',8)");
    expect(sql).not.toContain("administrator uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
    expect(sql).not.toContain("'11111111-1111-4111-8111-111111111111'::uuid");
  });

  it('applies the actual migrations and generated seed to PostgreSQL/WASM with 18 own assignments and 164/164/163 items', async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create schema auth;
        create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
      await db.exec(readFileSync('supabase/migrations/202610300001_review.sql', 'utf8'));
      await db.exec(readFileSync('supabase/migrations/202610300002_team_split.sql', 'utf8'));
      await expect(db.exec(readFileSync('supabase/seeds/synthetic_team_split.sql', 'utf8')))
        .rejects.toThrow(/Replace template UUIDs/);
      await db.exec('rollback');
      await db.exec(buildTeamSeed(ids));
      const rows = (await db.query<{ reviewer_id: string; assignments: number; items: number }>(`
        select a.reviewer_id::text, count(distinct a.id)::integer assignments, count(i.item_id)::integer items
        from review_assignments a join review_items i on i.assignment_id=a.id
        join review_projects p on p.id=a.project_id
        where p.name='Synthetic team split pilot' group by a.reviewer_id order by a.reviewer_id`)).rows;
      expect(rows).toEqual([
        { reviewer_id: ids.KISTI_REVIEWER_1_ID, assignments: 6, items: 164 },
        { reviewer_id: ids.KISTI_REVIEWER_2_ID, assignments: 6, items: 164 },
        { reviewer_id: ids.KISTI_REVIEWER_3_ID, assignments: 6, items: 163 },
      ]);
    } finally { await db.close(); }
  }, 30000);

  it('loads local UUIDs, writes a private ignored seed, and refuses to overwrite it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kisti-bootstrap-'));
    tempDirs.push(dir);
    writeFileSync(join(dir, '.env.local'), Object.entries({ ...ids, KISTI_ADMIN_ID: '00000000-0000-4000-8000-000000000008' })
      .map(([key, value]) => `${key}=${value}`).join('\n'));
    const environment: NodeJS.ProcessEnv = { ...process.env, KISTI_ADMIN_ID: ids.KISTI_ADMIN_ID };
    for (const key of Object.keys(ids)) if (key !== 'KISTI_ADMIN_ID') delete environment[key];
    const first = spawnSync(process.execPath, [script], { cwd: dir, env: environment, encoding: 'utf8' });
    expect(first.status, first.stderr).toBe(0);
    const output = join(dir, 'local-data/supabase-team-seed.sql');
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(readFileSync(output, 'utf8')).toBe(buildTeamSeed(ids));
    const second = spawnSync(process.execPath, [script], { cwd: dir, env: environment, encoding: 'utf8' });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exists/i);
    expect(readFileSync(output, 'utf8')).toBe(buildTeamSeed(ids));
  });
});
