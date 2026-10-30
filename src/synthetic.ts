import type {Assignment} from './contracts';
import type {ReviewDocument} from './csv';
import {teamAllocation} from './allocation';
export function syntheticDocument(a:Assignment):ReviewDocument{
 const kind=a.kind;
 const idColumn=kind==='blind'?'blind_id':kind==='sample'?'utterance_id':kind==='dedup'?'pair_id':'review_id';
 const labels=kind==='blind'?['policy_discussion','act','evidence_supports','note','reviewer','label_source']:kind==='e3b'?['policy_discussion','evidence_supports','note','reviewer','label_source']:kind==='dedup'?['same_policy','note','reviewer','label_source']:kind==='sample'?['policy_named','policy_name','act','note','label_source']:['committee_ok','correct_committee','note','label_source'];
 const sources=kind==='sample'?['council','date','text']:kind==='committee'?['source_ref','dataset_committee','raw_meeting_name','minutes_name']:kind==='dedup'?['blind_id_a','blind_id_b','name_a','name_b','quote_a','quote_b']:['name','aliases','evidence_1_council','evidence_1_date','evidence_1_source_ref','evidence_1_quote','evidence_2_council','evidence_2_date','evidence_2_source_ref','evidence_2_quote'];
 const header=[idColumn,...sources,...labels];
 const rows=Array.from({length:a.total},(_,i)=>{
  const position=(teamAllocation(a.roleCode)?.start||1)+i;
  const raw=Object.fromEntries(header.map(k=>[k,''])),id=`item-${String(position).padStart(3,'0')}`,name=`합성지원사업 ${position}`;
  const quote=`[합성 데이터] 의원: ${name}의 예산 집행 상황과 다음 연도 개선 계획을 설명해 주시겠습니까?`;
  raw[idColumn]=id;
  Object.assign(raw,kind==='sample'?{council:'합성의회',date:'2026-01-01',text:quote}:kind==='committee'?{source_ref:`synthetic:${id}`,dataset_committee:'합성복지위원회',raw_meeting_name:'합성복지위원회',minutes_name:'합성 회의록'}:kind==='dedup'?{blind_id_a:`synthetic-a-${position-1}`,blind_id_b:`synthetic-b-${position-1}`,name_a:name,name_b:`${name} 지원`,quote_a:quote,quote_b:'[합성 데이터] 집행부: 합성사업의 지원 범위를 설명합니다.'}:{name,aliases:`합성지원 ${position}`,evidence_1_council:'합성의회',evidence_1_date:'2026-01-01',evidence_1_source_ref:`synthetic:${id}:1`,evidence_1_quote:quote,evidence_2_council:'합성의회',evidence_2_date:'2026-02-01',evidence_2_source_ref:`synthetic:${id}:2`,evidence_2_quote:`[합성 데이터] 의원: ${name}의 대상과 예산 산출 근거를 확인하고 싶습니다.`});
  raw.label_source='human';return raw;
 });
 return {header,rows,idColumn,kind,datasetClass:'synthetic',bom:true,newline:'\r\n'};
}
