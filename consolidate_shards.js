/**
 * consolidate_shards.js - Consolidate shards, update accounts.json, and sync across D4 & H0
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_TOKEN_2 = process.env.GH_TOKEN_2 || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7182418544';

function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return Promise.resolve();
  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000
    }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

function githubApi(options, body) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      headers: {
        'User-Agent': 'Shard-Consolidator/1.0',
        'Authorization': `token ${options.token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function fetchRemoteShards() {
  if (!GH_TOKEN) return [];
  const res = await githubApi({
    path: '/repos/h0rjd/hactaydu-cloud-bot/contents/shards',
    method: 'GET',
    token: GH_TOKEN
  });

  if (res.status !== 200 || !Array.isArray(res.data)) return [];

  const shardFiles = res.data.filter(f => f.name.startsWith('acc_') && f.name.endsWith('.json'));
  console.log(`Found ${shardFiles.length} remote shard files in hactaydu-cloud-bot.`);

  const accounts = [];
  for (const file of shardFiles) {
    try {
      const fileRes = await githubApi({
        path: `/repos/h0rjd/hactaydu-cloud-bot/contents/${file.path}`,
        method: 'GET',
        token: GH_TOKEN
      });
      if (fileRes.status === 200 && fileRes.data.content) {
        const decoded = Buffer.from(fileRes.data.content, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          accounts.push(...parsed);
        } else if (parsed.username) {
          accounts.push(parsed);
        }
      }
      // Delete shard after reading
      await githubApi({
        path: `/repos/h0rjd/hactaydu-cloud-bot/contents/${file.path}`,
        method: 'DELETE',
        token: GH_TOKEN
      }, {
        message: `chore: purge processed shard ${file.name} [skip ci]`,
        sha: file.sha
      });
    } catch (e) {
      console.log(`Error reading shard ${file.name}: ${e.message}`);
    }
  }

  return accounts;
}

function fetchLocalShards() {
  const shardsDir = path.join(__dirname, 'shards');
  if (!fs.existsSync(shardsDir)) return [];
  const files = fs.readdirSync(shardsDir).filter(f => f.endsWith('.json'));
  const accounts = [];
  for (const f of files) {
    try {
      const p = path.join(shardsDir, f);
      const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(content)) accounts.push(...content);
      else if (content.username) accounts.push(content);
      fs.unlinkSync(p);
    } catch (e) {}
  }
  return accounts;
}

async function syncToD4(accounts, accountsD4, accountsH0) {
  if (!GH_TOKEN_2) {
    console.log('GH_TOKEN_2 not present, skipping remote sync to dungby4/cloud-engine-2.');
    return;
  }
  console.log('Syncing fresh accounts to dungby4/cloud-engine-2 via GitHub API...');
  const filesToSync = [
    { path: 'accounts.json', content: accounts },
    { path: 'accounts_d4.json', content: accountsD4 },
    { path: 'accounts_h0.json', content: accountsH0 }
  ];

  for (const f of filesToSync) {
    try {
      // Get current sha
      const getRes = await githubApi({
        path: `/repos/dungby4/cloud-engine-2/contents/${f.path}`,
        method: 'GET',
        token: GH_TOKEN_2
      });
      const sha = getRes.data && getRes.data.sha ? getRes.data.sha : undefined;
      const base64Content = Buffer.from(JSON.stringify(f.content, null, 2)).toString('base64');

      const putRes = await githubApi({
        path: `/repos/dungby4/cloud-engine-2/contents/${f.path}`,
        method: 'PUT',
        token: GH_TOKEN_2
      }, {
        message: `chore(accounts): sync fresh batch of ${accounts.length} accounts [skip ci]`,
        content: base64Content,
        sha
      });
      console.log(`Synced ${f.path} to dungby4/cloud-engine-2: status ${putRes.status}`);
    } catch (e) {
      console.log(`Failed to sync ${f.path} to dungby4: ${e.message}`);
    }
  }
}

async function main() {
  console.log('====================================================');
  console.log('🔄 Consolidating Shards & Updating Accounts Pool');
  console.log('====================================================');

  const remoteAccs = await fetchRemoteShards();
  const localAccs = fetchLocalShards();
  const newAccs = [...remoteAccs, ...localAccs];

  console.log(`Collected ${newAccs.length} accounts from shards.`);

  const accountsPath = path.join(__dirname, 'accounts.json');
  let currentAccounts = [];
  if (fs.existsSync(accountsPath)) {
    try {
      currentAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    } catch (e) {
      currentAccounts = [];
    }
  }

  const seen = new Set(currentAccounts.map(a => (a.username || '').toLowerCase()));
  const seenIds = new Set(currentAccounts.map(a => String(a.accId || '')));

  let added = 0;
  for (const acc of newAccs) {
    const u = (acc.username || '').toLowerCase();
    const id = String(acc.accId || '');
    if (!u || !id) continue;
    if (seen.has(u) || seenIds.has(id)) continue;
    seen.add(u);
    seenIds.add(id);
    currentAccounts.push(acc);
    added++;
  }

  console.log(`Successfully merged ${added} new unique accounts! Total in pool: ${currentAccounts.length}`);

  if (added > 0) {
    // Partition for D4 and H0
    const accountsD4 = currentAccounts.filter((_, i) => i % 2 === 0);
    const accountsH0 = currentAccounts.filter((_, i) => i % 2 === 1);

    fs.writeFileSync(accountsPath, JSON.stringify(currentAccounts, null, 2), 'utf-8');
    fs.writeFileSync(path.join(__dirname, 'accounts_d4.json'), JSON.stringify(accountsD4, null, 2), 'utf-8');
    fs.writeFileSync(path.join(__dirname, 'accounts_h0.json'), JSON.stringify(accountsH0, null, 2), 'utf-8');

    // Sync to D4 repo
    await syncToD4(currentAccounts, accountsD4, accountsH0);

    const msg = `🎉 <b>[Cloud IP-Rotator] Đã nạp thành công ${added} nick mới!</b>\n`
      + `📦 <b>Tổng kho hiện tại:</b> ${currentAccounts.length} nick\n`
      + `🖥️ <b>Máy D4:</b> ${accountsD4.length} nick | <b>Máy H0:</b> ${accountsH0.length} nick\n`
      + `⚡ Sẵn sàng cho lượt cày máy chủ tiếp theo!`;
    await sendTelegram(msg);
  }
}

main().catch(e => {
  console.error(`Error in consolidation: ${e.message}`);
  process.exit(0);
});
