import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBackend } from '../src/supabaseBackend';

describe('durable sync report sequence',()=>{
 beforeEach(()=>localStorage.clear());
 afterEach(()=>vi.restoreAllMocks());
 it('reserves sequence before network and continues after a failed request or new backend instance',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce({error:{message:'offline'}}).mockResolvedValue({error:null});
  const client={rpc} as unknown as SupabaseClient;
  const first=createSupabaseBackend(client,'reviewer-1');
  await expect(first.reportSync!('assignment-1','device-1',1,'pending')).rejects.toThrow('offline');
  const reloaded=createSupabaseBackend(client,'reviewer-1');
  await reloaded.reportSync!('assignment-1','device-1',0,'saved');
  await reloaded.reportSync!('assignment-1','device-2',0,'saved');
  expect(rpc.mock.calls.map(([,args])=>args.p_sequence)).toEqual([1,2,1]);
 });
 it('does not send a report when durable sequence storage fails',async()=>{
  const rpc=vi.fn();
  const client={rpc} as unknown as SupabaseClient;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage full');});
  await expect(createSupabaseBackend(client,'reviewer-1').reportSync!('assignment-1','device-1',1,'pending')).rejects.toThrow('storage full');
  expect(rpc).not.toHaveBeenCalled();
 });
});
