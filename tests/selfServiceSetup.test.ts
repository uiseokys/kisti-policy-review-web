import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error The generator is a plain Node ESM module without a declaration file.
import { buildSelfServiceSetup } from '../scripts/prepare-self-service.mjs';

const pageUrl = 'https://uiseokys.github.io/kisti-policy-review-web/';
const projectId = '00000000-0000-4000-8000-000000000010';
const script = resolve('scripts/prepare-self-service.mjs');
const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function invitationLinks(html: string) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    new URL(match[1].replaceAll('&amp;', '&')));
}

describe('self-service setup preparation', () => {
  it('stores four distinct 256-bit invitation hashes and no raw invitations in SQL', () => {
    const result = buildSelfServiceSetup({ pageUrl, projectId, now: new Date('2026-10-30T00:00:00.000Z') });
    const links = invitationLinks(result.html);
    expect(links).toHaveLength(4);
    const tokens = links.map((link) => new URLSearchParams(link.hash.slice(1)).get('join'));
    const seats = links.map((link) => new URLSearchParams(link.hash.slice(1)).get('seat'));
    expect(seats).toEqual(['member1', 'member2', 'member3', 'admin']);
    expect(new Set(tokens).size).toBe(4);
    for (const [index, token] of tokens.entries()) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token!, 'base64url')).toHaveLength(32);
      expect(result.sql).not.toContain(token!);
      const hash = createHash('sha256').update(token!).digest('hex');
      expect(result.sql).toContain(`'${seats[index]}', '${hash}'`);
      expect(links[index].origin + links[index].pathname).toBe(pageUrl);
    }
    expect(result.sql).toContain("'2026-11-06T00:00:00.000Z'::timestamptz");
    expect(result.sql).toContain(`'${projectId}'::uuid`);
    expect(result.sql).toMatch(/insert into public\.review_access_settings/i);
    expect(result.sql).toMatch(/insert into public\.review_access_invites/i);
    expect(result.sql).not.toMatch(/auth\.users|createUser|email_confirm/i);
  });

  it('rejects unsafe page URLs and malformed project IDs', () => {
    expect(() => buildSelfServiceSetup({ pageUrl: 'http://example.com/' })).toThrow(/HTTPS/i);
    expect(() => buildSelfServiceSetup({ pageUrl: `${pageUrl}#stale` })).toThrow(/fragment/i);
    expect(() => buildSelfServiceSetup({ pageUrl, projectId: "x'); drop table x;--" })).toThrow(/project ID/i);
  });

  it('writes private ignored files, does not print tokens, and refuses to overwrite either file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kisti-self-service-'));
    tempDirs.push(dir);
    const first = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    expect(first.status, first.stderr).toBe(0);
    const sqlPath = join(dir, 'local-data/self-service-setup.sql');
    const htmlPath = join(dir, 'local-data/participation-links.html');
    expect(existsSync(sqlPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    expect(statSync(sqlPath).mode & 0o777).toBe(0o600);
    expect(statSync(htmlPath).mode & 0o777).toBe(0o600);
    const sql = readFileSync(sqlPath, 'utf8');
    const html = readFileSync(htmlPath, 'utf8');
    for (const link of invitationLinks(html)) {
      const token = new URLSearchParams(link.hash.slice(1)).get('join')!;
      expect(sql).not.toContain(token);
      expect(first.stdout + first.stderr).not.toContain(token);
    }
    const second = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exist/i);
    expect(readFileSync(sqlPath, 'utf8')).toBe(sql);
    expect(readFileSync(htmlPath, 'utf8')).toBe(html);
  });

  it('does not create a partial setup when one destination already exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kisti-self-service-'));
    tempDirs.push(dir);
    const localDir = join(dir, 'local-data');
    mkdirSync(localDir);
    writeFileSync(join(localDir, 'participation-links.html'), 'existing');
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(localDir, 'self-service-setup.sql'))).toBe(false);
    expect(readFileSync(join(localDir, 'participation-links.html'), 'utf8')).toBe('existing');
  });
});
