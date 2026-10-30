#!/usr/bin/env python3
"""Local-only source preservation check and optional unmodified official validator invocation."""
import argparse,csv,json,subprocess,sys
from pathlib import Path

ACTS={'ordinance_enact','ordinance_amend','ordinance_repeal','budget_increase','budget_cut','budget_review','policy_proposal','evaluation','inquiry','report','other'}
KINDS={
 'blind':('blind_id',{'policy_discussion','act','evidence_supports','note','reviewer','label_source'}),
 'e3b':('review_id',{'policy_discussion','evidence_supports','note','reviewer','label_source'}),
 'dedup':('pair_id',{'same_policy','note','reviewer','label_source'}),
 'sample':('utterance_id',{'policy_named','policy_name','act','note','label_source'}),
 'committee':('review_id',{'committee_ok','correct_committee','note','label_source'})}
def read(path):
 with Path(path).open(encoding='utf-8-sig',newline='') as stream:
  reader=csv.DictReader(stream);return reader.fieldnames,list(reader)
def complete(kind,row):
 value=lambda key:(row.get(key) or '').strip()
 if value('label_source')!='human':return False
 if kind in {'blind','e3b'}:
  d=value('policy_discussion')
  if d=='yes':return value('evidence_supports') in {'yes','partly','no'} and (kind=='e3b' or value('act') in ACTS)
  return d in {'no','unsure'} and not value('act') and not value('evidence_supports')
 if kind=='dedup':return value('same_policy') in {'yes','no','unsure'}
 if kind=='sample':return (value('policy_named')=='yes' and bool(value('policy_name')) and value('act') in ACTS) or (value('policy_named')=='no' and not value('policy_name') and not value('act'))
 return (value('committee_ok')=='no' and bool(value('correct_committee'))) or (value('committee_ok') in {'yes','unsure'} and not value('correct_committee'))
def verify(kind,sheet,labels):
 sh,source=read(sheet);lh,output=read(labels);id_col,editable=KINDS[kind]
 problems=[]
 if sh!=lh:problems.append('header_changed')
 if len(source)!=len(output):problems.append('row_count_changed')
 if [r.get(id_col) for r in source]!=[r.get(id_col) for r in output]:problems.append('id_or_row_order_changed')
 if len({r.get(id_col) for r in output})!=len(output):problems.append('duplicate_ids')
 if sh==lh and len(source)==len(output) and any(a.get(k)!=b.get(k) for a,b in zip(source,output) for k in sh if k not in editable):problems.append('source_field_changed')
 if any(not complete(kind,row) for row in output):problems.append('incomplete_or_invalid_label')
 return {'accepted':not problems,'rows':len(output),'problems':problems}
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('kind',choices=KINDS);parser.add_argument('--sheet',required=True);parser.add_argument('--labels',required=True);parser.add_argument('--research-root');parser.add_argument('--e3b-validator');args=parser.parse_args()
 result=verify(args.kind,args.sheet,args.labels)
 if result['accepted'] and (args.research_root or args.e3b_validator):
  validator=Path(args.e3b_validator) if args.kind=='e3b' and args.e3b_validator else Path(args.research_root or '')/'docs/superpowers/reports/2026-10-28-e-realdata-guide/labels_check.py'
  if not validator.is_file() or (args.kind=='e3b' and not args.e3b_validator):result['accepted']=False;result['problems'].append('official_validator_not_configured')
  else:
   # Official validators print fixed counts/status only. Keep stderr local; never emit source rows.
   proc=subprocess.run([sys.executable,'-I',str(validator),args.kind,'--sheet',args.sheet,'--labels',args.labels],capture_output=True,text=True)
   result['official_validator_exit']=proc.returncode
   if proc.returncode:result['accepted']=False;result['problems'].append('official_validator_rejected')
 print(json.dumps(result,ensure_ascii=False));return 0 if result['accepted'] else 1
if __name__=='__main__':raise SystemExit(main())
