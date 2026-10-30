import {describe,expect,it} from 'vitest';
import {initialReviewMode} from '../src/accessMode';
describe('initial workspace mode',()=>{
 it('opens three-member mode for team-only reviewers and admin summaries',()=>{
  expect(initialReviewMode([{mode:'balanced',roleCode:'B2_R1'},{mode:'balanced',roleCode:'B2_H1'}])).toBe('balanced');
 });
 it('preserves official mode when assigned and ignores legacy balanced codes',()=>{
  expect(initialReviewMode([{mode:'official',roleCode:'R1'},{mode:'balanced',roleCode:'B1_R1'}])).toBe('official');
  expect(initialReviewMode([{mode:'balanced',roleCode:'B1_BLIND'}])).toBe('official');
  expect(initialReviewMode([])).toBe('official');
 });
});
