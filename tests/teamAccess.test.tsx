import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {TeamAccess} from '../src/TeamAccess';
afterEach(()=>{cleanup();window.history.replaceState(null,'','/');});
function gateway(){
 const invoke=vi.fn().mockResolvedValue({data:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'},error:null});
 const setSession=vi.fn().mockResolvedValue({error:null});
 return {invoke,setSession,client:{functions:{invoke},auth:{setSession}} as unknown as SupabaseClient};
}
describe('self-service team access',()=>{
 it('registers from a private seat link then installs the session without asking for email',async()=>{
  window.history.replaceState(null,'','/#join='+('j'.repeat(43))+'&seat=member2');
  const service=gateway();render(<TeamAccess client={service.client}/>);
  expect(screen.queryByLabelText('이메일')).toBeNull();
  fireEvent.change(screen.getByLabelText('이름'),{target:{value:'팀원 김'}});
  fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'SyntheticPassword12!'}});
  fireEvent.change(screen.getByLabelText('비밀번호 확인'),{target:{value:'SyntheticPassword12!'}});
  fireEvent.click(screen.getByRole('button',{name:'설정하고 평가 시작'}));
  await waitFor(()=>expect(service.setSession).toHaveBeenCalledWith({access_token:'synthetic-access',refresh_token:'synthetic-refresh'}));
  expect(service.invoke.mock.calls[0][1].body).toMatchObject({action:'register',seat:'member2',name:'팀원 김',invite:'j'.repeat(43)});
  expect(window.location.hash).toBe('');
 });
 it('returns to a seat with name and password, and never sends an invitation for login',async()=>{
  const service=gateway();render(<TeamAccess client={service.client}/>);
  fireEvent.click(screen.getByRole('button',{name:'팀원 3'}));
  fireEvent.change(screen.getByLabelText('이름'),{target:{value:'박 팀원'}});
  fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'SyntheticPassword12!'}});
  fireEvent.click(screen.getByRole('button',{name:'이어서 평가하기'}));
  await waitFor(()=>expect(service.setSession).toHaveBeenCalled());
  expect(service.invoke.mock.calls[0][1].body).toEqual({action:'login',seat:'member3',name:'박 팀원',password:'SyntheticPassword12!'});
 });
 it('keeps a failed registration on screen without creating a session',async()=>{
  window.history.replaceState(null,'','/#join='+('j'.repeat(43))+'&seat=member1');
  const service=gateway();service.invoke.mockResolvedValue({data:{error:'참여 링크를 확인해 주세요.'},error:null});render(<TeamAccess client={service.client}/>);
  fireEvent.change(screen.getByLabelText('이름'),{target:{value:'팀원 한'}});
  fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'SyntheticPassword12!'}});
  fireEvent.change(screen.getByLabelText('비밀번호 확인'),{target:{value:'SyntheticPassword12!'}});
  fireEvent.click(screen.getByRole('button',{name:'설정하고 평가 시작'}));
  expect(await screen.findByRole('alert')).toBeTruthy();expect(service.setSession).not.toHaveBeenCalled();
 });
});
