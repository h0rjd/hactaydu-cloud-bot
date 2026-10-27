const fs=require('fs'),path=require('path'),{execFile}=require('child_process'),{promisify}=require('util');const execute=promisify(execFile);
const lab=path.resolve(__dirname,'..'),v79=path.join(lab,'python_v79'),own=lab;
let python=process.env.PYTHON_BIN||path.join(v79,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
if(!fs.existsSync(python)){python=process.platform==='win32'?'python':'python3';}
const {forMachine,validateMachine}=require('../src/machine_partition');

const {plan}=require('../src/planner');const {lock}=require('../src/storage');const {run}=require('../src/worker'),{evaluateJackpot}=require('../jackpot_rules'),{atomicJSON,readJSON}=require('../src/storage');
const rawMachine=readJSON(path.join(lab,'machine.json'),{machineId:1,machineCount:1});
if(process.env.MACHINE_NAME)rawMachine.machineName=process.env.MACHINE_NAME;
const machine=validateMachine(rawMachine);
machine.machineName=rawMachine.machineName||(machine.machineId===1?'D4':'H0');
let stopping=false,shutdown=false;
const stopControl=setInterval(()=>{if(fs.existsSync(path.join(lab,'state/stop-requested.json'))){stopping=true;shutdown=true}},1000);stopControl.unref();for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{stopping=true;shutdown=true});
let lastGitSync=Date.now();
const {latestServer}=require('../src/server_catalog');
const {serverAllowed}=require('../src/server_policy');
const {FollowupQueue}=require('../src/followup_queue');
let followups;
const accountsFile=process.env.ACCOUNTS_PATH||path.join(own,'accounts.json');
const catalogAccount=readJSON(accountsFile)[0].accId;
async function runServer(srv){
 stopping=false;let nextServer=null;
 const poolSize=readJSON(path.join(lab,'state/live-settings.json'),{concurrency:16}).concurrency||16;
 if(!Number.isInteger(poolSize)||poolSize<1||poolSize>36)throw Error('INVALID_CONCURRENCY');
const protectedAccounts=[...readJSON(path.join(lab,'protection.json'),[]),...readJSON(path.join(lab,'protection_snapshot.json'),[]),...readJSON(path.join(lab,'jackpot_locked_vault.json'),[])];
 for(const entry of fs.readdirSync(path.join(lab,'state'),{withFileTypes:true})){const dir=path.join(lab,'state',entry.name);if(entry.isDirectory())protectedAccounts.push(...readJSON(path.join(dir,'jackpot_locked_vault.json'),[]));}
 const seen=new Set(),ids=new Set();const accounts=readJSON(accountsFile).filter(a=>{const n=a.username.toLowerCase(),id=String(a.accId);if(seen.has(n)||ids.has(id))return false;seen.add(n);ids.add(id);return true});
 const stateDir=path.join(lab,'state',`v79-${srv.sid}-20`);fs.mkdirSync(stateDir,{recursive:true});atomicJSON(path.join(stateDir,'server.json'),srv);
 const core=['Dương Tiễn','Tôn Ngộ Không','Na Tra','Lý Tịnh','Đường Tam Tạng','Cang Kim Tinh Quân','Hồng Hài Nhi','Trấn Nguyên Tử','Ngọc Diện Hồ Ly','Hằng Nga','Hoàng My','Ngưu Ma Vương','Thiết Phiến Công Chúa','Hàng Long Tôn Giả','Trư Bát Giới'];
 const globalVault=path.join(stateDir,'jackpot_locked_vault.json');protectedAccounts.push(...readJSON(globalVault,[]));
 const priorUsers=new Set();for(const f of fs.readdirSync(stateDir)){if(/^raw-.*\.json$/.test(f)&&!f.endsWith('.progress.json')){const r=readJSON(path.join(stateDir,f),{});if(r.account)priorUsers.add(r.account.toLowerCase());}}
 for(const name of readJSON(path.join(lab,'processed_accounts.json'),{})[srv.sid]||[])priorUsers.add(String(name).toLowerCase());
 const selected=forMachine(plan(accounts,{mode:'reroll',sid:srv.sid,protectedAccounts}).map(t=>t.account),machine).filter(a=>!priorUsers.has(a.username.toLowerCase()));
 const started=Date.now();let completed=0;const {progressLine}=require('../src/progress_log');
 const release=lock(path.join(stateDir,'orchestrator.lock'));let polling=false;
 const poll=setInterval(async()=>{if(polling||stopping)return;polling=true;try{const newest=await latestServer(catalogAccount);if(Number(newest.sid)>Number(srv.sid)){nextServer=newest;stopping=true;console.log(JSON.stringify({event:'NEW_SERVER',from:srv.sid,to:newest.sid,name:newest.name,action:'finish current accounts, then switch'}));}}catch{console.log(JSON.stringify({event:'SERVER_LOOKUP_FAILED',sid:srv.sid,action:'keep last verified server'}));}finally{polling=false}},60000);poll.unref();
 console.log(JSON.stringify({event:'START',server:srv.sid,machine:machine.machineName,concurrency:poolSize,codeDelayMs:180,maxAttempts:7,selected:selected.length}));
 try{const reports=await Promise.all(Array.from({length:poolSize},async(_,i)=>run({mode:'reroll',sid:srv.sid,accounts:selected.filter((_,j)=>j%poolSize===i),protectedAccounts,stateDir:path.join(stateDir,'worker-'+i),live:true,limit:10000,intervalMs:1000,adapters:{
 reroll:async a=>{if(stopping)return {status:'STOP_REQUESTED',halt:true};const input=path.join(stateDir,'current-'+a.accId+'.json'),output=path.join(stateDir,'raw-'+a.accId+'.json');atomicJSON(input,a);
 try{await execute(python,['probe_one.py',input,path.join(stateDir,'server.json'),output],{cwd:v79,timeout:495000,maxBuffer:256000});}catch(e){const detail=String(e.stdout||'');const reason=['SDK_ACCOUNT_ID_MISMATCH','SDK_TOKEN_REQUIRED','GAME_AUTH_ACCOUNT_NOT_BOUND','GAME_LOGIN_REJECTED','GAME_LOGIN_NOT_CONFIRMED'].find(code=>detail.includes(code));if(reason){stopping=true;shutdown=true;console.log(JSON.stringify({event:'LOGIN_BLOCKED',username:a.username,sid:srv.sid,errorCode:reason,action:'stop new accounts'}));}return {status:reason||'V79_PROBE_FAILED',halt:true}}finally{fs.unlinkSync(input)}
 const raw=readJSON(output),names=raw.heroes5Star||[],counts=Object.fromEntries(core.map(n=>[n,names.filter(h=>h===n).length]));const rule=evaluateJackpot(counts);
 const result={sid:srv.sid,serverName:srv.name,username:a.username,heroes5StarCount:names.length,isJackpotAlert:rule.isJackpotAlert,rawV79:raw,cdkAckedCount:raw.confirmedCodes.length,cdkUnconfirmedCodes:raw.unconfirmedCodes,rewardCollectionComplete:false,counts:rule.counts};
 completed++;const uLow=a.username.toLowerCase();priorUsers.add(uLow);const processedFile=path.join(lab,'processed_accounts.json');const processedMap=readJSON(processedFile,{});if(!Array.isArray(processedMap[srv.sid]))processedMap[srv.sid]=[];if(!processedMap[srv.sid].includes(uLow)){processedMap[srv.sid].push(uLow);atomicJSON(processedFile,processedMap);}if(Date.now()-lastGitSync>180000){lastGitSync=Date.now();try{const {exec}=require('child_process');exec('git config user.name "D-AUTO Bot" && git config user.email "bot@dauto.local" && git add processed_accounts.json state/ && (git diff --staged --quiet || git commit -m "chore: auto-checkpoint processed accounts [skip ci]") && git pull --rebase origin main && git push origin HEAD:main',{cwd:lab},()=>{});}catch(_){}}const resources=raw.observedResources||{};const heroes=Object.entries(rule.counts).filter(([,c])=>c>0).map(([n,c])=>`${n} x${c}`).join(' + ');
 console.log(progressLine({server:srv.name,done:completed,total:selected.length,elapsedMs:Date.now()-started,username:a.username,sent:raw.codesSent,responses:raw.confirmedCodes.length,tickets:resources.thienMenh,stars:names.length,gems:resources.gems,heroes,jackpot:rule.isJackpotAlert}));
 atomicJSON(path.join(stateDir,'progress.json'),{done:completed,total:selected.length,concurrency:poolSize,codeDelayMs:180,updatedAt:new Date().toISOString()});
 return {status:rule.isJackpotAlert?'JACKPOT_LOCKED':'PENDING',result,account:a};
 },followupStatus:r=>followups.status(r),jackpot:(a,r,context)=>{const vault=readJSON(globalVault,[]);if(!vault.some(x=>x.username===a.username))vault.push({...a,lockedAt:new Date().toISOString()});atomicJSON(globalVault,vault);return followups.enqueue(a,r,srv,{checkpoint:path.relative(lab,context.checkpointFile),key:context.taskKey});}}})));
 console.log(JSON.stringify({event:'ROUND_FINISHED',sid:srv.sid,attempted:reports.reduce((n,r)=>n+r.attempted,0)}));}finally{clearInterval(poll);release()}
 return nextServer;
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const release=lock(path.join(lab,'state/latest-runner.lock'));try{followups=new FollowupQueue(lab);followups.recoverPending();let server=await latestServer(catalogAccount);while(!shutdown){
const settings=readJSON(path.join(lab,'state/live-settings.json'),{});
if(!serverAllowed(server,settings)){atomicJSON(path.join(lab,'state/server-wait.json'),{mode:'WAITING',minimumServerSid:settings.minimumServerSid,latestSeen:server.sid,at:new Date().toISOString()});console.log(JSON.stringify({event:'WAITING_FOR_REQUIRED_SERVER',minimumSid:settings.minimumServerSid,latestSeen:server.sid}));while(!shutdown&&!serverAllowed(server,readJSON(path.join(lab,'state/live-settings.json'),{}))){await pause(60000);if(shutdown)break;try{server=await latestServer(catalogAccount)}catch{console.log(JSON.stringify({event:'SERVER_LOOKUP_FAILED'}));}}if(shutdown)break;}
atomicJSON(path.join(lab,'state/server-wait.json'),{mode:'RUNNING',sid:server.sid,at:new Date().toISOString()});atomicJSON(path.join(lab,'state/active-server.json'),server);const next=await runServer(server);if(shutdown)break;if(next){server=next;continue;}console.log(JSON.stringify({event:'WAITING_FOR_NEW_SERVER',sid:server.sid}));while(!shutdown){await pause(60000);if(shutdown)break;try{const latest=await latestServer(catalogAccount);if(Number(latest.sid)>Number(server.sid)){server=latest;break;}}catch{console.log(JSON.stringify({event:'SERVER_LOOKUP_FAILED'}));}}}}finally{if(followups)await followups.stop();release();console.log(JSON.stringify({event:'STOPPED'}))}})().catch(e=>{console.error('LATEST_RUNNER_FAILED',e.stack);process.exitCode=1});
