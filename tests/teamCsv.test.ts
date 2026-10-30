import {describe,expect,it} from 'vitest';
import type {Annotation} from '../src/contracts';
import {createTeamAssignments} from '../src/allocation';
import {officialAssignments} from '../src/demo';
import {syntheticDocument} from '../src/synthetic';
import {selectAssignmentDocument,mergeTeamReviewCsv,parseReviewCsv} from '../src/csv';
const work=createTeamAssignments(['one','two','three']);
const full=syntheticDocument(officialAssignments[0]);
const second=work.find(a=>a.roleCode==='B2_R1')!;
const parts=work.filter(a=>a.roleCode.endsWith('_R1')).map(assignment=>({
 assignment:{...assignment,submittedAt:'2026-10-30T00:00:00Z'},
 annotations:selectAssignmentDocument(full,assignment).rows.map(row=>({assignmentId:assignment.id,itemId:row.blind_id,reviewerId:assignment.reviewerId,labels:{policy_discussion:'no'},version:1,updatedAt:'2026-10-30T00:00:00Z'} as Annotation)),
}));
describe('team CSV partition and local recombination',()=>{
 it('automatically takes the member slice from a full source CSV without changing source cells or IDs',()=>{
  const imported={...full,datasetClass:'real' as const};
  const selected=selectAssignmentDocument(imported,second);
  expect(selected.rows).toEqual(full.rows.slice(27,54));expect(selected.rows).toHaveLength(27);
  expect(selected.rows[0].blind_id).toBe('item-028');expect(selected.header).toEqual(full.header);
  expect(selected.datasetClass).toBe('real');expect(full.rows).toHaveLength(81);
  expect(selectAssignmentDocument(selected,second).rows).toEqual(selected.rows);
  const h1=work.find(a=>a.roleCode==='B3_H1')!;
  const h1doc=selectAssignmentDocument(syntheticDocument(officialAssignments[2]),h1);
  expect(h1doc.rows).toHaveLength(22);expect(h1doc.rows[0].review_id).toBe('item-047');
 });
 it('rejects wrong groups, incorrect assignment metadata and unrelated row counts',()=>{
  expect(()=>selectAssignmentDocument({...full,rows:full.rows.slice(0,80)},second)).toThrow();
  expect(()=>selectAssignmentDocument(full,{...second,total:26})).toThrow();
  expect(()=>selectAssignmentDocument(full,work.find(a=>a.roleCode==='B1_H1')!)).toThrow();
 });
 it('combines three locked same-group sessions in original row order with reviewer attribution',()=>{
  const csv=mergeTeamReviewCsv(full,[parts[2],parts[0],parts[1]],{blindClosed:true});
  const merged=parseReviewCsv(csv,'blind');expect(merged.rows).toHaveLength(81);
  expect(merged.header).toEqual(full.header);expect(merged.rows.map(row=>row.blind_id)).toEqual(full.rows.map(row=>row.blind_id));
  expect(merged.rows.every((row,i)=>row.evidence_1_quote===full.rows[i].evidence_1_quote&&row.policy_discussion==='no')).toBe(true);
  expect([merged.rows[0].reviewer,merged.rows[27].reviewer,merged.rows[54].reviewer]).toEqual(['팀원 1','팀원 2','팀원 3']);
 });
 it('rejects unclosed, unlocked, missing, mixed-project and foreign or misallocated annotations',()=>{
  expect(()=>mergeTeamReviewCsv(full,parts,{blindClosed:false})).toThrow();
  expect(()=>mergeTeamReviewCsv(full,parts.slice(0,2),{blindClosed:true})).toThrow();
  for(const changed of [
   {...parts[0],assignment:{...parts[0].assignment,submittedAt:null}},
   {...parts[0],assignment:{...parts[0].assignment,projectId:'other-project'}},
   {...parts[0],annotations:parts[0].annotations.map((a,i)=>i===0?{...a,reviewerId:'foreign'}:a)},
   {...parts[0],annotations:parts[0].annotations.map((a,i)=>i===0?{...a,itemId:'item-028'}:a)},
  ])expect(()=>mergeTeamReviewCsv(full,[changed,parts[1],parts[2]],{blindClosed:true})).toThrow();
 });
});
