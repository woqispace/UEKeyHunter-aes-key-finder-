// setup.js — 指定目标，自动找出 exe / pak / utoc / ucas，写进 target.json
//
//   node setup.js "D:\Games\SomeGame"          指定游戏根目录（自动发现）
//   node setup.js --pak="D:\x.pak"             只给 pak（同目录的 utoc/ucas 自动带）
//   node setup.js --exe="D:\x\Game-Win64-Shipping.exe"
//   node setup.js --show                       看当前 target.json
//   node setup.js --clear                      清掉 target.json
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'target.json');

function argv(name) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? p.slice(name.length + 3).replace(/^"|"$/g, '').trim() : '';
}
const rest = process.argv.slice(2).filter(a => !a.startsWith('--'));
const gameArg = argv('game') || rest[0] || '';
const pakArg = argv('pak');
const exeArg = argv('exe');

function show(t) {
  const rows = [
    ['game', t.game],
    ['exe', t.exe],
    ['pak', t.pak],
    ['utoc', t.utoc],
    ['ucas', t.ucas],
    ['process', t.process],
  ];
  for (const [k, v] of rows) {
    // process 是进程名，不是路径，别当成文件判断
    const mark = !v ? '—' : (k === 'process' ? '✔' : (fs.existsSync(v) ? '✔' : '✘ 不存在'));
    console.log('  ' + (k + '        ').slice(0, 10) + mark.padEnd(9) + (v || ''));
  }
}

if (process.argv.includes('--clear')) {
  if (fs.existsSync(FILE)) { fs.unlinkSync(FILE); console.log('已删除 ' + FILE); }
  else console.log('本来就没有 ' + FILE);
  process.exit(0);
}

if (process.argv.includes('--show')) {
  if (!fs.existsSync(FILE)) { console.log('还没有 target.json，先跑 node setup.js "游戏根目录"'); process.exit(1); }
  console.log('target.json : ' + FILE);
  show(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  process.exit(0);
}

if (!gameArg && !pakArg && !exeArg) {
  console.log('用法：');
  console.log('  node setup.js "游戏根目录"');
  console.log('  node setup.js --pak="...pak"   /  --exe="...exe"');
  console.log('  node setup.js --show   /  --clear');
  process.exit(2);
}

// 复用 config.js 的发现逻辑（此时还没写 target.json，不会有旧值干扰）
const { discover } = require('./config');

let t = {};
const root = gameArg || (pakArg ? path.dirname(pakArg) : path.dirname(exeArg));

// 用户给的可能是游戏根，也可能直接是 Paks 目录 / Binaries\Win64 —— 往上退几级再找
let guess = root;
for (let i = 0; i < 4 && guess; i++) {
  const d = discover(guess);
  if (d.pak || d.exe) { t = d; break; }
  const up = path.dirname(guess);
  if (up === guess) break;
  guess = up;
}

if (!t.game) t = { game: root, exe: '', pak: '', utoc: '', ucas: '' };
if (exeArg) t.exe = exeArg;
if (pakArg) {
  t.pak = pakArg;
  const dir = path.dirname(pakArg);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const full = path.join(dir, e.name);
    if (!t.utoc && /\.utoc$/i.test(e.name)) t.utoc = full;
    if (!t.ucas && /\.ucas$/i.test(e.name)) t.ucas = full;
  }
}
t.process = t.exe ? path.basename(t.exe).replace(/\.exe$/i, '') : (t.process || '');

fs.writeFileSync(FILE, JSON.stringify(t, null, 2) + '\n', 'utf8');
console.log('已写入 ' + FILE);
show(t);
console.log('');
if (!t.pak) console.log('⚠ 没找到 .pak —— 校验器需要它（UE4 .pak）。纯 IoStore 游戏只有 .utoc/.ucas，那就没法用 SHA1 复核，只能靠挂载点启发式。');
if (!t.exe) console.log('⚠ 没找到可扫的主程序 —— 用 node scan-file.js "路径.exe" 直接指定。');
