/**
 * cloud_reg_shard.js - High-throughput Funtap Account Generator & Sync Shard
 * Runs on ephemeral GitHub Actions VM with unique Azure datacenter IP.
 * Uses Hybrid Fast-HTTP + Playwright fallback with full redirect handling & diagnostics.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const WORKER_ID = parseInt(process.env.SHARD_WORKER_ID || '1', 10);
const TARGET_COUNT = parseInt(process.env.MAX_ACCS_PER_VM || '3', 10);
const GH_TOKEN = process.env.GH_TOKEN || '';
const HUB_URL = process.env.HUB_URL || 'https://152-69-209-107.sslip.io/api/accounts/push';
const HUB_SECRET = process.env.HUB_SECRET || 'd57be08c4bbbc9c7feda86285611ee41fc8016d4f1bf4a1a7a60502d123b0ab3';

const VIETNAMESE_NAMES = [
  'Nguyen Van An', 'Tran Quoc Tuan', 'Le Hoang Long', 'Pham Duc Anh',
  'Hoang Minh Tri', 'Dang Van Lam', 'Vu Quang Huy', 'Bui Tien Dung',
  'Doan Van Hau', 'Nguyen Quang Hai', 'Phan Van Duc', 'Nguyen Cong Phuong',
  'Nguyen Tien Linh', 'Que Ngoc Hai', 'Do Hung Dung', 'Nguyen Tuan Anh',
  'Vu Dinh Trong', 'Tran Dinh Trong', 'Pham Xuan Manh', 'Nguyen Van Toan'
];

const DEVICES = [
  'Pixel 6', 'Pixel 7', 'Galaxy S22', 'Galaxy S23', 'Galaxy S24',
  'Redmi Note 12', 'Xiaomi 13', 'Oppo Reno 8', 'Vivo V27'
];

const PHONE_PREFIXES = ['097', '098', '096', '035', '036', '037', '038', '086', '091', '094'];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDigits(len) {
  let res = '';
  for (let i = 0; i < len; i++) {
    res += Math.floor(Math.random() * 10);
  }
  return res;
}

function generateAccountDetails(workerId, seq) {
  const tsPart = Date.now().toString().slice(-4);
  const rndPart = Math.floor(100 + Math.random() * 900);
  const username = `ntdung${tsPart}${workerId}${seq}${rndPart}`.slice(0, 18);
  const password = 'dg' + Math.random().toString(36).slice(2, 8) + 'x' + Math.floor(Math.random() * 9);
  const fullname = randomChoice(VIETNAMESE_NAMES);
  const device = randomChoice(DEVICES);
  const phone = randomChoice(PHONE_PREFIXES) + randomDigits(7);
  const birthYear = 1995 + Math.floor(Math.random() * 9);
  const birthMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const birthDay = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const birthday = `${birthYear}-${birthMonth}-${birthDay}`;

  return { username, password, fullname, device, phone, birthday };
}

function pushToHub(accounts) {
  return new Promise((resolve) => {
    if (!accounts || accounts.length === 0) return resolve(false);
    try {
      const u = new URL(HUB_URL);
      const data = JSON.stringify({ accounts });
      const client = u.protocol === 'https:' ? https : http;
      const req = client.request(u, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Secret': HUB_SECRET,
          'User-Agent': 'Cloud-IP-Rotator/1.0'
        },
        timeout: 10000,
        rejectUnauthorized: false
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          console.log(`📡 [Hub Sync] Push status ${res.statusCode}: ${body.slice(0, 120)}`);
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        });
      });
      req.on('error', (err) => {
        console.log(`⚠️ [Hub Sync] Push error: ${err.message}`);
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.write(data);
      req.end();
    } catch (e) {
      console.log(`⚠️ [Hub Sync] Exception: ${e.message}`);
      resolve(false);
    }
  });
}

async function saveShardToGitHub(accounts, workerId) {
  if (!GH_TOKEN || !accounts || accounts.length === 0) return false;
  const fileName = `shards/acc_${Date.now()}_w${workerId}_${Math.random().toString(36).slice(2, 6)}.json`;
  const contentBase64 = Buffer.from(JSON.stringify(accounts, null, 2)).toString('base64');
  const payload = JSON.stringify({
    message: `chore(shard): add ${accounts.length} accounts from worker #${workerId} [skip ci]`,
    content: contentBase64
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/h0rjd/hactaydu-cloud-bot/contents/${fileName}`,
      method: 'PUT',
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'User-Agent': 'Cloud-IP-Rotator/1.0',
        'Content-Type': 'application/json'
      },
      timeout: 12000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          console.log(`💾 [GitHub Shard] Successfully wrote ${fileName}`);
          resolve(true);
        } else {
          console.log(`⚠️ [GitHub Shard] Failed to write ${fileName}: HTTP ${res.statusCode} ${body.slice(0, 100)}`);
          resolve(false);
        }
      });
    });
    req.on('error', (err) => {
      console.log(`⚠️ [GitHub Shard] API Error: ${err.message}`);
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

function fetchWithRedirects(targetUrl, headers, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const cookies = [];
    function doRequest(currentUrl, redirectCount) {
      if (redirectCount > maxRedirects) return reject(new Error('Too many redirects'));
      const parsed = new URL(currentUrl);
      const reqHeaders = {
        ...headers,
        'Cookie': cookies.join('; ')
      };
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(parsed, { method: 'GET', headers: reqHeaders, timeout: 8000 }, (res) => {
        if (res.headers['set-cookie']) {
          for (const c of res.headers['set-cookie']) {
            cookies.push(c.split(';')[0]);
          }
        }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          return doRequest(nextUrl, redirectCount + 1);
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, cookies, body, finalUrl: currentUrl }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    }
    doRequest(targetUrl, 0);
  });
}

/**
 * Fast direct HTTP registration
 */
