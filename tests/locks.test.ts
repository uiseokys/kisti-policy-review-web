import {describe,it,expect,vi} from 'vitest';
import {acquireAssignmentLock,waitForAssignmentLock} from '../src/locks';
describe('single writer safety boundary',()=>{
 it('fails closed when safe cross-tab locks are unavailable',async()=>{
  await expect(acquireAssignmentLock('owner','assignment',undefined)).rejects.toThrow(/브라우저/);
 });
 it('resumes a waiting editor after the previous writer releases, and cancels closed editors',async()=>{
  vi.useFakeTimers();
  try{
   let held=true;let released=false;
   const manager={request:async(_name:string,_options:unknown,cb:(lock:unknown)=>unknown)=>cb(held?null:{name:'assignment'})} as unknown as LockManager;
   const waiting=vi.fn(),controller=new AbortController();
   const pending=waitForAssignmentLock('owner','assignment',controller.signal,waiting,manager);
   await vi.advanceTimersByTimeAsync(1);expect(waiting).toHaveBeenCalled();
   held=false;const acquired=pending.then(release=>{released=!!release;release?.();});
   await vi.advanceTimersByTimeAsync(500);await acquired;expect(released).toBe(true);
   held=true;const stopped=new AbortController();
   const canceled=waitForAssignmentLock('owner','assignment',stopped.signal,waiting,manager);
   stopped.abort();await expect(canceled).resolves.toBeNull();
   expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
 });
});
