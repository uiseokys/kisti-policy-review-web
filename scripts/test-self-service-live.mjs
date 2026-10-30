/** Explicit, resumable synthetic-only test of the deployed self-service path. */
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { buildSelfServiceSetup } from './prepare-self-service.mjs';

const origin = 'https://uiseokys.github.io';
const pageUrl = `${origin}/kisti-policy-review-web/`;
const projectRef = 'rokntsfyobsvfaqqkwtw';
const seats = ['member1', 'member2', 'member3', 'admin'];
const groups = [
  { role: 'R1', kind: 'blind', counts: [27, 27, 27] },
  { role: 'R2', kind: 'blind', counts: [8, 8, 8] },
  { role: 'H1', kind: 'e3b', counts: [23, 23, 22] },
  { role: 'R1_DEDUP', kind: 'dedup', counts: [3, 2, 3] },
  { role: 'S1', kind: 'sample', counts: [100, 100, 100] },
  { role: 'C1', kind: 'committee', counts: [3, 4, 3] },
];
const privateDir = resolve('local-data/live-test');
const statePath = join(privateDir, 'state.json');
const sqlPath = join(privateDir, 'setup-test.sql');
const linksPath = join(privateDir, 'participation-links.html');
const finalizePath = join(privateDir, 'finalize-test.sql');
const deactivatePath = join(privateDir, 'deactivate-test.sql');
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const itemPattern = /^item-(\d{3})$/;
let phase = 'startup';

class SafeError extends Error {}
function fail(code) { throw new SafeError(code); }
function requireResult(result, code) {
  if (result.error) fail(code);
  return result.data;
}
function ensure(condition, code) { if (!condition) fail(code); }
function privateWrite(path, content) {
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}
function saveState(state) {
  // The file already exists, so a temporary private file plus rename keeps resume data intact.
  const tmp = join(privateDir, `.state-${randomUUID()}`);
  privateWrite(tmp, `${JSON.stringify(state, null, 2)}\n`);
  try { renameSync(tmp, statePath); }
  catch (error) { rmSync(tmp, { force: true }); throw error; }
}

