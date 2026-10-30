import type {Assignment,TaskKind} from './contracts';

export const SOURCE_GROUPS = [
 {role:'R1',kind:'blind',total:81,title:'정책 이슈 평가'},
 {role:'R2',kind:'blind',total:24,title:'독립 정책 평가'},
 {role:'H1',kind:'e3b',total:68,title:'E3-B 탐색 평가'},
 {role:'R1_DEDUP',kind:'dedup',total:8,title:'중복 정책 판정'},
 {role:'S1',kind:'sample',total:300,title:'독립 발언 표본'},
 {role:'C1',kind:'committee',total:10,title:'위원회 검토'},
] as const;
export type SourceRole=(typeof SOURCE_GROUPS)[number]['role'];
export interface TeamAllocation {
 sourceRole:SourceRole;kind:TaskKind;title:string;sourceTotal:number;member:1|2|3;
 total:number;start:number;end:number;roleCode:string;
}
// Rotate only the remainder; then allocate contiguous source rows, preserving group order.
const allocations:TeamAllocation[]=[];let cursor=0;
for(const group of SOURCE_GROUPS){
 const counts=[0,0,0];for(let row=0;row<group.total;row++)counts[cursor++%3]++;
 let start=1;
 for(const member of [1,2,3] as const){
  const total=counts[member-1];
  allocations.push({sourceRole:group.role,kind:group.kind,title:group.title,sourceTotal:group.total,member,total,start,end:start+total-1,roleCode:`B${member}_${group.role}`});
  start+=total;
 }
}
export const teamAllocation=(roleCode:string)=>allocations.find(a=>a.roleCode===roleCode);
export const assignmentTitle=(roleCode:string)=>teamAllocation(roleCode)?.title||SOURCE_GROUPS.find(g=>g.role===roleCode)?.title||'이전 균등 분담 실험';
export const roleLabel=(roleCode:string)=>{const part=teamAllocation(roleCode);return part?`팀원 ${part.member} · ${part.sourceRole}`:roleCode;};
export function createTeamAssignments(owners:readonly [string,string,string],projectId='demo-team-split',prefix='demo-team'):Assignment[]{
 return allocations.map(part=>({id:`${prefix}-${part.member}-${part.sourceRole}`,projectId,reviewerId:owners[part.member-1],roleCode:part.roleCode,kind:part.kind,total:part.total,submittedAt:null,datasetClass:'synthetic',mode:'balanced'}));
}
