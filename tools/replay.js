// 开发用：把 fixtures 里的事件按一次真实交互流回放到采集器。
// 用法：node tools/replay.js [间隔ms]   （需先 npm start）
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const gap = Number(process.argv[2]) || 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(path, body) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: 'localhost', port: 4317, path, method: 'POST' },
      (res) => { res.resume(); res.on('end', resolve); },
    );
    req.on('error', resolve);
    req.end(body);
  });
}

const order = [
  'userpromptsubmit.json', 'statusline.json', 'pretooluse-bash.json',
  'posttooluse-edit.json', 'taskcreate.json', 'taskupdate.json',
  'notification.json', 'stop.json',
];

for (const name of order) {
  let raw;
  try { raw = readFileSync(join(dir, name), 'utf8'); }
  catch { console.log(`跳过缺失样本 ${name}`); continue; }
  const path = name.startsWith('statusline') ? '/statusline' : '/hook';
  await post(path, raw);
  console.log(`回放 ${name} → ${path}`);
  await sleep(gap);
}
console.log('回放结束');
