// scan-file.js — 在一个文件里逐字节找 AES key（默认扫 target.json 里的主程序）
//   node scan-file.js                       扫 config.EXE
//   node scan-file.js "D:\x.dll"            扫指定文件
//   node scan-file.js --start=0x1000 --end=0x200000 --stride=1
//   node scan-file.js --report=hits.txt --pak="D:\x.pak"
//
// 命中会被立即复核：解整个 pak 索引 -> SHA1 必须等于 pak 里存的值。
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { readPakInfo } = require('./lib/pak');
const { buildOracles, scanBuffer, verifyIndex } = require('./lib/oracle');

function argNum(name, def) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  if (!p) return def;
  const v = p.slice(name.length + 3).replace(/^"|"$/g, '');
  return v.startsWith('0x') ? parseInt(v, 16) : parseInt(v, 10);
}
function argStr(name) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? p.slice(name.length + 3).replace(/^"|"$/g, '') : null;
}

const target = process.argv.slice(2).find(a => !a.startsWith('--')) || cfg.EXE;
if (!target) {
  console.error('没给要扫的文件。用法: node scan-file.js "D:\path\to\Game-Win64-Shipping.exe"');
  console.error('（或先跑 node setup.js "游戏根目录"，让它自动找主程序）');
  process.exit(2);
}
if (!fs.existsSync(target)) { console.error('文件不存在: ' + target); process.exit(2); }

const pakInfo = readPakInfo(cfg.needPak());
if (!pakInfo) { console.error('读不了 pak 头，先跑 node probe.js 看看这个 pak 是什么布局'); process.exit(2); }

const oracles = buildOracles({ pakPath: cfg.PAK, ucasPath: cfg.UCAS, pakInfo });
console.log('目标   : ' + target);
console.log('校验器 : ' + oracles.map(o => `${o.name}(${o.kind})`).join('  '));
console.log('索引   : @' + pakInfo.indexOffset + ' size=' + pakInfo.indexSize + ' sha1=' + pakInfo.indexHash);

const buf = fs.readFileSync(target);
const start = argNum('start', 0);
const end = argNum('end', buf.length);
const stride = argNum('stride', 1);
const report = argStr('report') || cfg.HIT_LOG;
console.log(`范围   : ${start}..${Math.min(end, buf.length)}  stride=${stride}  文件=${buf.length} 字节\n`);

let hits = 0;
const t0 = Date.now();
scanBuffer(buf, oracles, {
  start, end, stride,
  onProgress: p => {
    process.stdout.write(`\r  ${p.pos}/${p.total}  ${Math.round(p.ratePerSec).toLocaleString()} keys/s  ${p.elapsedSec.toFixed(0)}s   `);
  },
  onHit: (off, keyHex, oracleName) => {
    hits++;
    console.log(`\n[HIT] offset=0x${off.toString(16)}  oracle=${oracleName}\n      key=${keyHex}`);
    const v = verifyIndex(keyHex, cfg.PAK, pakInfo);
    console.log(`      整索引 SHA1 = ${v.sha}`);
    console.log(`      存储 SHA1   = ${v.stored}   ${v.match ? '===> 确定正确' : '(不匹配)'}`);
    if (v.match) {
      console.log('      索引明文头 = ' + JSON.stringify(v.head.toString('latin1')));
      fs.appendFileSync(report, `${keyHex}\t${oracleName}\t${target}\n`);
      console.log('      已写入 ' + path.resolve(report));
    }
  },
});
console.log(`\n\n完成：命中 ${hits} 个，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
if (hits === 0) {
  console.log('结论：这个文件里没有连续 32 字节的 AES key（所有偏移都试过了）。');
  console.log('      下一步用 dump-mem.ps1 + scan-mem.js 去抓运行时内存。');
}
