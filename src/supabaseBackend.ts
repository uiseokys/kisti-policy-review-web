import type { SupabaseClient } from '@supabase/supabase-js';
import type { Annotation, Assignment, Labels, Progress, ReviewBackend, SaveCommand, SaveResult, TaskKind } from './contracts';
type Row = Record<string, unknown>;
function annotation(r: Row): Annotation { return {assignmentId:String(r.assignment_id),itemId:String(r.item_id),reviewerId:String(r.reviewer_id),labels:r.labels as Labels,version:Number(r.version),updatedAt:String(r.updated_at),...(r.mutation_id?{mutationId:String(r.mutation_id)}:{})}; }
const fail=(error: {message:string}|null) => { if(error)throw new Error(error.message); };
function nextReportSequence(userId:string,assignmentId:string,deviceId:string):number {
 if(typeof localStorage==='undefined')throw new Error('Durable sync sequence storage unavailable');
 const key=`kisti-review-report-sequence:${JSON.stringify([userId,assignmentId,deviceId])}`;
 const prior=localStorage.getItem(key);
 if(prior!==null&&!/^(0|[1-9]\d*)$/.test(prior))throw new Error('Invalid durable sync sequence');
 const next=prior===null?1:Number(prior)+1;
 if(!Number.isSafeInteger(next)||next<1)throw new Error('Durable sync sequence exhausted');
 localStorage.setItem(key,String(next)); // Reserve before network I/O; never reuse after a timeout.
 return next;
}
/** Uses only the signed-in user's public client. Privileged keys must never reach this module. */
export function createSupabaseBackend(client: SupabaseClient, userId: string): ReviewBackend {
 return {
  mode:'supabase',
  async assignments(){
   const {data,error}=await client.from('review_assignments').select('*,review_projects!inner(dataset_class)').eq('reviewer_id',userId).order('role_code'); fail(error);
   return (data??[]).map((r: Row):Assignment=>({id:String(r.id),projectId:String(r.project_id),reviewerId:String(r.reviewer_id),roleCode:String(r.role_code),kind:r.kind as TaskKind,total:Number(r.total),submittedAt:r.submitted_at?String(r.submitted_at):null,datasetClass:(r.review_projects as {dataset_class:'synthetic'}).dataset_class,mode:r.mode as Assignment['mode']}));
  },
  async load(assignmentId){
   const {data,error}=await client.from('review_annotations').select('*').eq('assignment_id',assignmentId).eq('reviewer_id',userId).order('item_id'); fail(error); return (data??[]).map(annotation);
  },
  async save(command:SaveCommand):Promise<SaveResult>{
   try {
    const {data,error}=await client.rpc('save_review_annotation',{p_assignment_id:command.assignmentId,p_item_id:command.itemId,p_expected_version:command.expectedVersion,p_mutation_id:command.mutationId,p_labels:command.labels});
    if(error)return {ok:false,type:error.code==='42501'?'forbidden':'error',message:error.message};
    if(!data||typeof data.ok!=='boolean')return {ok:false,type:'error',message:'Invalid server acknowledgement'};
    return data as SaveResult;
   }catch(error){return {ok:false,type:typeof navigator!=='undefined'&&!navigator.onLine?'offline':'error',message:error instanceof Error?error.message:'Save request failed'};}
  },
  async progress(){
   const {data,error}=await client.from('review_progress').select('*,review_assignments!inner(project_id)').order('role_code'); fail(error);
   return (data??[]).map((r:Row):Progress=>({assignmentId:String(r.assignment_id),projectId:String((r.review_assignments as {project_id:string}).project_id),reviewerId:String(r.reviewer_id),roleCode:String(r.role_code),kind:r.kind as TaskKind,mode:r.mode as Progress['mode'],total:Number(r.total),complete:Number(r.complete),inProgress:Number(r.in_progress),untouched:Number(r.untouched),percent:Number(r.percent),lastSavedAt:r.last_saved_at?String(r.last_saved_at):null,lastSyncState:String(r.last_sync_state),lastSeenAt:r.last_seen_at?String(r.last_seen_at):null,submittedAt:r.submitted_at?String(r.submitted_at):null}));
  },
  subscribeProgress(onChange,onReconnect){
   let subscribed=false;
   const channel=client.channel(`review-progress-${userId}-${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table:'review_progress'},()=>onChange()).subscribe(status=>{
    if(status==='SUBSCRIBED'){if(subscribed)onReconnect();subscribed=true;onChange();}
   });
   return ()=>{void client.removeChannel(channel);};
  },
  async reportSync(assignmentId,deviceId,pending,state){const sequence=nextReportSequence(userId,assignmentId,deviceId);const {error}=await client.rpc('report_review_sync_state',{p_assignment_id:assignmentId,p_device_id:deviceId,p_pending:pending,p_state:state,p_sequence:sequence});fail(error);},
  async submit(assignmentId){const {error}=await client.rpc('submit_review_assignment',{p_assignment_id:assignmentId});fail(error);},
  async exportLocked(assignmentId){const {data,error}=await client.rpc('export_locked_annotations',{p_assignment_id:assignmentId});fail(error);return (data??[]).map(annotation);},
 };
}
