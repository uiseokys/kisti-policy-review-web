export type Seat = 'member1' | 'member2' | 'member3' | 'admin';
export type Action = 'register' | 'login';

export interface InviteRow {
  id: string;
  project_id: string;
  seat: Seat;
  expires_at: string;
  user_id: string | null;
  display_name: string | null;
  login_email: string | null;
}

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

/** Supabase injects modern key dictionaries; older local stacks may inject legacy keys. */
export function resolveServerKeys(env: Record<string, string | undefined>): { publicKey: string; adminKey: string } | null {
  const defaultKey = (raw: string | undefined, prefix: string): string | null => {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const key = (parsed as Record<string, unknown>).default;
      return typeof key === 'string' && key.startsWith(prefix) && key.length > prefix.length && key.trim() === key
        ? key : null;
    } catch { return null; }
  };
  const legacyKey = (value: string | undefined): string | null =>
    value && value.trim() === value ? value : null;
  const publicKey = defaultKey(env.SUPABASE_PUBLISHABLE_KEYS, 'sb_publishable_') ?? legacyKey(env.SUPABASE_ANON_KEY);
  const adminKey = defaultKey(env.SUPABASE_SECRET_KEYS, 'sb_secret_') ?? legacyKey(env.SUPABASE_SERVICE_ROLE_KEY);
  return publicKey && adminKey ? { publicKey, adminKey } : null;
}

/** All privileged operations live in the Edge entry point's service-role client. */
export interface TeamAccessServices {
  getActiveProject(): Promise<string | null>;
  getInviteByHash(projectId: string, seat: Seat, tokenHash: string): Promise<InviteRow | null>;
  getInviteBySeat(projectId: string, seat: Seat): Promise<InviteRow | null>;
  getInviteById(inviteId: string): Promise<InviteRow | null>;
  takeAttempt(seat: Seat, action: Action): Promise<boolean>;
  createUser(email: string, password: string, displayName: string): Promise<string>;
  claimInvite(inviteId: string, userId: string, displayName: string, email: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  signIn(email: string, password: string): Promise<SessionTokens>;
  randomUUID(): string;
}

interface Options { appOrigin: string | undefined; now?: () => Date }
interface Input { action: Action; seat: Seat; name: string; password: string; invite?: string }

const seats = new Set<Seat>(['member1', 'member2', 'member3', 'admin']);
const fieldNames = new Set(['action', 'seat', 'name', 'password', 'invite']);
const credentialError = 'Invalid seat, name, or password.';
const invitationError = 'Invalid or expired invitation.';
const unavailableError = 'Team access is temporarily unavailable.';

function normalizeName(value: string): string { return value.normalize('NFC').trim(); }

function parseInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !fieldNames.has(key))) return null;
  if (body.action !== 'register' && body.action !== 'login') return null;
  if (!seats.has(body.seat as Seat)) return null;
  if (typeof body.name !== 'string' || typeof body.password !== 'string') return null;
  const name = normalizeName(body.name);
  const nameLength = Array.from(name).length;
  const passwordLength = Array.from(body.password).length;
  if (nameLength < 2 || nameLength > 40 || passwordLength < 8 || passwordLength > 128) return null;
  if (/[\u0000-\u001f\u007f]/u.test(name)) return null;
  if (body.action === 'register') {
    if (typeof body.invite !== 'string' || body.invite.length < 32 || body.invite.length > 512) return null;
    return { action: body.action, seat: body.seat as Seat, name, password: body.password, invite: body.invite };
  }
  if ('invite' in body) return null;
  return { action: body.action, seat: body.seat as Seat, name, password: body.password };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validOrigin(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.origin === value && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function createTeamAccessHandler(services: TeamAccessServices, options: Options) {
  const appOrigin = options.appOrigin;
  const now = options.now ?? (() => new Date());
  return async function handle(request: Request): Promise<Response> {
    const allowedOrigin = validOrigin(appOrigin) && request.headers.get('Origin') === appOrigin;
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = appOrigin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    }
    const respond = (status: number, body: object) => new Response(JSON.stringify(body), {
      status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
    });
    if (!validOrigin(appOrigin)) return respond(503, { error: unavailableError });
    if (!allowedOrigin) return respond(403, { error: 'Origin not allowed.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' });

    let input: Input | null;
    try { input = parseInput(await request.json()); }
    catch { input = null; }
    if (!input) return respond(400, { error: 'Invalid request.' });

    try {
      const projectId = await services.getActiveProject();
      if (!projectId) return respond(503, { error: unavailableError });

      if (input.action === 'login') {
        // Count every validly shaped login before checking a name or password.
        const allowed = await services.takeAttempt(input.seat, 'login');
        if (!allowed) return respond(429, { error: 'Too many attempts. Please try again later.' });
        const row = await services.getInviteBySeat(projectId, input.seat);
        if (!row || !row.user_id || !row.display_name || !row.login_email ||
            normalizeName(row.display_name).toLowerCase() !== input.name.toLowerCase()) {
          return respond(401, { error: credentialError });
        }
        try {
          const tokens = await services.signIn(row.login_email, input.password);
          return respond(200, tokens);
        } catch { return respond(401, { error: credentialError }); }
      }

      const tokenHash = await sha256Hex(input.invite!);
      const row = await services.getInviteByHash(projectId, input.seat, tokenHash);
      if (!row || row.project_id !== projectId || row.seat !== input.seat || row.user_id ||
          !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now().getTime()) {
        return respond(400, { error: invitationError });
      }
      // Unknown invitations never consume the seat's shared rate limit.
      const allowed = await services.takeAttempt(input.seat, 'register');
      if (!allowed) return respond(429, { error: 'Too many attempts. Please try again later.' });

      const email = `review-${services.randomUUID()}@kisti-review.invalid`;
      const userId = await services.createUser(email, input.password, input.name);
      try {
        await services.claimInvite(row.id, userId, input.name, email);
      } catch {
        // A failed transport acknowledgement does not prove the transaction ended.
        // A plain re-read can see null while the claim is still committing.
        let current: InviteRow | null;
        try { current = await services.getInviteById(row.id); }
        catch { return respond(503, { error: unavailableError }); }
        if (!current?.user_id) return respond(503, { error: unavailableError });
        if (current.user_id !== userId) {
          try { await services.deleteUser(userId); }
          catch { return respond(503, { error: unavailableError }); }
          return respond(400, { error: invitationError });
        }
      }
      try {
        const tokens = await services.signIn(email, input.password);
        return respond(200, tokens);
      } catch { return respond(503, { error: unavailableError }); }
    } catch { return respond(503, { error: unavailableError }); }
  };
}
