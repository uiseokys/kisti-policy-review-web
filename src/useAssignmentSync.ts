import {useEffect,useRef,useState} from 'react';
import type {Assignment,ReviewBackend} from './contracts';
import type {ReviewDocument} from './csv';
import {acquireAssignmentLock,waitForAssignmentLock} from './locks';
import {SyncEngine} from './sync';
import {IndexedDbQueue,loadLocalDocument} from './storage';

/** Keep lock ownership until all pending local transactions have settled. */
export function useAssignmentSync(ownerId:string,assignment:Assignment,backend:ReviewBackend,doc:ReviewDocument|null,offline:boolean,notice:(text:string)=>void){
 const [engine,setEngine]=useState<SyncEngine|null>(null),[lockError,setLockError]=useState('');
 const online=useRef(false);online.current=!offline&&doc?.datasetClass==='synthetic';
 useEffect(()=>{
  if(!doc)return;let canceled=false;const controller=new AbortController();let instance:SyncEngine|null=null;let release:(()=>void)|null=null;
  setEngine(null);setLockError('');
  const opening=(async()=>{
   release=await waitForAssignmentLock(ownerId,assignment.id,controller.signal,()=>setLockError('이 브라우저의 다른 탭 또는 복구 작업이 같은 항목을 편집 중입니다. 초안 보호를 위해 대기하며, 잠금이 풀리면 자동으로 이어집니다.'));
   if(canceled)return;
   if(!release)return;
   setLockError('');
   const namespace=doc.datasetClass==='real'?`local-only/${assignment.id}/${doc.rows[0]?.[doc.idColumn]}`:assignment.id;
   instance=new SyncEngine({ownerId,assignmentId:namespace,transport:backend});instance.setOnline(online.current);
   await instance.start();if(!canceled)setEngine(instance);
  })().catch(error=>{if(!canceled)setLockError(error instanceof Error?error.message:'로컬 저장소를 열지 못했습니다.');});
  return()=>{
   canceled=true;controller.abort();instance?.stop();
   void opening.finally(async()=>{instance?.stop();try{await instance?.persist();}catch{notice('로컬 저장을 마치지 못했습니다. 저장 공간을 확인해 주세요.');}finally{release?.();}});
  };
 },[ownerId,assignment.id,backend,doc,notice]);
 return {engine,lockError};
}

/** Drain previously visited synthetic assignments after login/reconnect without stealing an active editor lock. */
export function useOutboxRecovery(ownerId:string,assignments:Assignment[],backend:ReviewBackend,activeAssignmentId?:string){
 const [pending,setPending]=useState(0);
 useEffect(()=>{
  let stopped=false,running=false;const active=new Set<SyncEngine>();const store=new IndexedDbQueue();
  const recover=async()=>{
   if(stopped||running)return;running=true;let total=0;
   try{for(const assignment of assignments){
    if(stopped)break;
    const records=await store.getAll(ownerId,assignment.id);const dirty=Object.values(records).filter(r=>r.saveState!=='saved');total+=dirty.length;
    if(assignment.id===activeAssignmentId||!dirty.length||!navigator.onLine||sessionStorage.getItem('kisti-demo-offline')==='1'&&backend.mode==='demo')continue;
    const doc=await loadLocalDocument(ownerId,assignment.id) as ReviewDocument|null;
    if(doc?.datasetClass==='real'||dirty.every(r=>r.saveState==='conflict'||r.terminal))continue;
    const release=await acquireAssignmentLock(ownerId,assignment.id);if(!release)continue;
    const engine=new SyncEngine({ownerId,assignmentId:assignment.id,transport:backend,store});active.add(engine);
    try{
     if(stopped)continue;
     await engine.start();await engine.flush();await engine.persist();
     const snapshot=engine.getSnapshot(),states=Object.values(snapshot.records).map(r=>r.saveState);
     const state=states.includes('conflict')?'conflict':states.includes('error')?'error':snapshot.pending?'pending':'saved';
     const device=localStorage.getItem('kisti-device-id');if(device)await backend.reportSync?.(assignment.id,device,snapshot.pending,state);
    }finally{engine.stop();await engine.persist().catch(()=>{});active.delete(engine);release();}
   }if(!stopped)setPending(total);}catch{/* Active editor still exposes local storage/network errors. */}finally{running=false;}
  };
  void recover();const timer=setInterval(()=>void recover(),10000);const online=()=>void recover();window.addEventListener('online',online);window.addEventListener('kisti-sync-online',online);window.addEventListener('focus',online);
  return()=>{stopped=true;for(const engine of active)engine.stop();clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('kisti-sync-online',online);window.removeEventListener('focus',online);};
 },[ownerId,assignments,backend,activeAssignmentId]);
 return pending;
}
