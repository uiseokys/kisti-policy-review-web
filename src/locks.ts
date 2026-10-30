/** A browser installation may have only one writer for an assignment, including its durable outbox. */
export async function acquireAssignmentLock(ownerId:string,assignmentId:string,manager:LockManager|undefined=navigator.locks):Promise<(()=>void)|null>{
 if(!manager)throw new Error('이 브라우저는 안전한 다중 탭 편집 잠금을 지원하지 않습니다. 최신 브라우저를 이용해 주세요.');
 return new Promise((resolve,reject)=>{
  void manager.request(`kisti-review-writer/${ownerId}/${assignmentId}`,{ifAvailable:true},async lock=>{
   if(!lock){resolve(null);return;}
   await new Promise<void>(release=>resolve(release));
  }).catch(reject);
 });
}

/** Recovery and React teardown may briefly hold the lock; wait without creating a second writer. */
export async function waitForAssignmentLock(ownerId:string,assignmentId:string,signal:AbortSignal,onWaiting:()=>void,manager:LockManager|undefined=navigator.locks):Promise<(()=>void)|null>{
 while(!signal.aborted){
  const release=await acquireAssignmentLock(ownerId,assignmentId,manager);
  if(signal.aborted){release?.();return null;}
  if(release)return release;
  onWaiting();
  await new Promise<void>(resolve=>{
   const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
   const timer=setTimeout(finish,500);signal.addEventListener('abort',finish,{once:true});
   if(signal.aborted)finish();
  });
 }
 return null;
}
