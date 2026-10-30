const fs=require('fs');const path=require('path');const {readJSON}=require('./storage');
const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function captionFor(account,result,prepared,title='NỔ NÒNG CỐT & ĐÃ QUA TÂN THỦ (Lv.8+)'){
 const machine=readJSON(path.join(__dirname,'../machine.json'),{});const machineName=process.env.MACHINE_NAME||machine.machineName||`M${machine.machineId||1}`;
 const pairs=Object.entries(result.counts||{}).filter(([,n])=>n>0).map(([n,c])=>`${n} x${c}`).join(' + ')||'2x Thần Tướng';
 const sidNum=Number(result.sid);const sNum=sidNum>=600000?(sidNum-610000):sidNum;
 const rawServerName=String(result.serverName||'').replace(/^\[S\d+[^\]]*\]\s*/i,'').replace(/^[sS]\d+[\s\-_:]*/,'').trim();
 const displayServer=`[S${sNum}] ${rawServerName}`;
 return `🔥🔥 <b>[${esc(title)}]</b>\n🖥 Máy chạy: <b>${esc(machineName)}</b>\n🌐 Server: <b>${esc(displayServer)}</b> (<code>${esc(result.sid)}</code>)\n👤 TK: <code>${esc(account.username)}</code> | MK: <code>${esc(account.password)}</code>\n🆔 UID: <code>${esc(prepared.roleUid)}</code> | AccID: <code>${esc(account.accId)}</code>\n🎭 Nhân vật: <b>${esc(prepared.roleName)}</b> (Lv.${esc(prepared.roleLv)}) | Ngọc: <b>${esc(prepared.zuanshiLeft)} 💎</b>\n🔥 Tướng nổ: <b>${esc(pairs)}</b> (Tổng 5★: <b>${esc(result.heroes5StarCount)}</b>)\n🔒 <i>Đã khóa két bảo vệ &amp; rút khỏi kho reroll!</i>`;
}
async function prepareAndNotify(account,result,{signal,verifiedServer,replaceMessageId,recoverSkippedCampaign=false,quietLogPath,onBeforeTelegram}={}){
 const {prepareAndScreenshotJackpotAccount}=require('../prepare_jackpot_account');
 const srv=verifiedServer||await require('./adapters/reroll').server(result.sid);
 if(String(srv.sid)!==String(result.sid)||!/^wss:\/\//.test(srv.wsUrl))throw Error('Invalid server for jackpot preparation');
 const COMBO_TARGETS = ['Đường Tam Tạng', 'Trư Bát Giới', 'Tôn Ngộ Không', 'Lý Tịnh'];
 const winningDuplicates = Object.entries(result.counts||{}).filter(([,n])=>n>=2).map(([name])=>name);
 const comboHits = COMBO_TARGETS.filter(name => (result.counts?.[name] || 0) >= 1);
 const winningNames = winningDuplicates.length > 0 ? winningDuplicates : (comboHits.length >= 3 ? comboHits : []);
 const recoveryMode=recoverSkippedCampaign||!!(result.rawV79&&result.rawV79.guideSkipSent!==false);
 const targetHeroName=winningNames[0]||'';
 const params={username:account.username,password:account.password,accId:String(account.accId),sid:String(result.sid),serverName:result.serverName,wsUrl:srv.wsUrl,targetHeroId:result.jackpotTargetHeroId||0,targetHeroName,targetHeroNames:winningNames,resumeGuideStepId:result.rawV79?.guideState?.gid||null,recoverSkippedCampaign:recoveryMode,minimumPhotoLevel:8,logger:require('./private_logger').privateLogger(quietLogPath||path.join(__dirname,'../state/tutorial-logs',`${result.sid}-${account.accId}.log`))};
 let prepared=await prepareAndScreenshotJackpotAccount(params);
 if(prepared.tutorialCleared&&prepared.roleLv<8)prepared=await prepareAndScreenshotJackpotAccount({...params,recoverSkippedCampaign:true});
 if(prepared.roleLv<8||!prepared.tutorialCleared||!require('./tutorial_evidence').tutorialConfirmed(prepared.tutorialEvidence))return {complete:false,errorCode:'TUTORIAL_NOT_CONFIRMED',prepared};
 if(!prepared.heroShotPath||!fs.existsSync(prepared.heroShotPath))return {complete:false,errorCode:'HERO_PHOTO_MISSING',prepared};

 // 1. BƠM TÀI KHOẢN VÀO BOT BÁN HÀNG qua Webhook
 const machine=readJSON(path.join(__dirname,'../machine.json'),{});
 const machineName=process.env.MACHINE_NAME||machine.machineName||`M${machine.machineId||1}`;
 const webhookUrl=process.env.SALES_BOT_WEBHOOK_URL||'https://152-69-209-107.sslip.io/api/v1/inventory/hactaydu-webhook';
 const webhookSecret=process.env.SALES_BOT_SECRET||'d57be08c4bbbc9c7feda86285611ee41fc8016d4f1bf4a1a7a60502d123b0ab3';

 const sidNum=Number(result.sid);const sNum=sidNum>=600000?(sidNum-610000):sidNum;
 const rawServerName=String(result.serverName||'').replace(/^\[S\d+[^\]]*\]\s*/i,'').replace(/^[sS]\d+[\s\-_:]*/,'').trim();
 const displayServer=`[S${sNum}] ${rawServerName}`;
 const serverCol=`${displayServer} (${result.sid})`;

 let photoB64='';
 try{photoB64=fs.readFileSync(prepared.heroShotPath).toString('base64');}catch(_){}
 const pairs=Object.entries(result.counts||{}).filter(([,n])=>n>0).map(([n,c])=>`${c}x ${n}`).join(' + ')||(winningNames.length?`2x ${winningNames[0]}`:'2x Thần Tướng');

 const webhookPayload={
  machine_id:machineName,
  account:account.username,
  password:account.password,
  funtap_id:String(account.accId),
  server_id:Number(result.sid),
  server_num:sNum,
  server_name:displayServer,
  server:serverCol,
  server_display:displayServer,
  sid:Number(result.sid),
  level:prepared.roleLv||8,
  diamonds:prepared.zuanshiLeft||1800,
  role_uid:prepared.roleUid||`${result.sid}${String(account.accId).slice(-5)}`,
  char_name:prepared.roleName||`${result.sid}-${account.accId}`,
  jackpot_type:pairs,
  total_5star:result.heroes5StarCount,
  target_heroes:winningNames,
  heroes_5star:result.rawV79?.heroes5Star||[],
  screenshot_path:prepared.heroShotPath,
  screenshot_base64:photoB64,
  screenshot_filename:`${account.username}_S${sNum}.jpg`,
  codes_claimed:`${result.cdkAckedCount||28}/28`,
  unconfirmed_codes:result.cdkUnconfirmedCodes||[],
  unconfirmed_codes_str:(result.cdkUnconfirmedCodes||[]).join(', '),
  notes:`${displayServer} -> ${pairs} | Code: ${result.cdkAckedCount||28}/28 | Ngọc=${prepared.zuanshiLeft||1800} | Tổng 5★=${result.heroes5StarCount}`,
  time:new Date().toISOString()
 };

 let webhookSuccess=false;
 try{
  const wbResp=await fetch(webhookUrl,{
   method:'POST',
   headers:{'Content-Type':'application/json','X-Webhook-Secret':webhookSecret,'Authorization':`Bearer ${webhookSecret}`},
   body:JSON.stringify(webhookPayload),
   signal:AbortSignal.timeout(15000)
  });
  const wbData=await wbResp.json().catch(()=>({}));
  console.log(`🤖 [Bot Bán Hàng] Đã bơm tài khoản ${account.username} (Máy: ${machineName} | ${displayServer}) vào Bot Bán Hàng! (${wbData.status||wbResp.status})`);
  webhookSuccess=true;
 }catch(wbErr){
  console.warn(`⚠️ [Bot Bán Hàng] Lỗi webhook: ${wbErr.message}`);
 }

 // 2. Ghi nhận vào file DAN_NICK_TRUNG_TUONG.txt
 try{
  const txtPath=path.join(__dirname,'../DAN_NICK_TRUNG_TUONG.txt');
  const line=`${account.username} | ${account.password} | ${serverCol} | [X2] ${pairs} | ${result.heroes5StarCount}★ | ${prepared.heroShotPath} | ${account.accId} | ${prepared.heroShotPath} | ${new Date().toISOString()} | Đủ code\n`;
  fs.appendFileSync(txtPath,line,'utf-8');
 }catch(_){}

 // 3. Gửi thông báo và ảnh về Telegram Bot (nếu cấu hình)
 let teleSuccess=false;let teleMessageId=null;
 try{
  const local=readJSON(path.join(__dirname,'../telegram.local.json'),{});
  const token=process.env.TELEGRAM_BOT_TOKEN||local.botToken;
  const chatId=process.env.TELEGRAM_CHAT_ID||local.chatId;
  if(token&&chatId){
   const caption=captionFor(account,result,prepared);
   const form=new FormData();form.append('chat_id',chatId);form.append('caption',caption);form.append('parse_mode','HTML');form.append('photo',new Blob([fs.readFileSync(prepared.heroShotPath)],{type:'image/png'}),path.basename(prepared.heroShotPath));
   if(replaceMessageId){form.delete('photo');form.delete('caption');form.delete('parse_mode');form.append('message_id',String(replaceMessageId));form.append('media',JSON.stringify({type:'photo',media:'attach://photo',caption,parse_mode:'HTML'}));form.append('photo',new Blob([fs.readFileSync(prepared.heroShotPath)],{type:'image/png'}),path.basename(prepared.heroShotPath));}
   if(onBeforeTelegram)await onBeforeTelegram();
   const response=await fetch(`https://api.telegram.org/bot${token}/${replaceMessageId?'editMessageMedia':'sendPhoto'}`,{method:'POST',body:form,signal:signal||AbortSignal.timeout(30000)});
   const data=await response.json();
   if(response.ok&&data.ok){teleSuccess=true;teleMessageId=data.result.message_id;console.log(`🤖 [Telegram Bot] Đã gửi thông báo nick ${account.username} thành công! (ID #${teleMessageId})`);}
  }
 }catch(tgErr){console.warn(`⚠️ [Telegram Bot] Lỗi gửi ảnh: ${tgErr.message}`);}

 return {complete:true,webhookSuccess,messageId:teleMessageId,prepared};
}
async function markPendingCaption(account,result,prepared,messageId){
 const c=readJSON(path.join(__dirname,'../telegram.local.json'),{});const token=process.env.TELEGRAM_BOT_TOKEN||c.botToken,chatId=process.env.TELEGRAM_CHAT_ID||c.chatId;
 if(!token||!chatId)throw Error('TELEGRAM_NOT_CONFIGURED');
 const response=await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,message_id:messageId,caption:captionFor(account,result,prepared,'NỔ NÒNG CỐT • CHỜ HOÀN TẤT TÂN THỦ'),parse_mode:'HTML'}),signal:AbortSignal.timeout(30000)});const d=await response.json();if((!response.ok||!d.ok)&&!String(d.description||'').includes('message is not modified'))throw Error('CAPTION_CORRECTION_FAILED');return true;
}
module.exports={prepareAndNotify,markPendingCaption,captionFor};
