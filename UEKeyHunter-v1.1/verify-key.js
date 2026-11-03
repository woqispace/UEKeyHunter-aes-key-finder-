// verify-key.js — 手上已有一把候选 key 时，直接判定真假
//   node verify-key.js 01DA1F...C2DD
//   node verify-key.js --pak="D:\x.pak" <key>
'use strict';
const cfg = require('./config');
const { readPakInfo } = require('./lib/pak');
const { verifyIndex, printableRatio } = require('./lib/oracle');

const pakArg = (process.argv.find(a => a.startsWith('--pak=')) || '').slice(6).replace(/^"|"$/g, '');
const pakPath = pakArg || cfg.needPak();
const keyArg = process.argv.slice(2).find(a => !a.startsWith('--'));

if (!keyArg) {
  console.error('用法: node verify-key.js <64位hex的key>');
  process.exit(2);
}
const keyHex = keyArg.replace(/^0x/i, '').trim();
if (keyHex.length !== 64) { console.error('key 必须是 64 个 hex 字符（32 字节），现在 ' + keyHex.length + ' 个'); process.exit(2); }

const info = readPakInfo(pakPath);
if (!info) { console.error('读不了 ' + pakPath + ' 的 FPakInfo'); process.exit(2); }

console.log('key    : ' + keyHex);
console.log('pak    : ' + pakPath);
console.log('索引   : @' + info.indexOffset + ' size=' + info.indexSize);
const v = verifyIndex(keyHex, pakPath, info);
console.log('SHA1   : ' + v.sha);
console.log('存储值 : ' + v.stored);
console.log('结论   : ' + (v.match ? '✔ 正确（整索引 SHA1 完全一致）' : '✘ 不对（SHA1 不一致）'));
console.log('明文可打印率: ' + (printableRatio(v.head) * 100).toFixed(1) + '%');
console.log('明文头: ' + JSON.stringify(v.head.subarray(0, 96).toString('latin1')));
process.exit(v.match ? 0 : 1);
