import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const roots=['src','dist','.github'];const problems=[];
async function scan(root){let files;try{files=await readdir(root,{withFileTypes:true});}catch{return;}for(const file of files){const name=path.join(root,file.name);if(file.isDirectory()){await scan(name);continue;}if(!/\.(tsx?|m?js|css|html|ya?ml|json)$/.test(name))continue;const text=await readFile(name,'utf8');if(/sb_secret_[A-Za-z0-9_-]{16,}/.test(text))problems.push(`${name}: secret key pattern`);for(const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){try{if(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).role==='service_role')problems.push(`${name}: privileged JWT`);}catch{}}if(/VITE_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET_KEY)/.test(text))problems.push(`${name}: privileged frontend environment variable`);}}
for(const root of roots)await scan(root);
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log('PASS: frontend/build/workflow scan found no secret/service-role key material.');