function readState() {
  if (!existsSync(statePath) || !existsSync(sqlPath) || !existsSync(linksPath)) fail('private preparation files missing');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  ensure(state.schema === 1 && uuidPattern.test(state.projectId) && state.pageUrl === pageUrl, 'invalid private state');
  ensure(seats.every(seat => state.profiles?.[seat]?.name?.startsWith('Synthetic ') && state.profiles[seat]?.password?.length >= 16 && state.profiles[seat]?.invite?.length >= 32), 'incomplete private state');
  return state;
}
function env() {
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      const value = match[2];
      process.env[match[1]] = ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value;
    }
  }
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  ensure(url && key, 'public Supabase configuration missing');
  ensure(new URL(url).hostname === `${projectRef}.supabase.co`, 'unexpected Supabase project');
  return { url, key };
}
function prepare() {
  phase = 'prepare';
  if (existsSync(privateDir)) fail('private test directory already exists');
  const setup = buildSelfServiceSetup({ pageUrl });
  const anchors = [...setup.html.matchAll(/<a href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
  ensure(anchors.length === 4, 'preparation link count');
  const profiles = {};
  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index];
    const link = new URL(anchors[index]);
    const params = new URLSearchParams(link.hash.slice(1));
    ensure(link.origin === origin && params.get('seat') === seat, 'preparation link mismatch');
    profiles[seat] = { name: `Synthetic ${seat} ${setup.projectId.slice(0, 8)}`, password: `Synthetic!${randomBytes(24).toString('base64url')}`, invite: params.get('join') };
  }
  mkdirSync(resolve('local-data'), { mode: 0o700, recursive: true });
  mkdirSync(privateDir, { mode: 0o700, recursive: false });
  privateWrite(sqlPath, setup.sql);
  privateWrite(linksPath, setup.html);
  privateWrite(statePath, `${JSON.stringify({ schema: 1, pageUrl, projectId: setup.projectId, expiresAt: setup.expiresAt, profiles, stage: 'prepared' }, null, 2)}\n`);
  console.log('PASS prepare: private setup SQL, four links, and resumable credentials written under local-data/live-test/. Apply setup-test.sql before --run.');
}
async function access(action, seat, profile, config) {
  const body = { action, seat, name: profile.name, password: profile.password };
  if (action === 'register') body.invite = profile.invite;
  const response = await fetch(`${config.url}/functions/v1/team-access`, {
    method: 'POST', headers: { Origin: origin, apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, tokens: data?.access_token && data?.refresh_token ? data : null };
}
async function makeSession(config, tokens) {
  const client = createClient(config.url, config.key, clientOptions);
  const session = requireResult(await client.auth.setSession(tokens), 'set session failed');
  ensure(session?.user?.id && uuidPattern.test(session.user.id), 'invalid session identity');
  return { client, userId: session.user.id };
}
async function registerOrLogin(config, state, seat) {
  const profile = state.profiles[seat];
  let result = await access('login', seat, profile, config);
  if (result.status !== 200) {
    result = await access('register', seat, profile, config);
    if (result.status !== 200) result = await access('login', seat, profile, config);
  }
  ensure(result.status === 200 && result.tokens, `self-service ${seat} unavailable`);
  return makeSession(config, result.tokens);
}
function assignmentsFor(seat, rows) {
  const index = Number(seat.slice(-1));
  return groups.map(group => {
    const row = rows.find(value => value.role_code === `B${index}_${group.role}`);
    ensure(row && row.kind === group.kind && row.mode === 'balanced' && row.total === group.counts[index - 1], 'assignment allocation mismatch');
    return row;
  });
}
async function getAssignments(sessions, state) {
  const assignments = {};
  for (const seat of seats) {
    const rows = requireResult(await sessions[seat].client.from('review_assignments').select('id,project_id,reviewer_id,role_code,kind,total,mode,submitted_at').eq('project_id', state.projectId), 'assignment read failed');
    if (seat === 'admin') {
      ensure(rows.length === 18 && rows.every(row => row.project_id === state.projectId), 'admin assignment visibility');
      assignments.admin = rows;
    } else {
      ensure(rows.length === 6 && rows.every(row => row.reviewer_id === sessions[seat].userId), 'member assignment visibility');
      assignments[seat] = assignmentsFor(seat, rows);
    }
  }
  ensure([1, 2, 3].every((number, index) => assignments[`member${number}`].reduce((sum, row) => sum + row.total, 0) === [164, 164, 163][index]), 'member totals');
  const join = requireResult(await sessions.admin.client.from('review_assignments').select('id,project_id,review_projects!inner(id,dataset_class,blind_closed)').eq('project_id', state.projectId), 'admin project join failed');
  ensure(join.length === 18 && join.every(row => row.review_projects?.id === state.projectId && row.review_projects?.dataset_class === 'synthetic'), 'admin project join mismatch');
  for (const group of groups) {
    let start = 1;
    for (let number = 1; number <= 3; number++) {
      const row = assignments[`member${number}`].find(value => value.role_code === `B${number}_${group.role}`);
      const items = requireResult(await sessions[`member${number}`].client.from('review_items').select('item_id,position').eq('assignment_id', row.id).order('position'), 'item read failed');
      ensure(items.length === row.total && items.every((item, position) => item.position === position + 1 && Number(item.item_id.match(itemPattern)?.[1]) === start + position), 'source range mismatch');
      start += row.total;
    }
    ensure(start === group.counts.reduce((sum, count) => sum + count, 0) + 1, 'group source total');
  }
  console.log('PASS access: four self-service sessions; 18 assignments; member totals 164/164/163; six disjoint source ranges.');
  return assignments;
}
const fullLabels = kind => ({ blind: { policy_discussion: 'yes', act: 'inquiry', evidence_supports: 'yes' }, e3b: { policy_discussion: 'yes', evidence_supports: 'yes' }, dedup: { same_policy: 'no' }, sample: { policy_named: 'yes', policy_name: 'Synthetic policy', act: 'inquiry' }, committee: { committee_ok: 'yes' } })[kind];
const save = async (client, row, item, version, labels, mutation = randomUUID()) => requireResult(await client.rpc('save_review_annotation', { p_assignment_id: row.id, p_item_id: item, p_expected_version: version, p_mutation_id: mutation, p_labels: labels }), 'save RPC failed');
const report = async (client, row, device, pending, state, sequence) => requireResult(await client.rpc('report_review_sync_state', { p_assignment_id: row.id, p_device_id: device, p_pending: pending, p_state: state, p_sequence: sequence }), 'sync report failed');
const progress = async (client, row) => {
  const values = requireResult(await client.from('review_progress').select('*').eq('assignment_id', row.id), 'progress read failed');
  ensure(values.length === 1, 'progress row missing');
  return values[0];
};
async function subscribeOnce(client, row) {
  let resolveEvent;
  const event = new Promise(resolve => { resolveEvent = resolve; });
  const channel = client.channel(`synthetic-${randomUUID()}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'review_progress', filter: `assignment_id=eq.${row.id}` }, payload => resolveEvent(payload));
  try {
    await new Promise((resolveSub, rejectSub) => {
      const timer = setTimeout(() => rejectSub(new SafeError('realtime subscription timeout')), 20000);
      try {
        channel.subscribe(status => {
          if (status === 'SUBSCRIBED') { clearTimeout(timer); resolveSub(); }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); rejectSub(new SafeError(`realtime ${status}`)); }
        });
      } catch {
        clearTimeout(timer);
        rejectSub(new SafeError('realtime subscribe call failed'));
      }
    });
  } catch (error) {
    await client.removeChannel(channel).catch(() => {});
    throw error;
  }
  return { event, channel };
}
async function timedEvent(event) {
  let timer;
  try {
    return await Promise.race([event, new Promise((_, reject) => { timer = setTimeout(() => reject(new SafeError('realtime event timeout')), 20000); })]);
  } finally { clearTimeout(timer); }
}
async function specialChecks(sessions, assignments, state, config) {
  phase = 'special checks';
  const first = assignments.member1[0], r2 = assignments.member2[1], h1 = assignments.member3[2];
  const member = sessions.member1.client, other = sessions.member2.client, admin = sessions.admin.client;
  const pickUnused = async (client, row, start, end) => {
    const existing = requireResult(await client.from('review_annotations').select('item_id').eq('assignment_id', row.id), 'probe annotation read failed');
    const used = new Set(existing.map(value => value.item_id));
    for (let number = start; number <= end; number++) {
      const candidate = `item-${String(number).padStart(3, '0')}`;
      if (!used.has(candidate)) return candidate;
    }
    fail('probe item range exhausted');
  };
  const item = await pickUnused(member, first, 1, 27);
  const r2Item = await pickUnused(other, r2, 9, 16);
  const h1Item = await pickUnused(sessions.member3.client, h1, 47, 68);
  const baseline = await progress(admin, first);
  ensure(requireResult(await admin.from('review_annotations').select('item_id').eq('assignment_id', first.id), 'admin annotation read failed').length === 0, 'admin annotation visibility');
  ensure(requireResult(await other.from('review_annotations').select('item_id').eq('assignment_id', first.id), 'other annotation read failed').length === 0, 'other annotation visibility');
  ensure((await save(other, first, item, 0, fullLabels('blind'))).type === 'forbidden', 'cross-member save allowed');
  ensure((await save(admin, first, item, 0, fullLabels('blind'))).type === 'forbidden', 'admin save allowed');
  ensure((await other.from('review_annotations').insert({ assignment_id: first.id, item_id: item, reviewer_id: sessions.member2.userId, labels: fullLabels('blind') })).error, 'direct annotation write allowed');
  ensure((await other.from('review_assignments').insert({ project_id: state.projectId, reviewer_id: sessions.member2.userId, role_code: 'R1', kind: 'blind', total: 1 })).error, 'direct assignment write allowed');
  const second = await access('login', 'member1', state.profiles.member1, config);
  ensure(second.status === 200 && second.tokens, 'second login failed');
  const secondDevice = await makeSession(config, second.tokens);
  phase = 'Realtime subscription';
  const { event, channel } = await subscribeOnce(admin, first);
  phase = 'special checks';
  try {
    const mutation = randomUUID(), secondMutation = randomUUID();
    const secondLabels = { policy_discussion: 'no' };
    const [a, b, c] = await Promise.all([
      save(member, first, item, 0, fullLabels('blind'), mutation),
      save(secondDevice.client, first, item, 0, secondLabels, secondMutation),
      save(other, r2, r2Item, 0, fullLabels('blind')),
    ]);
    ensure([a, b].filter(value => value.ok).length === 1 && [a, b].filter(value => value.type === 'conflict').length === 1 && c.ok, 'concurrent CAS result');
    phase = 'Realtime event';
    const payload = await timedEvent(event);
    phase = 'special checks';
    ensure(payload?.new?.assignment_id === first.id && !('labels' in payload.new) && !('note' in payload.new), 'unsafe realtime payload');
    ensure(requireResult(await other.from('review_annotations').select('item_id').eq('assignment_id', first.id), 'other annotation read failed').length === 0, 'other member read allowed');
    ensure(requireResult(await admin.from('review_annotations').select('item_id').eq('assignment_id', first.id), 'admin annotation read failed').length === 0, 'admin direct read allowed');
    const replay = a.ok
      ? await save(member, first, item, 0, fullLabels('blind'), mutation)
      : await save(secondDevice.client, first, item, 0, secondLabels, secondMutation);
    ensure(replay.ok && replay.annotation.version === 1, 'idempotent replay');
    ensure((await save(member, first, item, 0, fullLabels('blind'))).type === 'conflict', 'stale CAS accepted');
    const row = requireResult(await member.from('review_annotations').select('version').eq('assignment_id', first.id).eq('item_id', item), 'annotation read failed')[0];
    ensure(row.version === 1, 'initial annotation version');
    ensure((await save(member, first, item, 1, { policy_discussion: 'yes' })).ok, 'partial save failed');
    let p = await progress(admin, first);
    ensure(p.complete === baseline.complete && p.in_progress === baseline.in_progress + 1, 'partial counted complete');
    ensure((await save(member, first, item, 2, {})).ok, 'downgrade save failed');
    p = await progress(admin, first);
    ensure(p.complete === baseline.complete && p.in_progress === baseline.in_progress && p.untouched === baseline.untouched, 'downgrade progress mismatch');
    ensure((await member.rpc('submit_review_assignment', { p_assignment_id: first.id })).error, 'incomplete submit allowed');
    ensure((await save(member, first, item, 3, fullLabels('blind'))).ok, 'restore save failed');
    const device = randomUUID();
    await report(member, first, device, 0, 'saved', 1);
    await report(member, first, device, 1, 'pending', 2);
    await report(member, first, device, 0, 'saved', 1);
    p = await progress(admin, first);
    ensure(p.last_sync_state === 'pending' && p.last_seen_at, 'stale sync sequence accepted');
    await report(member, first, device, 0, 'conflict', 3);
    ensure((await progress(admin, first)).last_sync_state === 'conflict', 'sync conflict not visible');
    await report(member, first, device, 0, 'saved', 4);
    ensure((await progress(admin, first)).last_sync_state === 'saved', 'sync recovery failed');
    const h1First = await save(sessions.member3.client, h1, h1Item, 0, fullLabels('e3b'));
    ensure(h1First.ok, 'third member save failed');
    const relogin = await access('login', 'member3', state.profiles.member3, config);
    ensure(relogin.status === 200 && relogin.tokens, 'returning access failed');
    const fresh = await makeSession(config, relogin.tokens);
    const restored = requireResult(await fresh.client.from('review_annotations').select('labels').eq('assignment_id', h1.id), 'returning annotation read failed');
    ensure(restored.some(value => value.labels.policy_discussion === 'yes'), 'returning state not restored');
    await fresh.client.auth.signOut();
  } finally {
    await admin.removeChannel(channel).catch(() => {});
    await secondDevice.client.auth.signOut();
  }
  state.stage = 'special'; saveState(state);
  console.log('PASS RPC: RLS, concurrent R1/R2 saves, CAS, idempotency, downgrade, sync sequence, returning login, and safe admin Realtime.');
}
async function fillAndSubmit(sessions, assignments, state) {
  phase = 'fill and submit';
  const all = [1, 2, 3].flatMap(number => assignments[`member${number}`].map(row => ({ row, client: sessions[`member${number}`].client })));
  for (const { row, client } of all) {
    const items = requireResult(await client.from('review_items').select('item_id,position').eq('assignment_id', row.id).order('position'), 'fill item read failed');
    const annotations = requireResult(await client.from('review_annotations').select('item_id,version,labels').eq('assignment_id', row.id), 'fill annotation read failed');
    const current = new Map(annotations.map(value => [value.item_id, value]));
    const target = fullLabels(row.kind);
    const needed = items.filter(item => {
      const labels = current.get(item.item_id)?.labels;
      return !labels || Object.keys(labels).length !== Object.keys(target).length || Object.entries(target).some(([key, value]) => labels[key] !== value);
    });
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, needed.length) }, async () => {
      while (next < needed.length) {
        const item = needed[next++];
        const response = await save(client, row, item.item_id, current.get(item.item_id)?.version ?? 0, fullLabels(row.kind));
        ensure(response.ok, 'bulk save rejected');
      }
    }));
    const p = await progress(sessions.admin.client, row);
    ensure(p.complete === row.total && p.in_progress === 0 && p.untouched === 0, 'bulk progress mismatch');
  }
  const sum = all.reduce((total, value) => total + value.row.total, 0);
  ensure(sum === 491, 'aggregate item total');
  console.log('PASS fill: all 491 synthetic annotations complete across 18 assignments.');
  const first = assignments.member1[0];
  const pendingDevice = randomUUID();
  await report(sessions.member1.client, first, pendingDevice, 1, 'pending', 1);
  ensure((await sessions.member1.client.rpc('submit_review_assignment', { p_assignment_id: first.id })).error, 'pending submit allowed');
  await report(sessions.member1.client, first, pendingDevice, 0, 'saved', 2);
  for (const { row, client } of all) {
    requireResult(await client.rpc('submit_review_assignment', { p_assignment_id: row.id }), 'submit failed');
    ensure((await progress(sessions.admin.client, row)).submitted_at, 'submitted progress missing');
  }
  ensure((await save(sessions.member1.client, first, 'item-001', 0, fullLabels('blind'))).type === 'locked', 'post-submit save allowed');
  ensure((await sessions.admin.client.rpc('export_locked_annotations', { p_assignment_id: first.id })).error, 'early export allowed');
  ensure((await sessions.admin.client.from('review_projects').update({ blind_closed: true }).eq('id', state.projectId)).error, 'client blind close allowed');
  if (!existsSync(finalizePath)) privateWrite(finalizePath, `-- Apply only after --run passes. Closes the blind phase for this synthetic project.\nupdate public.review_projects set blind_closed = true where id = '${state.projectId}'::uuid and dataset_class = 'synthetic' and blind_closed = false;\n`);
  state.stage = 'submitted'; saveState(state);
  console.log('PASS submit: 18 locked assignments; pending and early export denied. Apply private finalize-test.sql, then run --export.');
}
async function exportChecks(sessions, assignments, state) {
  phase = 'export';
  ensure(state.stage === 'submitted' || state.stage === 'exported', 'run stage incomplete');
  const project = requireResult(await sessions.admin.client.from('review_projects').select('id,blind_closed,dataset_class').eq('id', state.projectId), 'project read failed');
  ensure(project.length === 1 && project[0].blind_closed && project[0].dataset_class === 'synthetic', 'finalize SQL not applied');
  const all = [1, 2, 3].flatMap(number => assignments[`member${number}`].map(row => ({ row, client: sessions[`member${number}`].client })));
  const exports = new Map();
  for (const { row } of all) {
    const data = requireResult(await sessions.admin.client.rpc('export_locked_annotations', { p_assignment_id: row.id }), 'locked export failed');
    ensure(data.length === row.total && data.every(value => value.reviewer_id === row.reviewer_id && value.version >= 1), 'locked export count mismatch');
    exports.set(row.id, data);
  }
  ensure([...exports.values()].reduce((sum, rows) => sum + rows.length, 0) === 491, 'export total mismatch');
  const foreign = await sessions.member2.client.rpc('export_locked_annotations', { p_assignment_id: assignments.member1[0].id });
  ensure(foreign.error, 'other member export allowed');
  ensure(requireResult(await sessions.admin.client.from('review_annotations').select('item_id').eq('assignment_id', assignments.member1[0].id), 'admin direct annotation read failed').length === 0, 'admin direct annotation read allowed');
  const byId = new Map();
  for (let number = 1; number <= 3; number++) {
    const row = assignments[`member${number}`][0];
    for (const annotation of exports.get(row.id)) {
      ensure(!byId.has(annotation.item_id), 'R1 duplicate source ID');
      byId.set(annotation.item_id, { annotation, reviewer: `Synthetic member ${number}` });
    }
  }
  ensure(byId.size === 81, 'R1 merged size');
  const original = [], merged = [];
  for (let index = 1; index <= 81; index++) {
    const id = `item-${String(index).padStart(3, '0')}`;
    const result = byId.get(id);
    ensure(result, 'R1 source gap');
    const source = { blind_id: id, name: `Synthetic policy ${index}`, aliases: 'Synthetic alias', evidence_1_source_ref: `synthetic:${index}`, evidence_1_quote: 'Synthetic quote,\nnext line', evidence_2_source_ref: `synthetic:${index}:2`, evidence_2_quote: 'Second synthetic quote', policy_discussion: '', act: '', evidence_supports: '', note: '', reviewer: '', label_source: 'human' };
    original.push(source);
    merged.push({ ...source, ...result.annotation.labels, reviewer: result.reviewer });
  }
  const temporary = mkdtempSync(join(tmpdir(), 'kisti-self-service-csv-'));
  try {
    const sourcePath = join(temporary, 'source.csv'), mergedPath = join(temporary, 'merged.csv');
    writeFileSync(sourcePath, Papa.unparse(original, { newline: '\r\n' }) + '\r\n', { mode: 0o600 });
    writeFileSync(mergedPath, Papa.unparse(merged, { newline: '\r\n' }) + '\r\n', { mode: 0o600 });
    const args = ['scripts/verify_csv.py', 'blind', '--sheet', sourcePath, '--labels', mergedPath];
    const researchRoot = join(homedir(), 'Developer/kisti-policy-analysis-2026-research-e');
    if (existsSync(join(researchRoot, 'docs/superpowers/reports/2026-10-28-e-realdata-guide/labels_check.py'))) args.push('--research-root', researchRoot);
    const result = JSON.parse(execFileSync('python3', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    ensure(result.accepted && result.rows === 81, 'synthetic CSV validation failed');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  if (!existsSync(deactivatePath)) privateWrite(deactivatePath, `-- Apply after --export passes; deactivate only this synthetic test project.\ndelete from public.review_access_settings where id = true and project_id = '${state.projectId}'::uuid;\n`);
  state.stage = 'exported'; saveState(state);
  console.log('PASS export: 491 locked annotations, R1 merged 81-row synthetic CSV, local/available official validator, and RLS. Private deactivate-test.sql is ready.');
}
async function run(mode) {
  if (process.env.RUN_SELF_SERVICE_INTEGRATION !== '1') {
    console.log('SKIP: live self-service integration requires RUN_SELF_SERVICE_INTEGRATION=1.');
    return;
  }
  const state = readState();
  const config = env();
  const sessions = {};
  try {
    phase = 'self-service access';
    if (mode === '--run' && state.stage === 'prepared') {
      const invalid = await access('register', 'member1', { ...state.profiles.member1, invite: randomBytes(32).toString('base64url') }, config);
      ensure(invalid.status === 400 && !invalid.tokens, 'unknown invitation accepted');
      const wrongSeat = await access('register', 'member1', { ...state.profiles.member1, invite: state.profiles.member2.invite }, config);
      ensure(wrongSeat.status === 400 && !wrongSeat.tokens, 'wrong-seat invitation accepted');
    }
    for (const seat of seats) sessions[seat] = await registerOrLogin(config, state, seat);
    if (mode === '--run' && state.stage === 'prepared') {
      const reused = await access('register', 'member1', state.profiles.member1, config);
      ensure(reused.status === 400 && !reused.tokens, 'claimed invitation reused');
    }
    const assignments = await getAssignments(sessions, state);
    if (mode === '--export') await exportChecks(sessions, assignments, state);
    else if (state.stage === 'exported') console.log('PASS run: previous live validation is complete.');
    else {
      if (state.stage === 'prepared') await specialChecks(sessions, assignments, state, config);
      if (state.stage === 'special') await fillAndSubmit(sessions, assignments, state);
      else if (state.stage === 'submitted') console.log('PASS run: submitted stage already complete; apply finalize-test.sql and run --export.');
    }
  } finally {
    await Promise.allSettled(Object.values(sessions).map(async session => {
      await session.client.removeAllChannels();
      await session.client.auth.signOut();
    }));
  }
}

const mode = process.argv[2];
if (process.argv.length !== 3 || !['--prepare', '--run', '--export'].includes(mode)) {
  console.error('Usage: node scripts/test-self-service-live.mjs --prepare|--run|--export');
  process.exitCode = 2;
} else {
  try { if (mode === '--prepare') prepare(); else await run(mode); }
  catch (error) {
    // Never print remote errors or thrown payloads: they may contain session material.
    const safe = error instanceof SafeError ? error.message : 'validation failed';
    console.error(`FAIL ${phase}: ${safe}`);
    process.exitCode = 1;
  }
}
