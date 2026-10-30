-- Synthetic-only pilot. Apply as the database owner, never from the browser.
begin;
create table public.review_projects (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 1 and 100),
 dataset_class text not null default 'synthetic' check(dataset_class='synthetic'), blind_closed boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.review_memberships (
 project_id uuid not null references public.review_projects on delete cascade,
 user_id uuid not null, role text not null check(role in ('reviewer','admin')), primary key(project_id,user_id)
);
create table public.review_assignments (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.review_projects on delete cascade,
 reviewer_id uuid not null, role_code text not null,
 kind text not null check(kind in ('blind','e3b','dedup','sample','committee')), total integer not null check(total>0),
 mode text not null default 'official' check(mode in ('official','balanced')), submitted_at timestamptz,
 check((mode='official' and role_code in ('R1','R2','H1','R1_DEDUP','S1','C1')) or (mode='balanced' and role_code ~ '^B[1-3]_(BLIND|E3B|DEDUP|SAMPLE|COMMITTEE)$')),
 foreign key(project_id,reviewer_id) references public.review_memberships(project_id,user_id),
 unique(project_id,reviewer_id,role_code,mode)
);
create table public.review_items (
 assignment_id uuid not null references public.review_assignments on delete cascade,
 item_id text not null check(item_id ~ '^(item-[0-9]{3}|syn-[A-Za-z0-9_-]{1,100})$'), position integer not null check(position>0),
 primary key(assignment_id,item_id),unique(assignment_id,position)
);
create table public.review_annotations (
 assignment_id uuid not null, item_id text not null, reviewer_id uuid not null,
 labels jsonb not null default '{}', version integer not null default 0 check(version>=0),
 updated_at timestamptz not null default now(), mutation_id uuid,
 primary key(reviewer_id,assignment_id,item_id),
 foreign key(assignment_id,item_id) references public.review_items on delete cascade
);
create table public.review_mutations (
 reviewer_id uuid not null, mutation_id uuid not null, assignment_id uuid not null references public.review_assignments on delete cascade,
 item_id text not null, expected_version integer not null, labels jsonb not null, result jsonb not null,
 primary key(reviewer_id,mutation_id)
);
-- Per-device advisory state is separate from validated persisted labels.
create table public.review_device_sync (
 assignment_id uuid not null references public.review_assignments on delete cascade,
 reviewer_id uuid not null, device_id uuid not null, pending integer not null check(pending between 0 and 100000),
 state text not null check(state in ('saved','pending','conflict','error')), report_sequence bigint not null check(report_sequence>=0), last_seen_at timestamptz not null default now(),
 primary key(assignment_id,reviewer_id,device_id), check(state<>'saved' or pending=0)
);
create table public.review_progress (
 assignment_id uuid primary key references public.review_assignments on delete cascade, reviewer_id uuid not null,
 role_code text not null, kind text not null, mode text not null, total integer not null,
 complete integer not null default 0, in_progress integer not null default 0, untouched integer not null,
 percent numeric not null default 0, last_saved_at timestamptz, last_sync_state text not null default 'idle', last_seen_at timestamptz, submitted_at timestamptz
);
create function public.review_is_admin(p_project uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.review_memberships where project_id=p_project and user_id=auth.uid() and role='admin')
$$;
create function public.review_is_member(p_project uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.review_memberships where project_id=p_project and user_id=auth.uid())
$$;
create function public.review_assess_labels(p_kind text,p_labels jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare allowed text[]; k text; v jsonb; valid boolean:=true; complete boolean:=false; started boolean:=false; decision text;
begin
 allowed:=case p_kind when 'blind' then array['policy_discussion','act','evidence_supports','note'] when 'e3b' then array['policy_discussion','evidence_supports','note'] when 'dedup' then array['same_policy','note'] when 'sample' then array['policy_named','policy_name','act','note'] when 'committee' then array['committee_ok','correct_committee','note'] end;
 if allowed is null or jsonb_typeof(p_labels) is distinct from 'object' then return '{"valid":false,"complete":false,"started":false}'::jsonb; end if;
 for k,v in select * from jsonb_each(p_labels) loop
   if not(k=any(allowed)) or jsonb_typeof(v)<>'string' then valid:=false; end if;
   if jsonb_typeof(v)='string' then
    if char_length(p_labels->>k)>(case when k='note' then 2000 else 200 end) then valid:=false; end if;
    if btrim(p_labels->>k)<>'' then started:=true; end if;
    if k in ('policy_discussion','same_policy','committee_ok') and not(p_labels->>k=any(array['','yes','no','unsure'])) then valid:=false; end if;
    if k='policy_named' and not(p_labels->>k=any(array['','yes','no'])) then valid:=false; end if;
    if k='evidence_supports' and not(p_labels->>k=any(array['','yes','partly','no'])) then valid:=false; end if;
    if k='act' and not(p_labels->>k=any(array['','ordinance_enact','ordinance_amend','ordinance_repeal','budget_increase','budget_cut','budget_review','policy_proposal','evaluation','inquiry','report','other'])) then valid:=false; end if;
   end if;
 end loop;
 if p_kind in ('blind','e3b') then
  decision:=coalesce(p_labels->>'policy_discussion','');
  if decision='yes' then complete:=coalesce(p_labels->>'evidence_supports','')<>'' and (p_kind='e3b' or coalesce(p_labels->>'act','')<>'');
  else
   complete:=decision in ('no','unsure');
   if coalesce(btrim(p_labels->>'act'),'')<>'' or coalesce(btrim(p_labels->>'evidence_supports'),'')<>'' then valid:=false; end if;
  end if;
 elsif p_kind='sample' then
  if p_labels->>'policy_named'='yes' then complete:=coalesce(btrim(p_labels->>'policy_name'),'')<>'' and coalesce(p_labels->>'act','')<>'';
  else complete:=coalesce(p_labels->>'policy_named','')='no'; if coalesce(btrim(p_labels->>'policy_name'),'')<>'' or coalesce(btrim(p_labels->>'act'),'')<>'' then valid:=false; end if; end if;
 elsif p_kind='committee' then
  if p_labels->>'committee_ok'='no' then complete:=coalesce(btrim(p_labels->>'correct_committee'),'')<>'';
  else complete:=coalesce(p_labels->>'committee_ok','') in ('yes','unsure'); if coalesce(btrim(p_labels->>'correct_committee'),'')<>'' then valid:=false; end if; end if;
 else complete:=coalesce(p_labels->>'same_policy','')<>''; end if;
 return jsonb_build_object('valid',valid,'complete',valid and complete,'started',started);
end $$;
create function public.review_annotation_json(p public.review_annotations) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_build_object('assignmentId',p.assignment_id,'itemId',p.item_id,'reviewerId',p.reviewer_id,'labels',p.labels,'version',p.version,'updatedAt',p.updated_at,'mutationId',p.mutation_id)
$$;
create function public.review_refresh_progress(p_assignment uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.review_assignments; n integer; s integer; saved timestamptz; seen timestamptz; sync_state text;
begin
 select * into strict a from public.review_assignments where id=p_assignment;
 select count(*) filter(where (v->>'complete')::boolean),count(*) filter(where (v->>'started')::boolean and not (v->>'complete')::boolean),max(x.updated_at)
 into n,s,saved from public.review_annotations x cross join lateral public.review_assess_labels(a.kind,x.labels) v where x.assignment_id=a.id and x.reviewer_id=a.reviewer_id;
 select max(last_seen_at),case
  when bool_or(state='conflict') then 'conflict'
  when bool_or(state='error') then 'error'
  when bool_or(pending>0 or state='pending') then 'pending'
  when count(*)>0 or saved is not null then 'saved' else 'idle' end
 into seen,sync_state from public.review_device_sync where assignment_id=a.id and reviewer_id=a.reviewer_id;
 insert into public.review_progress(assignment_id,reviewer_id,role_code,kind,mode,total,complete,in_progress,untouched,percent,last_saved_at,last_sync_state,last_seen_at,submitted_at)
 values(a.id,a.reviewer_id,a.role_code,a.kind,a.mode,a.total,n,s,a.total-n-s,round(100.0*n/a.total,2),saved,sync_state,seen,a.submitted_at)
 on conflict(assignment_id) do update set complete=excluded.complete,in_progress=excluded.in_progress,untouched=excluded.untouched,percent=excluded.percent,last_saved_at=excluded.last_saved_at,last_sync_state=excluded.last_sync_state,last_seen_at=excluded.last_seen_at,submitted_at=excluded.submitted_at;
end $$;
create function public.review_initialize_progress() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin perform public.review_refresh_progress(new.id); return new; end $$;
create trigger review_assignment_progress after insert on public.review_assignments for each row execute function public.review_initialize_progress();
create function public.save_review_annotation(p_assignment_id uuid,p_item_id text,p_expected_version integer,p_mutation_id uuid,p_labels jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.review_assignments; current_row public.review_annotations; prior public.review_mutations; response jsonb;
begin
 if auth.uid() is null then return '{"ok":false,"type":"forbidden","message":"Authentication required"}'; end if;
 select * into a from public.review_assignments where id=p_assignment_id for update;
 if not found or a.reviewer_id<>auth.uid() or not public.review_is_member(a.project_id) then return '{"ok":false,"type":"forbidden","message":"Assignment unavailable"}'; end if;
 if not exists(select 1 from public.review_projects where id=a.project_id and dataset_class='synthetic') then return '{"ok":false,"type":"forbidden","message":"Synthetic projects only"}'; end if;
 -- A mutation identifier is permanently bound to one exact command.
 select * into prior from public.review_mutations where reviewer_id=auth.uid() and mutation_id=p_mutation_id;
 if found then
  if prior.assignment_id=p_assignment_id and prior.item_id=p_item_id and prior.expected_version=p_expected_version and prior.labels=p_labels then return prior.result; end if;
  return '{"ok":false,"type":"error","message":"Mutation identifier reused"}';
 end if;
 if a.submitted_at is not null then return '{"ok":false,"type":"locked","message":"Assignment submitted"}'; end if;
 if p_mutation_id is null or p_expected_version is null or p_expected_version<0 or not exists(select 1 from public.review_items where assignment_id=a.id and item_id=p_item_id) then return '{"ok":false,"type":"forbidden","message":"Unknown item or invalid command"}'; end if;
 if not (public.review_assess_labels(a.kind,p_labels)->>'valid')::boolean then return '{"ok":false,"type":"error","message":"Invalid labels"}'; end if;
 insert into public.review_annotations(assignment_id,item_id,reviewer_id) values(a.id,p_item_id,auth.uid()) on conflict do nothing;
 select * into strict current_row from public.review_annotations where assignment_id=a.id and item_id=p_item_id and reviewer_id=auth.uid();
 if current_row.version<>p_expected_version then return jsonb_build_object('ok',false,'type','conflict','remote',public.review_annotation_json(current_row)); end if;
 update public.review_annotations set labels=p_labels,version=version+1,updated_at=clock_timestamp(),mutation_id=p_mutation_id where assignment_id=a.id and item_id=p_item_id and reviewer_id=auth.uid() returning * into current_row;
 response:=jsonb_build_object('ok',true,'annotation',public.review_annotation_json(current_row));
 insert into public.review_mutations values(auth.uid(),p_mutation_id,a.id,p_item_id,p_expected_version,p_labels,response);
 perform public.review_refresh_progress(a.id); return response;
end $$;
create function public.report_review_sync_state(p_assignment_id uuid,p_device_id uuid,p_pending integer,p_state text,p_sequence bigint) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.review_assignments; changed integer;
begin
 select * into a from public.review_assignments where id=p_assignment_id for update;
 if not found or auth.uid() is null or a.reviewer_id<>auth.uid() or not public.review_is_member(a.project_id) then raise exception 'Assignment unavailable' using errcode='42501'; end if;
 if p_device_id is null or p_pending is null or p_pending not between 0 and 100000 or p_state is null or p_state not in ('saved','pending','conflict','error') or (p_state='saved' and p_pending<>0) or p_sequence is null or p_sequence<0 then raise exception 'Invalid advisory sync state'; end if;
 if a.submitted_at is not null and (p_pending>0 or p_state<>'saved') then raise exception 'Assignment submitted' using errcode='42501'; end if;
 insert into public.review_device_sync(assignment_id,reviewer_id,device_id,pending,state,report_sequence,last_seen_at) values(a.id,auth.uid(),p_device_id,p_pending,p_state,p_sequence,clock_timestamp())
 on conflict(assignment_id,reviewer_id,device_id) do update set pending=excluded.pending,state=excluded.state,report_sequence=excluded.report_sequence,last_seen_at=excluded.last_seen_at
 where excluded.report_sequence>public.review_device_sync.report_sequence;
 get diagnostics changed=row_count;
 if changed>0 then perform public.review_refresh_progress(a.id); end if;
end $$;
create function public.submit_review_assignment(p_assignment_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.review_assignments;
begin
 select * into a from public.review_assignments where id=p_assignment_id for update;
 if not found or auth.uid() is null or a.reviewer_id<>auth.uid() or not public.review_is_member(a.project_id) then raise exception 'Assignment unavailable' using errcode='42501'; end if;
 if a.submitted_at is not null then return; end if;
 if exists(select 1 from public.review_device_sync where assignment_id=a.id and (pending>0 or state in ('pending','conflict','error'))) then raise exception 'Known device has pending or unresolved edits'; end if;
 if (select count(*) from public.review_items where assignment_id=a.id)<>a.total or (select count(*) from public.review_annotations x where x.assignment_id=a.id and x.reviewer_id=auth.uid() and (public.review_assess_labels(a.kind,x.labels)->>'complete')::boolean)<>a.total then raise exception 'All assigned items require complete valid server labels'; end if;
 update public.review_assignments set submitted_at=clock_timestamp() where id=a.id; perform public.review_refresh_progress(a.id);
end $$;
create function public.export_locked_annotations(p_assignment_id uuid) returns setof public.review_annotations language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.review_assignments;
begin
 select * into a from public.review_assignments where id=p_assignment_id;
 if not found or auth.uid() is null or not(a.reviewer_id=auth.uid() or public.review_is_admin(a.project_id)) or a.submitted_at is null or not exists(select 1 from public.review_projects where id=a.project_id and blind_closed) then raise exception 'Export requires authorization, submitted session and closed blind phase' using errcode='42501'; end if;
 return query select x.* from public.review_annotations x join public.review_items i using(assignment_id,item_id) where x.assignment_id=a.id order by i.position;
end $$;
-- Every table is protected. Clients have no direct mutation privileges.
alter table public.review_projects enable row level security;
alter table public.review_memberships enable row level security;
alter table public.review_assignments enable row level security;
alter table public.review_items enable row level security;
alter table public.review_annotations enable row level security;
alter table public.review_mutations enable row level security;
alter table public.review_progress enable row level security;
alter table public.review_device_sync enable row level security;
create policy projects_read on public.review_projects for select to authenticated using(public.review_is_member(id));
create policy memberships_read on public.review_memberships for select to authenticated using(user_id=auth.uid() or public.review_is_admin(project_id));
create policy assignments_read on public.review_assignments for select to authenticated using(reviewer_id=auth.uid() or public.review_is_admin(project_id));
create policy items_read on public.review_items for select to authenticated using(exists(select 1 from public.review_assignments a where a.id=assignment_id and (a.reviewer_id=auth.uid() or public.review_is_admin(a.project_id))));
create policy annotations_read on public.review_annotations for select to authenticated using(reviewer_id=auth.uid() and exists(select 1 from public.review_assignments a where a.id=assignment_id and a.reviewer_id=auth.uid()));
create policy devices_read on public.review_device_sync for select to authenticated using(reviewer_id=auth.uid());
create policy progress_read on public.review_progress for select to authenticated using(reviewer_id=auth.uid() or exists(select 1 from public.review_assignments a where a.id=assignment_id and public.review_is_admin(a.project_id)));
revoke all on public.review_projects,public.review_memberships,public.review_assignments,public.review_items,public.review_annotations,public.review_mutations,public.review_device_sync,public.review_progress from public,anon,authenticated;
grant select on public.review_projects,public.review_memberships,public.review_assignments,public.review_items,public.review_annotations,public.review_device_sync,public.review_progress to authenticated;
revoke all on function public.review_is_admin(uuid),public.review_is_member(uuid),public.review_assess_labels(text,jsonb),public.review_annotation_json(public.review_annotations),public.review_refresh_progress(uuid),public.review_initialize_progress(),public.save_review_annotation(uuid,text,integer,uuid,jsonb),public.report_review_sync_state(uuid,uuid,integer,text,bigint),public.submit_review_assignment(uuid),public.export_locked_annotations(uuid) from public,anon,authenticated;
grant execute on function public.review_is_admin(uuid),public.review_is_member(uuid),public.save_review_annotation(uuid,text,integer,uuid,jsonb),public.report_review_sync_state(uuid,uuid,integer,text,bigint),public.submit_review_assignment(uuid),public.export_locked_annotations(uuid) to authenticated;
-- Publish only summary rows, never annotations, mutation payloads, or labels.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables) then raise exception 'supabase_realtime FOR ALL TABLES is unsafe: configure explicit safe summary tables before applying'; end if;
 if exists(select 1 from pg_publication_namespace pn join pg_publication p on p.oid=pn.pnpubid join pg_namespace n on n.oid=pn.pnnspid where p.pubname='supabase_realtime' and n.nspname='public') then raise exception 'supabase_realtime FOR TABLES IN SCHEMA public is unsafe: configure explicit safe summary tables before applying'; end if;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='review_progress') then alter publication supabase_realtime add table public.review_progress; end if;
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and left(tablename,7)='review_' and tablename<>'review_progress') then raise exception 'supabase_realtime publishes forbidden review tables: only review_progress is permitted'; end if;
 end if;
end $$;
-- Service-role use is restricted to explicit local administrator tooling.
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant all on public.review_projects,public.review_memberships,public.review_assignments,public.review_items,public.review_annotations,public.review_mutations,public.review_device_sync,public.review_progress to service_role;
 end if;
end $$;
commit;
