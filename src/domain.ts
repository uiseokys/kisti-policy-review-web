import type { Act, Labels, TaskKind } from './contracts';
export const ACT_OPTIONS: Act[] = ['ordinance_enact','ordinance_amend','ordinance_repeal','budget_increase','budget_cut','budget_review','policy_proposal','evaluation','inquiry','report','other'];
export const ACT_LABELS: Record<Act,string> = {ordinance_enact:'조례 제정',ordinance_amend:'조례 개정',ordinance_repeal:'조례 폐지',budget_increase:'예산 증액',budget_cut:'예산 삭감',budget_review:'예산 심의',policy_proposal:'정책 제안',evaluation:'평가',inquiry:'질의',report:'보고',other:'기타'};
const keys: Record<TaskKind,string[]> = {blind:['policy_discussion','act','evidence_supports','note'],e3b:['policy_discussion','evidence_supports','note'],dedup:['same_policy','note'],sample:['policy_named','policy_name','act','note'],committee:['committee_ok','correct_committee','note']};
/** Valid drafts can be incomplete. Invalid/nonapplicable fields never count toward completion. */
export function assessLabels(kind: TaskKind, labels: Labels): { valid:boolean; complete:boolean; started:boolean; errors:string[] } {
 const errors:string[]=[];
 if (!keys[kind] || !labels || typeof labels!=='object' || Array.isArray(labels)) return {valid:false,complete:false,started:false,errors:['Invalid label object']};
 const entries=Object.entries(labels); const started=entries.some(([,v])=>typeof v==='string'&&v.trim()!=='');
 for(const [k,v] of entries){
  if(!keys[kind].includes(k)) errors.push(`Unknown field: ${k}`);
  if(typeof v!=='string') {errors.push(`Invalid type: ${k}`);continue;}
  if(v.length>(k==='note'?2000:200)) errors.push(`Too long: ${k}`);
  const choices:Record<string,readonly string[]>={policy_discussion:['','yes','no','unsure'],same_policy:['','yes','no','unsure'],committee_ok:['','yes','no','unsure'],policy_named:['','yes','no'],act:['',...ACT_OPTIONS],evidence_supports:['','yes','partly','no']};
  if(choices[k]&&!choices[k].includes(v)) errors.push(`Invalid value: ${k}`);
 }
 const value=(key:keyof Labels)=>typeof labels[key]==='string'?labels[key]!.trim():'';
 const blank=(...fields:(keyof Labels)[])=>{for(const field of fields)if(value(field))errors.push(`Field must be blank: ${field}`);};
 let complete=false;
 if(kind==='blind'||kind==='e3b'){
  if(value('policy_discussion')==='yes')complete=!!value('evidence_supports')&&(kind==='e3b'||!!value('act'));
  else {blank('act','evidence_supports'); complete=['no','unsure'].includes(value('policy_discussion'));}
 }else if(kind==='sample'){
  if(value('policy_named')==='yes')complete=!!value('policy_name')&&!!value('act');
  else {blank('policy_name','act');complete=value('policy_named')==='no';}
 }else if(kind==='committee'){
  if(value('committee_ok')==='no')complete=!!value('correct_committee');
  else {blank('correct_committee');complete=['yes','unsure'].includes(value('committee_ok'));}
 }else complete=!!value('same_policy');
 return {valid:errors.length===0,complete:errors.length===0&&complete,started,errors};
}
