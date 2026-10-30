import {beforeEach,describe,expect,it} from 'vitest';
import {DemoBackend,closeDemoBlind,officialAssignments} from '../src/demo';
import {syntheticDocument} from '../src/synthetic';
import {mergeReviewCsv,parseReviewCsv} from '../src/csv';
import type {Labels,TaskKind} from '../src/contracts';

beforeEach(()=>localStorage.clear());
describe('full synthetic official workflow',()=>{
 it('completes all 491 official items, locks six assignments, and exports preserved local CSVs after blind closure',async()=>{
  const completed:Record<TaskKind,Labels>={
   blind:{policy_discussion:'yes',act:'report',evidence_supports:'yes'},
   e3b:{policy_discussion:'yes',evidence_supports:'partly'},
   dedup:{same_policy:'yes'},
   sample:{policy_named:'yes',policy_name:'합성 평가 정책',act:'report'},
   committee:{committee_ok:'no',correct_committee:'합성 위원회'},
  };
  const admin=new DemoBackend('demo-admin');
  for(const assignment of officialAssignments){
   const reviewer=new DemoBackend(assignment.reviewerId);
   await expect(reviewer.submit(assignment.id)).rejects.toThrow();
   for(let i=1;i<=assignment.total;i++){
    expect((await reviewer.save({assignmentId:assignment.id,itemId:`item-${String(i).padStart(3,'0')}`,expectedVersion:0,mutationId:crypto.randomUUID(),labels:completed[assignment.kind]})).ok).toBe(true);
   }
   await reviewer.submit(assignment.id);
   await expect(admin.exportLocked(assignment.id)).rejects.toThrow();
  }
  const progress=(await admin.progress()).filter(p=>p.mode==='official');
  expect(progress.reduce((n,p)=>n+p.complete,0)).toBe(491);
  expect(progress.every(p=>p.percent===100&&p.submittedAt)).toBe(true);
  closeDemoBlind('demo-official');
  for(const assignment of officialAssignments){
   const doc=syntheticDocument(assignment),annotations=await admin.exportLocked(assignment.id);
   const result=parseReviewCsv(mergeReviewCsv(doc,annotations,{locked:true,blindClosed:true,reviewer:assignment.roleCode}),assignment.kind);
   expect(result.header).toEqual(doc.header);expect(result.rows).toHaveLength(assignment.total);
   const labelFields=new Set(['policy_discussion','act','evidence_supports','same_policy','policy_named','policy_name','committee_ok','correct_committee','note','reviewer','label_source']);
   for(let i=0;i<doc.rows.length;i++)for(const field of doc.header)if(!labelFields.has(field))expect(result.rows[i][field]).toBe(doc.rows[i][field]);
  }
 });
});
