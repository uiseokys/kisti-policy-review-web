-- Run as database owner AFTER replacing three reviewer UUIDs and administrator UUID.
-- UUIDs must identify existing Supabase Auth users. No real project IDs/text belong here.
-- This is an explicit template, not an automatically executed seed.
begin;
do $$
declare p uuid:=gen_random_uuid(); reviewers uuid[]:=array[
 '11111111-1111-4111-8111-111111111111'::uuid,
 '22222222-2222-4222-8222-222222222222'::uuid,
 '33333333-3333-4333-8333-333333333333'::uuid,
 '11111111-1111-4111-8111-111111111111'::uuid,
 '11111111-1111-4111-8111-111111111111'::uuid,
 '22222222-2222-4222-8222-222222222222'::uuid];
 administrator uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 codes text[]:=array['R1','R2','H1','R1_DEDUP','S1','C1'];
 kinds text[]:=array['blind','blind','e3b','dedup','sample','committee'];
 counts integer[]:=array[81,24,68,8,300,10]; a uuid; j integer;
begin
 -- Guard against accidentally running the unedited template.
 if administrator='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then raise exception 'Replace template UUIDs with existing synthetic pilot Auth users'; end if;
 insert into public.review_projects(id,name) values(p,'Synthetic official pilot');
 insert into public.review_memberships values(p,administrator,'admin');
 for j in 1..6 loop
  insert into public.review_memberships values(p,reviewers[j],'reviewer') on conflict do nothing;
  insert into public.review_assignments(project_id,reviewer_id,role_code,kind,total,mode) values(p,reviewers[j],codes[j],kinds[j],counts[j],'official') returning id into a;
  insert into public.review_items select a,'item-'||lpad(i::text,3,'0'),i from generate_series(1,counts[j]) i;
 end loop;
 -- R1/R1_DEDUP/S1 share reviewer 1; R2/C1 share reviewer 2; H1 uses reviewer 3.
 -- 81+24+68+8+300+10 = 491. No source content is stored in any item row.
end $$;
commit;
