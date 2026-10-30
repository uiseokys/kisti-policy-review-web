import {beforeEach,describe,it,expect} from 'vitest';
import {DemoBackend,officialAssignments} from '../src/demo';
import {teamAllocation} from '../src/allocation';
beforeEach(()=>localStorage.clear());
describe('persisted local synthetic practice backend',()=>{
 it('keeps optional balanced work in a separate project with preserved task kinds',async()=>{
  const balancedAssignments=(await Promise.all(['demo-r1','demo-r2','demo-h1'].map(id=>new DemoBackend(id).assignments()))).flat().filter(a=>a.mode==='balanced'&&teamAllocation(a.roleCode));
  expect(balancedAssignments).toHaveLength(18);
  expect(['demo-r1','demo-r2','demo-h1'].map(id=>balancedAssignments.filter(a=>a.reviewerId===id).reduce((n,a)=>n+a.total,0))).toEqual([164,164,163]);
  expect(balancedAssignments.every(a=>a.mode==='balanced'&&a.projectId!==officialAssignments[0].projectId)).toBe(true);
  expect(['blind','e3b','dedup','sample','committee'].map(kind=>balancedAssignments.filter(a=>a.kind===kind).reduce((n,a)=>n+a.total,0))).toEqual([105,68,8,300,10]);
 });
 it('keeps official role counts and does not count partial committed inputs',async()=>{
  expect(officialAssignments.map(a=>a.total)).toEqual([81,24,68,8,300,10]);
  const backend=new DemoBackend('demo-r1');const a=officialAssignments[0];
  const save=await backend.save({assignmentId:a.id,itemId:'item-001',expectedVersion:0,mutationId:'m1',labels:{policy_discussion:'yes'}});
  expect(save.ok).toBe(true);expect((await backend.progress()).find(p=>p.assignmentId===a.id)?.complete).toBe(0);
  expect((await backend.progress()).find(p=>p.assignmentId===a.id)?.inProgress).toBe(1);
 });
 it('detects version conflicts and isolates reviewers',async()=>{
  const r1=new DemoBackend('demo-r1');const r2=new DemoBackend('demo-r2');const a=officialAssignments[0];
  const first={assignmentId:a.id,itemId:'item-001',expectedVersion:0,mutationId:'m1',labels:{policy_discussion:'no' as const}};
  expect((await r1.save(first)).ok).toBe(true);
  expect((await r1.save(first)).ok).toBe(true);
  const stale=await r1.save({...first,mutationId:'m2',labels:{policy_discussion:'unsure'}});
  expect(!stale.ok&&stale.type).toBe('conflict');
  expect((await r2.load(a.id)).length).toBe(0);
  expect((await r2.save({...first,mutationId:'m3'})).ok).toBe(false);
 });
 it('restores from committed storage and recalculates completion after editing',async()=>{
  const a=officialAssignments[0];const backend=new DemoBackend('demo-r1');
  await backend.save({assignmentId:a.id,itemId:'item-001',expectedVersion:0,mutationId:'m1',labels:{policy_discussion:'no'}});
  const again=new DemoBackend('demo-r1');expect((await again.load(a.id))[0].version).toBe(1);
  expect((await again.progress())[0].complete).toBe(1);
  await again.save({assignmentId:a.id,itemId:'item-001',expectedVersion:1,mutationId:'m2',labels:{policy_discussion:'yes'}});
  expect((await again.progress())[0].complete).toBe(0);
  await expect(new DemoBackend('demo-admin').exportLocked(a.id)).rejects.toThrow();
 });
});
