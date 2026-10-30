import {useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
type Seat='member1'|'member2'|'member3'|'admin';
const seats:Seat[]=['member1','member2','member3','admin'];
function invitation(){
 const params=new URLSearchParams(window.location.hash.slice(1)),seat=params.get('seat') as Seat,invite=params.get('join');
 return invite&&/^[A-Za-z0-9_-]{43}$/.test(invite)&&seats.includes(seat)?{seat,invite}:null;
}
export function TeamAccess({client}:{client:SupabaseClient}){
 const [link]=useState(invitation),[seat,setSeat]=useState<Seat>(link?.seat||'member1'),[register,setRegister]=useState(!!link);
 const [name,setName]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();if(busy)return;setError('');
  if(register&&(!link||confirm!==password)){setError(link?'비밀번호 확인이 일치하지 않습니다.':'관리자가 전달한 참여 링크를 열어 주세요.');return;}
  setBusy(true);
  try{
   const body={action:register?'register':'login',seat,name:name.normalize('NFC').trim(),password,...(register?{invite:link!.invite}:{})};
   const result=await client.functions.invoke('team-access',{body});
   if(result.error){
    let message='연결을 확인하거나 잠시 후 다시 시도해 주세요.';
    try{const payload=await result.error.context?.json();if(typeof payload?.error==='string')message=payload.error;}catch{/* Keep safe generic message. */}
    throw new Error(message);
   }
   if(result.data?.error)throw new Error(result.data.error);
   if(!result.data?.access_token||!result.data?.refresh_token)throw new Error('접속을 확인하지 못했습니다. 다시 시도해 주세요.');
   const {error:sessionError}=await client.auth.setSession({access_token:result.data.access_token,refresh_token:result.data.refresh_token});
   if(sessionError)throw new Error('접속 상태를 저장하지 못했습니다. 다시 시도해 주세요.');
   setPassword('');setConfirm('');
   if(register)window.history.replaceState(null,'',window.location.pathname+window.location.search);
  }catch(caught){setError(caught instanceof Error?caught.message:'접속하지 못했습니다.');}finally{setBusy(false);}
 };
 return <div className="team-access"><p className="muted">{register?'이름과 비밀번호를 정하면 바로 평가를 시작합니다.':'본인 자리와 설정한 이름·비밀번호로 작업을 이어갑니다.'}</p>
 <div className="seat-picker" aria-label="팀원 선택">{(['member1','member2','member3'] as const).map((value,i)=><button type="button" key={value} aria-pressed={seat===value} disabled={busy||register&&link?.seat!==value} onClick={()=>setSeat(value)}>팀원 {i+1}</button>)}</div>
 {seat==='admin'&&<p className="pill green">관리자 접속</p>}
 <form onSubmit={event=>void submit(event)}><label>이름<input required minLength={2} maxLength={40} autoComplete="username" value={name} onChange={event=>setName(event.target.value)} disabled={busy}/></label><label>비밀번호<input type="password" required minLength={8} maxLength={128} autoComplete={register?'new-password':'current-password'} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label>{register&&<label>비밀번호 확인<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)} disabled={busy}/></label>}
 <button className="primary wide" disabled={busy}>{busy?'접속 확인 중…':register?'설정하고 평가 시작':'이어서 평가하기'}</button></form>
 {error&&<div className="alert error" role="alert">{error}</div>}
 {register?<button className="text-button" disabled={busy} onClick={()=>{setRegister(false);setError('');}}>이미 설정했어요 · 이어서 평가하기</button>:<><p className="small muted">처음이라면 관리자가 전달한 본인 참여 링크를 열어 주세요.</p><button className="text-button" disabled={busy} onClick={()=>{setSeat(seat==='admin'?'member1':'admin');setError('');}}>{seat==='admin'?'팀원으로 접속':'관리자 접속'}</button></>}
 </div>;
}
