import { describe, expect, it, vi } from 'vitest';
import { createTeamAccessHandler, resolveServerKeys, type TeamAccessServices } from '../supabase/functions/team-access/handler';

const origin = 'https://uiseokys.github.io';
const invite = 'a'.repeat(64);
const projectId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const claimedInvite = {
  id: '33333333-3333-4333-8333-333333333333', project_id: projectId,
  seat: 'member1' as const, expires_at: '2099-01-01T00:00:00.000Z',
  user_id: null, display_name: null, login_email: null
};

function fixture() {
  const services = {
    getActiveProject: vi.fn().mockResolvedValue(projectId),
    getInviteByHash: vi.fn().mockResolvedValue({ ...claimedInvite }),
    getInviteBySeat: vi.fn().mockResolvedValue({ ...claimedInvite, user_id: userId, display_name: '민지', login_email: 'review-stored@kisti-review.invalid' }),
    getInviteById: vi.fn().mockResolvedValue({ ...claimedInvite }),
    takeAttempt: vi.fn().mockResolvedValue(true),
    createUser: vi.fn().mockResolvedValue(userId),
    claimInvite: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue({ access_token: 'access', refresh_token: 'refresh' }),
    randomUUID: vi.fn().mockReturnValue('44444444-4444-4444-8444-444444444444')
  } satisfies TeamAccessServices;
  const handler = createTeamAccessHandler(services, { appOrigin: origin, now: () => new Date('2026-10-30T00:00:00.000Z') });
  const request = (body: unknown, requestOrigin = origin, method = 'POST') => handler(new Request('https://edge.example/team-access', {
    method, headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  }));
  return { services, handler, request };
}

