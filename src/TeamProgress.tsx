import type {Progress} from './contracts';
import {SOURCE_GROUPS,teamAllocation} from './allocation';

export function plannedTeamTotal(progress:Pick<Progress,'projectId'>[]){
 return Math.max(1,new Set(progress.map(p=>p.projectId)).size)*SOURCE_GROUPS.reduce((n,g)=>n+g.total,0);
}

export function TeamProgress({progress}:{progress:Progress[]}){
 const knownProjects=[...new Set(progress.map(p=>p.projectId))],projects=knownProjects.length?knownProjects:[undefined];
 return <section className="team-overview"><h2>세 팀원의 분담과 진행률</h2><p className="muted small">미참여 팀원의 배정도 전체 계획에 포함합니다. 완료 수는 서버에 저장된 유효한 평가만 집계합니다.</p>
 <div className="table-scroll"><table aria-label="팀원별 평가 분담"><thead><tr><th>팀원</th><th>정책 이슈</th><th>독립 정책</th><th>탐색</th><th>주 평가 합계</th><th>보조 평가 포함</th><th>서버 저장 완료</th></tr></thead><tbody>
 {projects.flatMap(project=>[1,2,3].map(member=>{
  const rows=progress.filter(p=>p.projectId===project&&teamAllocation(p.roleCode)?.member===member);
  const count=(role:string)=>teamAllocation(`B${member}_${role}`)!.total;
  const main=count('R1')+count('R2')+count('H1'),total=SOURCE_GROUPS.reduce((n,g)=>n+count(g.role),0),done=rows.reduce((n,p)=>n+p.complete,0);
  return <tr key={`${project}-${member}`}><th scope="row">팀원 {member}{!rows.length&&<small>참여 대기</small>}{projects.length>1&&<small>{project?.slice(0,8)}</small>}</th><td>{count('R1')}</td><td>{count('R2')}</td><td>{count('H1')}</td><td><strong>{main}</strong></td><td>{total}</td><td>{done} / {total}<small>{(done/total*100).toFixed(1)}%</small></td></tr>;
 }))}</tbody></table></div></section>;
}
