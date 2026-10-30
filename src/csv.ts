import Papa from 'papaparse';
import type { Annotation, Assignment, TaskKind, LocalItem } from './contracts';
import { assessLabels } from './domain';
import {teamAllocation} from './allocation';
export interface ReviewDocument {header:string[];rows:Record<string,string>[];idColumn:string;kind:TaskKind;datasetClass:'real'|'synthetic';bom:boolean;newline:'\r\n'|'\n';}
const idColumns: Record<TaskKind,string>={blind:'blind_id',e3b:'review_id',dedup:'pair_id',sample:'utterance_id',committee:'review_id'};
const editableColumns:Record<TaskKind,string[]>={
  blind:['policy_discussion','act','evidence_supports','note','reviewer','label_source'],
  e3b:['policy_discussion','evidence_supports','note','reviewer','label_source'],
  dedup:['same_policy','note','reviewer','label_source'],
  sample:['policy_named','policy_name','act','note','label_source'],
  committee:['committee_ok','correct_committee','note','label_source']
};
export function parseReviewCsv(text:string,kind:TaskKind):ReviewDocument {
  const bom=text.startsWith('\uFEFF');
  const parsed=Papa.parse<string[]>(text.replace(/^\uFEFF/,''),{skipEmptyLines:false,dynamicTyping:false});
  if(parsed.errors.length)throw new Error('CSV 구문이 올바르지 않습니다. UTF-8 CSV인지 확인해 주세요.');
  const data=parsed.data.slice();
  while(data.length&&data.at(-1)!.every(v=>v===''))data.pop();
  const header=data.shift();
  if(!header?.length||new Set(header).size!==header.length)throw new Error('헤더가 없거나 같은 열 이름이 중복됩니다.');
  const idColumn=idColumns[kind];
  if(!header.includes(idColumn))throw new Error(`이 작업에는 ${idColumn} 열이 필요합니다.`);
  const rows=data.map(cells=>{
    if(cells.length!==header.length)throw new Error('열 수가 다른 행이 있습니다.');
    return Object.fromEntries(header.map((key,i)=>[key,cells[i]]));
  });
  const ids=rows.map(row=>row[idColumn]);
  if(!ids.length||ids.some(id=>!id.trim())||new Set(ids).size!==ids.length)throw new Error('항목 ID가 비어 있거나 중복됩니다.');
  return {header,rows,idColumn,kind,datasetClass:'real',bom,newline:parsed.meta.linebreak==='\r\n'?'\r\n':'\n'};
}
export function selectAssignmentDocument(doc:ReviewDocument,assignment:Assignment):ReviewDocument {
  if(doc.kind!==assignment.kind)throw new Error('CSV의 평가 유형이 배정과 다릅니다.');
  const part=assignment.mode==='balanced'?teamAllocation(assignment.roleCode):undefined;
  if(part&&(part.total!==assignment.total||part.kind!==assignment.kind))throw new Error('3인 분담 배정 정보를 확인해 주세요.');
  if(part&&doc.rows.length===part.sourceTotal)return {...doc,rows:doc.rows.slice(part.start-1,part.end)};
  if(doc.rows.length!==assignment.total)throw new Error(part?`전체 ${part.sourceTotal}개 또는 본인 몫 ${part.total}개 행의 CSV가 필요합니다.`:`이 작업에는 ${assignment.total}개 행이 필요합니다.`);
  return doc;
}
export function mergeReviewCsv(doc:ReviewDocument,annotations:Annotation[],meta:{locked:boolean;blindClosed:boolean;reviewer:string;reviewersByItem?:Record<string,string>}):string {
  if(!meta.locked||!meta.blindClosed)throw new Error('제출 잠금과 블라인드 평가 종료를 먼저 확인해야 합니다.');
  const byId=new Map(annotations.map(a=>[a.itemId,a]));
  if(byId.size!==annotations.length||byId.size!==doc.rows.length)throw new Error('평가 항목 수가 원본과 다릅니다.');
  const rows=doc.rows.map(source=>{
    const annotation=byId.get(source[doc.idColumn]);
    if(!annotation||annotation.version<1||!assessLabels(doc.kind,annotation.labels).complete||!assessLabels(doc.kind,annotation.labels).valid)throw new Error('미완료 또는 유효하지 않은 평가가 있습니다.');
    const row={...source};
    for(const key of editableColumns[doc.kind]){
      if(!doc.header.includes(key))continue;
      row[key]=key==='label_source'?'human':key==='reviewer'?(meta.reviewersByItem?.[annotation.itemId]||meta.reviewer):String(annotation.labels[key as keyof typeof annotation.labels]??'');
    }
    return doc.header.map(key=>row[key]);
  });
  return (doc.bom?'\uFEFF':'')+Papa.unparse({fields:doc.header,data:rows},{newline:doc.newline})+doc.newline;
}
/** Recombine only three locked slices of the same source group; source CSV stays local. */
export function mergeTeamReviewCsv(doc:ReviewDocument,parts:{assignment:Assignment;annotations:Annotation[]}[],meta:{blindClosed:boolean}):string {
  if(!meta.blindClosed||parts.length!==3)throw new Error('세 팀원의 제출 잠금과 블라인드 종료가 필요합니다.');
  const first=teamAllocation(parts[0].assignment.roleCode),project=parts[0].assignment.projectId;
  if(!first||doc.kind!==first.kind||doc.rows.length!==first.sourceTotal)throw new Error('해당 평가 유형의 전체 원본 CSV가 필요합니다.');
  const members=new Set<number>(),reviewersByItem:Record<string,string>={};
  for(const {assignment,annotations} of parts){
    const part=teamAllocation(assignment.roleCode);
    if(!part||assignment.mode!=='balanced'||part.sourceRole!==first.sourceRole||members.has(part.member)||assignment.projectId!==project||!assignment.submittedAt)throw new Error('동일한 프로젝트·평가 유형의 팀원 3명 모두 제출해야 합니다.');
    members.add(part.member);
    const expected=new Set(selectAssignmentDocument(doc,assignment).rows.map(row=>row[doc.idColumn]));
    if(annotations.length!==part.total||new Set(annotations.map(a=>a.itemId)).size!==part.total||annotations.some(a=>a.assignmentId!==assignment.id||a.reviewerId!==assignment.reviewerId||!expected.has(a.itemId)))throw new Error('배정과 일치하지 않거나 중복된 평가 결과가 있습니다.');
    for(const annotation of annotations)reviewersByItem[annotation.itemId]=`팀원 ${part.member}`;
  }
  return mergeReviewCsv(doc,parts.flatMap(part=>part.annotations),{locked:true,blindClosed:true,reviewer:'3인 분담',reviewersByItem});
}
export function documentItems(doc:ReviewDocument):LocalItem[]{
  return doc.rows.map((raw,position)=>({id:raw[doc.idColumn],position,
    title:raw.name||raw.policy_name||[raw.name_a,raw.name_b].filter(Boolean).join(' ↔ ')||raw.dataset_committee||`항목 ${position+1}`,
    quote1:raw.evidence_1_quote||raw.text||raw.quote||raw.quote_a||'',
    quote2:raw.evidence_2_quote||raw.quote_b||'',source:[raw.evidence_1_council||raw.council,raw.evidence_1_date||raw.date,raw.evidence_1_source_ref||raw.source_ref].filter(Boolean).join(' · '),raw}));
}