async function registerViaHttp(info, seq) {
  const t0 = Date.now();
  const entryUrl = `https://core.sdkmain.com/v1/apps/2a456b78cf5122cd9278ef24b4d7bfb9/9.9.9.5/register/phone?sdk_version=6.1.2&device_network=wifi&device_os=Android%2012&device_name=${encodeURIComponent(info.device)}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  try {
    const pageRes = await fetchWithRedirects(entryUrl, headers);
    if (pageRes.statusCode === 429) {
      console.log(`⚠️ [HTTP Reg #${seq}] HTTP 429 (IP Rate Limited)`);
      return null;
    }

    const html = pageRes.body;
    const mTok = html.match(/name=["']_token["']\s+value=["']([^"']+)["']/);
    const token = mTok ? mTok[1] : '';
    const mAct = html.match(/<form[^>]+action=["']([^"']+)["']/);
    const actionUrl = mAct ? mAct[1].replace(/&amp;/g, '&') : entryUrl;

    if (!token) {
      console.log(`⚠️ [HTTP Reg #${seq}] CSRF _token missing. Status: ${pageRes.statusCode}, Snippet: ${html.slice(0, 150).replace(/\s+/g, ' ')}`);
      return null;
    }

    const postData = new URLSearchParams({
      '_token': token,
      'username': info.username,
      'fullname': info.fullname,
      'birthday': info.birthday,
      'phone': info.phone,
      'password': info.password
    }).toString();

    const postHeaders = {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
      'Cookie': pageRes.cookies.join('; '),
      'Referer': pageRes.finalUrl
    };

    return new Promise((resolve) => {
      const parsedAction = new URL(actionUrl);
      const postReq = https.request(parsedAction, { method: 'POST', headers: postHeaders, timeout: 10000 }, (postRes) => {
        let postBody = '';
        postRes.on('data', chunk => postBody += chunk);
        postRes.on('end', () => {
          const dur = ((Date.now() - t0) / 1000).toFixed(2);
          if (postBody.includes('loginSuccess')) {
            const mRes = postBody.match(/appSDKexecute\('loginSuccess',\s*(\{.*?\})\);/);
            if (mRes) {
              try {
                const resObj = JSON.parse(mRes[1]);
                const dataBlock = resObj.data || {};
                const accBlock = dataBlock.account || {};
                const accId = String(accBlock.account_id || dataBlock.id || '');
                const funId = String(dataBlock.id || accBlock.account_id || '');
                const accessToken = String(resObj.access_token || 'r');

                const acc = {
                  idx: Math.floor(Date.now() / 1000) * 100 + seq,
                  username: info.username,
                  password: info.password,
                  accId,
                  phone: info.phone,
                  funid: funId,
                  accessToken
                };
                console.log(`✅ [HTTP Reg #${seq}] Created ${info.username} (AccID: ${accId}) in ${dur}s`);
                return resolve(acc);
              } catch (e) {}
            }
          }
          console.log(`⚠️ [HTTP Reg #${seq}] Non-success response in ${dur}s: ${postBody.slice(0, 120).replace(/\s+/g, ' ')}`);
          resolve(null);
        });
      });

      postReq.on('error', (e) => {
        console.log(`⚠️ [HTTP Reg #${seq}] POST Error: ${e.message}`);
        resolve(null);
      });
      postReq.write(postData);
      postReq.end();
    });

  } catch (err) {
    console.log(`⚠️ [HTTP Reg #${seq}] Exception: ${err.message}`);
    return null;
  }
}

/**
 * Playwright fallback
 */
async function registerViaPlaywright(browser, info, workerId, seq) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 414, height: 896 },
    locale: 'vi-VN'
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__sdkResults = [];
    window.JsHandler = {
      mobAppSDKexecute: function(command, params) {
        try {
          const parsed = typeof params === 'string' ? JSON.parse(params) : params;
          window.__sdkResults.push({ command, params: parsed });
        } catch (e) {
          window.__sdkResults.push({ command, raw: params });
        }
      }
    };
  });

  const targetUrl = `https://core.sdkmain.com/v1/apps/2a456b78cf5122cd9278ef24b4d7bfb9/9.9.9.5/register/phone?sdk_version=6.1.2&device_network=wifi&device_os=Android%2012&device_name=${encodeURIComponent(info.device)}`;
  const t0 = Date.now();
  let accObj = null;

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const userInp = await page.waitForSelector('#username', { timeout: 8000 }).catch(() => null);

    if (!userInp) {
      const curUrl = page.url();
      const title = await page.title().catch(() => '');
      const snip = (await page.content().catch(() => '')).slice(0, 150).replace(/\s+/g, ' ');
      console.log(`⚠️ [Playwright #${seq}] #username not found. URL: ${curUrl}, Title: ${title}, Snippet: ${snip}`);
      return null;
    }

    await page.evaluate((data) => {
      const u = document.getElementById('username');
      const f = document.getElementById('fullname');
      const b = document.getElementById('birthday');
      const p = document.getElementById('phone');
      const pwd = document.getElementById('password');
      const form = document.querySelector('form');
      if (!u || !form) return;

      u.value = data.username;
      f.value = data.fullname;
      b.value = data.birthday;
      p.value = data.phone;
      pwd.value = data.password;

      for (const el of [u, f, b, p, pwd]) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (typeof grecaptcha !== 'undefined' && grecaptcha.enterprise) {
        const siteKey = '6Lc7WFYsAAAAAIZ1uFlJpFgSlbcFFdGYHXgaVcVU';
        grecaptcha.enterprise.ready(function() {
          grecaptcha.enterprise.execute(siteKey, { action: 'submit' }).then(function(token) {
            const rInput = document.getElementById('g-recaptcha-response');
            if (rInput) rInput.value = token;
            form.submit();
          });
        });
      } else {
        form.submit();
      }
    }, info);

    let registeredInfo = null;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200);
      const sdkResults = await page.evaluate(() => window.__sdkResults || []).catch(() => []);
      for (const res of sdkResults) {
        if (res.command === 'loginSuccess' && res.params) {
          registeredInfo = res.params;
          break;
        }
      }
      if (registeredInfo) break;

      const content = await page.content().catch(() => '');
      if (content.includes('loginSuccess')) {
        const m = content.match(/appSDKexecute\('loginSuccess',\s*(\{.*?\})\);/);
        if (m) {
          try { registeredInfo = JSON.parse(m[1]); break; } catch (e) {}
        }
      }
    }

    const dur = ((Date.now() - t0) / 1000).toFixed(2);
    if (registeredInfo) {
      const dataBlock = registeredInfo.data || {};
      const accountBlock = dataBlock.account || {};
      const accId = String(accountBlock.account_id || dataBlock.id || '');
      const funId = String(dataBlock.id || accountBlock.account_id || '');
      const token = String(registeredInfo.access_token || 'r');

      accObj = {
        idx: Math.floor(Date.now() / 1000) * 100 + seq,
        username: info.username,
        password: info.password,
        accId,
        phone: info.phone,
        funid: funId,
        accessToken: token
      };
      console.log(`✅ [Playwright #${seq}] Created ${info.username} (AccID: ${accId}) in ${dur}s`);
    }
  } catch (err) {
    console.log(`⚠️ [Playwright #${seq}] Error: ${err.message}`);
  } finally {
    await context.close().catch(() => {});
  }

  return accObj;
}

