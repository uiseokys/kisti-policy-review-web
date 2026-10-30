/** Real remote integration, explicitly gated; never imported by frontend code. */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
if(existsSync('.env.local')) {
 for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m||process.env[m[1]]!==undefined)continue;
  let value=m[2]; if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
  process.env[m[1]]=value;
 }
}
const keys=['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','SUPABASE_TEST_SECRET_KEY'];
if(process.env.RUN_SUPABASE_INTEGRATION!=='1'||keys.some(k=>!process.env[k])){
 console.log('SKIP: Real Supabase integration NOT RUN. Requires RUN_SUPABASE_INTEGRATION=1 and VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_TEST_SECRET_KEY in local CLI environment/.env.local.');process.exit(0);
}
const url=process.env.VITE_SUPABASE_URL, anon=process.env.VITE_SUPABASE_PUBLISHABLE_KEY, secret=process.env.SUPABASE_TEST_SECRET_KEY;
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const privileged=createClient(url,secret,opts);
const projectId=randomUUID(), assignmentId=randomUUID(), r2AssignmentId=randomUUID(), h1AssignmentId=randomUUID(), runId=randomUUID();const users=[],clients=[],credentials=[];let channel,temporaryCsvDirectory;
const check=({data,error})=>{if(error)throw new Error(error.message);return data;};
const csvCell=value=>`"${String(value??'').replaceAll('"','""')}"`;
const csv=(headers,rows)=>[headers.map(csvCell).join(','),...rows.map(row=>headers.map(key=>csvCell(row[key])).join(','))].join('\r\n')+'\r\n';
let passed=false;
try {
 for(let i=0;i<4;i++){
  const password=`Synthetic!${randomUUID()}`;const email=`synthetic-${runId}-${i}@example.com`;
  credentials.push({email,password});
  const user=check(await privileged.auth.admin.createUser({email,password,email_confirm:true})).user;users.push(user.id);
  const c=createClient(url,anon,opts);check(await c.auth.signInWithPassword({email,password}));clients.push(c);
 }
 const [reviewer,other,h1,admin]=clients;
 const secondDevice=createClient(url,anon,opts);check(await secondDevice.auth.signInWithPassword(credentials[0]));clients.push(secondDevice);
 check(await privileged.from('review_projects').insert({id:projectId,name:`Synthetic integration ${runId}`}));
 check(await privileged.from('review_memberships').insert(users.map((user_id,i)=>({project_id:projectId,user_id,role:i===3?'admin':'reviewer'}))));
 check(await privileged.from('review_assignments').insert([
  {id:assignmentId,project_id:projectId,reviewer_id:users[0],role_code:'R1',kind:'blind',total:2},
  {id:r2AssignmentId,project_id:projectId,reviewer_id:users[1],role_code:'R2',kind:'blind',total:1},
  {id:h1AssignmentId,project_id:projectId,reviewer_id:users[2],role_code:'H1',kind:'e3b',total:1}
 ]));
 check(await privileged.from('review_items').insert([...([1,2].map(i=>({assignment_id:assignmentId,item_id:`syn-test-${i}`,position:i}))),{assignment_id:r2AssignmentId,item_id:'syn-r2-1',position:1},{assignment_id:h1AssignmentId,item_id:'syn-h1-1',position:1}]));
 assert.equal(check(await reviewer.from('review_assignments').select('id').eq('id',assignmentId)).length,1);
 assert.equal(check(await other.from('review_assignments').select('id').eq('id',assignmentId)).length,0);
 assert.equal(check(await admin.from('review_progress').select('*').eq('assignment_id',assignmentId))[0].complete,0);
 // Realtime subscribes to summaries only. Snapshot reads remain necessary on reconnect.
 let eventResolve; const changed=new Promise(resolve=>{eventResolve=resolve;});
 const subscribed=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Realtime subscribe timed out')),20000);
  channel=admin.channel(`synthetic-${runId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'review_progress',filter:`assignment_id=eq.${assignmentId}`},payload=>eventResolve(payload)).subscribe(status=>{
   if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}
   if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(new Error('Realtime subscription failed'));}
  });
 });await subscribed;
 const save=(c,labels,version,mutation=randomUUID(),item='syn-test-1',assignment=assignmentId)=>c.rpc('save_review_annotation',{p_assignment_id:assignment,p_item_id:item,p_expected_version:version,p_mutation_id:mutation,p_labels:labels}).then(check);
 const reportSequences=new Map();
 const report=(c,device,pending,state,delayedSequence)=>{
  const sequence=delayedSequence??((reportSequences.get(device)??0)+1);
  if(delayedSequence===undefined)reportSequences.set(device,sequence);
  return c.rpc('report_review_sync_state',{p_assignment_id:assignmentId,p_device_id:device,p_pending:pending,p_state:state,p_sequence:sequence});
 };
 const labels={policy_discussion:'yes',act:'report',evidence_supports:'yes'};
 const mutation=randomUUID(); const [r1First,r1Second,r2First]=await Promise.all([save(reviewer,labels,0,mutation),save(secondDevice,{policy_discussion:'no'},0),save(other,{policy_discussion:'no'},0,randomUUID(),'syn-r2-1',r2AssignmentId)]);
 assert.equal([r1First,r1Second].filter(r=>r.ok).length,1);assert.equal([r1First,r1Second].filter(r=>r.type==='conflict').length,1);assert.equal(r2First.ok,true);
 const payload=await Promise.race([changed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Realtime progress event timed out')),20000))]);
 assert.equal(payload.new.assignment_id,assignmentId);assert.equal('labels' in payload.new,false);assert.equal('note' in payload.new,false);
 const current=check(await reviewer.from('review_annotations').select('*').eq('assignment_id',assignmentId))[0];assert.equal(current.version,1);
 if(r1First.ok){assert.equal((await save(reviewer,labels,0,mutation)).annotation.version,1);}
 assert.deepEqual(check(await other.from('review_annotations').select('item_id,labels,version').eq('assignment_id',r2AssignmentId))[0].labels,{policy_discussion:'no'});
 assert.equal(check(await reviewer.from('review_annotations').select('item_id').eq('assignment_id',r2AssignmentId)).length,0);
 assert.equal(check(await other.from('review_annotations').select('item_id').eq('assignment_id',assignmentId)).length,0);
 assert.equal((await save(h1,{policy_discussion:'yes',evidence_supports:'yes'},0,randomUUID(),'syn-h1-1',h1AssignmentId)).ok,true);
 check(await h1.auth.signOut());
 const h1Fresh=createClient(url,anon,opts);check(await h1Fresh.auth.signInWithPassword(credentials[2]));clients.push(h1Fresh);
 assert.deepEqual(check(await h1Fresh.from('review_annotations').select('item_id,labels,version').eq('assignment_id',h1AssignmentId))[0].labels,{policy_discussion:'yes',evidence_supports:'yes'});
 assert.equal(check(await reviewer.from('review_annotations').select('item_id').eq('assignment_id',h1AssignmentId)).length,0);
 assert.equal(check(await admin.from('review_annotations').select('*').eq('assignment_id',assignmentId)).length,0);
 assert.equal(check(await other.from('review_annotations').select('*').eq('assignment_id',assignmentId)).length,0);
 assert.equal((await save(other,{},1)).type,'forbidden');
 assert.equal((await save(admin,{},1)).type,'forbidden');
 assert.ok((await report(other,randomUUID(),0,'saved')).error);
 assert.ok((await reviewer.from('review_assignments').insert({id:randomUUID(),project_id:projectId,reviewer_id:users[0],role_code:'R2',kind:'blind',total:1})).error);
 assert.ok((await reviewer.from('review_annotations').update({labels:{}}).eq('assignment_id',assignmentId)).error);
 assert.equal((await save(reviewer,{raw_text:'forbidden'},1)).ok,false);
 assert.equal((await save(reviewer,{policy_discussion:'no',act:'report'},1)).ok,false);
 assert.equal((await save(reviewer,{},1,randomUUID(),'syn-unknown')).type,'forbidden');
 assert.equal((await save(reviewer,{},1)).annotation.version,2);
 let progress=check(await admin.from('review_progress').select('*').eq('assignment_id',assignmentId))[0];assert.equal(progress.complete,0);assert.equal(progress.untouched,2);
 assert.ok((await reviewer.rpc('submit_review_assignment',{p_assignment_id:assignmentId})).error);
 assert.equal((await save(reviewer,{policy_discussion:'no'},2)).ok,true);
 assert.equal((await save(reviewer,{policy_discussion:'no'},0,randomUUID(),'syn-test-2')).ok,true);
 progress=check(await admin.from('review_progress').select('*').eq('assignment_id',assignmentId))[0];assert.equal(progress.complete,2);
 const device1=randomUUID(),device2=randomUUID();
 check(await report(reviewer,device1,0,'saved'));
 check(await report(reviewer,device1,1,'pending'));
 check(await report(reviewer,device1,0,'saved',1)); // Delayed stale ACK cannot clear sequence 2.
 check(await report(secondDevice,device2,0,'saved'));
 progress=check(await admin.from('review_progress').select('*').eq('assignment_id',assignmentId))[0];assert.equal(progress.complete,2);assert.equal(progress.last_sync_state,'pending');assert.ok(progress.last_seen_at);
 assert.ok((await reviewer.rpc('submit_review_assignment',{p_assignment_id:assignmentId})).error);
 check(await report(reviewer,device1,0,'conflict'));
 assert.ok((await reviewer.rpc('submit_review_assignment',{p_assignment_id:assignmentId})).error);
 check(await report(reviewer,device1,0,'saved'));
 check(await reviewer.rpc('submit_review_assignment',{p_assignment_id:assignmentId}));
 assert.equal((await save(reviewer,{},3)).type,'locked');
 assert.ok((await admin.rpc('export_locked_annotations',{p_assignment_id:assignmentId})).error);
 assert.equal(check(await admin.from('review_annotations').select('*').eq('assignment_id',assignmentId)).length,0);
 assert.ok((await reviewer.from('review_projects').update({blind_closed:true}).eq('id',projectId)).error);
 check(await privileged.from('review_projects').update({blind_closed:true}).eq('id',projectId));
 const exported=check(await admin.rpc('export_locked_annotations',{p_assignment_id:assignmentId}));assert.equal(exported.length,2);
 temporaryCsvDirectory=mkdtempSync(join(tmpdir(),'kisti-synthetic-remote-export-'));
 const headers=['blind_id','name','aliases','evidence_1_source_ref','evidence_1_quote','evidence_2_source_ref','evidence_2_quote','policy_discussion','act','evidence_supports','note','reviewer','label_source'];
 const original=exported.map((row,i)=>({blind_id:row.item_id,name:`합성사업 ${i+1}`,aliases:'합성별칭',evidence_1_source_ref:`synthetic:${i+1}`,evidence_1_quote:'합성 인용,\n줄바꿈',evidence_2_source_ref:`synthetic:${i+1}:2`,evidence_2_quote:'두 번째 합성 인용',policy_discussion:'',act:'',evidence_supports:'',note:'',reviewer:'',label_source:'human'}));
 const merged=original.map((row,i)=>({...row,...exported[i].labels,reviewer:'synthetic-human-tester',label_source:'human'}));
 const sourcePath=join(temporaryCsvDirectory,'original.csv'),mergedPath=join(temporaryCsvDirectory,'merged.csv');
 writeFileSync(sourcePath,csv(headers,original),'utf8');writeFileSync(mergedPath,csv(headers,merged),'utf8');
 const validatorArgs=['scripts/verify_csv.py','blind','--sheet',sourcePath,'--labels',mergedPath];
 const knownResearchRoot=join(homedir(),'Developer/kisti-policy-analysis-2026-research-e');
 if(existsSync(join(knownResearchRoot,'docs/superpowers/reports/2026-10-28-e-realdata-guide/labels_check.py')))validatorArgs.push('--research-root',knownResearchRoot);
 const validation=JSON.parse(execFileSync('python3',validatorArgs,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(validation.accepted,true);assert.equal(validation.rows,2);
 assert.equal(check(await admin.from('review_annotations').select('*').eq('assignment_id',assignmentId)).length,0);
 assert.ok((await other.rpc('export_locked_annotations',{p_assignment_id:assignmentId})).error);
 assert.ok((await privileged.from('review_projects').insert({name:'Rejected class test',dataset_class:'real'})).error);
 passed=true;console.log('PASS: real Auth users, R1/R2 concurrent own writes, H1 fresh SDK session restoration, RLS isolation, direct-write rejection, safe Realtime progress, persisted completeness/downgrade, CAS, idempotency, submission lock, export gate and synthetic CSV verification. Fresh SDK login is not a physical-browser/device test.');
}catch(error){
 let message=error instanceof Error?error.message:'Unknown integration failure';for(const s of [secret,anon])if(s)message=message.split(s).join('[REDACTED]');console.error(`FAIL: ${message}`);process.exitCode=1;
}finally{
 if(channel&&clients[3])await clients[3].removeChannel(channel);
 for(const c of clients)await c.auth.signOut();
 if(temporaryCsvDirectory)rmSync(temporaryCsvDirectory,{recursive:true,force:true});
 // This UUID is generated by this invocation; no broad cleanup query is permitted.
 const cleanup=await privileged.from('review_projects').delete().eq('id',projectId);
 if(cleanup.error){console.error('FAIL: synthetic project cleanup failed; inspect the test project via administrator tooling.');process.exitCode=1;}
 for(const id of users){const {error}=await privileged.auth.admin.deleteUser(id);if(error){console.error('FAIL: synthetic Auth user cleanup failed.');process.exitCode=1;}}
 if(passed&&!process.exitCode)console.log('PASS: synthetic test project and Auth users cleaned up.');
}
