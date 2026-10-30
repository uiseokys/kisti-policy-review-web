export type TaskKind = 'blind' | 'e3b' | 'dedup' | 'sample' | 'committee';
export type Decision = 'yes' | 'no' | 'unsure';
export type Act = 'ordinance_enact' | 'ordinance_amend' | 'ordinance_repeal' | 'budget_increase' | 'budget_cut' | 'budget_review' | 'policy_proposal' | 'evaluation' | 'inquiry' | 'report' | 'other';
export type Labels = Partial<{
  policy_discussion: Decision | ''; act: Act | ''; evidence_supports: 'yes' | 'partly' | 'no' | '';
  note: string; same_policy: Decision | ''; policy_named: 'yes' | 'no' | ''; policy_name: string;
  committee_ok: Decision | ''; correct_committee: string;
}>;
export interface Assignment {
  id: string; projectId: string; reviewerId: string; roleCode: string; kind: TaskKind;
  total: number; submittedAt: string | null; datasetClass: 'synthetic' | 'real'; mode: 'official' | 'balanced';
}
export interface Annotation {
  assignmentId: string; itemId: string; reviewerId: string; labels: Labels;
  version: number; updatedAt: string; mutationId?: string;
}
export interface SaveCommand { assignmentId: string; itemId: string; expectedVersion: number; mutationId: string; labels: Labels; }
export type SaveResult = { ok: true; annotation: Annotation } | { ok: false; type: 'conflict'; remote: Annotation } | { ok: false; type: 'locked' | 'forbidden' | 'offline' | 'error'; message: string };
export interface SyncTransport { load(assignmentId: string): Promise<Annotation[]>; save(command: SaveCommand): Promise<SaveResult>; }
export interface Progress {
  assignmentId: string; projectId?:string; reviewerId: string; roleCode: string; kind: TaskKind; mode: 'official' | 'balanced';
  total: number; complete: number; inProgress: number; untouched: number; percent: number;
  lastSavedAt: string | null; lastSyncState: string; submittedAt: string | null; lastSeenAt?: string | null;
}
export interface LocalItem { id: string; position: number; title: string; quote1: string; quote2: string; source: string; raw: Record<string, string>; }
export interface ReviewBackend extends SyncTransport {
  mode: 'demo' | 'supabase';
  assignments(): Promise<Assignment[]>;
  progress(): Promise<Progress[]>;
  subscribeProgress(onChange: () => void, onReconnect: () => void): () => void;
  submit(assignmentId: string): Promise<void>;
  exportLocked(assignmentId: string): Promise<Annotation[]>;
  reportSync?(assignmentId: string, deviceId: string, pending: number, state: 'saved' | 'pending' | 'conflict' | 'error'): Promise<void>;
}
