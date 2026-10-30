#!/usr/bin/env python3
"""Tests only newly constructed synthetic files; never opens research data."""
import csv,subprocess,sys,tempfile
from pathlib import Path
from verify_csv import verify
RESEARCH=Path.home()/'Developer/kisti-policy-analysis-2026-research-e'
E3B=Path.home()/'Developer/kisti-policy-analysis-2026-e3b/E3-B/scripts/verify_returned_labels.py'
fixtures={
 'blind':({'blind_id':'synthetic-1','name':'합성사업','aliases':'합성별칭','evidence_1_source_ref':'synthetic:1','evidence_1_quote':'합성 인용,\n줄바꿈','evidence_2_source_ref':'synthetic:2','evidence_2_quote':'두 번째 합성 인용','policy_discussion':'','act':'','evidence_supports':'','note':'','reviewer':'','label_source':'human'},{'policy_discussion':'yes','act':'inquiry','evidence_supports':'yes','reviewer':'synthetic-human-tester'}),
 'e3b':({'review_id':'synthetic-1','name':'합성사업','quote':'합성 인용','policy_discussion':'','evidence_supports':'','note':'','reviewer':'','label_source':'human'},{'policy_discussion':'yes','evidence_supports':'yes','reviewer':'synthetic-human-tester'}),
 'dedup':({'pair_id':'synthetic-1','blind_id_a':'a','blind_id_b':'b','name_a':'합성A','name_b':'합성B','same_policy':'','note':'','reviewer':'','label_source':'human'},{'same_policy':'no','reviewer':'synthetic-human-tester'}),
 'sample':({'utterance_id':'synthetic-1','council':'합성의회','date':'2026-01-01','text':'합성 인용','policy_named':'','policy_name':'','act':'','note':'','label_source':'human'},{'policy_named':'yes','policy_name':'합성사업','act':'inquiry'}),
 'committee':({'review_id':'synthetic-1','source_ref':'synthetic:1','dataset_committee':'합성위원회','raw_meeting_name':'합성위원회','committee_ok':'','correct_committee':'','note':'','label_source':'human'},{'committee_ok':'yes'})}
def write(path,row):
 with path.open('w',encoding='utf-8-sig',newline='') as stream:w=csv.DictWriter(stream,fieldnames=list(row),lineterminator='\r\n');w.writeheader();w.writerow(row)
passed=0;official=0
with tempfile.TemporaryDirectory(prefix='kisti-synthetic-export-') as tmp:
 for kind,(source,updates) in fixtures.items():
  sheet=Path(tmp)/(kind+'-sheet.csv');labels=Path(tmp)/(kind+'-labels.csv');write(sheet,source);write(labels,source|updates)
  assert verify(kind,sheet,labels)['accepted'];passed+=1
  validator=E3B if kind=='e3b' else RESEARCH/'docs/superpowers/reports/2026-10-28-e-realdata-guide/labels_check.py'
  if validator.is_file():
   p=subprocess.run([sys.executable,'-I',str(validator),kind,'--sheet',str(sheet),'--labels',str(labels)],capture_output=True,text=True);assert p.returncode==0,kind+' official synthetic validation rejected';official+=1
  altered=source|updates;altered[next(k for k in source if k not in updates and k!='label_source')]='changed';write(labels,altered)
  assert not verify(kind,sheet,labels)['accepted'];passed+=1
print(f'PASS: synthetic CSV preservation/validation checks={passed}; unmodified official validators passed={official}/5; no real-data files read.')
