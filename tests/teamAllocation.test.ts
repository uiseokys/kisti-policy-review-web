import {beforeEach,describe,expect,it} from 'vitest';
import {createTeamAssignments,SOURCE_GROUPS,teamAllocation} from '../src/allocation';
import {syntheticDocument} from '../src/synthetic';
import {DemoBackend,officialAssignments} from '../src/demo';
beforeEach(()=>localStorage.clear());
describe('three-member source group allocation',()=>{
 it('splits each original role separately, balances remainders, and preserves official assignments',()=>{
  const work=createTeamAssignments(['demo-r1','demo-r2','demo-h1']);
  expect(work).toHaveLength(18);
  expect(SOURCE_GROUPS.map(group=>work.filter(a=>teamAllocation(a.roleCode)?.sourceRole===group.role).map(a=>a.total))).toEqual([[27,27,27],[8,8,8],[23,23,22],[3,2,3],[100,100,100],[3,4,3]]);
  expect(['demo-r1','demo-r2','demo-h1'].map(owner=>work.filter(a=>a.reviewerId===owner&&['R1','R2','H1'].includes(teamAllocation(a.roleCode)!.sourceRole)).reduce((n,a)=>n+a.total,0))).toEqual([58,58,57]);
  expect(['demo-r1','demo-r2','demo-h1'].map(owner=>work.filter(a=>a.reviewerId===owner).reduce((n,a)=>n+a.total,0))).toEqual([164,164,163]);
  expect(officialAssignments.map(a=>a.total)).toEqual([81,24,68,8,300,10]);
 });
 it('covers every source row exactly once, with consistent source IDs in generated documents',()=>{
  const work=createTeamAssignments(['demo-r1','demo-r2','demo-h1']);
  for(const group of SOURCE_GROUPS){
   const parts=work.filter(a=>teamAllocation(a.roleCode)?.sourceRole===group.role);
   const ids=parts.flatMap(a=>{const doc=syntheticDocument(a);return doc.rows.map(row=>row[doc.idColumn]);});
   expect(ids).toEqual(Array.from({length:group.total},(_,i)=>`item-${String(i+1).padStart(3,'0')}`));
   expect(new Set(ids).size).toBe(group.total);
   expect(parts.every(a=>a.kind===group.kind)).toBe(true);
  }
 });
 it('accepts only the signed-in member source range and isolates another member assignments',async()=>{
  const owner=new DemoBackend('demo-r2'),other=new DemoBackend('demo-r1');
  const assignment=(await owner.assignments()).find(a=>a.roleCode==='B2_R1')!;
  expect(assignment).toBeDefined();
  const command={assignmentId:assignment.id,itemId:'item-028',expectedVersion:0,mutationId:crypto.randomUUID(),labels:{policy_discussion:'no' as const}};
  expect((await owner.save(command)).ok).toBe(true);
  expect((await owner.save({...command,itemId:'item-001',mutationId:crypto.randomUUID()})).ok).toBe(false);
  expect((await other.load(assignment.id))).toEqual([]);
  expect((await other.save({...command,mutationId:crypto.randomUUID()})).ok).toBe(false);
 });
});
