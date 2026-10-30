import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {IDBFactory} from 'fake-indexeddb';
import App from '../src/App';

// Browser service boundary only. Draft storage, sync engine, forms and persisted backend remain real.
const activeLocks=new Set<string>();
function lockManager(){
 const held=activeLocks;
 return {request:async(name:string,options:unknown,callback?: (lock:unknown)=>unknown)=>{
  const cb=typeof options==='function'?options as (lock:unknown)=>unknown:callback!;
  if(held.has(name))return cb(null);
  held.add(name);try{return await cb({name,mode:'exclusive'});}finally{held.delete(name);}
 }} as unknown as LockManager;
}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();Object.defineProperty(globalThis,'indexedDB',{value:new IDBFactory(),configurable:true});Object.defineProperty(navigator,'locks',{value:lockManager(),configurable:true});});
afterEach(async()=>{cleanup();await waitFor(()=>expect(activeLocks.size).toBe(0));});
describe('real UI with local synthetic persistence',()=>{
 it('gives member two separate thirds of all three main review groups',async()=>{
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:/R2.*합성/}));
  await screen.findByRole('button',{name:'3인 균등 분담'}).then(button=>fireEvent.click(button));
  await screen.findByRole('heading',{name:'합성지원사업 28'});
  expect(screen.getByRole('button',{name:/팀원 2 · R1 정책 이슈 평가/}).textContent).toContain('0 / 27');
  fireEvent.click(screen.getByRole('button',{name:/팀원 2 · R2 독립 정책 평가/}));
  await screen.findByRole('heading',{name:'합성지원사업 9'});
  fireEvent.click(screen.getByRole('button',{name:/팀원 2 · H1 E3-B 탐색 평가/}));
  await screen.findByRole('heading',{name:'합성지원사업 24'});
  expect(screen.getByText(/주 평가 58건/)).toBeTruthy();
 });
 it('flushes an edit immediately before switching assignments and restores it after reopening',async()=>{
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:/R1.*합성/}));
  await screen.findByRole('heading',{name:'합성지원사업 1'});
  fireEvent.click(screen.getByRole('button',{name:/×\s*no/}));
  fireEvent.change(screen.getByLabelText(/검토 메모/),{target:{value:'이동 전 보관 확인'}});
  fireEvent.click(screen.getByRole('button',{name:/R1_DEDUP 중복 정책 판정/}));
  await screen.findByText('같은 정책을 가리키나요?');
  fireEvent.click(screen.getByRole('button',{name:/R1 정책 이슈 평가/}));
  await screen.findByDisplayValue('이동 전 보관 확인');
  await waitFor(()=>expect(screen.getByRole('button',{name:/R1 정책 이슈 평가/}).textContent).toContain('1 / 81'));
 });
 it('retains an offline draft across unmount and sends it after explicit reconnection',async()=>{
  const first=render(<App/>);fireEvent.click(screen.getByRole('button',{name:/R1.*합성/}));
  await screen.findByRole('heading',{name:'합성지원사업 1'});
  fireEvent.click(screen.getByRole('button',{name:'오프라인 연습'}));
  fireEvent.click(screen.getByRole('button',{name:/×\s*no/}));
  fireEvent.change(screen.getByLabelText(/검토 메모/),{target:{value:'오프라인 복구'}});
  await waitFor(()=>expect(screen.getByText(/미동기화 1개/)).toBeTruthy());
  first.unmount();await waitFor(()=>expect(activeLocks.size).toBe(0));render(<App/>);
  await screen.findByDisplayValue('오프라인 복구');
  expect(screen.getByRole('button',{name:/R1 정책 이슈 평가/}).textContent).toContain('0 / 81');
  fireEvent.click(screen.getByRole('button',{name:'온라인 연습으로 전환'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:/R1 정책 이슈 평가/}).textContent).toContain('1 / 81'));
 });
});
