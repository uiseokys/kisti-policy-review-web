import { describe, expect, it } from 'vitest';
import { assessLabels } from '../src/domain';
describe('persisted label completeness', () => {
  it('distinguishes empty and incomplete valid drafts', () => {
    expect(assessLabels('blind', {})).toMatchObject({valid:true,complete:false,started:false});
    expect(assessLabels('blind', {policy_discussion:'yes'})).toMatchObject({valid:true,complete:false,started:true});
  });
  it('requires task-specific conditional evidence', () => {
    expect(assessLabels('blind', {policy_discussion:'yes',act:'report',evidence_supports:'partly'}).complete).toBe(true);
    expect(assessLabels('e3b', {policy_discussion:'yes',evidence_supports:'yes'}).complete).toBe(true);
    expect(assessLabels('sample', {policy_named:'yes',policy_name:'Synthetic',act:'report'}).complete).toBe(true);
    expect(assessLabels('committee', {committee_ok:'no'}).complete).toBe(false);
    expect(assessLabels('committee', {committee_ok:'no',correct_committee:'Synthetic'}).complete).toBe(true);
    expect(assessLabels('dedup', {same_policy:'unsure'}).complete).toBe(true);
  });
  it('rejects nonapplicable and unsafe fields', () => {
    for (const labels of [{policy_discussion:'no',act:'report'}, {policy_discussion:'unsure',evidence_supports:'yes'}, {rogue:'raw text'}, {note:42}, {note:'a'.repeat(2001)}]) {
      expect(assessLabels('blind', labels as never).valid).toBe(false);
    }
    expect(assessLabels('e3b', {policy_discussion:'yes',act:'report'}).valid).toBe(false);
    expect(assessLabels('sample', {policy_named:'no',policy_name:'raw'}).valid).toBe(false);
    expect(assessLabels('committee', {committee_ok:'yes',correct_committee:'raw'}).valid).toBe(false);
  });
});
