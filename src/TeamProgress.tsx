import type {Progress} from './contracts';
import {teamAllocation} from './allocation';

export function TeamProgress({progress}:{progress:Progress[]}){
 const projects=[...new Set(progress.map(p=>p.projectId))];
 return <section className="team-overview"><h2>세 팀원의 분담과 진행률</h2><p className="muted small">정책 이슈·독립 정책·탐색 평가를 각각 3분의 1씩 나눕니다. 남는 항목은 한 건씩 배분합니다.</p>
 <div className="table-scroll"><table aria-label="팀원별 평가 분담"><thead><tr><th>팀원</th><th>정책 이슈</th><th>독립 정책</th><th>탐색</th><th>주 평가 합계</th><th>보조 평가 포함</th><th>서버 저장 완료</th></tr></thead><tbody>
 {projects.flatMap(project=>[1,2,3].map(member=>{
  const rows=progress.filter(p=>p.projectId===project&&teamAllocation(p.roleCode)?.member===member);
  if(!rows.length)return null;
  const count=(role:string)=>rows.filter(p=>teamAllocation(p.roleCode)?.sourceRole===role).reduce((n,p)=>n+p.total,0);
  const main=count('R1')+count('R2')+count('H1'),total=rows.reduce((n,p)=>n+p.total,0),done=rows.reduce((n,p)=>n+p.complete,0);
  return <tr key={`${project}-${member}`}><th scope="row">팀원 {member}{projects.length>1&&<small>{project?.slice(0,8)}</small>}</th><td>{count('R1')}</td><td>{count('R2')}</td><td>{count('H1')}</td><td><strong>{main}</strong></td><td>{total}</td><td>{done} / {total}<small>{(done/total*100).toFixed(1)}%</small></td></tr>;
 }))}</tbody></table></div></section>;
}
