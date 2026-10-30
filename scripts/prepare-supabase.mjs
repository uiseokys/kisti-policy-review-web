import { readFileSync, mkdirSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { parseEnv } from 'node:util';

const templatePath = import.meta.url.startsWith('file:')
  ? new NodeURL('../supabase/seeds/synthetic_team_split.sql', import.meta.url)
  : resolve('supabase/seeds/synthetic_team_split.sql');
const template = readFileSync(templatePath, 'utf8');
const names = ['KISTI_REVIEWER_1_ID', 'KISTI_REVIEWER_2_ID', 'KISTI_REVIEWER_3_ID', 'KISTI_ADMIN_ID'];
const placeholders = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function replaceDeclaration(sql, oldText, newText) {
  if (sql.split(oldText).length !== 2) throw new Error('Seed template declaration changed; inspect the template before generating SQL');
  return sql.replace(oldText, newText);
}

/** Build SQL for four existing Auth users without touching the template's safety guard. */
export function buildTeamSeed(ids) {
  const values = names.map((name) => {
    const value = ids?.[name];
    if (typeof value !== 'string' || !uuidPattern.test(value) || placeholders.includes(value)) {
      throw new Error(`${name} must be an existing canonical, non-template Auth UUID`);
    }
    return value;
  });
  if (new Set(values).size !== values.length) throw new Error('The three reviewer IDs and administrator ID must be distinct');

  let sql = template;
  for (let index = 0; index < 3; index++) {
    sql = replaceDeclaration(sql, `'${placeholders[index]}'::uuid`, `'${values[index]}'::uuid`);
  }
  sql = replaceDeclaration(sql, `administrator uuid:='${placeholders[3]}'`, `administrator uuid:='${values[3]}'`);
  return sql;
}

function localConfig() {
  let fileValues = {};
  try {
    fileValues = parseEnv(readFileSync(join(process.cwd(), '.env.local'), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name] ?? fileValues[name]]));
}

function main() {
  const sql = buildTeamSeed(localConfig());
  const output = join(process.cwd(), 'local-data', 'supabase-team-seed.sql');
  mkdirSync(join(process.cwd(), 'local-data'), { recursive: true });
  let fd;
  try {
    fd = openSync(output, 'wx', 0o600);
    writeFileSync(fd, sql, 'utf8');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Generated seed already exists: ${output}`);
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  console.log(`Wrote local seed: ${output}`);
}

if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`Bootstrap preparation failed: ${error.message}`); process.exitCode = 1; }
}