describe('team-access edge handler', () => {
  it('prefers the default modern publishable and secret keys over legacy values', () => {
    expect(resolveServerKeys({
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_MODERN', alternate: 'sb_publishable_OTHER' }),
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_MODERN' }),
      SUPABASE_ANON_KEY: 'legacy-public', SUPABASE_SERVICE_ROLE_KEY: 'legacy-admin'
    })).toEqual({ publicKey: 'sb_publishable_MODERN', adminKey: 'sb_secret_MODERN' });
  });

  it('falls back per key when modern dictionaries are missing, malformed, or have an invalid default', () => {
    expect(resolveServerKeys({
      SUPABASE_PUBLISHABLE_KEYS: '{invalid json',
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_publishable_WRONG_ROLE' }),
      SUPABASE_ANON_KEY: 'legacy-public', SUPABASE_SERVICE_ROLE_KEY: 'legacy-admin'
    })).toEqual({ publicKey: 'legacy-public', adminKey: 'legacy-admin' });
    expect(resolveServerKeys({
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_MODERN' }),
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-admin'
    })).toEqual({ publicKey: 'sb_publishable_MODERN', adminKey: 'legacy-admin' });
  });

  it('fails closed when either modern and legacy key pair cannot provide both roles', () => {
    expect(resolveServerKeys({ SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_SECRET_KEYS: '[]' })).toBeNull();
    expect(resolveServerKeys({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_MODERN' }) })).toBeNull();
    expect(resolveServerKeys({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_MODERN' }) })).toBeNull();
  });

  it('denies a missing or foreign Origin before touching privileged services', async () => {
    const { services, handler, request } = fixture();
    expect((await request({ action: 'login', seat: 'member1', name: '민지', password: 'password123' }, 'https://evil.example')).status).toBe(403);
    expect((await handler(new Request('https://edge.example/team-access', { method: 'OPTIONS' }))).status).toBe(403);
    expect(services.getActiveProject).not.toHaveBeenCalled();
    const missingConfig = createTeamAccessHandler(services, { appOrigin: '' });
    expect((await missingConfig(new Request('https://edge.example/team-access', { method: 'OPTIONS', headers: { Origin: origin } }))).status).toBe(503);
  });

  it('handles preflight with exact CORS and only POST as the data method', async () => {
    const { handler } = fixture();
    const preflight = await handler(new Request('https://edge.example/team-access', { method: 'OPTIONS', headers: { Origin: origin } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect((await handler(new Request('https://edge.example/team-access', { method: 'GET', headers: { Origin: origin } }))).status).toBe(405);
  });

  it.each([
    { action: 'register', seat: 'member1', name: 'A', password: 'password123', invite },
    { action: 'register', seat: 'member1', name: '민지', password: 'short', invite },
    { action: 'register', seat: 'other', name: '민지', password: 'password123', invite },
    { action: 'register', seat: 'member1', name: '민지', password: 'password123', invite, extra: true },
    { action: 'login', seat: 'member1', name: '민지', password: 'password123', invite }
  ])('rejects malformed fields without service calls: %j', async body => {
    const { services, request } = fixture();
    expect((await request(body)).status).toBe(400);
    expect(services.getActiveProject).not.toHaveBeenCalled();
  });

  it('rejects a wrong invitation before rate limiting or creating an Auth user', async () => {
    const { services, request } = fixture();
    services.getInviteByHash.mockResolvedValue(null);
    const response = await request({ action: 'register', seat: 'member1', name: '민지', password: 'password123', invite });
    expect(response.status).toBe(400);
    expect(services.getInviteByHash).toHaveBeenCalledWith(projectId, 'member1', expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(services.takeAttempt).not.toHaveBeenCalled();
    expect(services.createUser).not.toHaveBeenCalled();
  });

  it('rejects used or expired invitations before creating an Auth user', async () => {
    const { services, request } = fixture();
    const body = { action: 'register', seat: 'member1', name: '민지', password: 'password123', invite };
    services.getInviteByHash.mockResolvedValueOnce({ ...claimedInvite, user_id: userId })
      .mockResolvedValueOnce({ ...claimedInvite, expires_at: '2020-01-01T00:00:00.000Z' });
    expect((await request(body)).status).toBe(400);
    expect((await request(body)).status).toBe(400);
    expect(services.takeAttempt).not.toHaveBeenCalled();
    expect(services.createUser).not.toHaveBeenCalled();
  });

  it('registers through a random internal alias, claims once, and returns only tokens', async () => {
    const { services, request } = fixture();
    const response = await request({ action: 'register', seat: 'member1', name: '  민지  ', password: 'password123', invite });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access_token: 'access', refresh_token: 'refresh' });
    const alias = 'review-44444444-4444-4444-8444-444444444444@kisti-review.invalid';
    expect(services.createUser).toHaveBeenCalledWith(alias, 'password123', '민지');
    expect(services.claimInvite).toHaveBeenCalledWith(claimedInvite.id, userId, '민지', alias);
    expect(services.signIn).toHaveBeenCalledWith(alias, 'password123');
    expect(services.deleteUser).not.toHaveBeenCalled();
  });

  it('accepts a committed claim when the RPC acknowledgement is lost', async () => {
    const { services, request } = fixture();
    services.claimInvite.mockRejectedValue(new Error('transport lost'));
    services.getInviteById.mockResolvedValue({ ...claimedInvite, user_id: userId });
    expect((await request({ action: 'register', seat: 'member1', name: '민지', password: 'password123', invite })).status).toBe(200);
    expect(services.deleteUser).not.toHaveBeenCalled();
  });

  it('preserves the new Auth user if claim status cannot be read after an RPC error', async () => {
    const { services, request } = fixture();
    services.claimInvite.mockRejectedValue(new Error('transport lost'));
    services.getInviteById.mockRejectedValue(new Error('read unavailable'));
    expect((await request({ action: 'register', seat: 'member1', name: '민지', password: 'password123', invite })).status).toBe(503);
    expect(services.deleteUser).not.toHaveBeenCalled();
    expect(services.signIn).not.toHaveBeenCalled();
  });

  it('does not delete an Auth user while an apparently unclaimed seat may still commit', async () => {
    const { services, request } = fixture();
    let committedUser: string | null = null;
    let resolveCommit!: () => void;
    const commitLater = new Promise<void>(resolve => { resolveCommit = resolve; });
    void commitLater.then(() => { committedUser = userId; });
    services.claimInvite.mockRejectedValue(new Error('RPC acknowledgement lost'));
    services.getInviteById.mockImplementation(async () => ({ ...claimedInvite, user_id: committedUser }));

    const response = await request({ action: 'register', seat: 'member1', name: '민지', password: 'password123', invite });
    expect(response.status).toBe(503);
    expect(services.deleteUser).not.toHaveBeenCalled();
    expect(services.signIn).not.toHaveBeenCalled();

    resolveCommit();
    await commitLater;
    expect((await services.getInviteById(claimedInvite.id))?.user_id).toBe(userId);
  });

  it('preserves the Auth user when the invite re-read returns no row', async () => {
    const { services, request } = fixture();
    services.claimInvite.mockRejectedValue(new Error('RPC acknowledgement lost'));
    services.getInviteById.mockResolvedValue(null);
    expect((await request({ action: 'register', seat: 'member1', name: '민지', password: 'password123', invite })).status).toBe(503);
    expect(services.deleteUser).not.toHaveBeenCalled();
    expect(services.signIn).not.toHaveBeenCalled();
  });

  it('deletes only its new Auth user when another claimant wins the seat', async () => {
    const { services, request } = fixture();
    services.claimInvite.mockRejectedValue(new Error('unique violation sensitive info'));
    services.getInviteById.mockResolvedValue({ ...claimedInvite, user_id: '55555555-5555-4555-8555-555555555555' });
    const response = await request({ action: 'register', seat: 'member1', name: '민지', password: 'password123', invite });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('sensitive info');
    expect(services.deleteUser).toHaveBeenCalledWith(userId);
    expect(services.signIn).not.toHaveBeenCalled();
  });

  it('uses the selected seat and normalized name for returning login', async () => {
    const { services, request } = fixture();
    const response = await request({ action: 'login', seat: 'member1', name: '  민지  ', password: 'password123' });
    expect(response.status).toBe(200);
    expect(services.getInviteBySeat).toHaveBeenCalledWith(projectId, 'member1');
    expect(services.takeAttempt).toHaveBeenCalledWith('member1', 'login');
    expect(services.signIn).toHaveBeenCalledWith('review-stored@kisti-review.invalid', 'password123');
  });

  it('returns generic errors for a wrong name or password and 429 for exhausted attempts', async () => {
    const { services, request } = fixture();
    const body = { action: 'login', seat: 'member1', name: '다른 사람', password: 'password123' };
    const wrongName = await request(body);
    expect(wrongName.status).toBe(401);
    expect(services.signIn).not.toHaveBeenCalled();
    services.takeAttempt.mockResolvedValue(false);
    expect((await request(body)).status).toBe(429);
    services.takeAttempt.mockResolvedValue(true);
    services.signIn.mockRejectedValue(new Error('user password mismatch sensitive'));
    const wrongPassword = await request({ ...body, name: '민지' });
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await wrongName.json());
  });
});
