import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
vi.mock('@supabase/supabase-js',()=>({createClient:vi.fn(()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}})}}))}));
import App from '../src/App';
afterEach(()=>{cleanup();vi.unstubAllEnvs();sessionStorage.clear();});
describe('review login',()=>{
 it('offers explicit synthetic reviewer roles without claiming cloud connection',()=>{
  render(<App/>);
  expect(screen.getByRole('button',{name:/R1.*합성/})).toBeTruthy();
  expect(screen.getByRole('button',{name:/관리자.*합성/})).toBeTruthy();
  expect(screen.getByText(/실데이터 클라우드 동기화는 비활성/)).toBeTruthy();
 });
 it('requires real login when connected, ignoring an old local demo identity',()=>{
  vi.stubEnv('VITE_SUPABASE_URL','https://synthetic-test.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_synthetic_test_configuration');
  sessionStorage.setItem('kisti-demo-identity',JSON.stringify({id:'demo-admin',label:'관리자',role:'admin',mode:'demo'}));
  render(<App/>);
  expect(screen.getByLabelText('이름')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/합성 연습/})).toBeNull();
  expect(screen.queryByRole('button',{name:/합성 대시보드/})).toBeNull();
  expect(screen.queryByText('운영 대시보드')).toBeNull();
 });
});
