const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tls = require('tls');
const https = require('https');
const crypto = require('crypto');
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
let chromium;
function loadChromium() {
  if (!chromium) {
    try { chromium = require('playwright').chromium; }
    catch (_) {
      try { chromium = require('./funtap-registration/node_modules/playwright').chromium; }
      catch (__) {
        try { chromium = require('../funtap-registration/node_modules/playwright').chromium; }
        catch (___) { chromium = null; }
      }
    }
  }
  return chromium;
}
function telegramConfig() {
  let local = {};
  try { local = JSON.parse(fs.readFileSync(path.join(__dirname, 'telegram.local.json'), 'utf8')); } catch (_) {}
  return { botToken: process.env.TELEGRAM_BOT_TOKEN || local.botToken || '', chatId: process.env.TELEGRAM_CHAT_ID || local.chatId || '' };
}
function telegramFetch(url, options) {
  const { botToken, chatId } = telegramConfig();
  if (!botToken || !chatId) return Promise.resolve({ ok: false, json: async () => ({ ok: false, description: 'Telegram disabled' }) });
  return fetch(url, options);
}
const { FUNTAP_CONFIG, buildRegisterEntryUrl, buildWebViewHeaders } = require('./funtap-registration/src/funtap-api');
const { parseRegistrationResponse } = require('./funtap-registration/src/response-parser');
const { parseCsrfAndFormHtml } = require('./funtap-registration/src/csrf-parser');

const WORKSPACE = __dirname;
const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || (fs.existsSync(path.join(WORKSPACE, 'new_created_accounts.json')) ? path.join(WORKSPACE, 'new_created_accounts.json') : path.join(WORKSPACE, 's39_accounts_mapped.json'));
const LOCKED_VAULT_PATH = `${WORKSPACE}/jackpot_locked_vault.json`;
const RESULTS_JSON_PATH = `${WORKSPACE}/new_servers_reroll_results.json`;
const SUMMARY_MD_PATH = `${WORKSPACE}/new_servers_reroll_summary.md`;
const JACKPOT_JSON_PATH = `${WORKSPACE}/jackpot_2x_winners.json`;

// ABSOLUTE PROTECTION LIST: NEVER TOUCH dungby39, dungby85, OR SOLD ACCOUNTS (dungnt4, dungby177, ntdung67, ntdung153, ntdung150, ntdung701, ntdung808, ntdung3802, ntdung4067, dungby93, dungnt647, ntdung6972, ntdung1546, dungnt577)!
const SOLD_USERNAMES = new Set(['dungnt4', 'dungby177', 'ntdung67', 'ntdung153', 'ntdung150', 'ntdung701', 'ntdung808', 'ntdung3802', 'ntdung4067', 'dungby93', 'dungnt647', 'ntdung6972', 'ntdung1546', 'dungnt577']);
const KNOWN_X2_WINNERS = new Set(['dungby260', 'dungby148', 'ntdung131', 'dungnt66', 'dungby410', 'dungby109', 'ntdung709']);
const EXCLUDED_USERNAMES = new Set(['dungby39', 'dungby85', ...SOLD_USERNAMES]);
const EXCLUDED_ACC_IDS = new Set(['720524013', '720531472', '720575833', '720571635', '720577409', '720584169', '720584106', '720660758', '720664543', '721138607', '721140996', '720531619', '720650326', '721165638']);

