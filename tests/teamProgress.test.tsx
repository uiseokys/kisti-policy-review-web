import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {TeamProgress,plannedTeamTotal} from '../src/TeamProgress';
afterEach(cleanup);
describe('planned work before teammates join',()=>{
 it('shows all three planned seats with zero saved answers before registration',()=>{
  render(<TeamProgress progress={[]}/>);
  const rows=within(screen.getByRole('table',{name:'팀원별 평가 분담'})).getAllByRole('row');
  expect(rows).toHaveLength(4);
  expect(rows[1].textContent).toContain('0 / 164');expect(rows[2].textContent).toContain('0 / 164');expect(rows[3].textContent).toContain('0 / 163');
  expect(plannedTeamTotal([])).toBe(491);
 });
 it('keeps the denominator at the full project plan while seats are unclaimed',()=>{
  expect(plannedTeamTotal([{projectId:'p1'}])).toBe(491);
  expect(plannedTeamTotal([{projectId:'p1'},{projectId:'p1'},{projectId:'p2'}])).toBe(982);
 });
});
