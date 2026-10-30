import {beforeEach,describe,expect,it} from 'vitest';
import {DemoBackend,closeDemoBlind,officialAssignments} from '../src/demo';
import {createTeamAssignments,teamAllocation,SOURCE_GROUPS} from '../src/allocation';
import {syntheticDocument} from '../src/synthetic';
import {mergeTeamReviewCsv,parseReviewCsv} from '../src/csv';
import type {Labels,TaskKind} from '../src/contracts';
beforeEach(()=>localStorage.clear());
describe('three teammates complete and combine their work',()=>{
 it('locks all 18 slices of 491 synthetic items and reconstructs six whole source CSVs',async()=>{
  const work=createTeamAssignments(['demo-r1','demo-r2','demo-h1']);
  const labels:Record<TaskKind,Labels>={blind:{policy_discussion:'no'},e3b:{policy_discussion:'no'},dedup:{same_policy:'yes'},sample:{policy_named:'no'},committee:{committee_ok:'yes'}};
  const admin=new DemoBackend('demo-admin');
  for(const assignment of work){
   const reviewer=new DemoBackend(assignment.reviewerId),doc=syntheticDocument(assignment);
   for(const row of doc.rows)expect((await reviewer.save({assignmentId:assignment.id,itemId:row[doc.idColumn],expectedVersion:0,mutationId:crypto.randomUUID(),labels:labels[assignment.kind]})).ok).toBe(true);
   await reviewer.submit(assignment.id);
  }
  await expect(admin.exportLocked(work[0].id)).rejects.toThrow();
  closeDemoBlind('demo-team-split');
  const progress=(await admin.progress()).filter(p=>teamAllocation(p.roleCode));
  expect(progress).toHaveLength(18);expect(progress.reduce((n,p)=>n+p.complete,0)).toBe(491);
  for(const source of SOURCE_GROUPS){
   const sourceAssignment=officialAssignments.find(a=>a.roleCode===source.role)!,doc=syntheticDocument(sourceAssignment);
   const parts=await Promise.all(work.filter(a=>teamAllocation(a.roleCode)?.sourceRole===source.role).map(async a=>({assignment:{...a,submittedAt:progress.find(p=>p.assignmentId===a.id)!.submittedAt},annotations:await admin.exportLocked(a.id)})));
   const csv=parseReviewCsv(mergeTeamReviewCsv(doc,parts,{blindClosed:true}),source.kind);
   expect(csv.header).toEqual(doc.header);expect(csv.rows).toHaveLength(source.total);
   expect(csv.rows.map(row=>row[doc.idColumn])).toEqual(doc.rows.map(row=>row[doc.idColumn]));
   expect(new Set(csv.rows.map(row=>row[doc.idColumn])).size).toBe(source.total);
  }
 });
});
