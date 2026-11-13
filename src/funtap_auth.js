const fs=require('fs'),path=require('path'),crypto=require('crypto');
const APP='2a456b78cf5122cd9278ef24b4d7bfb9',VERSION='9.9.9.5';
function credentials(accId){const root=path.resolve(__dirname,'..');for(const name of ['accounts.json','s39_accounts_mapped.json','accounts_h0.json','accounts_d4.json','new_created_accounts.json','all_github_worker_accounts.json']){const f=path.join(root,name);if(!fs.existsSync(f))continue;const rows=JSON.parse(fs.readFileSync(f,'utf8'));const a=rows.find(x=>String(x.accId)===String(accId));if(a)return a;}throw Error('SDK_CREDENTIALS_REQUIRED');}
async function login(account,request=fetch){
 if(!account?.username||!account?.password)throw Error('SDK_CREDENTIALS_REQUIRED');
 const body=new URLSearchParams({email:account.username,password:account.password,device_id:crypto.createHash('sha1').update('vn.ftg.hactaydu.pixel6.device').digest('hex'),fcm_token:'',package_name:'vn.ftg.hactaydu',appsflyer_id:'1729500000000-1234567890123456789',advertising_id:'00000000-0000-0000-0000-000000000000'});
 const r=await request(`https://core.sdkmain.com/api/v1/apps/${APP}/${VERSION}/auth/login`,{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json','X-Request':APP,'app-Version':VERSION,'sdk-Version':'6.1.2',Language:'vi-VN','X-Android-Notch':'false'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('SDK_LOGIN_HTTP_'+r.status);const d=await r.json(),u=d.data||{},token=d.access_token||u.accessToken||u.access_token,id=u.account?.account_id;
 if(!token||!id||(typeof d.error_code==='number'&&d.error_code<0))throw Error('SDK_LOGIN_REJECTED');
 if(account.accId&&String(id)!==String(account.accId))throw Error('SDK_ACCOUNT_ID_MISMATCH');
 return {accId:String(id),token};
}
async function authKey(accId,account,request=fetch){
 const a=account||credentials(accId),session=await login({...a,accId:String(accId)},request);
 const hosts=['funtap-xy.xinliugame.net','funtap-xy.ridvqqxa.com'];
 const headers={
  'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Accept':'*/*',
  'Referer':'https://rescdnft105vn.ridvqqxa.com/'
 };
 let lastErr=null;
 for(const host of hosts){
  try{
   const url=new URL(`https://${host}/funtap/checkLogin.php`);
   url.search=new URLSearchParams({access_token:session.token,plt:'android',appVersion:VERSION});
   const r=await request(url,{headers,signal:AbortSignal.timeout(15000)});
   if(!r.ok)continue;
   const d=await r.json();
   if(!d||Number(d.code)!==200||String(d.openid)!==String(accId))throw Error('GAME_AUTH_ACCOUNT_NOT_BOUND');
   if(!d.time||!d.authkey||!d.userIp)throw Error('GAME_AUTH_NOT_CONFIRMED');
   return {ts:String(d.time),ak:String(d.authkey),userIp:String(d.userIp||'')};
  }catch(err){lastErr=err;}
 }
 throw lastErr||Error('GAME_AUTH_NOT_CONFIRMED');
}
module.exports={login,authKey};
