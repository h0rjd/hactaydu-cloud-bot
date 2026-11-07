/**
 * cloud_reg_shard.js - High-throughput Funtap Account Generator & Sync Shard
 * Runs on ephemeral GitHub Actions VM with unique Azure datacenter IP.
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
  // Use workerId + timestamp + random to ensure 100% collision-free usernames across 252 VMs
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

async function registerAccount(browser, workerId, seq) {
  const info = generateAccountDetails(workerId, seq);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    viewport: { width: 414, height: 896 },
    locale: 'vi-VN'
  });

  const page = await context.newPage();

  // Intercept JS Handler for instantaneous capture
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

  // Block images and media for ultra-fast load
  await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf}', route => route.abort());

  const targetUrl = `https://core.sdkmain.com/v1/apps/2a456b78cf5122cd9278ef24b4d7bfb9/9.9.9.5/register/phone`
    + `?sdk_version=6.1.2&device_network=wifi&device_os=Android%2012&device_name=${encodeURIComponent(info.device)}`;

  const t0 = Date.now();
  let accObj = null;

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#username', { timeout: 10000 });

    const submitRes = await page.evaluate((data) => {
      try {
        const u = document.getElementById('username');
        const f = document.getElementById('fullname');
        const b = document.getElementById('birthday');
        const p = document.getElementById('phone');
        const pwd = document.getElementById('password');
        const form = document.querySelector('form');

        if (!u || !form) return { ok: false, error: 'Elements missing' };

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
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }, info);

    if (!submitRes.ok) {
      console.log(`[Worker #${workerId} - Seq #${seq}] Form evaluation error: ${submitRes.error}`);
    }

    // Wait for loginSuccess signal via bridge or HTML content
    let registeredInfo = null;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200);

      // Check bridge results first
      const sdkResults = await page.evaluate(() => window.__sdkResults || []).catch(() => []);
      for (const res of sdkResults) {
        if (res.command === 'loginSuccess' && res.params) {
          registeredInfo = res.params;
          break;
        }
      }
      if (registeredInfo) break;

      // Fallback: check content regex
      const content = await page.content().catch(() => '');
      if (content.includes('loginSuccess')) {
        const m = content.match(/appSDKexecute\('loginSuccess',\s*(\{.*?\})\);/);
        if (m) {
          try {
            registeredInfo = JSON.parse(m[1]);
            break;
          } catch (e) {}
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
        accId: accId,
        phone: info.phone,
        funid: funId,
        accessToken: token
      };

      console.log(`✅ [Worker #${workerId} - Seq #${seq}] Created ${info.username} (AccID: ${accId}) in ${dur}s`);
    } else {
      console.log(`❌ [Worker #${workerId} - Seq #${seq}] Registration failed after ${dur}s`);
    }

  } catch (err) {
    console.log(`⚠️ [Worker #${workerId} - Seq #${seq}] Error: ${err.message}`);
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

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
    });
  } catch (err) {
    console.error(`💥 Failed to launch Chromium: ${err.message}`);
    process.exit(1);
  }

  const createdAccounts = [];

  for (let seq = 1; seq <= TARGET_COUNT; seq++) {
    const acc = await registerAccount(browser, WORKER_ID, seq);
    if (acc) {
      createdAccounts.push(acc);
      // Stream push directly to Hub
      await pushToHub([acc]);
    }
    if (seq < TARGET_COUNT) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  await browser.close().catch(() => {});

  console.log(`\n🎉 Shard #${WORKER_ID} completed: ${createdAccounts.length}/${TARGET_COUNT} accounts created.`);

  if (createdAccounts.length > 0) {
    // Save to GitHub Shard Storage
    await saveShardToGitHub(createdAccounts, WORKER_ID);

    // Also persist locally in workspace
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
  process.exit(0); // Exit 0 so next workflow steps / chain-next still proceed
});