// Priority 1 Servers: Focus on Newest Servers (Nữ Nhi Quốc S3 -> S1, Xa Trì Quốc S10 -> S1, Ô Kê Quốc S10 -> S1)
const NEW_ACC_SERVERS = [
  { sid: '610073', id: 73, name: 'Nữ Nhi Quốc-S3', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9099/' },
  { sid: '610072', id: 72, name: 'Nữ Nhi Quốc-S2', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9098/' },
  { sid: '610071', id: 71, name: 'Nữ Nhi Quốc-S1', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9097/' },
  { sid: '610070', id: 70, name: 'Xa Trì Quốc-S10', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9096/' },
  { sid: '610069', id: 69, name: 'Xa Trì Quốc-S9', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9095/' },
  { sid: '610068', id: 68, name: 'Xa Trì Quốc-S8', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9094/' },
  { sid: '610067', id: 67, name: 'Xa Trì Quốc-S7', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9093/' },
  { sid: '610066', id: 66, name: 'Xa Trì Quốc-S6', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9092/' },
  { sid: '610065', id: 65, name: 'Xa Trì Quốc-S5', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9091/' },
  { sid: '610064', id: 64, name: 'Xa Trì Quốc-S4', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9090/' },
  { sid: '610063', id: 63, name: 'Xa Trì Quốc-S3', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9089/' },
  { sid: '610062', id: 62, name: 'Xa Trì Quốc-S2', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9088/' },
  { sid: '610061', id: 61, name: 'Xa Trì Quốc-S1', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9087/' },
  { sid: '610060', id: 60, name: 'Ô Kê Quốc-S10', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9086/' },
  { sid: '610059', id: 59, name: 'Ô Kê Quốc-S9', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9085/' },
  { sid: '610058', id: 58, name: 'Ô Kê Quốc-S8', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9084/' },
  { sid: '610057', id: 57, name: 'Ô Kê Quốc-S7', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9083/' },
  { sid: '610056', id: 56, name: 'Ô Kê Quốc-S6', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9082/' },
  { sid: '610055', id: 55, name: 'Ô Kê Quốc-S5', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9081/' },
  { sid: '610054', id: 54, name: 'Ô Kê Quốc-S4', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9080/' },
  { sid: '610053', id: 53, name: 'Ô Kê Quốc-S3', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9079/' },
  { sid: '610052', id: 52, name: 'Ô Kê Quốc-S2', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9078/' },
  { sid: '610051', id: 51, name: 'Ô Kê Quốc-S1', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9077/' },
  { sid: '610050', id: 50, name: 'Lưu Sa Hà-S10', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9076/' },
  { sid: '610049', id: 49, name: 'Lưu Sa Hà-S9', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9075/' }
];

// Additional Servers for Existing + New Accounts to maximize 2x Dương Tiễn / 2x Ngộ Không probability
const EXTRA_SERVERS = [
  { sid: '610035', id: 35, name: 'Hoàng Phong Lĩnh-S5', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9061/' },
  { sid: '610034', id: 34, name: 'Hoàng Phong Lĩnh-S4', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9060/' },
  { sid: '610033', id: 33, name: 'Hoàng Phong Lĩnh-S3', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9048/' },
  { sid: '610032', id: 32, name: 'Hoàng Phong Lĩnh-S2', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9047/' },
  { sid: '610031', id: 31, name: 'Hoàng Phong Lĩnh-S1', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9046/' },
  { sid: '610030', id: 30, name: 'Cao Lão Trang-S10', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9045/' },
  { sid: '610029', id: 29, name: 'Cao Lão Trang-S9', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9044/' },
  { sid: '610028', id: 28, name: 'Cao Lão Trang-S8', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9043/' },
  { sid: '610027', id: 27, name: 'Cao Lão Trang-S7', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9042/' },
  { sid: '610026', id: 26, name: 'Cao Lão Trang-S6', wsUrl: 'wss://wss-funtap-xy.xinliugame.net:9041/' },
];

// Ordered by highest 5★ Hero Shards (703/704/1012) & 5x Summon Tickets (501) first!
const GIFTCODES = [
  'TOP1STORE', 'DUONGTIEN', 'NATRA', 'NGOKHONG', 'DKT50K', 'DKT30K', 'DKT10K',
  'DAT100KDKT', 'DKT20K', 'DKT5K',
  'NHANCAN111', 'NHICAN222', 'TICAN333', 'THIETCAN444', 'THANCAN555', 'YCAN666',
  'HACTAYDU888', 'TAYDUKI', 'CHUONGCAM', 'HTDCC999', 'HOICHIEUTROIMUA', '45THANTUONG',
  'DOITAC666', 'CCC2026', 'THUANPHAM', 'VAN97', 'HOANGDZ', 'NGOCKEN'
];

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }
  acquire() {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const next = this.queue.shift();
      next();
    }
  }
}
// Account concurrency is controlled by the worker pool; no hidden three-account gate.

class CustomWebSocket {
  constructor(urlStr) {
    const u = new URL(urlStr);
    this.readyState = 0;
    this.binaryType = 'arraybuffer';
    this._buf = Buffer.alloc(0);
    this._handshakeDone = false;
    const key = crypto.randomBytes(16).toString('base64');
    this.sock = tls.connect(
      {
        host: u.hostname,
        port: Number(u.port || 443),
        servername: u.hostname,
        rejectUnauthorized: false
      },
      () => {
        this.sock.write(
          `GET ${u.pathname || '/'} HTTP/1.1\r\n` +
            `Host: ${u.host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n\r\n`
        );
      }
    );
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

const gameCode = fs.readFileSync(`${WORKSPACE}/remote_game.js`, 'utf8');
const vnLang =
  JSON.parse(fs.readFileSync(`${WORKSPACE}/cdn_cache/res/lang/vn/vn.json`, 'utf8')).lang || {};

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

function normVi(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTargetHero(id, rawName, rawName2) {
  const combinedRaw = String(rawName || '') + ' ' + String(rawName2 || '');
  const norm = normVi(combinedRaw);
  if (
    id === 1014 ||
    norm.includes('duong tien') ||
    norm.includes('duongtien') ||
    norm.includes('nhi lang') ||
    norm.includes('hien thanh chan quan') ||
    combinedRaw.includes('杨戬') ||
    combinedRaw.includes('二郎')
  ) {
    return 'Dương Tiễn';
  }
  if (
    id === 2014 ||
    id === 2015 ||
    norm.includes('ngo khong') ||
    norm.includes('ngokhong') ||
    norm.includes('te thien') ||
    norm.includes('cuu le binh chu') ||
    combinedRaw.includes('孙悟空') ||
    combinedRaw.includes('齐天大圣')
  ) {
    return 'Tôn Ngộ Không';
  }
  if (
    id === 3014 ||
    /\bna tra\b/.test(norm) ||
    norm.includes('natra') ||
    norm.includes('tam thai tu') ||
    norm.includes('lac nhat nhan vuong') ||
    combinedRaw.includes('哪吒')
  ) {
    return 'Na Tra';
  }
  if (norm.includes('cang kim tinh quan') || norm.includes('cang kim thien quan')) return 'Cang Kim Tinh Quân';
  if (
    norm.includes('duong tam tang') ||
    norm.includes('bach ma hoa than') ||
    combinedRaw.includes('唐三藏')
  ) {
    return 'Đường Tam Tạng';
  }
  if (
    norm.includes('hong hai nhi') ||
    norm.includes('tu tuong thien ton') ||
    combinedRaw.includes('红孩儿')
  ) {
    return 'Hồng Hài Nhi';
  }
  if (
    id === 3012 ||
    norm.includes('tran nguyen tu') ||
    norm.includes('nam chau xich de') ||
    combinedRaw.includes('镇元子')
  ) {
    return 'Trấn Nguyên Tử';
  }
  if (
    norm.includes('ly tinh') ||
    norm.includes('thac thap thien vuong') ||
    combinedRaw.includes('李靖') ||
    combinedRaw.includes('托塔天王')
  ) {
    return 'Lý Tịnh';
  }
  if (
    norm.includes('tru bat gioi') ||
    norm.includes('bat gioi') ||
    norm.includes('tru ngo nang') ||
    combinedRaw.includes('猪八戒') ||
    combinedRaw.includes('猪悟能') ||
    combinedRaw.includes('八戒')
  ) {
    return 'Trư Bát Giới';
  }
  return null;
}

function fetchAuthKey(accId) { return require('./src/funtap_auth').authKey(accId); }

function mapAccIdFromLogin(username, password) {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      email: username,
      password: password,
      device_os: '18.0',
      device_name: 'iPhone',
      device_resolution: '1170x2532',
      device_network: '1',
      sdk_version: '7.0.0'
    }).toString();
    const req = https.request(
      'https://core.sdkmain.com/api/v1/apps/f0d9c5e4b5d0de9bd966ed884c72e5ad/vi/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'HacTayDu/1.0.1 (iPhone; iOS 18.0; Scale/3.00)'
        },
        timeout: 6000
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.data && j.data.account && j.data.account.account_id) {
              resolve({
                funid: String(j.data.id || ''),
                accId: String(j.data.account.account_id)
              });
            } else {
              resolve(null);
            }
          } catch (_) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runAccountOnServer(acc, srv, options = {}) {
  return await runAccountSession(acc,srv,options);
}
async function runAccountSession(acc, srv, options = {}) {
  const trace = [];
  const eventCounts = {};
  const snapshot = stage => { if (options.trace) trace.push({stage, tickets: bagDict[501]?.cnt || 0, factionTickets: bagDict[502]?.cnt || 0, gems: digits[102], heroes: heroMap.size, bag: Object.values(bagDict).map(x => ({id:x.id,cnt:x.cnt,name:vnLang[x.name] || x.name}))}); };
  const accountStartedAt = Date.now();
  const { idx, username, password, accId, funid } = acc;
  if (EXCLUDED_USERNAMES.has(username) || EXCLUDED_ACC_IDS.has(String(accId))) {
    throw new Error(`SKIPPED PROTECTED ACCOUNT: ${username}`);
  }

  const { ts, ak, userIp: loginUserIp } = await (options.fetchAuthKey || fetchAuthKey)(accId);

  let humanInfo = null;
  const heroMap = new Map();
  const bagDict = {};
  const digits = {};
  const achieveTasks = [];
  const sevenDayDays = [];
  let sevenDayData = null;
  let upStarTasks = [];
  let loginResolved = false;
  let resolveLogin;
  const loginPromise = new Promise((r) => {
    resolveLogin = (v) => {
      if (!loginResolved) {
        loginResolved = true;
        r(v);
      }
    };
  });

  let seqCounter = 0;
  function recordHero(h) {
    if (!h) return;
    const key = h.heroUuid ? `uuid_${h.heroUuid}` : `id_${h.id}_${++seqCounter}`;
    heroMap.set(key, h);
  }

  let accountSocket = null;
  class AccountWebSocket extends CustomWebSocket {
    constructor(url) { super(url); accountSocket = this; }
  }
  const baseSandbox = {
    n: undefined,
    SD: undefined,
    WebSocket: AccountWebSocket,
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
        baseSandbox.n.CG_ASK_LOGIN(
          accStr,
          ts,
          ak,
          'vn',
          'VN',
          loginUserIp || '',
          jsonDatas,
          ''
        );
      },
      onFailed: () => resolveLogin(false),
      onError: () => resolveLogin(false),
      onClose: () => resolveLogin(false)
    }
  };

  let onCdkAck = null;
  let inventoryUpdatedAt = Date.now();
  let inventoryRevision = 0;
  const runtimeEvents = {};
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
                  eventCounts[fn] = (eventCounts[fn] || 0) + 1;
                  runtimeEvents[fn] = (runtimeEvents[fn] || 0) + 1;
                  if (/^GC_(ITEM|HERO|SUIPIAN|TIEM_DIGIT|MAIL_GET)/.test(fn)) { inventoryUpdatedAt = Date.now(); inventoryRevision++; }
                  if (options.trace && ['GC_BROADCAST','GC_CDK','GC_DRAWCARD_DRAW'].includes(fn)) trace.push({event:fn,args:fn === 'GC_DRAWCARD_DRAW' ? args.slice(0,3) : args.map(a => typeof a === 'string' ? (vnLang[a] || a) : a)});
                  if (fn === 'GC_ZZ_HUMAN_INFO') {
                    humanInfo = args[0] || {};
                    if (args[7]) humanInfo.identity = String(args[7]);
                    resolveLogin(true);
                  } else if (fn === 'GC_CDK') {
                    if (onCdkAck) onCdkAck({responseObserved:true,status:'redeemed'});
                  } else if (fn === 'GC_BROADCAST' && args[0] === 8) {
                    const message = String(args[2] || '');
                    const outcome = require('./giftcodes').giftcodeNoticeOutcome(message);
                    if (onCdkAck && outcome) onCdkAck(outcome);
                  } else if (fn === 'GC_ITEM_LIST') {
                    for (const it of args[0] || []) if (it && it.id) bagDict[it.id] = it;
                  } else if (fn === 'GC_ITEM_CHANGE') {
                    const [id, cnt, item] = args;
                    const itemData = Array.isArray(item) ? item[0] : item;
                    if (cnt <= 0) delete bagDict[id];
                    else if (itemData) {
                      itemData.cnt = cnt;
                      bagDict[id] = itemData;
                    } else if (bagDict[id]) {
                      bagDict[id].cnt = cnt;
                    } else {
                      bagDict[id] = { id, cnt };
                    }
                  } else if (fn === 'GC_TIEM_DIGIT') {
                    digits[args[0]] = args[1];
                  } else if (fn === 'GC_HERO_LIST' || fn === 'GC_HERO_BAG_LIST') {
                    for (const h of args[0] || []) recordHero(h);
                  } else if (fn === 'GC_HERO_ADD' || fn === 'GC_HERO_BAG_ADD') {
                    recordHero(args[0]);
                  } else if (fn === 'GC_HERO_DEL' || fn === 'GC_HERO_BAG_DEL') {
                    const uuid = args[0];
                    if (uuid) heroMap.delete(`uuid_${uuid}`);
                  } else if (fn === 'GC_MAIL_QUERY') {
                    const list = args[0] || [];
                    for (const ml of list) {
                      if (ml && ml.uuid && ml.flag == 1 && ml.get == 0 && baseSandbox.n.CG_MAIL_GET) {
                        baseSandbox.n.CG_MAIL_GET(ml.uuid);
                      }
                    }
                    if (baseSandbox.n.CG_MAIL_ALL_GET) baseSandbox.n.CG_MAIL_ALL_GET();
                  } else if (fn === 'GC_HERO_TUJIAN_QUERY') {
                    const list = args[0] || [];
                    for (const item of list) {
                      if (
                        item &&
                        item.hero &&
                        item.hero.id &&
                        (item.state == 1 || item.state == 2)
                      ) {
                        baseSandbox.n.CG_HERO_TUJIAN_UP(item.hero.id);
                      }
                    }
                  } else if (fn === 'GC_HERO_TUJIAN_UP_QUERY') {
                    const [hero, state] = args;
                    if (hero && hero.id && (state == 1 || state == 2)) {
                      baseSandbox.n.CG_HERO_TUJIAN_UP(hero.id);
                    }
                  } else if (fn === 'GC_HERO_JIBAN_QUERY') {
                    const list = args[0] || [];
                    for (const jb of list) {
                      if (jb && jb.jiBanID && jb.isDot == 1) {
                        baseSandbox.n.CG_HERO_JIBAN_JIHUO(jb.jiBanID);
                      }
                    }
                  } else if (fn === 'GC_DAILY_TASK_QUERY') {
                    const taskType = args[0];
                    const tasks = args[3] || [];
                    if (taskType === 2) {
                      achieveTasks.length = 0;
                      achieveTasks.push(...tasks);
                    }
                  } else if (fn === 'GC_SEVENDAYTARGET_QUERY') {
                    sevenDayData = {
                      nowDay: args[0],
                      nowJifen: args[1],
                      jifenList: args[3] || [],
                      dayData: args[4]
                    };
                    if (args[4]) sevenDayDays.push(args[4]);
                  } else if (fn === 'GC_SEVENDAYTARGET_DAY_QUERY') {
                    if (args[0]) sevenDayDays.push(args[0]);
                  } else if (fn === 'GC_UP_STAR_PLAN_SUBTAB_LIST') {
                    upStarTasks = args[0] || [];
                  } else if (fn === 'GC_UP_STAR_PLAN_BOX_QUERY') {
                    for (let bi = 1; bi <= 15; bi++) {
                      try {
                        baseSandbox.n.CG_UP_STAR_PLAN_BOX_GET(bi);
                      } catch (_) {}
                    }
                  } else if (fn === 'GC_GUIDE_STEP') {
                    const step = args[0];
                    if (step && step.id && baseSandbox.n && baseSandbox.n.CG_GUIDE_STEP_FINISH) {
                      try {
                        baseSandbox.n.CG_GUIDE_STEP_FINISH(step.id);
                      } catch (_) {}
                    }
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
    set(target, prop, val) {
      target[prop] = val;
      return true;
    }
  });

  vm.createContext(sandboxProxy);
  COMBINED_PROTOCOL_SCRIPT.runInContext(sandboxProxy);
  const nm = baseSandbox.n;

  nm.connect(srv.wsUrl, `${srv.sid}-${accId}`);
  const loggedIn = await Promise.race([loginPromise, sleep(7500).then(() => false)]);
  if (!loggedIn) {
    try {
      if (accountSocket) accountSocket.close();
    } catch (_) {}
    return {
      key: `${srv.sid}_${username}`,
      sid: srv.sid,
      serverName: srv.name,
      idx,
      username,
      password,
      accId,
      funid,
      ok: false,
      error: `WebSocket login timeout on ${srv.name}`
    };
  }

  await sleep(110);

  try {
    if (!humanInfo || !humanInfo.name) {
      const rName = 'ThanhTon' + Math.floor(10000 + Math.random() * 89999);
      if (nm.CG_ROLE_CHANGE_NAME_GUIDE) nm.CG_ROLE_CHANGE_NAME_GUIDE(rName, 0);
      await sleep(150);
    }
    if (nm.CG_SCENE_JUMPSTORY) nm.CG_SCENE_JUMPSTORY();
    if (nm.CG_GUIDE_SKIP) {
      nm.CG_GUIDE_SKIP(1);
      nm.CG_GUIDE_SKIP(0);
    }
  } catch (_) {}

  async function waitInventoryQuiet(quietMs = 500, maxMs = 4000) {
    const start = Date.now();
    await sleep(200);
    while (Date.now() - start < maxMs && Date.now() - inventoryUpdatedAt < quietMs) await sleep(100);
  }
  let mailQueriesConfirmed = 0;
  async function claimMail() {
    if (!accountSocket || accountSocket.readyState !== 1) return false;
    const before = runtimeEvents.GC_MAIL_QUERY || 0;
    nm.CG_MAIL_QUERY(1); nm.CG_MAIL_QUERY(2);
    const deadline = Date.now() + 4000;
    while ((runtimeEvents.GC_MAIL_QUERY || 0) < before + 2 && Date.now() < deadline) await sleep(100);
    if ((runtimeEvents.GC_MAIL_QUERY || 0) >= before + 2) mailQueriesConfirmed++;
    nm.CG_MAIL_ALL_GET();
    await sleep(600);
    await waitInventoryQuiet();
  }
  // ACK has no request ID: after an ambiguous response, do not send another code
  // on this socket. A later invocation opens a fresh connection.
  let cdkSessionAmbiguous = false;
  async function sendCdkCode(code, timeoutMs) {
    if (cdkSessionAmbiguous) return {sent:false,responseObserved:false,halt:true,error:'Ambiguous CDK session'};
    if (!accountSocket || accountSocket.readyState !== 1) return {sent:false,responseObserved:false,error:'Socket not open'};
    return new Promise(resolve => {
      let settled = false;
      const finish = outcome => { if (settled) return; settled = true; clearTimeout(timer); onCdkAck = null; if (!outcome.responseObserved) cdkSessionAmbiguous = true; resolve({sent:true,...outcome,halt:!outcome.responseObserved}); };
      if (options.trace) trace.push({codeSent:code,at:new Date().toISOString()});
      const timer = setTimeout(() => finish({responseObserved:false,status:'unconfirmed'}), timeoutMs);
      onCdkAck = finish;
      try { nm.CG_CDK(code); }
      catch (err) { clearTimeout(timer); onCdkAck = null; resolve({sent:false,responseObserved:false,error:err.message}); }
    });
  }
  let cdkReport;
  const codeSettings = require('./runtime_settings').readSettings();
  {
    // Initialize mail state before the first CDK request, as in the reference.
    nm.CG_MAIL_QUERY(1);
    await sleep(450);
    cdkReport = await require('./giftcodes').redeemGiftcodes(GIFTCODES, sendCdkCode, {timeoutMs:codeSettings.codeTimeoutMs,timeoutStepMs:codeSettings.codeRetryTimeoutMs-codeSettings.codeTimeoutMs,rounds:codeSettings.codeRounds,intervalMs:Math.max(450,codeSettings.codeDelayMs),previous: options.previous?.key === `${srv.sid}_${username}` && options.previous?.rewardPipelineVersion >= 2 ? options.previous.cdkDetails : []});
    if (options.auditOnlyCodes) {
      accountSocket.close();
      return {ok:true,key:`${srv.sid}_${username}`,sid:srv.sid,cdkReport,diagnostics:{trace,eventCounts}};
    }
    await sleep(1000);
    await claimMail();
  }
  const cdkSentCount = cdkReport.sentCount;
  const cdkAckedCount = cdkReport.responseCount;
  const unconfirmedCodes = cdkReport.unconfirmedCodes;
  await claimMail();
  snapshot('after_mail');
  async function unpackAndCombine() {
    for (const id of Object.keys(bagDict)) {
      const it = bagDict[id];
      if (!it || it.cnt <= 0 || [501,502,503].includes(it.id)) continue;
      const rev = inventoryRevision;
      if (it.suipian?.fullcnt > 0) {
        const count = Math.floor(it.cnt / it.suipian.fullcnt);
        if (!count) continue;
        nm.CG_SUIPIAN_HERO_USE(it.id, Math.min(50,count));
      } else {
        const op = it.opflag || 0;
        const randomBox = !!(op & (1 << 9) || op & (1 << 11));
        const selectBox = !!(op & (1 << 5)) && !randomBox;
        if (selectBox || !(randomBox || it.subType === 6 || [521,522,523,524,525,526].includes(it.id))) continue;
        nm.CG_ITEM_USE(it.id,Math.min(50,it.cnt));
      }
      const deadline = Date.now() + 2500;
      while (inventoryRevision === rev && Date.now() < deadline) await sleep(100);
      await waitInventoryQuiet(250,2000);
    }
  }
  const drawReport = {requests:0,responses:0,unconfirmed:0};
  async function pullAllTicketsOnly() {
    nm.CG_DRAWCARD_SETSKIP(1);
    for (let i=0;i<60;i++) {
      const count = bagDict[501]?.cnt || 0;
      if (count < 1 || !accountSocket || accountSocket.readyState !== 1) break;
      const before = runtimeEvents.GC_DRAWCARD_DRAW || 0;
      drawReport.requests++;
      nm.CG_DRAWCARD_DRAW(1,count >= 10 ? 2 : 1,0);
      const deadline = Date.now() + 4000;
      while ((runtimeEvents.GC_DRAWCARD_DRAW || 0) === before && Date.now() < deadline) await sleep(100);
      if ((runtimeEvents.GC_DRAWCARD_DRAW || 0) === before) {drawReport.unconfirmed++; break;}
      drawReport.responses++;
      await waitInventoryQuiet();
      if ((bagDict[501]?.cnt || 0) >= count) break;
    }
  }
  // Always sweep late mail and boxes; never infer completion from hero count.
  for (let pass=0;pass<3;pass++) {
    await claimMail();
    await unpackAndCombine();
    await waitInventoryQuiet();
    snapshot('before_draw');
    await pullAllTicketsOnly();
    await unpackAndCombine();
    await waitInventoryQuiet();
    if (pass >= 1 && !(bagDict[501]?.cnt > 0) && !Object.values(bagDict).some(it => it.suipian?.fullcnt > 0 && it.cnt >= it.suipian.fullcnt)) break;
  }
  snapshot('after_draw');
  const rewardCollectionComplete = accountSocket?.readyState === 1 && mailQueriesConfirmed >= 2 && unconfirmedCodes.length === 0 && !(bagDict[501]?.cnt > 0) && drawReport.unconfirmed === 0 && !Object.values(bagDict).some(it => it.suipian?.fullcnt > 0 && it.cnt >= it.suipian.fullcnt);
  // Count 5★ heroes
  const heroes5Star = [];
  const coreCounts = {
    'Dương Tiễn': 0,
    'Tôn Ngộ Không': 0,
    'Na Tra': 0,
    'Đường Tam Tạng': 0,
    'Hồng Hài Nhi': 0,
    'Trấn Nguyên Tử': 0,
    'Cang Kim Tinh Quân': 0,
    'Lý Tịnh': 0,
    'Trư Bát Giới': 0
  };

  for (const h of heroMap.values()) {
    if (!h) continue;
    const hName = vnLang[h.name] || h.name || '';
    const hName2 = vnLang[h.name2] || h.name2 || '';
    const fullName = hName2 ? `${hName} (${hName2})` : hName;
    if ((h.star || 0) >= 5) {
      const m = matchTargetHero(h.id, hName, hName2);
      heroes5Star.push({
        uuid: h.heroUuid,
        id: h.id,
        job: h.job || 1,
        name: hName,
        name2: hName2,
        star: h.star,
        fullName,
        coreTag: m
      });
      if (m && coreCounts[m] !== undefined) {
        coreCounts[m]++;
      }
    }
  }

  const shardSummary = [];
  for (const k of Object.keys(bagDict)) {
    const it = bagDict[k];
    if (it && it.suipian && it.cnt > 0) {
      const iName = vnLang[it.name] || it.name || '';
      shardSummary.push(`${iName} x${it.cnt}/${it.suipian.fullcnt}`);
      // Unsummoned fragments remain in shardSummary, never count as owned heroes.
    }
  }

  const countDT = coreCounts['Dương Tiễn'];
  const countTNK = coreCounts['Tôn Ngộ Không'];
  const countNT = coreCounts['Na Tra'];
  const countDTT = coreCounts['Đường Tam Tạng'];
  const jackpotRules = require('./jackpot_rules').evaluateJackpot(coreCounts);
  const countCK = jackpotRules.counts['Cang Kim Tinh Quân'];
  const countHHN = coreCounts['Hồng Hài Nhi'] || 0;
  const countTNT = coreCounts['Trấn Nguyên Tử'] || 0;
  const totalTamThanh = countDT + countTNK + countNT;
  const totalCores = jackpotRules.total;
  const {isSameHeroX2X3,isCoreX2Plus1,isMultiTamThanh3,isJackpotAlert} = jackpotRules;
  const isMultiTamThanh = totalTamThanh >= 2;
  const jackpotTargetHeroId = heroes5Star.find(h => (jackpotRules.counts[h.coreTag] || 0) >= 2)?.id ||
                              heroes5Star.find(h => ['Đường Tam Tạng', 'Trư Bát Giới', 'Tôn Ngộ Không', 'Lý Tịnh'].includes(h.coreTag))?.id || 0;

  // ONLY claim Tiên Ngọc from Achievements / Đồ Giám / Duyên Phận if this account hit X2/X3 or >= 2 Tam Thánh (e.g. Ngộ Không + Dương Tiễn)!
  if (isJackpotAlert || totalTamThanh >= 2) {
    try {
      if (nm.CG_HERO_TUJIAN_QUERY) nm.CG_HERO_TUJIAN_QUERY();
      if (nm.CG_HERO_JIBAN_QUERY) nm.CG_HERO_JIBAN_QUERY();
      if (nm.CG_DAILY_TASK_QUERY) nm.CG_DAILY_TASK_QUERY(2);
      if (nm.CG_SEVENDAYTARGET_QUERY) nm.CG_SEVENDAYTARGET_QUERY();
      if (nm.CG_SEVENDAYTARGET_DAY_QUERY) nm.CG_SEVENDAYTARGET_DAY_QUERY(1);
      for (const tabID of [1, 2, 3]) {
        if (nm.CG_UP_STAR_PLAN_SUBTAB_QUERY) nm.CG_UP_STAR_PLAN_SUBTAB_QUERY(tabID);
      }
      if (nm.CG_UP_STAR_PLAN_BOX_QUERY) nm.CG_UP_STAR_PLAN_BOX_QUERY();
    } catch (_) {}
    await sleep(240);
    try {
      for (const at of achieveTasks) {
        if (at && at.status === 1 && nm.CG_DAILY_TASK_TASK_REWARD_GET) {
          nm.CG_DAILY_TASK_TASK_REWARD_GET(2, at.taskID);
        }
      }
      for (const dayObj of sevenDayDays) {
        if (!dayObj || !dayObj.tags) continue;
        for (const tag of dayObj.tags) {
          for (const aim of (tag && tag.aims) || []) {
            if (aim && aim.state === 1 && nm.CG_SEVENDAYTARGET_AIM_GET) {
              nm.CG_SEVENDAYTARGET_AIM_GET(aim.id);
            }
          }
        }
      }
      for (const jf of (sevenDayData && sevenDayData.jifenList) || []) {
        if (jf && jf.state === 1 && nm.CG_SEVENDAYTARGET_JIFEN_GET) {
          nm.CG_SEVENDAYTARGET_JIFEN_GET(jf.id);
        }
      }
      for (const tk of upStarTasks || []) {
        if (tk && tk.state === 1 && nm.CG_UP_STAR_PLAN_TASK_GET) {
          nm.CG_UP_STAR_PLAN_TASK_GET(1, tk.taskID);
        }
      }
    } catch (_) {}
    await sleep(180);
  }

  let tutorialCleared = false;
  let finalRoleName = (humanInfo && humanInfo.name) || '';
  let finalRoleUid = (humanInfo && humanInfo.identity) || '';
  let finalRoleLv = (humanInfo && humanInfo.lv) || 1;
  let finalZuanshi = digits[102] || 0;
  let mainShotPath = '';
  let heroShotPath = '';

  try {
    if (accountSocket) accountSocket.close();
  } catch (_) {}

  const tamThanhSummary = [];
  if (countDT > 0) tamThanhSummary.push(`Dương Tiễn x${countDT}`);
  if (countTNK > 0) tamThanhSummary.push(`Tôn Ngộ Không x${countTNK}`);
  if (countNT > 0) tamThanhSummary.push(`Na Tra x${countNT}`);

  const targetSummary = [];
  for (const [k, cnt] of Object.entries(jackpotRules.counts)) {
    if (cnt > 0) targetSummary.push(`${k} x${cnt}`);
  }

  return {
    key: `${srv.sid}_${username}`,
    sid: srv.sid,
    serverName: srv.name,
    idx,
    username,
    password,
    accId,
    funid,
    ok: true,
    roleName: finalRoleName,
    roleUid: finalRoleUid,
    roleLv: finalRoleLv,
    zuanshiLeft: finalZuanshi,
    mainShotPath,
    heroShotPath,
    heroes5StarCount: heroes5Star.length,
    heroes5Star: heroes5Star.map((h) => h.fullName),
    shards: shardSummary,
    coreCounts,
    tamThanhSummary,
    targetSummary,
    countDT,
    countTNK,
    countNT,
    countDTT,
    countCK,
    countCKActual:coreCounts['Cang Kim Tinh Quân'],
    jackpotTargetHeroId,
    countHHN,
    countTNT,
    totalTamThanh,
    totalCores,
    tutorialCleared,
    cdkAckedCount,
    cdkSentCount,
    cdkDetails: cdkReport.details,
    rewardCollectionComplete,
    rewardPipelineVersion: 5,
    codeSettings,
    cdkRedeemedCount: cdkReport.details.filter(x=>x.status === 'redeemed').length,
    cdkAlreadyClaimedCount: cdkReport.details.filter(x=>x.status === 'already_claimed').length,
    cdkRejectedCodes: cdkReport.details.filter(x=>x.status === 'rejected').map(x=>x.code),
    drawReport,
    ticketsLeft: {thienMenh:bagDict[501]?.cnt || 0,he:bagDict[502]?.cnt || 0},
    diagnostics: options.trace ? {trace, eventCounts} : undefined,
    durationMs: Date.now() - accountStartedAt,
    finishedAt: new Date().toISOString(),
    cdkTotalCount: GIFTCODES.length,
    cdkUnconfirmedCodes: unconfirmedCodes,
    isJackpot2xDT: countDT >= 2,
    isJackpot2xTNK: countTNK >= 2,
    isJackpot2xNT: countNT >= 2,
    isSameHeroX2X3,
    isMultiTamThanh,
    isMultiCore: totalCores >= 2,
    isCoreX2Plus1,
    isMultiTamThanh3,
    isJackpotAlert
  };
}

function saveProgress(allResultsMap, totalPlanned, saveFullJson = false) {
  const cleanAll = Array.from(allResultsMap.values()).filter((r) => r && r.ok);
  if (saveFullJson) {
    fs.writeFileSync(RESULTS_JSON_PATH, JSON.stringify(cleanAll));
  }

  // Filter out sold accounts (dungnt4, dungby177, ntdung67, ntdung153, ntdung150) from active available list
  const clean = cleanAll.filter((r) => !SOLD_USERNAMES.has(r.username));

  const jackpots2xDT = clean.filter((r) => (r.countDT || 0) >= 2);
  const jackpots2xTNK = clean.filter((r) => (r.countTNK || 0) >= 2);
  const jackpots2xNT = clean.filter((r) => (r.countNT || 0) >= 2);
  const jackpotsSame2x = clean.filter(
    (r) => (r.countDT || 0) >= 2 || (r.countTNK || 0) >= 2 || (r.countNT || 0) >= 2 || (r.countDTT || 0) >= 2
  );

  fs.writeFileSync(
    JACKPOT_JSON_PATH,
    JSON.stringify(
      { jackpots2xDT, jackpots2xTNK, jackpots2xNT, jackpotsSame2x },
      null,
      2
    )
  );

  let md = `# KẾT QUẢ SĂN x2 / x3 TƯỚNG GIỐNG HỆT NHAU (2x/3x DƯƠNG TIỄN, 2x/3x TÔN NGỘ KHÔNG, 2x/3x NA TRA) — Ô KÊ QUỐC S2/S1 & LƯU SA HÀ S10/S9\n\n`;
  md += `- **Tổng số lượt đã roll**: **${cleanAll.length} / ${totalPlanned}**\n`;
  md += `- **Đã khóa bảo vệ**: \`dungby39\`, \`dungby85\` và **các nick đã bán/tách bán**\n`;
  md += `- **Tiêu chí nổ x2/x3**: Chỉ tính **>= 2 bản sao giống hệt nhau của cùng 1 tướng** (\`2x/3x Dương Tiễn\`, \`2x/3x Tôn Ngộ Không\`, hoặc \`2x/3x Na Tra\`). Tự động tách khỏi list reroll server sau và tự động qua tân thủ!\n`;
  md += `- 🔥🔥 **NICK CÒN SẴN >= 2 DƯƠNG TIỄN CÙNG NICK**: **${jackpots2xDT.length}** (${jackpots2xDT.map((r) => `${r.username}@${r.serverName} [x${r.countDT}]`).join(', ') || 'Đang dò tiếp...'})\n`;
  md += `- 🔥🔥 **NICK CÒN SẴN >= 2 TÔN NGỘ KHÔNG CÙNG NICK**: **${jackpots2xTNK.length}** (${jackpots2xTNK.map((r) => `${r.username}@${r.serverName} [x${r.countTNK}]`).join(', ') || 'Đang dò tiếp...'})\n`;
  md += `- 🔥 **NICK CÒN SẴN >= 2 NA TRA CÙNG NICK**: **${jackpots2xNT.length}** (${jackpots2xNT.map((r) => `${r.username}@${r.serverName} [x${r.countNT}]`).join(', ') || 'Đang dò tiếp...'})\n\n`;

  if (jackpotsSame2x.length > 0) {
    md += `## 🔥🔥 DANH SÁCH NICK NỔ x2 / x3 CÙNG 1 TƯỚNG (DƯƠNG TIỄN / TÔN NGỘ KHÔNG / NA TRA) — ${jackpotsSame2x.length} NICK\n\n`;
    md += `| Server | Tài khoản | Mật khẩu | UID Nhân Vật | Account ID | Tiên Ngọc | Tướng x2 / x3 Giống Hệt Nhau | Tân Thủ | Tổng 5★ | Danh sách 5★ |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|\n`;
    const sortedSame = [...jackpotsSame2x].sort((a, b) => Number(b.sid) - Number(a.sid));
    for (const r of sortedSame) {
      const sameParts = [];
      if ((r.countDT || 0) >= 2) sameParts.push(`Dương Tiễn x${r.countDT}`);
      if ((r.countTNK || 0) >= 2) sameParts.push(`Tôn Ngộ Không x${r.countTNK}`);
      if ((r.countNT || 0) >= 2) sameParts.push(`Na Tra x${r.countNT}`);
      const tutStr = r.tutorialCleared ? `✅ Đã qua (Lv.${r.roleLv || 7})` : '✅ Sẵn sàng';
      md += `| **${r.serverName}** (\`${r.sid}\`) | **${r.username}** | \`${r.password || 'ntdung12'}\` | \`${r.roleUid || ''}\` | \`${r.accId}\` | ${r.zuanshiLeft} | 🔥 **${sameParts.join(' + ')}** | ${tutStr} | ${r.heroes5StarCount} | ${(r.heroes5Star || []).join(', ')} |\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(SUMMARY_MD_PATH, md);

  if (process.env.REROLL_SHARD_ID) {
    const shardId = process.env.REROLL_SHARD_ID;
    const shardDir = path.join(WORKSPACE, 'shards');
    if (!fs.existsSync(shardDir)) {
      try { fs.mkdirSync(shardDir, { recursive: true }); } catch (_) {}
    }
    const shardFile = path.join(shardDir, `reroll_winners_${shardId}.json`);
    const statusFile = path.join(shardDir, `status_reroll_${shardId}.json`);
    try {
      fs.writeFileSync(shardFile, JSON.stringify({ jackpots2xDT, jackpots2xTNK, jackpots2xNT, jackpotsSame2x }, null, 2));
      fs.writeFileSync(statusFile, JSON.stringify({
        shardId,
        processed: cleanAll.length,
        total: totalPlanned,
        jackpots: jackpotsSame2x.length,
        updatedAt: Date.now()
      }, null, 2));
    } catch (_) {}
  }
}

function generateRandomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const prefixes = ['dn', 'ntd', 'dby', 'td', 'dg'];
  const pfx = prefixes[Math.floor(Math.random() * prefixes.length)];
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return pfx + suffix;
}

function generateRandomPhone() {
  const prefixes = ['096', '097', '098', '038', '039', '036', '037'];
  const pfx = prefixes[Math.floor(Math.random() * prefixes.length)];
  const rest = String(Math.floor(1000000 + Math.random() * 8999999));
  return pfx + rest;
}

function generateRandomBirthday() {
  const y = 1991 + Math.floor(Math.random() * 13);
  const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const d = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fetchLatestServersDynamic() {
  return new Promise((resolve) => {
    const req = https.get(
      'https://funtap-xy.xinliugame.net/game/getServerList.php?lst=all&ac=720435142&plt=ios&v=1&platform=funtap&appid=ios',
      { timeout: 6000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const all =
              Array.isArray(parsed) && parsed[0] && parsed[0].sid
                ? parsed
                : (Array.isArray(parsed) && parsed[0] ? parsed[0].all : parsed && parsed.all) || [];
            const mapped = all
              .filter((s) => s && s.sid && s.server && Number(s.sid) >= 610049)
              .map((s) => ({
                sid: String(s.sid),
                id: Number(s.id || Number(s.sid) - 610000),
                name: s.name,
                wsUrl: String(s.server).replace(/\\\//g, '/')
              }))
              .sort((a, b) => Number(b.sid) - Number(a.sid));
            if (mapped.length > 0) return resolve(mapped);
          } catch (_) {}
          resolve(NEW_ACC_SERVERS.filter((s) => Number(s.sid) >= 610049));
        });
      }
    );
    req.on('error', () => resolve(NEW_ACC_SERVERS.filter((s) => Number(s.sid) >= 610049)));
    req.on('timeout', () => {
      req.destroy();
      resolve(NEW_ACC_SERVERS.filter((s) => Number(s.sid) >= 610049));
    });
  });
}

const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 150 });
const RECAPTCHA_SITE_KEY = '6Lc7WFYsAAAAAIZ1uFlJpFgSlbcFFdGYHXgaVcVU';

function mapAccIdFromLoginFast(username, password) {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      email: username,
      password: password,
      device_os: '18.0',
      device_name: 'iPhone',
      device_resolution: '1170x2532',
      device_network: '1',
      sdk_version: '7.0.0'
    }).toString();
    const req = https.request(
      'https://core.sdkmain.com/api/v1/apps/f0d9c5e4b5d0de9bd966ed884c72e5ad/vi/auth/login',
      {
        method: 'POST',
        agent: keepAliveHttpsAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'HacTayDu/1.0.1 (iPhone; iOS 18.0; Scale/3.00)'
        },
        timeout: 6000
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.data && j.data.account && j.data.account.account_id) {
              return resolve({
                funid: String(j.data.id || ''),
                accId: String(j.data.account.account_id)
              });
            }
          } catch (_) {}
          resolve(null);
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

module.exports = { runAccountOnServer, mapAccIdFromLoginFast, matchTargetHero };
if(require.main===module){console.error('Use npm run reg or npm run reroll. The legacy mixed factory entrypoint is disabled.');process.exitCode=2;}
