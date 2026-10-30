import { createClient } from 'npm:@supabase/supabase-js@2';
import { createTeamAccessHandler, type Action, type InviteRow, type Seat, type SessionTokens, type TeamAccessServices } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const appOrigin = Deno.env.get('KISTI_APP_ORIGIN');

function makeServices(): TeamAccessServices | null {
  if (!url || !anonKey || !serviceRoleKey) return null;
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const service = createClient(url, serviceRoleKey, clientOptions);
  const publicAuth = createClient(url, anonKey, clientOptions);
  const checked = <T extends { data: unknown; error: { message: string } | null }>(result: T): T['data'] => {
    if (result.error) throw new Error('Service operation failed');
    return result.data;
  };
  return {
    async getActiveProject() {
      const row = checked(await service.from('review_access_settings').select('project_id').eq('id', true).maybeSingle());
      return row?.project_id ?? null;
    },
    async getInviteByHash(projectId: string, seat: Seat, tokenHash: string) {
      return checked(await service.from('review_access_invites')
        .select('id,project_id,seat,expires_at,user_id,display_name,login_email')
        .eq('project_id', projectId).eq('seat', seat).eq('token_hash', tokenHash).maybeSingle()) as InviteRow | null;
    },
    async getInviteBySeat(projectId: string, seat: Seat) {
      return checked(await service.from('review_access_invites')
        .select('id,project_id,seat,expires_at,user_id,display_name,login_email')
        .eq('project_id', projectId).eq('seat', seat).maybeSingle()) as InviteRow | null;
    },
    async getInviteById(inviteId: string) {
      return checked(await service.from('review_access_invites')
        .select('id,project_id,seat,expires_at,user_id,display_name,login_email')
        .eq('id', inviteId).maybeSingle()) as InviteRow | null;
    },
    async takeAttempt(seat: Seat, action: Action) {
      return checked(await service.rpc('take_review_access_attempt', { p_seat: seat, p_action: action })) === true;
    },
    async createUser(email: string, password: string, displayName: string) {
      const data = checked(await service.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { display_name: displayName }
      }));
      if (!data.user?.id) throw new Error('Auth user was not created');
      return data.user.id;
    },
    async claimInvite(inviteId: string, userId: string, displayName: string, email: string) {
      checked(await service.rpc('claim_review_access', {
        p_invite_id: inviteId, p_user_id: userId, p_display_name: displayName, p_login_email: email
      }));
    },
    async deleteUser(userId: string) {
      checked(await service.auth.admin.deleteUser(userId));
    },
    async signIn(email: string, password: string): Promise<SessionTokens> {
      const data = checked(await publicAuth.auth.signInWithPassword({ email, password }));
      const access_token = data.session?.access_token;
      const refresh_token = data.session?.refresh_token;
      if (!access_token || !refresh_token) throw new Error('Auth session unavailable');
      return { access_token, refresh_token };
    },
    randomUUID: () => crypto.randomUUID()
  };
}

const services = makeServices();
const handler = services
  ? createTeamAccessHandler(services, { appOrigin })
  : async () => new Response(JSON.stringify({ error: 'Team access is temporarily unavailable.' }), {
      status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });

Deno.serve(handler);
