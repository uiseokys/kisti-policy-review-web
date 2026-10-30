import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
let db: PGlite;
const p='00000000-0000-0000-0000-000000000001', a='00000000-0000-0000-0000-000000000002', u='00000000-0000-0000-0000-000000000003', other='00000000-0000-0000-0000-000000000004';
const uid=async(id:string)=>db.exec(`select set_config('request.jwt.claim.sub','${id}',false)`);
const save=async(labels:object,version=0,mutation=crypto.randomUUID()) => db.query<{save_review_annotation:any}>(`select public.save_review_annotation($1,$2,$3,$4,$5::jsonb)`,[a,'syn-1',version,mutation,JSON.stringify(labels)]).then(r=>r.rows[0].save_review_annotation);
describe('SQL contract in PostgreSQL WASM (not remote Supabase)',()=>{
 beforeAll(async()=>{ db=new PGlite(); await db.exec(`create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`); await db.exec(readFileSync('supabase/migrations/202610300001_review.sql','utf8')); await db.exec(`insert into review_projects(id,name) values('${p}','Synthetic test'); insert into review_memberships values('${p}','${u}','reviewer'),('${p}','${other}','reviewer'); insert into review_assignments(id,project_id,reviewer_id,role_code,kind,total) values('${a}','${p}','${u}','R1','blind',1); insert into review_items values('${a}','syn-1',1);`); await uid(u); },30000);
 afterAll(async()=>{await db?.close();});
 it('CAS, durable idempotency, downgrade progress, strict validation and lock',async()=>{
   const m=crypto.randomUUID(); const first=await save({policy_discussion:'yes',act:'report',evidence_supports:'yes'},0,m); expect(first.ok).toBe(true); expect(first.annotation.version).toBe(1);
   expect((await save({policy_discussion:'yes',act:'report',evidence_supports:'yes'},0,m)).annotation.version).toBe(1);
   expect((await save({policy_discussion:'no'},0,m)).type).toBe('error');
   expect((await save({policy_discussion:'no'},0)).type).toBe('conflict');
   expect((await db.query<{complete:number}>(`select complete from review_progress where assignment_id='${a}'`)).rows[0].complete).toBe(1);
   expect((await save({},1)).ok).toBe(true);
   expect((await db.query<{complete:number}>(`select complete from review_progress where assignment_id='${a}'`)).rows[0].complete).toBe(0);
   expect((await save({raw:'forbidden'},2)).ok).toBe(false);
   await expect(db.query(`select submit_review_assignment('${a}')`)).rejects.toThrow();
   await save({policy_discussion:'no'},2);
   const device1=crypto.randomUUID(), device2=crypto.randomUUID();
   await db.query(`select report_review_sync_state($1,$2,1,'pending',1)`,[a,device1]);
   await db.query(`select report_review_sync_state($1,$2,0,'saved',1)`,[a,device2]);
   expect((await db.query<{complete:number;last_sync_state:string;last_seen_at:string}>(`select complete,last_sync_state,last_seen_at from review_progress where assignment_id='${a}'`)).rows[0]).toMatchObject({complete:1,last_sync_state:'pending'});
   await expect(db.query(`select submit_review_assignment('${a}')`)).rejects.toThrow();
   await db.query(`select report_review_sync_state($1,$2,0,'conflict',2)`,[a,device1]);
   await expect(db.query(`select submit_review_assignment('${a}')`)).rejects.toThrow();
   await db.query(`select report_review_sync_state($1,$2,0,'error',3)`,[a,device1]);
   await expect(db.query(`select submit_review_assignment('${a}')`)).rejects.toThrow();
   await db.query(`select report_review_sync_state($1,$2,0,'saved',4)`,[a,device1]);
   await db.query(`select submit_review_assignment('${a}')`);
   expect((await save({},3)).type).toBe('locked');
 });
 it('enforces reviewer isolation, export gate, write privilege and server synthetic classification', async()=>{
   await uid(other); expect((await save({},3)).type).toBe('forbidden');
   await expect(db.query(`select report_review_sync_state($1,$2,0,'saved',1)`,[a,crypto.randomUUID()])).rejects.toThrow();
   await db.exec(`set role authenticated`); expect((await db.query(`select * from review_annotations`)).rows).toHaveLength(0);
   await expect(db.exec(`update review_assignments set reviewer_id='${other}'`)).rejects.toThrow(); await db.exec('reset role');
   await uid(u); await expect(db.query(`select * from export_locked_annotations('${a}')`)).rejects.toThrow();
   await db.exec(`insert into review_memberships values('${p}','00000000-0000-0000-0000-000000000005','admin');`); await uid('00000000-0000-0000-0000-000000000005');
   await db.exec(`set role authenticated`); expect((await db.query(`select * from review_annotations`)).rows).toHaveLength(0); await db.exec('reset role');
   await db.exec(`update review_projects set blind_closed=true where id='${p}'`); expect((await db.query(`select * from export_locked_annotations('${a}')`)).rows).toHaveLength(1);
   await db.exec(`set role authenticated`); expect((await db.query(`select * from review_annotations`)).rows).toHaveLength(0); await db.exec('reset role');
   await expect(db.exec(`insert into review_projects(name,dataset_class) values('real','real')`)).rejects.toThrow();
 });
 it('ignores a delayed saved report after a newer pending report',async()=>{
   await uid(u);
   const assignment='00000000-0000-0000-0000-000000000006',device=crypto.randomUUID();
   await db.exec(`insert into review_assignments(id,project_id,reviewer_id,role_code,kind,total) values('${assignment}','${p}','${u}','R2','blind',1); insert into review_items values('${assignment}','item-001',1);`);
   const saved=(await db.query<{save_review_annotation:{ok:boolean}}>(`select save_review_annotation($1,'item-001',0,$2,'{"policy_discussion":"no"}'::jsonb)`,[assignment,crypto.randomUUID()])).rows[0].save_review_annotation;
   expect(saved.ok).toBe(true);
   await db.query(`select report_review_sync_state($1,$2,1,'pending',2)`,[assignment,device]);
   await db.query(`select report_review_sync_state($1,$2,0,'saved',1)`,[assignment,device]);
   expect((await db.query<{pending:number;state:string;report_sequence:number}>(`select pending,state,report_sequence from review_device_sync where assignment_id=$1 and device_id=$2`,[assignment,device])).rows[0]).toMatchObject({pending:1,state:'pending',report_sequence:2});
   expect((await db.query<{last_sync_state:string}>(`select last_sync_state from review_progress where assignment_id=$1`,[assignment])).rows[0].last_sync_state).toBe('pending');
   await expect(db.query(`select submit_review_assignment($1)`,[assignment])).rejects.toThrow();
   await db.query(`select report_review_sync_state($1,$2,0,'saved',3)`,[assignment,device]);
   await db.query(`select submit_review_assignment($1)`,[assignment]);
 });
 it('seeds the exact official roles, totals and opaque item IDs', async()=>{
   let seed=readFileSync('supabase/seeds/synthetic_official.sql','utf8');
   for(let i=1;i<=6;i++)seed=seed.replaceAll(`${String(i).repeat(8)}-${String(i).repeat(4)}-4${String(i).repeat(3)}-8${String(i).repeat(3)}-${String(i).repeat(12)}`,`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
   seed=seed.replace("administrator uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'","administrator uuid:='00000000-0000-4000-8000-000000000007'");
   await db.exec(seed);
   const rows=(await db.query<{role_code:string;total:number;actual:number;first_id:string}>(`select a.role_code,a.total,count(i.*)::integer actual,min(i.item_id) first_id from review_assignments a join review_items i on i.assignment_id=a.id where a.mode='official' and a.project_id<>'${p}' group by a.id order by a.role_code`)).rows;
   expect(Object.fromEntries(rows.map(r=>[r.role_code,r.total]))).toEqual({R1:81,R2:24,H1:68,R1_DEDUP:8,S1:300,C1:10});
   expect(rows.reduce((n,r)=>n+r.actual,0)).toBe(491);
   expect(rows.every(r=>r.actual===r.total&&r.first_id==='item-001')).toBe(true);
   const owners=(await db.query<{role_code:string;reviewer_id:string}>(`select role_code,reviewer_id from review_assignments where mode='official' and project_id<>'${p}'`)).rows;
   const byRole=Object.fromEntries(owners.map(r=>[r.role_code,r.reviewer_id]));
   expect(new Set(owners.map(r=>r.reviewer_id)).size).toBe(3);
   expect(byRole.R1).toBe(byRole.R1_DEDUP);expect(byRole.R1).toBe(byRole.S1);
   expect(byRole.R2).toBe(byRole.C1);
 });
 it('seeds a separate balanced project with global round-robin totals and matching item IDs',async()=>{
   let seed=readFileSync('supabase/seeds/synthetic_balanced.sql','utf8');
   for(let i=1;i<=3;i++)seed=seed.replaceAll(`${String(i).repeat(8)}-${String(i).repeat(4)}-4${String(i).repeat(3)}-8${String(i).repeat(3)}-${String(i).repeat(12)}`,`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
   seed=seed.replace("administrator uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'","administrator uuid:='00000000-0000-4000-8000-000000000007'");
   await db.exec(seed);
   const rows=(await db.query<{role_code:string;kind:string;total:number;actual:number;first_id:string;last_id:string}>(`select a.role_code,a.kind,a.total,count(i.*)::integer actual,min(i.item_id) first_id,max(i.item_id) last_id from review_assignments a join review_items i on i.assignment_id=a.id where a.mode='balanced' group by a.id order by a.role_code`)).rows;
   expect(rows).toHaveLength(15);
   expect(rows.every(r=>r.actual===r.total&&r.first_id==='item-001'&&r.last_id===`item-${String(r.total).padStart(3,'0')}`)).toBe(true);
   expect(rows.every(r=>/^B[1-3]_(BLIND|E3B|DEDUP|SAMPLE|COMMITTEE)$/.test(r.role_code)&&r.role_code.endsWith(r.kind.toUpperCase()))).toBe(true);
   const byKind=Object.fromEntries(['blind','e3b','dedup','sample','committee'].map(kind=>[kind,rows.filter(r=>r.kind===kind).reduce((n,r)=>n+r.total,0)]));
   expect(byKind).toEqual({blind:105,e3b:68,dedup:8,sample:300,committee:10});
   const byReviewer=[1,2,3].map(i=>rows.filter(r=>r.role_code.startsWith(`B${i}_`)).reduce((n,r)=>n+r.total,0));
   expect(byReviewer).toEqual([164,164,163]);
   expect(['blind','e3b','dedup','sample','committee'].map(kind=>[1,2,3].map(i=>rows.find(r=>r.role_code===`B${i}_${kind.toUpperCase()}`)?.total))).toEqual([[35,35,35],[23,23,22],[3,2,3],[100,100,100],[3,4,3]]);
   expect((await db.query<{n:number}>(`select count(distinct project_id)::integer n from review_assignments where mode in ('official','balanced') and project_id<>'${p}'`)).rows[0].n).toBe(2);
 });
 it('rejects a schema-wide Realtime publication that would expose review tables',async()=>{
   const isolated=new PGlite();
   try {
     await isolated.exec(`create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create publication supabase_realtime for tables in schema public;`);
     await expect(isolated.exec(readFileSync('supabase/migrations/202610300001_review.sql','utf8'))).rejects.toThrow(/supabase_realtime/);
   } finally {await isolated.close();}
 });
 it('publishes only review_progress when Realtime uses explicit tables',async()=>{
   const isolated=new PGlite();
   try {
     await isolated.exec(`create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create publication supabase_realtime;`);
     await isolated.exec(readFileSync('supabase/migrations/202610300001_review.sql','utf8'));
     const rows=(await isolated.query<{tablename:string}>(`select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and left(tablename,7)='review_' order by tablename`)).rows;
     expect(rows.map(r=>r.tablename)).toEqual(['review_progress']);
   } finally {await isolated.close();}
 });
});
