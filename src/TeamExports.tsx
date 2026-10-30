import {useState} from 'react';
import type {Assignment,Progress,ReviewBackend} from './contracts';
import {SOURCE_GROUPS,roleLabel,teamAllocation} from './allocation';
import {mergeReviewCsv,mergeTeamReviewCsv,parseReviewCsv,selectAssignmentDocument} from './csv';
import {closeDemoBlind} from './demo';

export function ReviewExports({backend,mode,progress,notice}:{backend:ReviewBackend;mode:'official'|'balanced';progress:Progress[];notice:(text:string)=>void}){
 const [selected,setSelected]=useState(''),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false);
 const projects=[...new Set(progress.map(p=>p.projectId).filter((id):id is string=>!!id))];
 const groups=mode==='balanced'?projects.flatMap(project=>SOURCE_GROUPS.flatMap(source=>{
  const rows=progress.filter(p=>p.projectId===project&&teamAllocation(p.roleCode)?.sourceRole===source.role);
  return rows.length===3&&new Set(rows.map(p=>teamAllocation(p.roleCode)?.member)).size===3&&rows.every(p=>p.submittedAt)?[{id:`team/${project}/${source.role}`,source,rows}]:[];
 })):[];
 const group=groups.find(g=>g.id===selected),session=progress.find(p=>p.assignmentId===selected&&p.submittedAt);
 const asAssignment=(p:Progress):Assignment=>({id:p.assignmentId,projectId:p.projectId||'',reviewerId:p.reviewerId,roleCode:p.roleCode,kind:p.kind,mode:p.mode,total:p.total,submittedAt:p.submittedAt,datasetClass:'synthetic'});
 const exportCsv=async()=>{
  if(!file||(!group&&!session))return;setBusy(true);
  try{
   let csv='',filename='';
   if(group){
    const doc=parseReviewCsv(await file.text(),group.source.kind);
    const parts=await Promise.all(group.rows.map(async p=>({assignment:asAssignment(p),annotations:await backend.exportLocked(p.assignmentId)})));
    csv=mergeTeamReviewCsv(doc,parts,{blindClosed:true});filename=`${group.source.role}_team_labels.csv`;
   }else if(session){
    const annotations=await backend.exportLocked(session.assignmentId);
    const doc=selectAssignmentDocument(parseReviewCsv(await file.text(),session.kind),asAssignment(session));
    csv=mergeReviewCsv(doc,annotations,{locked:true,blindClosed:true,reviewer:roleLabel(session.roleCode)});filename=`${session.roleCode}_labels.csv`;
   }
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
   const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   notice('제출된 라벨을 로컬 원본에 병합했습니다. 공식 검증기로 최종 확인해 주세요.');
  }catch(error){notice((error as Error).message);}finally{setBusy(false);}
 };
 return <section className="export-panel"><div><div className="eyebrow">LOCAL EXPORT</div><h2>제출 결과 CSV 생성</h2><p className="muted">세션 잠금과 블라인드 종료를 확인한 후 라벨을 로컬 원본에 병합합니다.{mode==='balanced'&&' 같은 평가 유형의 세 팀원이 제출하면 전체 CSV 하나로 합칠 수 있습니다.'}</p></div>
 <div className="export-controls"><select aria-label="내보낼 제출 세션" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">제출된 세션 선택</option>{groups.length>0&&<optgroup label="평가 유형별 전체 CSV · 3인 병합">{groups.map(g=><option key={g.id} value={g.id}>{g.source.role} · {g.source.title} 전체 {g.source.total}건{projects.length>1?` · ${g.rows[0].projectId?.slice(0,8)}`:''}</option>)}</optgroup>}<optgroup label="개별 제출 세션">{progress.filter(p=>p.submittedAt).map(p=><option key={p.assignmentId} value={p.assignmentId}>{roleLabel(p.roleCode)} · {p.total}개</option>)}</optgroup></select><label className="file-input">원본 CSV · 로컬에서만 읽음<input type="file" accept=".csv" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><button className="primary" disabled={(!group&&!session)||!file||busy} onClick={()=>void exportCsv()}>공식 형식 CSV 생성</button></div>
 {backend.mode==='demo'&&<button className="text-button" onClick={()=>{try{closeDemoBlind(mode==='official'?'demo-official':'demo-team-split');notice('합성 프로젝트의 블라인드 단계를 종료했습니다.');}catch(error){notice((error as Error).message);}}}>모든 합성 세션 제출 후 블라인드 종료</button>}</section>;
}
