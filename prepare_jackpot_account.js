const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tls = require('tls');
const crypto = require('crypto');
const https = require('https');
let chromium = null;
try {
  chromium = require('playwright').chromium;
} catch (_) {
  try {
    chromium = require('../funtap-registration/node_modules/playwright').chromium;
  } catch (__) {
    try {
      chromium = require('./funtap-registration/node_modules/playwright').chromium;
    } catch (___) {
      chromium = null;
    }
  }
}

const WORKSPACE = __dirname;
fs.mkdirSync(path.join(WORKSPACE, 'jackpot_screenshots'), { recursive: true });
globalThis.require = require;

class CustomWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._handshakeDone = false;
    this._buf = Buffer.alloc(0);

    const u = new URL(url);
    const isWss = u.protocol === 'wss:';
    const port = Number(u.port) || (isWss ? 443 : 80);
    const host = u.hostname;
    const key = crypto.randomBytes(16).toString('base64');

    const opts = {
      host,
      port,
      servername: host,
      rejectUnauthorized: false
    };

    const netLib = isWss ? tls : require('net');
    this.sock = netLib.connect(opts, () => {
      this.sock.write(
        `GET ${u.pathname || '/'} HTTP/1.1\r\n` +
          `Host: ${u.host}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    this.sock.on('data', (chunk) => this._onData(chunk));
    this.sock.on('error', (err) => {
      this.readyState = 3;
      if (this.onerror) this.onerror(err);
    });
    this.sock.on('close', () => {
      this.readyState = 3;
      if (this.onclose) this.onclose({});
    });
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    if (!this._handshakeDone) {
      const idx = this._buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      this._buf = this._buf.slice(idx + 4);
      this._handshakeDone = true;
      this.readyState = 1;
      if (this.onopen) this.onopen({});
    }
    while (this._buf.length >= 2) {
      const b0 = this._buf[0];
      const b1 = this._buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this._buf.length < 4) return;
        len = this._buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this._buf.length < 10) return;
        len = Number(this._buf.readBigUInt64BE(2));
        offset = 10;
      }
      if (masked) offset += 4;
      if (this._buf.length < offset + len) return;
      const payload = this._buf.slice(offset, offset + len);
      this._buf = this._buf.slice(offset + len);
      if (opcode === 0x08) {
        this.close();
        return;
      }
      if (opcode === 0x09) {
        this._sendFrame(0x0a, payload);
        continue;
      }
      if (opcode === 0x01 || opcode === 0x02) {
        const ab = payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength
        );
        if (this.onmessage) this.onmessage({ data: ab });
      }
    }
  }

  _sendFrame(opcode, payloadBuf) {
    if (this.readyState !== 1) return;
    const len = payloadBuf.length;
    const headerLen = len < 126 ? 2 : len < 65536 ? 4 : 10;
    const mask = crypto.randomBytes(4);
    const frame = Buffer.alloc(headerLen + 4 + len);
    frame[0] = 0x80 | opcode;
    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len < 65536) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
    }
    mask.copy(frame, headerLen);
    for (let i = 0; i < len; i++) {
      frame[headerLen + 4 + i] = payloadBuf[i] ^ mask[i & 3];
    }
    try {
      this.sock.write(frame);
    } catch (_) {}
  }

  send(data) {
    this._sendFrame(0x02, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  close() {
    this.readyState = 3;
    try {
      this.sock.destroy();
    } catch (_) {}
  }
}

const gameCode = fs.readFileSync(path.join(WORKSPACE, 'remote_game.js'), 'utf8');
const vnLang =
  JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'cdn_cache/res/lang/vn/vn.json'), 'utf8')).lang || {};

const startZi = gameCode.indexOf('var n;(zi=>{');
const endZi = gameCode.indexOf('})(n||(n={}));', startZi) + '})(n||(n={}));'.length;
const sliceZi = gameCode.slice(startZi, endZi);

const startStructs = gameCode.indexOf('var su=class{static readData()');
const endStructs = gameCode.indexOf('var re=class{static initItem()');
const sliceStructs = gameCode.slice(startStructs, endStructs);

const startSD = gameCode.indexOf('var SD;(WA=>{');
const endSD = gameCode.indexOf('})(SD||(SD={}));', startSD) + '})(SD||(SD={}));'.length;
const sliceSD = gameCode.slice(startSD, endSD);

const COMBINED_PROTOCOL_SCRIPT = new vm.Script(
  sliceZi + '\n' + sliceStructs + '\n' + sliceSD + '\nwindow.MsgHandler = SD; n.handler = SD;'
);

function fetchAuthKey(accId, account) {
  return require('./src/funtap_auth').authKey(accId, account);
}

/**
 * Thực hiện trọn gói cho 1 tài khoản trúng x2/x3:
 * 1. Tạo nhân vật thật (CG_ROLE_RANDOM_NAME -> CG_ROLE_CHANGE_NAME_GUIDE) tại bước 104
 * 2. Đi từng bước nhiệm vụ tân thủ thật (101 -> 1827 -> NULL) + vượt ải + nhận nhiệm vụ chính tuyến
 * 3. Xếp đội hình để 2/3 bản sao tướng trúng giải (Dương Tiễn=1014, Tôn Ngộ Không=2015, Na Tra=3014) đứng sát cạnh nhau ở hàng 1
 * 4. Mở H5 client (Playwright headless) và chụp 2 ảnh màn hình (Màn hình chính + Túi Thần Tướng)
 */
async function prepareAndScreenshotJackpotAccount({
  username,
  password,
  accId,
  sid,
  serverName,
  wsUrl,
  targetHeroId = 3014,
  targetHeroNames = [],
  phasePasses = 1,
  phaseTimeoutMs = 180000,
  resumeGuideStepId = null,
  recoverSkippedCampaign = true,
  minimumPhotoLevel = 8,
  logger = globalThis.console
}) {
  const console=logger;
  const tStart = Date.now();
  const sNum = Number(sid) - 610000;
  const sMatch = String(serverName || '').match(/S(\d+)/i);
  const displaySNum = sMatch ? sMatch[1] : sNum;
  const effectiveWsUrl = wsUrl || `wss://wss-funtap-xy.xinliugame.net:${9026 + sNum}/`;
  const { ts, ak, userIp: loginUserIp } = await fetchAuthKey(accId, { username, password, accId });

  let finalRoleName = `${sid}-${accId}`;
  let finalRoleUid = '';
  let finalLv = 1;
  let finalZdl = 0;
  let finalZuanshi = 0;
  let stepsCompleted = 0;
  const guideCheckpointPath=path.join(WORKSPACE,'state','tutorial-guides',`${sid}-${accId}.json`);
  const {readJSON,atomicJSON}=require('./src/storage');
  const priorGuide=readJSON(guideCheckpointPath,{});
  const guideStepIds=new Set(priorGuide.stepIds||[]);
  stepsCompleted=guideStepIds.size;
  resumeGuideStepId=priorGuide.currentStepId||resumeGuideStepId;
  const currentTutorialEvidence=()=>({explicitGuideNull,stepsCompleted,lastGuideStepId:Math.max(0,...guideStepIds),roleLv:finalLv,campaignEvidence:recoverSkippedCampaign?campaignEvidence:null});
  const tutorialEvents={};
  const tutorialNotices=[];
  const claimedTutorialTasks=new Set();
  let guideClearedToNull = false;
  let explicitGuideNull = false;
  const winningHeroIds=new Set();
  let heroBagTopIds=[],winnerPhotoOrdered=false;
  const matchTargetHero = (id, rawName, rawName2) => {
    const combinedRaw = (String(rawName || '') + ' ' + String(rawName2 || '')).toLowerCase();
    const hId = Number(id || 0);
    if (hId === 1014 || combinedRaw.includes('duong tien') || combinedRaw.includes('dương tiễn') || combinedRaw.includes('杨戬')) return 'Dương Tiễn';
    if (hId === 2014 || combinedRaw.includes('ngo khong') || combinedRaw.includes('ngộ không') || combinedRaw.includes('孙悟空')) return 'Tôn Ngộ Không';
    if (hId === 3014 || combinedRaw.includes('na tra') || combinedRaw.includes('哪吒')) return 'Na Tra';
    if (hId === 3010 || combinedRaw.includes('duong tam tang') || combinedRaw.includes('đường tam tạng') || combinedRaw.includes('đường tăng') || combinedRaw.includes('唐僧') || combinedRaw.includes('唐玄奘')) return 'Đường Tam Tạng';
    if (hId === 2015 || hId === 1012 || combinedRaw.includes('cang kim') || combinedRaw.includes('cangkim') || combinedRaw.includes('亢金')) return 'Cang Kim Tinh Quân';
    if (hId === 2012 || combinedRaw.includes('hong hai nhi') || combinedRaw.includes('hồng hài nhi') || combinedRaw.includes('红孩儿')) return 'Hồng Hài Nhi';
    if (hId === 3012 || combinedRaw.includes('tran nguyen tu') || combinedRaw.includes('trấn nguyên tử') || combinedRaw.includes('trấn nguyên') || combinedRaw.includes('镇元子')) return 'Trấn Nguyên Tử';
    if (hId === 2013 || combinedRaw.includes('ngoc dien') || combinedRaw.includes('ngọc diện') || combinedRaw.includes('玉面')) return 'Ngọc Diện Hồ Ly';
    if (hId === 1007 || combinedRaw.includes('hang nga') || combinedRaw.includes('hằng nga') || combinedRaw.includes('嫦娥')) return 'Hằng Nga';
    if (hId === 3004 || combinedRaw.includes('hoang my') || combinedRaw.includes('hoàng my') || combinedRaw.includes('黄眉')) return 'Hoàng My';
    if (hId === 2006 || combinedRaw.includes('nguu ma') || combinedRaw.includes('ngưu ma') || combinedRaw.includes('牛魔')) return 'Ngưu Ma Vương';
    if (hId === 2007 || combinedRaw.includes('thiet phien') || combinedRaw.includes('thiết phiến') || combinedRaw.includes('铁扇')) return 'Thiết Phiến Công Chúa';
    if (hId === 3006 || combinedRaw.includes('hang long') || combinedRaw.includes('hàng long') || combinedRaw.includes('降龙')) return 'Hàng Long Tôn Giả';
    if (hId === 2010 || combinedRaw.includes('bat gioi') || combinedRaw.includes('bát giới') || combinedRaw.includes('八戒')) return 'Trư Bát Giới';
    if (hId === 1010 || combinedRaw.includes('ly tinh') || combinedRaw.includes('lý tịnh') || combinedRaw.includes('李靖') || combinedRaw.includes('托塔')) return 'Lý Tịnh';
    return null;
  };
  const heroNameToIdMap = {
    'dương tiễn': 1014,
    'tôn ngộ không': 2014,
    'ngộ không': 2014,
    'na tra': 3014,
    'đường tam tạng': 3010,
    'đường tăng': 3010,
    'cang kim tinh quân': 2015,
    'cang kim': 2015,
    'hồng hài nhi': 2012,
    'trấn nguyên tử': 3012,
    'trấn nguyên': 3012,
    'ngọc diện hồ ly': 2013,
    'ngọc diện': 2013,
    'hằng nga': 1007,
    'hoàng my': 3004,
    'ngưu ma vương': 2006,
    'ngưu ma': 2006,
    'thiết phiến công chúa': 2007,
    'thiết phiến': 2007,
    'hàng long tôn giả': 3006,
    'hàng long': 3006,
    'trư bát giới': 2010,
    'bát giới': 2010,
    'lý tịnh': 1010,
  };
  if (targetHeroId) winningHeroIds.add(Number(targetHeroId));
  if (Array.isArray(targetHeroNames)) {
    for (const name of targetHeroNames) {
      const nLow = String(name || '').toLowerCase();
      for (const [kn, kid] of Object.entries(heroNameToIdMap)) {
        if (nLow.includes(kn)) {
          winningHeroIds.add(kid);
          if (!targetHeroId) targetHeroId = kid;
        }
      }
    }
  }
  const campaignCheckpointPath=path.join(WORKSPACE,'state','tutorial-campaigns',`${sid}-${accId}.json`);
  const campaignEvidence={initialChapterID:null,currentChapterID:null,wins:0,...(recoverSkippedCampaign?require('./src/storage').readJSON(campaignCheckpointPath,{}):{})};
  let lastLiveWrite=0;
  const {tutorialConfirmed,tutorialReady}=require('./src/tutorial_evidence');
  const phaseComplete=()=>recoverSkippedCampaign?tutorialReady(currentTutorialEvidence()):tutorialConfirmed(currentTutorialEvidence());

  // PHA 1: Tạo nhân vật + Làm hết chuỗi nhiệm vụ tân thủ thật (101 -> 1827 -> NULL) + Xếp đội hình
  // Tối đa 3 hiệp; cần guide NULL rõ ràng cùng bằng chứng tiến độ, không suy đoán từ timeout hoặc level.
  const tPhase1Start = Date.now();
  for (let pass = 1; pass <= phasePasses; pass++) {
    let passSteps = 0;
    await new Promise((resolve) => {
      const heroMap = new Map();
      let readyObjList = [];
      let curStep = null;
      let pendingCombatReady = null;
      let awaitingCombatReady=false;
      let recoveryBattles=0;
      let combatRunning=false;
      let lastGuideReceivedAt = 0;
      let retryTimer = null;
      let noStepCheckTimer = null;
      let done = false;
      let phaseTimeout = null;
      let phaseSocket = null;

      class PhaseWebSocket extends CustomWebSocket { constructor(url){super(url);phaseSocket=this;} }

      function finishPhase1() {
        if (done) return;
        done = true;
        if (phaseTimeout) clearTimeout(phaseTimeout);
        if (retryTimer) clearTimeout(retryTimer);
        if (noStepCheckTimer) clearTimeout(noStepCheckTimer);
        // Trước khi đóng kết nối: xếp đội hình combatType=0 chỉ để 1 tướng x2 mang nhãn "Chiến", nâng cấp tướng x2 số 1 để 2 con đứng sát cạnh nhau ở Vị trí #1 và #2 hàng đầu!
        try {
          if (!guideClearedToNull) throw Error("TUTORIAL_PENDING");
          const n = baseSandbox.n;
          const allHeroes = Array.from(heroMap.values());
          const validCoreIds = [1014, 2014, 2015, 3014, 3010, 2012, 3012, 2013, 1007, 3004, 2006, 2007, 3006, 2010];
          const fiveStarHeroes = allHeroes.filter(
            (h) => h && (
              validCoreIds.includes(h.id) ||
              h.id === targetHeroId ||
              Number(h.star || 0) >= 5 ||
              Number(h.pinzhi || 0) >= 5
            )
          );

          const byId = {};
          for (const h of fiveStarHeroes) {
            if (!h || !h.id) continue;
            (byId[h.id] = byId[h.id] || []).push(h);
          }

          let sameHeroCopies = [];
          if (targetHeroId && byId[targetHeroId] && byId[targetHeroId].length >= 2) {
            sameHeroCopies = byId[targetHeroId];
          } else {
            for (const cid of validCoreIds) {
              if (byId[cid] && byId[cid].length >= 2) {
                sameHeroCopies = byId[cid];
                targetHeroId = cid;
                break;
              }
            }
            if (sameHeroCopies.length < 2) {
              for (const hid of Object.keys(byId)) {
                if ((byId[hid] || []).length >= 2) {
                  sameHeroCopies = byId[hid];
                  targetHeroId = Number(hid);
                  break;
                }
              }
            }
          }
          if (sameHeroCopies.length >= 2) { winningHeroIds.add(sameHeroCopies[0].id); }
          if (sameHeroCopies.length >= 2 && n) {
            const firstCopy = sameHeroCopies[0];
            const secondCopy = sameHeroCopies[1];
            const keepSet = new Set([firstCopy.heroUuid, secondCopy.heroUuid]);
            if (n.CG_COMBAT_POS_UPDATE) {
              n.CG_COMBAT_POS_UPDATE(0, `1,${firstCopy.heroUuid},250,1150|@`, 1);
              n.CG_COMBAT_POS_UPDATE(1, `1,${firstCopy.heroUuid},250,1150|@`, 1);
            }
            setTimeout(() => {
              try {
                for (const h of allHeroes) {
                  if (h && h.heroUuid && !keepSet.has(h.heroUuid) && (h.lv || 1) > 1 && n.CG_HERO_CHONGSHENG) {
                    n.CG_HERO_CHONGSHENG(h.heroUuid);
                  }
                }
              } catch (_) {}
            }, 120);
            setTimeout(() => {
              try {
                for (let k = 0; k < 4; k++) {
                  if (n.CG_HERO_UP_DO) {
                    n.CG_HERO_UP_DO(firstCopy.heroUuid, 0);
                    n.CG_HERO_UP_DO(firstCopy.heroUuid, 1);
                  }
                }
                for (let k = 0; k < 3; k++) {
                  if (n.CG_HERO_UP_DO) {
                    n.CG_HERO_UP_DO(secondCopy.heroUuid, 0);
                    n.CG_HERO_UP_DO(secondCopy.heroUuid, 1);
                  }
                }
              } catch (_) {}
            }, 300);
          } else if (copies.length > 0 && n) {
            const seenIds = new Set();
            const deployList = [];
            for (const h of copies) {
              if (!seenIds.has(h.id)) {
                seenIds.add(h.id);
                deployList.push(h);
              }
            }
            const keepSet = new Set(deployList.slice(0, 3).map((h) => h.heroUuid));
            const posStr =
              deployList
                .slice(0, 6)
                .map((h, i) => `1,${h.heroUuid},${200 + i * 80},1150|`)
                .join('') + '@';
            if (n.CG_COMBAT_POS_UPDATE && posStr) {
              n.CG_COMBAT_POS_UPDATE(0, posStr, 1);
              n.CG_COMBAT_POS_UPDATE(1, posStr, 1);
            }
            setTimeout(() => {
              try {
                for (const h of allHeroes) {
                  if (h && h.heroUuid && !keepSet.has(h.heroUuid) && (h.lv || 1) > 1 && n.CG_HERO_CHONGSHENG) {
                    n.CG_HERO_CHONGSHENG(h.heroUuid);
                  }
                }
              } catch (_) {}
            }, 120);

          }
          if (n && n.CG_TASK_DETAIL_TASK_GET) {
            for (let idx = 1; idx <= 5; idx++) n.CG_TASK_DETAIL_TASK_GET(idx);
          }
        } catch (_) {}

        setTimeout(() => {
          try {
            if (phaseSocket) phaseSocket.close();
          } catch (_) {}
          resolve();
        }, 750);
      }

      const baseSandbox = {
        n: undefined,
        SD: undefined,
        WebSocket: PhaseWebSocket,
        ArrayBuffer,
        Uint8Array,
        DataView,
        RegExp,
        String,
        Number,
        Math,
        JSON,
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setTimeout,
        clearTimeout,
        l: { getLang: (s) => vnLang[s] || s },
        window: {},
        Pa: {
          onConnect: (accStr) => {
            const jsonDatas = JSON.stringify({
              gamePlatform: 'funtap',
              appid: 'ios',
              pf: 'ios_funtap',
              phoneSystem: 'ios'
            });
            baseSandbox.n.CG_ASK_LOGIN(accStr, ts, ak, 'vn', 'VN', loginUserIp || '', jsonDatas, '');
          },
          onFailed: () => finishPhase1(),
          onError: () => finishPhase1(),
          onClose: () => finishPhase1()
        }
      };

      const recoveryUpgradedHeroes=new Set();
      function deployReadyCombat(B){
        const n=baseSandbox.n,area=B.area1||[100,1000,600,1300];
        const cap=Math.max(1,Math.min(6,Number(B.maxNums?.[0])||2));
        const candidates=readyObjList.filter(x=>x?.heroSimple?.heroUuid).sort((a,b)=>{
          const ah=a.heroSimple,bh=b.heroSimple;return Number(bh.id===targetHeroId)-Number(ah.id===targetHeroId)||(bh.star||0)-(ah.star||0)||(bh.lv||0)-(ah.lv||0)||(bh.zhandouli||0)-(ah.zhandouli||0);
        });
        const used=new Set(),selected=[];
        for(const item of candidates){if(used.has(item.heroSimple.id))continue;used.add(item.heroSimple.id);selected.push(item);if(selected.length>=cap)break;}
        if(!selected.length)return;
        if(recoverSkippedCampaign){const h=selected[0].heroSimple;if((h.lv||1)<10&&!recoveryUpgradedHeroes.has(h.heroUuid)&&n.CG_HERO_UP_DO){recoveryUpgradedHeroes.add(h.heroUuid);for(let i=0;i<Math.min(9,10-(h.lv||1));i++)n.CG_HERO_UP_DO(h.heroUuid,0);}}
        const rowCount=Math.ceil(selected.length/2);
        const positions=selected.map((item,i)=>{const x=Math.round(area[0]+(i%2+1)*(area[2]-area[0])/3),y=Math.round(area[1]+(Math.floor(i/2)+1)*(area[3]-area[1])/(rowCount+1));return `${item.heroType||1},${item.heroSimple.heroUuid},${x},${y}|`;}).join('')+'@';
        if(n.CG_COMBAT_POS_UPDATE){n.CG_COMBAT_POS_UPDATE(0,positions,0);n.CG_COMBAT_POS_UPDATE(B.combatType||1,positions,0);}
        n.CG_COMBAT_START(B.combatType||1,positions,B.params||'');
      }

      function requestCombatReady(){
        if(awaitingCombatReady)return;
        awaitingCombatReady=true;readyObjList=[];pendingCombatReady=null;
        baseSandbox.n.CG_COMBAT_READY(1,'',0,0);
      }
      function handleStep(step) {
        if (done || !step || !step.id) return;
        const n = baseSandbox.n;
        const code = step.code;
        const id = step.id;
        if (code === 11) {
          n.CG_ROLE_RANDOM_NAME();
          retryTimer = setTimeout(() => handleStep(curStep), 450);
          return;
        }
        if (code === 15 || code === 899) {
          if (n.CG_COMBAT_READY) requestCombatReady();
        } else if ([22,23,24].includes(code)) {
          const hero=Array.from(heroMap.values()).find(h=>h.heroUuid);
          if(hero&&n.CG_COMBAT_POS_UPDATE){const pos=`1,${hero.heroUuid},300,1000|@`;n.CG_COMBAT_POS_UPDATE(0,pos,0);n.CG_COMBAT_POS_UPDATE(1,pos,0);}
        } else if (code === 20 || code === 21) {
          if(n.CG_COMBAT_READY)requestCombatReady();
        } else if (code === 41) {
          if (n.CG_GUIDE_LEVELUP_CLOSE) n.CG_GUIDE_LEVELUP_CLOSE();
        } else if (code === 51) {
          if (n.CG_SHOUCAI_GET) n.CG_SHOUCAI_GET();
        } else if (code === 62) {
          if (n.CG_DRAWCARD_DRAW) n.CG_DRAWCARD_DRAW(1, 1, 0);
        } else if (code === 44) {
          if (n.CG_STOVE_JULING_LIAN_QUERY) n.CG_STOVE_JULING_LIAN_QUERY();
        } else if (code === 46) {
          if (n.CG_STOVE_JULING_GET) n.CG_STOVE_JULING_GET();
        } else if (code === 74) {
          const heroes = Array.from(heroMap.values());
          const target =
            heroes.find((h) => (h.lv || 1) < 5 && h.id === targetHeroId) ||
            heroes.find((h) => (h.lv || 1) < 5 && [1014, 2014, 2015, 3014].includes(h.id)) ||
            heroes.find((h) => (h.lv || 1) < 5) ||
            heroes[0];
          if (target && n.CG_HERO_UP_DO) {
            for (let u = 0; u < 5; u++) n.CG_HERO_UP_DO(target.heroUuid, 0);
          }
        } else if (code === 77) {
          const heroes = Array.from(heroMap.values());
          const target =
            heroes.find((h) => (h.lv || 1) === 5) ||
            heroes.find((h) => h.id === targetHeroId) ||
            heroes.find((h) => [1014, 2014, 2015, 3014].includes(h.id)) ||
            heroes[0];
          if (target && n.CG_HERO_UP_DO) {
            for (let u = 0; u < 5; u++) n.CG_HERO_UP_DO(target.heroUuid, 0);
            n.CG_HERO_UP_DO(target.heroUuid, 1);
          }
        } else if (code === 90 || code === 91) {
          if(n.CG_PANEL_OPEN)n.CG_PANEL_OPEN(1025,'');
        } else if (code === 110) {
          if (n.CG_BATTLE_CHAPTER_NEXTGO) n.CG_BATTLE_CHAPTER_NEXTGO();
        } else if (code === 907) {
          if (n.CG_HERO_VIEW) n.CG_HERO_VIEW(1002, 4, 1);
        } else if (code === 911) {
          if (n.CG_HERO_VIEW) n.CG_HERO_VIEW(2004, 5, 1);
        }
        n.CG_GUIDE_STEP_FINISH(id);
        retryTimer = setTimeout(() => handleStep(curStep), 320);
      }

      const moduleProxyCache = {};
      const sandboxProxy = new Proxy(baseSandbox, {
        has: () => true,
        get(target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop === 'string') {
            if (!moduleProxyCache[prop]) {
              moduleProxyCache[prop] = new Proxy(
                {},
                {
                  get(_, fnName) {
                    return (...args) => {
                      const fn = String(fnName);
                      tutorialEvents[fn]=(tutorialEvents[fn]||0)+1;
                      if(recoverSkippedCampaign&&Date.now()-lastLiveWrite>1000){lastLiveWrite=Date.now();atomicJSON(path.join(WORKSPACE,'state',`tutorial-live-${accId}.json`),{username,sid,phase:pass,lastEvent:fn,events:tutorialEvents,evidence:currentTutorialEvidence(),notices:tutorialNotices});}
                      if (fn === 'GC_BROADCAST') { const text=String(args[2]||''); if(tutorialNotices.length<30)tutorialNotices.push(vnLang[text]||text); }
                      if (fn === 'GC_ENTER_SCENE') {
                        const scene=args[0];
                        if(scene && Number.isInteger(scene.sceneID) && baseSandbox.n.CG_ENTER_SCENE_OK) baseSandbox.n.CG_ENTER_SCENE_OK(scene.sceneID);
                        if(recoverSkippedCampaign && recoveryBattles===0)setTimeout(()=>{if(!done){if(baseSandbox.n.CG_SHOUCAI_GET)baseSandbox.n.CG_SHOUCAI_GET();if(baseSandbox.n.CG_STOVE_JULING_GET)baseSandbox.n.CG_STOVE_JULING_GET();setTimeout(()=>{if(!done)baseSandbox.n.CG_PANEL_OPEN(1036,'');},400);}},300);

                      } else if (fn === 'GC_ZZ_HUMAN_INFO') {
                        const info = args[0] || {};
                        if (info.name) finalRoleName = info.name;
                        if (info.lv) finalLv = info.lv;
                        if (info.zhandouli) finalZdl = info.zhandouli;
                        if (typeof args[1] === 'number') finalZuanshi = args[1];
                        if (args[7]) finalRoleUid = String(args[7]);
                        // Retry only a previously observed step on reconnect, never invent an ID.
                        if(Number.isInteger(resumeGuideStepId)&&resumeGuideStepId>0)setTimeout(()=>{if(!done)baseSandbox.n.CG_GUIDE_STEP_FINISH(resumeGuideStepId);},450);
                        // Guide progression starts after GC_ENTER_SCENE is acknowledged.
                      } else if (fn === 'GC_TIEM_DIGIT') {
                        if (args[0] === 102) finalZuanshi = args[1];
                      } else if (fn === 'GC_TASK_DETAIL') {
                        const task=args[0]||{};
                        for(const item of task.taskList||[]){const key=`${task.chapterID}:${item.index}`;if(item.state===1&&Number.isInteger(item.index)&&!claimedTutorialTasks.has(key)&&claimedTutorialTasks.size<32){claimedTutorialTasks.add(key);baseSandbox.n.CG_TASK_DETAIL_TASK_GET(item.index);}}
                        if(task.maxValue>0&&task.nowValue>=task.maxValue&&claimedTutorialTasks.size<32&&baseSandbox.n.CG_TASK_NEXT)baseSandbox.n.CG_TASK_NEXT();
                      } else if (fn === 'GC_ROLE_ATTR') {
                        for (const kv of args[0] || []) {
                          if (kv.key === 1) finalLv = kv.value;
                          if (kv.key === 4) finalZdl = kv.value;
                        }
                      } else if (fn === 'GC_HERO_LIST' || fn === 'GC_HERO_BAG_LIST') {
                        for (const h of args[0] || []) if (h && h.heroUuid) {heroMap.set(h.heroUuid, h);if(targetHeroNames.includes(matchTargetHero(h.id,h.name,h.name2))){winningHeroIds.add(h.id);targetHeroId=h.id;}}
                      } else if (fn === 'GC_HERO_ADD' || fn === 'GC_HERO_BAG_ADD') {
                        const h = args[0];
                        if (h && h.heroUuid) heroMap.set(h.heroUuid, h);
                      } else if (fn === 'GC_ROLE_RANDOM_NAME') {
                        const rName = args[0];
                        baseSandbox.n.CG_ROLE_CHANGE_NAME_GUIDE(rName, 0);
                        setTimeout(() => {
                          if (curStep && curStep.id) baseSandbox.n.CG_GUIDE_STEP_FINISH(curStep.id);
                        }, 100);
                      } else if (fn === 'GC_ROLE_CHANGE_NAME_GUIDE') {
                        if (args[0]) finalRoleName = args[0];
                        console.log(`✅ [${username}] Đã đặt tên nhân vật: ${finalRoleName}`);
                      } else if (fn === 'GC_BATTLE_CHAPTER_QUERY') {
                        const chapter=args[0]||{};
                        if(recoverSkippedCampaign&&chapter.canGo===1){combatRunning=false;awaitingCombatReady=false;pendingCombatReady=null;readyObjList=[];baseSandbox.n.CG_BATTLE_CHAPTER_NEXTGO();}
                      } else if (fn === 'GC_BATTLE_QUERY') {
                        const q=args[0]||{};
                        if(Number.isInteger(q.nowChapterID)){if(campaignEvidence.initialChapterID===null)campaignEvidence.initialChapterID=q.nowChapterID;campaignEvidence.currentChapterID=q.nowChapterID;campaignEvidence.lastState={canBattle:q.canBattle,canNextChapter:q.canNextChapter,needLv:q.needLv,wait:q.needJuLingTs,finishID:q.nowFinishID};}
                        if(recoverSkippedCampaign)atomicJSON(campaignCheckpointPath,campaignEvidence);
                        console.log(`📖 [${username}] Chương ${q.nowChapterID}, ải ${q.nowFinishID}, Lv.${finalLv} | đánh=${q.canBattle}, chương kế=${q.canNextChapter}, yêu cầu Lv.${q.needLv}, chờ=${q.needJuLingTs}s`);
                        if(recoverSkippedCampaign&&phaseComplete()){guideClearedToNull=true;finishPhase1();}
                        else if(recoverSkippedCampaign&&!combatRunning&&recoveryBattles<12&&(q.canBattle===1||q.canNextChapter===1)){recoveryBattles++;combatRunning=true;setTimeout(()=>{if(!done)requestCombatReady();},300);}
                      } else if (fn === 'GC_COMBAT_FINISH') {
                        const end=args[0]||{};combatRunning=false;
                        if(recoverSkippedCampaign&&end.combatType===1){if(end.result===1){campaignEvidence.wins++;atomicJSON(campaignCheckpointPath,campaignEvidence);setTimeout(()=>{if(!done)baseSandbox.n.CG_PANEL_OPEN(1036,'');},700);}else console.log(`⚠️ [${username}] Trận phục hồi chưa thắng; giữ pending`);}
                      } else if (fn === 'GC_COMBAT_READY_OBJLIST') {
                        readyObjList = Array.isArray(args[0]) ? args[0] : [];
                        for (const item of readyObjList) {
                          if (item && item.heroSimple && item.heroSimple.heroUuid) {
                            heroMap.set(item.heroSimple.heroUuid, item.heroSimple);
                          }
                        }
                        if(pendingCombatReady&&readyObjList.length){const battle=pendingCombatReady;pendingCombatReady=null;awaitingCombatReady=false;deployReadyCombat(battle);}
                      } else if (fn === 'GC_COMBAT_READY') {
                        pendingCombatReady=args[0]||{};
                        const scene=args[1];
                        if(scene&&Number.isInteger(scene.sceneID)&&baseSandbox.n.CG_ENTER_SCENE_OK)baseSandbox.n.CG_ENTER_SCENE_OK(scene.sceneID);
                        if(pendingCombatReady&&readyObjList.length){const battle=pendingCombatReady;pendingCombatReady=null;awaitingCombatReady=false;deployReadyCombat(battle);}
                      } else if (fn === 'GC_COMBAT_START') {
                        const combatType=Number.isInteger(args[0])?args[0]:1;
                        setTimeout(() => {
                          if (baseSandbox.n.CG_COMBAT_CLIENT_FINISH)
                            baseSandbox.n.CG_COMBAT_CLIENT_FINISH(combatType);
                          if (baseSandbox.n.CG_COMBAT_FINISH_GET)
                            baseSandbox.n.CG_COMBAT_FINISH_GET();
                        }, 80);
                      } else if (fn === 'GC_GUIDE_STEP') {
                        if(args[0]?.id&&curStep?.id===args[0].id&&Date.now()-lastGuideReceivedAt<250)return;
                        lastGuideReceivedAt=Date.now();
                        if (noStepCheckTimer) {
                          clearTimeout(noStepCheckTimer);
                          noStepCheckTimer = null;
                        }
                        if (retryTimer) {
                          clearTimeout(retryTimer);
                          retryTimer = null;
                        }
                        const step = args[0];
                        if (!step || !step.id) {
                          explicitGuideNull = true;
                          guideClearedToNull = phaseComplete();
                          if (!guideClearedToNull) { console.log(`⚠️ [${username}] Guide NULL, còn Lv.${finalLv}; nhận thưởng nhiệm vụ đã hoàn thành trước khi xác minh lại`); if(baseSandbox.n.CG_PANEL_OPEN)baseSandbox.n.CG_PANEL_OPEN(1025,''); return; }
                          console.log(
                            `🎉 [${username}] Server xác nhận kết thúc guide (${stepsCompleted} ID quan sát, bước cuối ${Math.max(0,...guideStepIds)} -> NULL | Lv.${finalLv})!`
                          );
                          atomicJSON(guideCheckpointPath,{...priorGuide,currentStepId:Math.max(0,...guideStepIds),stepIds:[...guideStepIds],completedEvidence:currentTutorialEvidence()});
                          setTimeout(() => finishPhase1(), 650);
                          return;
                        }
                        console.log(`➡️ [${username}] Tân thủ bước ${step.id}, code ${step.code}, Lv.${finalLv}`);
                        passSteps++;
                        guideStepIds.add(step.id);
                        stepsCompleted=guideStepIds.size;
                        atomicJSON(guideCheckpointPath,{currentStepId:step.id,currentCode:step.code,stepIds:[...guideStepIds],updatedAt:new Date().toISOString()});
                        curStep = step;
                        setTimeout(() => handleStep(step), 40);
                      }
                    };
                  }
                }
              );
            }
            return moduleProxyCache[prop];
          }
          return undefined;
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        }
      });

      vm.createContext(sandboxProxy);
      COMBINED_PROTOCOL_SCRIPT.runInContext(sandboxProxy);
      baseSandbox.n.connect(effectiveWsUrl, `${sid}-${accId}`);

      // Timeout an toàn tối đa 50s mỗi hiệp
      phaseTimeout = setTimeout(() => finishPhase1(), phaseTimeoutMs);
    });

    if (guideClearedToNull) break;
    if (pass < phasePasses) {
      console.log(`🔄 [${username}] Hiệp ${pass} mới đạt Lv.${finalLv} (${stepsCompleted} bước) -> Chạy tiếp hiệp ${pass + 1} để qua sạch 100% tân thủ...`);
    }
  }
  const phase1Sec = ((Date.now() - tPhase1Start) / 1000).toFixed(2);



  if(tutorialConfirmed(currentTutorialEvidence())&&finalLv<minimumPhotoLevel)return {username,accId,sid,serverName,roleName:finalRoleName,roleUid:finalRoleUid,roleLv:finalLv,tutorialCleared:true,tutorialEvidence:currentTutorialEvidence(),stepsCompleted,heroShotPath:'',mainShotPath:''};

  // PHA 2: Mở Headless Chromium (Playwright) qua CDN chính thức & chụp 2 ảnh màn hình (Màn hình chính + Túi Tướng)
  const tPhase2Start = Date.now();
  const mainShotPath = `${WORKSPACE}/jackpot_screenshots/S${displaySNum}_${username}_ManHinhChinh.png`;
  const heroShotPath = `${WORKSPACE}/jackpot_screenshots/S${displaySNum}_${username}_TuiTuong.png`;
  fs.mkdirSync(`${WORKSPACE}/jackpot_screenshots`, { recursive: true });
  let browser = null;
  try {
    if (!chromium) {
      try { chromium = require('playwright').chromium; } catch (_) {}
      if (!chromium) {
        try { chromium = require(path.join(WORKSPACE, 'funtap-registration/node_modules/playwright')).chromium; } catch (_) {}
      }
    }
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ];
    try {
      browser = await chromium.launch({
        headless: true,
        args: launchArgs
      });
    } catch (pwErr) {
      const chromePath = fs.existsSync('/usr/bin/google-chrome')
        ? '/usr/bin/google-chrome'
        : fs.existsSync('/usr/bin/chromium-browser')
          ? '/usr/bin/chromium-browser'
          : undefined;
      browser = await chromium.launch({
        headless: true,
        executablePath: chromePath,
        args: launchArgs
      });
    }
    const context = await browser.newContext({
      viewport: { width: 450, height: 800 },
      deviceScaleFactor: 2
    });
    const page = await context.newPage();

    await page.route('**/api/server_list**', async (route) => {
      const srvObj = [
        {
          sid: String(sid),
          name: serverName,
          status: '1',
          isNewAccount: '0',
          minSid: 1,
          maxSid: Math.max(100, sNum),
          channel: '',
          gdt_vid: '',
          weixinadinfo: '',
          roleName: finalRoleName,
          roleLv: finalLv,
          roleHead: 3002,
          privatePolicy: 0,
          directEnter: 1,
          notice: 0,
          cadpa: 0,
          tips: '',
          isTishen: 0,
          showNotice: 0,
          id: sNum,
          server: effectiveWsUrl,
          recommend: 1,
          area: null,
          region: 'VN',
          regionName: '推荐',
          gamePlatform: 'funtap',
          entry_domain: 'https://funtap-xy.ridvqqxa.com/',
          log_login: 'https://funtap-xy.ridvqqxa.com/game/login.php'
        }
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(srvObj)
      });
    });

    await page.route('**/13528/js/game.js**', async (route) => {
      const resp = await route.fetch();
      let code = await resp.text();
      code = code.replace(
        'window["PlatformManager"]=Ip;',
        'window["PlatformManager"]=Ip;try{Object.assign(window,{p:p,n:n,zi:n,NetMsg:n,Ri:Ri,bh:bh,bt:bt,si:si,ye:ye,Xa:Xa,gb:gb,fb:fb,at:at,uh:uh,H:H,P0:P0});window.__tutorialAudit={explicitNull:false,steps:[]};const original=P0.GC_GUIDE_STEP;P0.GC_GUIDE_STEP=function(step){if(step&&step.id){window.__tutorialAudit.steps.push(step.id)}else{window.__tutorialAudit.explicitNull=true}return original.apply(this,arguments)};}catch(e){}'
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: code
      });
    });

    await page.route('**/13528/play_frame**', async (route) => {
      const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background-color: #000; }
    @font-face { font-family: Microsoft YaHei; src: url("/13528/res/font/msyh_vn.woff"); }
    @font-face { font-family: MyFont; src: url("/13528/res/font/msyh2_vn.woff"); }
  </style>
</head>
<body>
  <script src="/13528/libs/min/lib.js"></script>
  <script>
    window.onload = function() {
      var s = document.createElement("script");
      s.src = "/13528/js/game.js";
      s.onload = function() {
        Global.GLOBAL_PLATEFORM = true;
        Global.GLOBAL_HIDE_IP = "1";
        Global.GLOBAL_SHOW_IP = false;
        Global.SHOW_DEBUG_LOGIN = false;
        Global.GLOBAL_ACCOUNT = ${JSON.stringify(String(accId))};
        Global.ACCOUNT = ${JSON.stringify(String(accId))};
        Global.GLOBAL_OPENID = ${JSON.stringify(String(accId))};
        Global.GLOBAL_USER_IP = ${JSON.stringify(loginUserIp || "")};
        Global.GLOBAL_REGION = "VN";
        Global.GLOBAL_PF = "ios_funtap";
        Global.GAME_PLATFORM = "funtap";
        Global.GLOBAL_APPID = "ios";
        Global.GLOBAL_VERSION = "13528";
        Global.GLOBAL_LANG = "vn";
        Global.RESHOST = "https://rescdnft105vn.ridvqqxa.com/13528/";
        Global.GLOBAL_ENTRY_DOMAIN = "https://funtap-xy.ridvqqxa.com/";
        Global.GLOBAL_LOG_LOGIN = "https://funtap-xy.ridvqqxa.com/game/login.php";
        Global.GLOBAL_ALL_SERVER_LIST = window.location.origin + "/api/server_list";
        Global.GLOBAL_LAST_SERVER_LIST = window.location.origin + "/api/server_list";
        Global.TARGET_SERVER_ID = ${Number(sid)};
        Global.GLOBAL_SERVER_ID = ${Number(sid)};
        Global.GLOBAL_SERVER_INDEX = ${sNum};
        Global.GLOBAL_SERVER_NAME = ${JSON.stringify(serverName)};
        Global.IP = ${JSON.stringify(effectiveWsUrl)};
        Global.GLOBAL_TIMESTAMP = ${JSON.stringify(ts)};
        Global.GLOBAL_AUTHKEY = ${JSON.stringify(ak)};
        Global.LOGIN_TOKEN = "";
        Global.font1 = "Microsoft YaHei";
        Global.font2 = "MyFont";
        Global.GLOBAL_SDK_LOGIN = 0;
        Global.IS_TISHEN = 0;
        Global.censor = null;
        Global.resLang = { sound: {}, image: {}, spine: {} };
        Global.GLOBAL_LOGIN_AUDIO = 0;
        Global.GLOBAL_LOGIN_MUSIC = 0;
        Global.GLOBAL_VN_AGE_TIP = 0;
        Global.GLOBAL_DIRECT_ENTER = 1;
        window.start(1, 1, 1, 1);
        setTimeout(function() {
          if (window.NetMsg && window.NetMsg.connect && !window.NetMsg.isConnect) {
            window.NetMsg.connect(Global.IP, ${JSON.stringify(`${sid}-${accId}`)});
          }
        }, 1400);
      };
      document.body.appendChild(s);
    };
  </script>
</body>
</html>`;
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: html
      });
    });

    await page.goto('https://rescdnft105vn.ridvqqxa.com/13528/play_frame', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    console.log(`⏳ [${username}] Đang chờ game tải 100% tài nguyên CDN và hiển thị giao diện chính...`);
    try {
      await page.waitForFunction(() => {
        try {
          if (typeof window.bt !== 'undefined' && window.bt && typeof window.bt.getInstance === 'function') {
            const b = window.bt.getInstance();
            if (b) return true;
          }
          if (typeof window.si !== 'undefined' && window.si && typeof window.si.getInstance === 'function') {
            return true;
          }
        } catch (_) {}
        return false;
      }, { timeout: 60000, polling: 1000 });
      console.log(`✅ [${username}] Giao diện chính game đã nạp thành công!`);
    } catch (_) {
      console.warn(`⚠️ [${username}] Hết 60s chờ UI chính, tiến hành kích hoạt giao diện...`);
    }

    // Chờ 2.5s để UI và hoạt ảnh vào game (loginTween) ổn định hoàn toàn
    await page.waitForTimeout(2500);

    // Let the real client enter scenes and expose the actual current guide.
    if (!tutorialConfirmed(currentTutorialEvidence())) {
      const browserGuideDeadline=Date.now()+90000;
      while(Date.now()<browserGuideDeadline){
        const state=await page.evaluate(()=>{
          const audit=window.__tutorialAudit||{explicitNull:false,steps:[]};const info=window.H?.data||{};
          const guide=window.at?.data;const net=window.n;
          if(guide?.id&&net){
            if(guide.code===899&&net.CG_COMBAT_READY)net.CG_COMBAT_READY(1,'',0,0);
            if(guide.code===907&&net.CG_HERO_VIEW)net.CG_HERO_VIEW(1002,4,1);
            if(guide.code===911&&net.CG_HERO_VIEW)net.CG_HERO_VIEW(2004,5,1);
            if(net.CG_GUIDE_STEP_FINISH)net.CG_GUIDE_STEP_FINISH(guide.id);
          }
          return {explicitGuideNull:audit.explicitNull,stepsCompleted:new Set(audit.steps).size,lastGuideStepId:Math.max(0,...audit.steps),roleLv:info.lv||0,roleName:info.name||'',current:guide?.id||null};
        });
        if(state.roleLv)finalLv=state.roleLv;if(state.roleName)finalRoleName=state.roleName;
        if(tutorialConfirmed(state)){explicitGuideNull=true;stepsCompleted+=state.stepsCompleted;if(state.lastGuideStepId)guideStepIds.add(state.lastGuideStepId);guideClearedToNull=true;break;}
        await page.waitForTimeout(500);
      }
    }
    if(!phaseComplete())throw Error('TUTORIAL_NOT_CONFIRMED');

    // 1. Chụp ảnh Màn hình chính trước để lưu lại thông tin tài khoản (Lv, Tiên Ngọc, Tên nhân vật)
    try {
      await page.screenshot({ path: mainShotPath });
      console.log(`📸 [${username}] Đã chụp Màn hình chính -> ${mainShotPath}`);
    } catch (shotErr) {
      console.warn(`⚠️ [${username}] Không thể chụp Màn hình chính:`, shotErr.message);
    }

    // 2. Tắt sạch mọi hướng dẫn tân thủ, popup, hộp thoại che màn hình
    await page.evaluate(() => {
      try {
        if (window.uh && uh.getInstance && uh.getInstance().inStage && uh.getInstance().inStage()) {
          uh.getInstance().close();
        }
        if (window.at) {
          at.data = null;
          if (at.guide && at.guide.close) at.guide.close();
        }
        if (window.Ri && Ri.getInstance) {
          Ri.getInstance().setGuideMode(false);
        }
        if (window.be && typeof be.closeFull === 'function') {
          be.closeFull();
        }
      } catch (_) {}
    });

    // 3. Mở Túi Thần Tướng một cách chắc chắn 100%:
    // - Đăng ký panel Thần Tướng vào bottom menu bt
    // - Cấu hình sort ưu tiên tướng jackpot lên đầu
    // - Gọi trực tiếp si.getInstance().open(0) và reflushHero()
    for (let attempt = 1; attempt <= 4; attempt++) {
      await page.evaluate(({ targetNames, targetIds }) => {
        try {
          const isTarget = (h) => {
            if (!h) return false;
            const hid = Number(h.id || h.heroId || h.heroSimple?.id || 0);
            if (targetIds.includes(hid)) return true;
            const str = (String(h.name || '') + ' ' + String(h.heroSimple?.name || '') + ' ' + String(h.heroName || '') + ' ' + String(h.name_cn || '')).toLowerCase();
            for (const tn of targetNames) {
              if (tn && (str.includes(tn) || tn.includes(str))) return true;
            }
            return false;
          };
          if (window.tt) {
            window.tt.combatheroSort = (a, b) => {
              const aT = isTarget(a), bT = isTarget(b);
              if (aT && !bT) return -1;
              if (!aT && bT) return 1;
              return (b.star || 0) - (a.star || 0) || (b.lv || 0) - (a.lv || 0);
            };
          }
        } catch (_) {}
        try {
          if (window.bt && bt.getInstance) {
            const mb = bt.getInstance();
            if (window.ye && !mb.index2Panel[0]) mb.register(0, ye.getInstance());
            if (window.si) mb.register(1, si.getInstance());
            mb.onTab(1);
          }
        } catch (_) {}
        try {
          if (window.si && si.getInstance) {
            const s = si.getInstance();
            s.open(0);
            if (typeof s.reflushHero === 'function') s.reflushHero();
            if (typeof s.setList === 'function') s.setList(0, 0);
            if (window.Laya && Laya.stage && s.ui && !s.ui.parent) {
              Laya.stage.addChild(s.ui);
            }
          }
        } catch (_) {}
      }, {
        targetNames: (targetHeroNames || []).map(s => String(s || '').toLowerCase().trim()),
        targetIds: [...winningHeroIds]
      });

      try {
        await page.mouse.click(113, 770);
      } catch (_) {}

      const opened = await page.evaluate(() => {
        try {
          if (window.si && si.getInstance) {
            const s = si.getInstance();
            if (s && ((typeof s.inStage === 'function' && s.inStage()) || (s.ui && (s.ui.inStage ? s.ui.inStage() : !!s.ui.parent)))) {
              return !!(s.ui && s.ui.cardList && s.ui.cardList.list);
            }
          }
        } catch (_) {}
        return false;
      });

      if (opened) {
        console.log(`✅ [${username}] Đã mở Túi Thần Tướng thành công (Lần ${attempt})!`);
        break;
      }
      await page.waitForTimeout(1000);
    }

    // Chờ tối đa 6s để danh sách thẻ tướng trong Túi Thần Tướng tải hoàn tất
    for (let w = 0; w < 12; w++) {
      const hasListData = await page.evaluate(() => {
        try {
          const comp = window.si?.getInstance()?.ui?.cardList?.list;
          const rows = comp?.dataSource || comp?.array;
          return Array.isArray(rows) && rows.length > 0;
        } catch (_) { return false; }
      });
      if (hasListData) break;
      await page.waitForTimeout(500);
    }

    // Tự động sắp xếp 2 hoặc 3 tướng jackpot đứng kề nhau ngay hàng đầu (Slot 1 & Slot 2)
    let photoOrder = { top: [], ordered: false, topMatchCount: 0, totalRows: 0 };
    for (let bagTry = 0; bagTry < 12; bagTry++) {
      photoOrder = await page.evaluate(({ targetHeroIds, targetHeroNames }) => {
        try {
          const normNames = (targetHeroNames || []).map(n => String(n || '').toLowerCase().trim());
          const idSet = new Set((targetHeroIds || []).map(Number).filter(x => x > 0));

          const isMatch = (h) => {
            if (!h) return false;
            const hid = Number(h.id || h.heroId || h.heroSimple?.id || h.cfgId || 0);
            if (hid > 0 && idSet.has(hid)) return true;
            const raw = (String(h.name || '') + ' ' + String(h.heroSimple?.name || '') + ' ' + String(h.heroName || '') + ' ' + String(h.name_cn || '')).toLowerCase();
            for (const t of normNames) {
              if (!t) continue;
              if (raw.includes(t) || t.includes(raw)) return true;
              if (t.includes('ngọc diện') && (raw.includes('ngoc dien') || raw.includes('ngọc diện') || raw.includes('玉面') || hid === 4008 || hid === 2013)) return true;
              if (t.includes('trấn nguyên') && (raw.includes('tran nguyen') || raw.includes('trấn nguyên') || raw.includes('镇元') || hid === 1014 || hid === 3012)) return true;
              if (t.includes('lý tịnh') && (raw.includes('ly tinh') || raw.includes('lý tịnh') || raw.includes('李靖') || raw.includes('托塔') || hid === 1010)) return true;
              if (t.includes('ngưu ma') && (raw.includes('nguu ma') || raw.includes('ngưu ma') || raw.includes('牛魔') || hid === 2006)) return true;
              if (t.includes('thiết phiến') && (raw.includes('thiet phien') || raw.includes('thiết phiến') || raw.includes('铁扇') || hid === 2009 || hid === 2007)) return true;
              if (t.includes('hồng hài') && (raw.includes('hong hai') || raw.includes('hồng hài') || raw.includes('红孩') || hid === 1012 || hid === 2012)) return true;
              if (t.includes('hàng long') && (raw.includes('hang long') || raw.includes('hàng long') || raw.includes('降龙') || hid === 3006)) return true;
              if (t.includes('hằng nga') && (raw.includes('hang nga') || raw.includes('hằng nga') || raw.includes('嫦娥') || hid === 2007 || hid === 1007)) return true;
              if (t.includes('hoàng my') && (raw.includes('hoang my') || raw.includes('hoàng my') || raw.includes('黄眉') || hid === 3004)) return true;
              if (t.includes('bát giới') && (raw.includes('bat gioi') || raw.includes('bát giới') || raw.includes('八戒') || hid === 2010)) return true;
              if (t.includes('ngộ không') && (raw.includes('ngo khong') || raw.includes('ngộ không') || raw.includes('孙悟空') || hid === 3011 || hid === 2014)) return true;
              if (t.includes('dương tiễn') && (raw.includes('duong tien') || raw.includes('dương tiễn') || raw.includes('杨戬') || hid === 3009 || hid === 1014)) return true;
              if (t.includes('na tra') && (raw.includes('na tra') || raw.includes('哪吒') || hid === 3003 || hid === 3014)) return true;
              if (t.includes('đường') && (raw.includes('duong tam tang') || raw.includes('đường tam tạng') || raw.includes('đường tăng') || raw.includes('唐僧') || hid === 1003 || hid === 3010)) return true;
              if (t.includes('cang kim') && (raw.includes('cang kim') || raw.includes('亢金') || hid === 4003 || hid === 2015)) return true;
              if (t.includes('bạch cốt') && (raw.includes('bach cot') || raw.includes('bạch cốt') || raw.includes('白骨') || hid === 1011)) return true;
            }
            return false;
          };

          const comp = window.si?.getInstance()?.ui?.cardList?.list;
          let rows = comp?.dataSource || comp?.array;
          if (!Array.isArray(rows) || !rows.length) {
            if (window.tt?.heros && Array.isArray(window.tt.heros)) rows = window.tt.heros;
          }
          if (!Array.isArray(rows) || !rows.length) {
            return { top: [], ordered: false, topMatchCount: 0, totalRows: 0 };
          }

          // Đưa các tướng nòng cốt jackpot trùng khớp lên vị trí Slot 1 & Slot 2
          rows.sort((a, b) => {
            const isATarget = isMatch(a);
            const isBTarget = isMatch(b);
            if (isATarget && !isBTarget) return -1;
            if (!isATarget && isBTarget) return 1;
            return (b.star || 0) - (a.star || 0) || (b.lv || 0) - (a.lv || 0);
          });

          if (comp) {
            comp.dataSource = rows;
            comp.array = rows;
            try {
              if (comp.cells && comp.renderHandler) {
                for (let i = 0; i < Math.min(6, rows.length); i++) {
                  if (comp.cells[i]) comp.renderHandler.runWith([comp.cells[i], i]);
                }
              }
            } catch (_) {}
            if (comp.refresh) comp.refresh();
            if (comp.scrollTo) comp.scrollTo(0);
          }

          const topIds = rows.slice(0, 6).map(h => h?.id || h?.heroSimple?.id || 0);
          const topMatchCount = rows.slice(0, 2).filter(isMatch).length;
          return {
            top: topIds,
            ordered: topMatchCount >= 2 || (rows.length === 1 && topMatchCount === 1) || (rows.length > 0 && isMatch(rows[0])),
            topMatchCount,
            totalRows: rows.length
          };
        } catch (err) {
          return { top: [], ordered: false, error: err.message };
        }
      }, {
        targetHeroIds: [...winningHeroIds],
        targetHeroNames: targetHeroNames || []
      });

      if (photoOrder.ordered && photoOrder.top && photoOrder.top.length >= 2) break;
      await page.waitForTimeout(600);
    }

    heroBagTopIds = photoOrder.top || [];
    winnerPhotoOrdered = !!photoOrder.ordered;
    if (!winnerPhotoOrdered) {
      console.warn(`⚠️ [${username}] Sắp xếp tướng jackpot chưa hoàn hảo (topMatch=${photoOrder.topMatchCount}/${photoOrder.totalRows}), vẫn chụp ảnh và tiếp tục gửi bot.`);
      winnerPhotoOrdered = true;
    }

    // Chờ 3.5s để danh sách thẻ tướng 5 sao hiển thị rõ ràng, avatar đầy đủ
    await page.waitForTimeout(3500);
    await page.screenshot({ path: heroShotPath });
    console.log(`📸 [${username}] Đã chụp Túi Thần Tướng -> ${heroShotPath}`);
  } catch (err) {
    console.warn(`⚠️ [${username}] Chuẩn bị tân thủ/ảnh chưa hoàn tất:`, err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  const phase2Sec = ((Date.now() - tPhase2Start) / 1000).toFixed(2);
  const totalSec = ((Date.now() - tStart) / 1000).toFixed(2);

  return {
    username,
    accId,
    sid,
    serverName,
    roleName: finalRoleName,
    roleUid: finalRoleUid,
    roleLv: finalLv,
    zhandouli: finalZdl,
    zuanshiLeft: finalZuanshi,
    tutorialCleared: phaseComplete(),
    tutorialEvidence: currentTutorialEvidence(),
    tutorialEvents,tutorialNotices,campaignEvidence,heroBagTopIds,winnerPhotoOrdered,
    stepsCompleted,
    phase1Sec: Number(phase1Sec),
    phase2Sec: Number(phase2Sec),
    totalSec: Number(totalSec),
    mainShotPath: fs.existsSync(mainShotPath) ? mainShotPath : '',
    heroShotPath: fs.existsSync(heroShotPath) ? heroShotPath : ''
  };
}

module.exports = { prepareAndScreenshotJackpotAccount };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    function getArg(flag, def = '') {
      const idx = args.indexOf(flag);
      return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : def;
    }
    const username = getArg('--acc') || getArg('--username') || 'dungnt66';
    const password = getArg('--pwd') || getArg('--password') || '';
    const accId = getArg('--fid') || getArg('--accId') || '720577379';
    const sid = getArg('--sid') || '610065';
    const serverName = getArg('--server-name') || '';
    const wsUrl = getArg('--ws-url') || '';
    const targetHeroId = Number(getArg('--hero') || 0);
    const targetHeroName = getArg('--hero-name') || '';
    const rawHeroNames = getArg('--hero-names') || '';
    const targetHeroNames = targetHeroName
      ? [targetHeroName]
      : (rawHeroNames ? rawHeroNames.split(',').map((s) => s.trim()).filter(Boolean) : []);

    try {
      const res = await prepareAndScreenshotJackpotAccount({
        username,
        password,
        accId,
        sid,
        serverName,
        wsUrl,
        targetHeroId,
        targetHeroNames
      });
      console.log('RESULT_JSON_START:' + JSON.stringify(res) + ':RESULT_JSON_END');
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}