async function main() {
  console.log(`====================================================`);
  console.log(`🚀 Starting Cloud Reg Shard #${WORKER_ID} (Target: ${TARGET_COUNT} accounts)`);
  console.log(`🌐 Public IP VM: GitHub Actions Azure Runner`);
  console.log(`====================================================`);

  let browser = null;
  const createdAccounts = [];

  for (let seq = 1; seq <= TARGET_COUNT; seq++) {
    const info = generateAccountDetails(WORKER_ID, seq);
    // 1. Try Fast HTTP first (super fast 0.5s, no overhead)
    let acc = await registerViaHttp(info, seq);

    // 2. If HTTP failed, fallback to Playwright
    if (!acc) {
      if (!browser) {
        try {
          const { chromium } = require('playwright');
          browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
          });
        } catch (e) {
          console.log(`Cannot launch playwright: ${e.message}`);
        }
      }
      if (browser) {
        acc = await registerViaPlaywright(browser, info, WORKER_ID, seq);
      }
    }

    if (acc) {
      createdAccounts.push(acc);
      await pushToHub([acc]);
    }

    if (seq < TARGET_COUNT) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (browser) await browser.close().catch(() => {});

  console.log(`\n🎉 Shard #${WORKER_ID} completed: ${createdAccounts.length}/${TARGET_COUNT} accounts created.`);

  if (createdAccounts.length > 0) {
    await saveShardToGitHub(createdAccounts, WORKER_ID);

    try {
      const shardsDir = path.join(__dirname, 'shards');
      fs.mkdirSync(shardsDir, { recursive: true });
      const localFile = path.join(shardsDir, `local_acc_${Date.now()}_w${WORKER_ID}.json`);
      fs.writeFileSync(localFile, JSON.stringify(createdAccounts, null, 2), 'utf-8');
    } catch (e) {}
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(0);
});
