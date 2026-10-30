import { describe, it, expect } from 'vitest';
import { parseReviewCsv, mergeReviewCsv } from '../src/csv';
import type { Annotation } from '../src/contracts';
const source = '\uFEFFblind_id,name,evidence_1_quote,policy_discussion,act,evidence_supports,note,reviewer,label_source\r\nb-01,합성사업,"합성 문장, 쉼표\n둘째 줄",,,,,,human\r\n';
const annotation: Annotation = {assignmentId:'a',itemId:'b-01',reviewerId:'r',labels:{policy_discussion:'yes',act:'inquiry',evidence_supports:'yes',note:'합성 검토'},version:1,updatedAt:'2026-10-30T00:00:00Z'};
describe('local CSV import/export', () => {
  it('retains a quoted multiline source and marks user imports real by default', () => {
    const doc = parseReviewCsv(source, 'blind');
    expect(doc.rows[0].evidence_1_quote).toBe('합성 문장, 쉼표\n둘째 줄');
    expect(doc.datasetClass).toBe('real');
    expect(doc.bom).toBe(true);
  });
  it('merges labels only after lock and blind closure, preserving every source cell', () => {
    const doc = parseReviewCsv(source, 'blind');
    expect(() => mergeReviewCsv(doc,[annotation],{locked:false,blindClosed:true,reviewer:'R1'})).toThrow();
    expect(() => mergeReviewCsv(doc,[annotation],{locked:true,blindClosed:false,reviewer:'R1'})).toThrow();
    const merged=parseReviewCsv(mergeReviewCsv(doc,[annotation],{locked:true,blindClosed:true,reviewer:'R1'}),'blind');
    expect(merged.header).toEqual(doc.header);
    expect(merged.rows[0].evidence_1_quote).toBe(doc.rows[0].evidence_1_quote);
    expect(merged.rows[0].policy_discussion).toBe('yes');
    expect(merged.rows[0].label_source).toBe('human');
  });
  it('rejects duplicate IDs and incomplete or extra exports', () => {
    expect(() => parseReviewCsv(source+'b-01,重複,,,,,,,\r\n','blind')).toThrow();
    const doc=parseReviewCsv(source,'blind');
    expect(()=>mergeReviewCsv(doc,[],{locked:true,blindClosed:true,reviewer:'R1'})).toThrow();
    expect(()=>mergeReviewCsv(doc,[{...annotation,labels:{policy_discussion:'yes'}}],{locked:true,blindClosed:true,reviewer:'R1'})).toThrow();
  });
});
