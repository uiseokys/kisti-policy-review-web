-- Admit source-specific roles in the optional three-member synthetic balanced project.
-- Existing official and legacy balanced role codes remain valid.
begin;
alter table public.review_assignments drop constraint review_assignments_check;
alter table public.review_assignments add constraint review_assignments_check check (
  (mode = 'official' and role_code in ('R1','R2','H1','R1_DEDUP','S1','C1'))
  or
  (mode = 'balanced' and (
    role_code ~ '^B[1-3]_(BLIND|E3B|DEDUP|SAMPLE|COMMITTEE)$'
    or (role_code ~ '^B[1-3]_(R1|R2)$' and kind = 'blind')
    or (role_code ~ '^B[1-3]_H1$' and kind = 'e3b')
    or (role_code ~ '^B[1-3]_R1_DEDUP$' and kind = 'dedup')
    or (role_code ~ '^B[1-3]_S1$' and kind = 'sample')
    or (role_code ~ '^B[1-3]_C1$' and kind = 'committee')
  ))
);
commit;
