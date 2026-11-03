// scan-mem.js — 扫 dump-mem.ps1 转储出来的内存区域，找那把 key
//   node scan-mem.js                       扫默认目录 mem\<进程名>
//   node scan-mem.js "D:\dump"             扫指定目录
//   node scan-mem.js "D:\dump" --fast --stride=8
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { readPakInfo } = require('./lib/pak');
const { buildOracles, scanBuffer, verifyIndex } = require('./lib/oracle');

const dirArg = process.argv.slice(2).find(a => !a.startsWith('--'));
let dir = dirArg ? dirArg.replace(/^"|"$/g, '') : '';
if (!dir) {
  if (!cfg.PROCESS) {
    console.error('没说扫哪儿。用法: node scan-mem.js "D:\dump目录"');
    console.error('（或先 node setup.js "游戏根目录"，默认扫 mem\\<进程名>）');
    process.exit(2);
  }
  dir = path.join(__dirname, 'mem', cfg.PROCESS);
}
if (!fs.existsSync(dir)) {
  console.error('目录不存在: ' + dir);
  console.error('先抓内存: powershell -NoProfile -ExecutionPolicy Bypass -File dump-mem.ps1 -ProcessName "' + (cfg.PROCESS || '进程名') + '"');
  process.exit(2);
}

const pakInfo = readPakInfo(cfg.needPak());
if (!pakInfo) { console.error('读不了 pak 头，先跑 node probe.js'); process.exit(2); }
let oracles = buildOracles({ pakPath: cfg.PAK, ucasPath: cfg.UCAS, pakInfo });
const strideArg = (process.argv.find(a => a.startsWith('--stride=')) || '').slice(9);
const stride = strideArg ? parseInt(strideArg, 10) : 1;
if (process.argv.includes('--fast')) {
  // 只留最强的那个校验器（pak 索引挂载点），速度 ~1.07M keys/s
  oracles = oracles.filter(o => o.kind === 'mount').slice(0, 1);
}

const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.bin')).sort();
if (!files.length) { console.error('目录里没有 .bin 转储文件: ' + path.resolve(dir)); process.exit(2); }
const total = files.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
console.log('内存目录 : ' + path.resolve(dir));
console.log('区域文件 : ' + files.length + ' 个，共 ' + (total / 1048576).toFixed(1) + ' MB');
console.log('校验器   : ' + oracles.map(o => o.name).join('  ') + '  stride=' + stride);
console.log('');

let hits = 0, done = 0;
const t0 = Date.now();
for (const f of files) {
  const p = path.join(dir, f);
  const buf = fs.readFileSync(p);
  done += buf.length;
  scanBuffer(buf, oracles, {
    stride,
    onProgress: p2 => {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r  ${(done / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB  ` +
        `${Math.round(p2.ratePerSec).toLocaleString()} keys/s  ${el.toFixed(0)}s   `);
    },
    onHit: (off, keyHex, oracleName) => {
      hits++;
      console.log(`\n[HIT] file=${f} offset=0x${off.toString(16)} oracle=${oracleName}`);
      console.log(`      key=${keyHex}`);
      const v = verifyIndex(keyHex, cfg.PAK, pakInfo);
      if (v.match) {
        console.log('      ✔ 整索引 SHA1 一致 —— 这就是真 key');
        console.log('      明文头 = ' + JSON.stringify(v.head.toString('latin1')));
        fs.appendFileSync(cfg.HIT_LOG, keyHex + '\t' + oracleName + '\tmem:' + f + '\n');
      } else {
        console.log('      ✘ SHA1 不一致（假命中）');
      }
    },
  });
}
console.log(`\n\n完成：命中 ${hits} 个，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
