import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPageUrl = 'https://uiseokys.github.io/kisti-policy-review-web/';
const seats = ['member1', 'member2', 'member3', 'admin'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

/** Build a SQL bootstrap and private invitation sheet without writing either artifact. */
export function buildSelfServiceSetup({ pageUrl = defaultPageUrl, projectId = randomUUID(), now = new Date() } = {}) {
  let page;
  try { page = new URL(pageUrl); }
  catch { throw new Error('Page URL must be an absolute HTTPS URL'); }
  if (page.protocol !== 'https:' || page.username || page.password) {
    throw new Error('Page URL must be an absolute HTTPS URL without credentials');
  }
  if (page.hash) throw new Error('Page URL must not contain a fragment');
  if (page.search) throw new Error('Page URL must not contain a query');
  if (typeof projectId !== 'string' || !uuidPattern.test(projectId)) {
    throw new Error('Project ID must be a canonical UUID');
  }
  const started = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(started)) throw new Error('Current time must be a valid Date');
  const expiresAt = new Date(started + sevenDaysMs).toISOString();
  const invitations = seats.map((seat) => {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    const link = new URL(page.href);
    link.hash = new URLSearchParams({ join: token, seat }).toString();
    return { seat, token, hash, link: link.href };
  });

  // The singleton insert is the concurrency guard. A conflicting insert rolls back the transaction.
  const sql = `-- Private setup SQL. Contains only SHA-256 hashes of invitations, never raw tokens.
begin;
do $$ begin
  if exists (select 1 from public.review_access_settings) then
    raise exception 'A self-service review project is already active';
  end if;
end $$;
insert into public.review_projects (id, name, dataset_class)
values ('${projectId}'::uuid, 'Self-service synthetic team pilot', 'synthetic');
insert into public.review_access_settings (id, project_id)
values (true, '${projectId}'::uuid);
insert into public.review_access_invites (project_id, seat, token_hash, expires_at)
values
${invitations.map(({ seat, hash }) => `  ('${projectId}'::uuid, '${seat}', '${hash}', '${expiresAt}'::timestamptz)`).join(',\n')};
commit;
`;
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>연구팀 참여 링크</title>
</head>
<body>
  <h1>연구팀 참여 링크</h1>
  <p>각 담당자에게 해당 링크 하나만 개별 전달하세요. 링크는 ${expiresAt}에 만료됩니다.</p>
  <ul>
${invitations.map(({ seat, link }) => `    <li>${seat}: <a href="${link.replaceAll('&', '&amp;')}" referrerpolicy="no-referrer">참여하기</a></li>`).join('\n')}
  </ul>
</body>
</html>
`;
  return { projectId, expiresAt, sql, html };
}

/** Write each complete file by exclusive hard link, with rollback if the pair cannot be installed. */
export function writeSelfServiceSetup(outputDir, setup) {
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const sqlPath = join(outputDir, 'self-service-setup.sql');
  const htmlPath = join(outputDir, 'participation-links.html');
  if (existsSync(sqlPath) || existsSync(htmlPath)) {
    throw new Error('Private setup files already exist; refusing to overwrite them');
  }
  const stagingDir = mkdtempSync(join(outputDir, '.self-service-'));
  let installedSql = false;
  try {
    const stagedSql = join(stagingDir, 'self-service-setup.sql');
    const stagedHtml = join(stagingDir, 'participation-links.html');
    writeFileSync(stagedSql, setup.sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    writeFileSync(stagedHtml, setup.html, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    linkSync(stagedSql, sqlPath);
    installedSql = true;
    linkSync(stagedHtml, htmlPath);
  } catch (error) {
    if (installedSql) rmSync(sqlPath, { force: true });
    if (error?.code === 'EEXIST') throw new Error('Private setup files already exist; refusing to overwrite them');
    throw error;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
  return { sqlPath, htmlPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    writeSelfServiceSetup(join(process.cwd(), 'local-data'), buildSelfServiceSetup());
    console.log('Wrote private setup files under local-data/');
  } catch (error) {
    console.error(`Self-service preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
