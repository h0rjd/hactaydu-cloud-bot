const fs=require('fs'),path=require('path'),crypto=require('crypto');const {readJSON,atomicJSON}=require('./storage');
const idFor=(sid,name)=>crypto.createHash('sha256').update(`${sid}:${String(name).toLowerCase()}`).digest('hex');
const jobDir=root=>path.join(root,'state/followup-jobs');
function put(root,job){atomicJSON(path.join(jobDir(root),job.id+'.json'),job);}
function enqueue(root,account,result,server,source={}){const id=idFor(result.sid,account.username),file=path.join(jobDir(root),id+'.json');const old=readJSON(file,null);if(old)return old;const job={id,account,result,server,source,status:'QUEUED',attempts:0,createdAt:new Date().toISOString()};put(root,job);return job;}
function all(root){const dir=jobDir(root);if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>readJSON(path.join(dir,f))).sort((a,b)=>(b.source?.priority||0)-(a.source?.priority||0)||Number(b.result.sid)-Number(a.result.sid)||a.createdAt.localeCompare(b.createdAt));}
function resultFor(root,sid,name){const j=readJSON(path.join(jobDir(root),idFor(sid,name)+'.json'),null);return j&&['DONE','FAILED','REVIEW_REQUIRED','BLOCKED'].includes(j.status)?j.delivery:null;}
function recover(root){for(const j of all(root)){
 if(j.status==='SENDING'){j.status='REVIEW_REQUIRED';j.delivery={complete:false,errorCode:'TELEGRAM_ACK_UNCERTAIN'};put(root,j);continue;}
 if(j.status==='RUNNING'){j.status=j.attempts>=3?'FAILED':'QUEUED';put(root,j);}
 if(j.status==='FAILED'&&j.delivery?.errorCode==='TUTORIAL_NOT_CONFIRMED'&&!j.guideSequenceFixApplied){j.guideSequenceFixApplied='3.0.2';j.previousAttempts=j.attempts;j.attempts=0;j.status='QUEUED';j.retryAt=0;put(root,j);}
 if(j.status==='FAILED'&&(j.delivery?.errorCode==='WINNER_PHOTO_ORDER_NOT_CONFIRMED'||j.delivery?.errorCode==='HERO_PHOTO_MISSING')&&!j.winnerOrderFixApplied){j.winnerOrderFixApplied='3.1.2';j.previousAttempts=j.attempts;j.attempts=0;j.status='QUEUED';j.retryAt=0;put(root,j);}
}}

async function processOne(root,job,deliver){job.status='RUNNING';job.attempts++;put(root,job);try{const sold=readJSON(path.join(root,'protection.json'),[]);if(sold.some(x=>String(x.username||'').toLowerCase()===job.account.username.toLowerCase()||String(x.accId||'')===String(job.account.accId))){job.status='BLOCKED';job.delivery={complete:false,errorCode:'SOLD_ACCOUNT_PROTECTED'};}else{job.delivery=await deliver(job.account,job.result,{verifiedServer:job.server,replaceMessageId:job.source.messageId,recoverSkippedCampaign:job.result.rawV79?.guideSkipSent!==false,quietLogPath:path.join(root,'state/tutorial-logs',job.id+'.log'),onBeforeTelegram:()=>{job.status='SENDING';put(root,job);}});job.status=job.delivery.complete?'DONE':'FAILED';}}
catch{const uncertain=job.status==='SENDING';job.status=uncertain?'REVIEW_REQUIRED':'FAILED';job.delivery={complete:false,errorCode:uncertain?'TELEGRAM_ACK_UNCERTAIN':'FOLLOWUP_FAILED'};}
job.finishedAt=new Date().toISOString();job.retryAt=Date.now()+60000;put(root,job);return job;}
module.exports={idFor,enqueue,all,put,resultFor,recover,processOne};
