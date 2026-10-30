-- Private, synthetic-only self-service invitations. Never expose these rows to clients.
begin;

create table public.review_access_settings (
  id boolean primary key default true check (id),
  project_id uuid not null references public.review_projects on delete cascade
);

create table public.review_access_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.review_projects on delete cascade,
  seat text not null check (seat in ('member1','member2','member3','admin')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  user_id uuid,
  display_name text,
  login_email text,
  unique (project_id,seat),
  check (
    (user_id is null and display_name is null and login_email is null)
    or (user_id is not null and display_name is not null and login_email is not null
      and user_id <> '00000000-0000-0000-0000-000000000000'::uuid
      and char_length(display_name) between 2 and 40 and display_name ~ '[^[:space:]]'
      and char_length(login_email) <= 254 and login_email ~ '^[^@[:space:]]+@kisti-review[.]invalid$')
  )
);

create table public.review_access_attempts (
  project_id uuid not null references public.review_projects on delete cascade,
  seat text not null check (seat in ('member1','member2','member3','admin')),
  action text not null check (action in ('login','register')),
  bucket timestamptz not null,
  count integer not null check (count > 0),
  primary key (project_id,seat,action,bucket)
);

alter table public.review_access_settings enable row level security;
alter table public.review_access_invites enable row level security;
alter table public.review_access_attempts enable row level security;
revoke all on public.review_access_settings,public.review_access_invites,public.review_access_attempts from public,anon,authenticated;
grant all on public.review_access_settings,public.review_access_invites,public.review_access_attempts to service_role;

create function public.take_review_access_attempt(p_seat text,p_action text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  active_project uuid;
  attempt_limit integer;
  attempt_count integer;
begin
  if p_seat is null or p_seat not in ('member1','member2','member3','admin')
    or p_action is null or p_action not in ('login','register')
  then raise exception 'Invalid access attempt' using errcode='22023'; end if;

  select project_id into active_project from public.review_access_settings where id for share;
  if not found then return false; end if;
  attempt_limit := case p_action when 'login' then 10 else 5 end;
  -- UPSERT holds the bucket row lock through the statement/transaction. Saturating
  -- at limit+1 avoids overflow without ever reopening a blocked minute.
  insert into public.review_access_attempts(project_id,seat,action,bucket,count)
    values(active_project,p_seat,p_action,date_trunc('minute',now()),1)
    on conflict(project_id,seat,action,bucket) do update
    set count=least(public.review_access_attempts.count,attempt_limit)+1
    returning count into attempt_count;
  return attempt_count <= attempt_limit;
end $$;

create function public.claim_review_access(p_invite_id uuid,p_user_id uuid,p_display_name text,p_login_email text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  active_project uuid;
  invitation public.review_access_invites;
  member_number integer;
  source_codes text[] := array['R1','R2','H1','R1_DEDUP','S1','C1'];
  source_kinds text[] := array['blind','blind','e3b','dedup','sample','committee'];
  -- Rows are source groups, columns are member1/member2/member3.
  source_counts integer[] := array[[27,27,27],[8,8,8],[23,23,22],[3,2,3],[100,100,100],[3,4,3]];
  source_start integer;
  source_count integer;
  group_number integer;
  previous_member integer;
  assignment_id uuid;
begin
  if p_invite_id is null or p_user_id is null or p_user_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_display_name is null or char_length(p_display_name) not between 2 and 40 or p_display_name !~ '[^[:space:]]'
    or p_login_email is null or char_length(p_login_email)>254 or p_login_email !~ '^[^@[:space:]]+@kisti-review[.]invalid$'
  then raise exception 'Invalid access identity' using errcode='22023'; end if;

  -- Lock settings before the invitation so switching the active project cannot
  -- interleave with a successful claim or create cross-project assignments.
  select project_id into active_project from public.review_access_settings where id for share;
  if not found then raise exception 'Access unavailable' using errcode='42501'; end if;
  select * into invitation from public.review_access_invites where id=p_invite_id for update;
  if not found or invitation.project_id<>active_project then
    raise exception 'Invitation unavailable for active project' using errcode='42501';
  end if;
  if invitation.expires_at<=clock_timestamp() then raise exception 'Invitation expired' using errcode='42501'; end if;
  if invitation.user_id is not null then
    if invitation.user_id=p_user_id then return; end if;
    raise exception 'Invitation already claimed' using errcode='42501';
  end if;

  update public.review_access_invites set user_id=p_user_id,display_name=p_display_name,login_email=p_login_email where id=invitation.id;
  insert into public.review_memberships(project_id,user_id,role)
    values(active_project,p_user_id,case invitation.seat when 'admin' then 'admin' else 'reviewer' end);
  if invitation.seat='admin' then return; end if;

  member_number := right(invitation.seat,1)::integer;
  for group_number in 1..6 loop
    source_start := 1;
    for previous_member in 1..member_number-1 loop
      source_start := source_start+source_counts[group_number][previous_member];
    end loop;
    source_count := source_counts[group_number][member_number];
    insert into public.review_assignments(project_id,reviewer_id,role_code,kind,total,mode)
      values(active_project,p_user_id,'B'||member_number||'_'||source_codes[group_number],source_kinds[group_number],source_count,'balanced')
      returning id into assignment_id;
    insert into public.review_items(assignment_id,item_id,position)
      select assignment_id,'item-'||lpad(source_row::text,3,'0'),source_row-source_start+1
      from generate_series(source_start,source_start+source_count-1) source_row;
  end loop;
end $$;

revoke all on function public.take_review_access_attempt(text,text),public.claim_review_access(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.take_review_access_attempt(text,text),public.claim_review_access(uuid,uuid,text,text) to service_role;
commit;
