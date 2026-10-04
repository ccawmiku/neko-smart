#!/usr/bin/env node
// Read-only compatibility audit. Never rewrites vendored code or live configuration.
import fs from 'node:fs';
const baseline=JSON.parse(fs.readFileSync(new URL('../packages/shared/src/metacubexd/upstream.json',import.meta.url),'utf8'));
const repos=[['metacubexd','MetaCubeX/metacubexd',baseline.commit],['neko-master','foru17/neko-master','6f72cfd0db69e2952713f24a648812407fef1e78']];
for(const [name,repo,base]of repos){
 const response=await fetch(`https://api.github.com/repos/${repo}/commits/main`,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`${name}: upstream request failed (${response.status})`);
 const {sha}=await response.json();console.info(`${name}: baseline=${base}; latest=${sha}; ${base===sha?'unchanged':'review required'}`);
 if(name==='metacubexd'){
  const srcResponse=await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${baseline.source}`,{signal:AbortSignal.timeout(20000)});if(!srcResponse.ok)throw Error('MetaCube API source moved; review required');
  const source=await srcResponse.text();const missing=baseline.functions.filter(name=>!source.includes(`export function ${name}(`));
  console.info('MetaCube imported API functions: '+(missing.length?'MISSING '+missing.join(', '):'all present'));
  if(missing.length)process.exitCode=1;
 }
}
console.info('Run contract tests and UI checks before merging upstream changes; API presence alone is not a compatibility proof.');
