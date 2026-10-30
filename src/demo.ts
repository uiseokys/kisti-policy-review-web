import type {Annotation,Assignment,Progress,ReviewBackend,SaveCommand,SaveResult,TaskKind} from './contracts';
import {assessLabels} from './domain';
import {createTeamAssignments,teamAllocation} from './allocation';
const roles=['R1','R2','H1','R1_DEDUP','S1','C1'];
const kinds:TaskKind[]=['blind','blind','e3b','dedup','sample','committee'];
const owners=['demo-r1','demo-r2','demo-h1','demo-r1','demo-r1','demo-r2'];
export const officialAssignments:Assignment[]=[81,24,68,8,300,10].map((total,i)=>({id:`demo-${roles[i]}`,projectId:'demo-official',reviewerId:owners[i],roleCode:roles[i],kind:kinds[i],total,submittedAt:null,datasetClass:'synthetic',mode:'official'}));
function balancedAssignments():Assignment[]{
 const result:Assignment[]=[];let cursor=0;
 for(const [kind,count] of [['blind',105],['e3b',68],['dedup',8],['sample',300],['committee',10]] as [TaskKind,number][]){
  const totals=[0,0,0];for(let n=0;n<count;n++)totals[(cursor++)%3]++;
  for(let i=0;i<3;i++)result.push({id:`demo-balanced-${i}-${kind}`,projectId:'demo-balanced',reviewerId:owners[i],roleCode:`B${i+1}_${kind.toUpperCase()}`,kind,total:totals[i],submittedAt:null,datasetClass:'synthetic',mode:'balanced'});
 }return result;
}
const assignments=[...officialAssignments,...balancedAssignments(),...createTeamAssignments(['demo-r1','demo-r2','demo-h1'])];
const KEY='kisti-synthetic-backend-v1',EVENT='kisti-demo-updated';
type Device={pending:number;state:string;seen:string};
type State={annotations:Record<string,Annotation>;locks:Record<string,string>;receipts:Record<string,{command:string;annotation:Annotation}>;closed:Record<string,boolean>;devices:Record<string,Device>};
const read=():State=>JSON.parse(localStorage.getItem(KEY)||'{"annotations":{},"locks":{},"receipts":{},"closed":{},"devices":{}}');
function persist(state:State){localStorage.setItem(KEY,JSON.stringify(state));window.dispatchEvent(new Event(EVENT));}
async function mutate<T>(fn:()=>T):Promise<T>{return navigator.locks?navigator.locks.request('kisti-demo-server',fn):fn();}
export class DemoBackend implements ReviewBackend {
 readonly mode='demo' as const;
 constructor(readonly userId:string){}
 private own(id:string){return assignments.find(a=>a.id===id&&a.reviewerId===this.userId);}
 async assignments(){const s=read();return assignments.filter(a=>a.reviewerId===this.userId).map(a=>({...a,submittedAt:s.locks[a.id]||null}));}
 async load(id:string){if(!this.own(id))return [];return Object.values(read().annotations).filter(a=>a.assignmentId===id&&a.reviewerId===this.userId);}
 async save(cmd:SaveCommand):Promise<SaveResult>{return mutate(()=>{
  const a=this.own(cmd.assignmentId);if(!a)return {ok:false,type:'forbidden',message:'배정된 평가자만 저장할 수 있습니다.'};
  const s=read(),receiptKey=`${this.userId}/${cmd.mutationId}`,fingerprint=JSON.stringify(cmd),receipt=s.receipts[receiptKey];
  if(receipt)return receipt.command===fingerprint?{ok:true,annotation:receipt.annotation}:{ok:false,type:'error',message:'요청 ID 재사용 오류'};
  if(s.locks[a.id])return {ok:false,type:'locked',message:'제출하여 잠긴 평가입니다. 초안은 이 기기에 보관됩니다.'};
  const part=teamAllocation(a.roleCode),position=Number(cmd.itemId.slice(5));
  if(!/^item-\d{3}$/.test(cmd.itemId)||position<(part?.start||1)||position>(part?.end||a.total))return {ok:false,type:'forbidden',message:'배정되지 않은 항목입니다.'};
  if(!assessLabels(a.kind,cmd.labels).valid)return {ok:false,type:'error',message:'허용되지 않은 입력입니다.'};
  const key=`${a.id}/${cmd.itemId}`,old=s.annotations[key];
  if((old?.version||0)!==cmd.expectedVersion)return {ok:false,type:'conflict',remote:old||{assignmentId:a.id,itemId:cmd.itemId,reviewerId:this.userId,labels:{},version:0,updatedAt:''}};
  const annotation:Annotation={assignmentId:a.id,itemId:cmd.itemId,reviewerId:this.userId,labels:structuredClone(cmd.labels),version:(old?.version||0)+1,updatedAt:new Date().toISOString(),mutationId:cmd.mutationId};
  s.annotations[key]=annotation;s.receipts[receiptKey]={command:fingerprint,annotation};persist(s);return {ok:true,annotation};
 });}
 async progress():Promise<Progress[]>{const s=read();return assignments.filter(a=>this.userId==='demo-admin'||a.reviewerId===this.userId).map(a=>{
  const rows=Object.values(s.annotations).filter(r=>r.assignmentId===a.id),states=rows.map(r=>assessLabels(a.kind,r.labels));
  const complete=states.filter(v=>v.complete).length,inProgress=states.filter(v=>v.started&&!v.complete).length;
  const devices=Object.entries(s.devices).filter(([key])=>key.startsWith(a.id+'/')).map(([,v])=>v);
  return {assignmentId:a.id,projectId:a.projectId,reviewerId:a.reviewerId,roleCode:a.roleCode,kind:a.kind,mode:a.mode,total:a.total,complete,inProgress,untouched:a.total-complete-inProgress,percent:complete/a.total*100,lastSavedAt:rows.map(r=>r.updatedAt).sort().at(-1)||null,lastSyncState:['conflict','error','pending'].find(v=>devices.some(d=>d.state===v||v==='pending'&&d.pending>0))||(rows.length?'saved':'idle'),lastSeenAt:devices.map(v=>v.seen).sort().at(-1)||null,submittedAt:s.locks[a.id]||null};
 });}
 subscribeProgress(change:()=>void,reconnect:()=>void){window.addEventListener(EVENT,change);window.addEventListener('storage',change);window.addEventListener('online',reconnect);return()=>{window.removeEventListener(EVENT,change);window.removeEventListener('storage',change);window.removeEventListener('online',reconnect);};}
 async reportSync(id:string,deviceId:string,pending:number,state:string){if(!this.own(id))throw new Error('접근 권한 없음');await mutate(()=>{const s=read();s.devices[`${id}/${deviceId}`]={pending,state,seen:new Date().toISOString()};persist(s);});}
 async submit(id:string){if(!this.own(id))throw new Error('접근 권한 없음');await mutate(()=>{
  const s=read(),a=this.own(id)!;
  if(Object.entries(s.devices).some(([key,d])=>key.startsWith(id+'/')&&(d.pending>0||['pending','conflict','error'].includes(d.state))))throw new Error('미동기화 또는 충돌 상태를 먼저 해결해 주세요.');
  const rows=Object.values(s.annotations).filter(r=>r.assignmentId===id);
  if(rows.length!==a.total||rows.some(r=>!assessLabels(a.kind,r.labels).complete))throw new Error('서버에 유효하게 저장되지 않은 항목이 있습니다.');
  s.locks[id]=new Date().toISOString();persist(s);
 });}
 async exportLocked(id:string){const s=read(),a=assignments.find(a=>a.id===id);if(this.userId!=='demo-admin'||!a||!s.locks[id]||!s.closed[a.projectId])throw new Error('제출 잠금과 블라인드 종료 후 관리자만 내보낼 수 있습니다.');return Object.values(s.annotations).filter(r=>r.assignmentId===id);}
}
export function closeDemoBlind(projectId:string){const s=read();if(assignments.filter(a=>a.projectId===projectId).some(a=>!s.locks[a.id]))throw new Error('해당 모드의 모든 배정이 제출된 후 종료할 수 있습니다.');s.closed[projectId]=true;persist(s);}
