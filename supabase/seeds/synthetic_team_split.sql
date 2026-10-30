-- OPTIONAL synthetic three-member split. It creates a new project and leaves earlier pilots untouched.
-- Replace the three reviewer UUIDs and administrator UUID with existing Auth users before applying.
begin;
do $$
declare
  p uuid := gen_random_uuid();
  reviewers uuid[] := array[
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid
  ];
  administrator uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  source_codes text[] := array['R1','R2','H1','R1_DEDUP','S1','C1'];
  kinds text[] := array['blind','blind','e3b','dedup','sample','committee'];
  counts integer[] := array[81,24,68,8,300,10];
  totals integer[];
  cursor integer := 0;
  recipient integer;
  source_start integer;
  j integer;
  i integer;
  n integer;
  a uuid;
begin
  if administrator='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    or left(reviewers[1]::text,8)=repeat('1',8)
    or left(reviewers[2]::text,8)=repeat('2',8)
    or left(reviewers[3]::text,8)=repeat('3',8)
  then raise exception 'Replace template UUIDs with existing synthetic pilot Auth users'; end if;

  insert into public.review_projects(id,name) values(p,'Synthetic team split pilot');
  insert into public.review_memberships values(p,administrator,'admin');
  for i in 1..3 loop
    insert into public.review_memberships values(p,reviewers[i],'reviewer') on conflict do nothing;
  end loop;

  for j in 1..6 loop
    totals := array[0,0,0];
    for n in 1..counts[j] loop
      recipient := mod(cursor,3)+1;
      totals[recipient] := totals[recipient]+1;
      cursor := cursor+1;
    end loop;

    source_start := 1;
    for i in 1..3 loop
      insert into public.review_assignments(project_id,reviewer_id,role_code,kind,total,mode)
        values(p,reviewers[i],'B'||i||'_'||source_codes[j],kinds[j],totals[i],'balanced')
        returning id into a;
      insert into public.review_items(assignment_id,item_id,position)
        select a,'item-'||lpad(source_row::text,3,'0'),source_row-source_start+1
        from generate_series(source_start,source_start+totals[i]-1) source_row;
      source_start := source_start+totals[i];
    end loop;
  end loop;
end $$;
commit;
