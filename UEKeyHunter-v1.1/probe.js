// probe.js — 看容器长什么样（pak 尾部 FPakInfo + utoc 头），不做任何猜测
//   node probe.js                              读 target.json
//   node probe.js --pak="D:\x.pak" --utoc="D:\x.utoc"
'use strict';
const fs = require('fs');
const cfg = require('./config');
const { readPakInfo, readUtocHeader } = require('./lib/pak');
const { printableRatio } = require('./lib/oracle');

function arg(name, def) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? p.slice(name.length + 3).replace(/^"|"$/g, '') : def;
}

const pakPath = arg('pak', cfg.PAK);
const utocPath = arg('utoc', cfg.UTOC);

if (!pakPath && !utocPath) {
  console.error('没有目标。先跑:  node setup.js "游戏根目录"   或用 --pak= / --utoc= 直接给路径');
  process.exit(2);
}

console.log('='.repeat(70));
console.log('PAK : ' + (pakPath || '(未指定)'));
console.log('='.repeat(70));
if (!pakPath) {
  console.log('（跳过：没给 .pak。纯 IoStore 游戏只有 .utoc/.ucas）');
} else {
  const info = readPakInfo(pakPath);
  if (!info) {
    console.log('!! 尾部 64KB 内没找到 FPakInfo magic（E1 12 6F 5A）—— 可能不是 UE4 .pak，或文件被截断');
  } else {
    const pad = k => (k + '                        ').slice(0, 30);
    for (const [k, v] of Object.entries(info)) console.log('  ' + pad(k) + v);
    console.log('  ' + pad('stockLayout') + (info.stockLayout ? '是（标准 UE4 v4+）' : '否 —— 非标准布局，按标准写的工具会跑偏'));

    // 采样熵，判断是否真的加密
    const fd = fs.openSync(pakPath, 'r');
    const size = fs.statSync(pakPath).size;
    console.log('\n  [样本] 每 MB 可打印率 / 零字节率（密文应当分布均匀、零字节极少）：');
    for (let off = 0; off + 1048576 <= size && off < 8 * 1048576; off += 1048576) {
      const b = Buffer.alloc(1048576);
      fs.readSync(fd, b, 0, b.length, off);
      let z = 0;
      for (let i = 0; i < b.length; i++) if (b[i] === 0) z++;
      console.log(`    @${String(off).padStart(9)}  printable=${(printableRatio(b) * 100).toFixed(1)}%  zeros=${((z / b.length) * 100).toFixed(1)}%`);
    }
    fs.closeSync(fd);
  }
}

console.log('\n' + '='.repeat(70));
console.log('UTOC: ' + (utocPath || '(未指定)'));
console.log('='.repeat(70));
if (!utocPath) {
  console.log('（跳过：没给 .utoc）');
} else {
  const u = readUtocHeader(utocPath);
  if (!u) console.log('!! 不是 IoStore 容器（magic 不匹配）');
  else for (const [k, v] of Object.entries(u)) console.log('  ' + (k + '                        ').slice(0, 30) + v);
}
