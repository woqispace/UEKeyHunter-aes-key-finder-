// config.js — 目标配置。这里不写死任何游戏。
//
// 取值优先级（从高到低）：
//   1) 命令行参数  --game= --exe= --pak= --utoc= --ucas= --process=
//   2) 同目录 target.json   （由 setup.js 生成，也可以手写）
//   3) 环境变量   UEKH_GAME / UEKH_EXE / UEKH_PAK / UEKH_UTOC / UEKH_UCAS / UEKH_PROCESS
//
// 只给了游戏根目录时，会自动在里面找主程序、*.pak、*.utoc、*.ucas。
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const TARGET_FILE = path.join(HERE, 'target.json');

function argv(name) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  if (!p) return '';
  return p.slice(name.length + 3).replace(/^"|"$/g, '').trim();
}

function safeListDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

// 递归收集子目录（有深度上限，避免在超大游戏目录里卡住）
function collectDirs(root, depth, acc) {
  if (depth <= 0) return acc;
  for (const e of safeListDir(root)) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    acc.push(p);
    collectDirs(p, depth - 1, acc);
  }
  return acc;
}

function pickLargest(files, ext) {
  let best = '', bestSize = -1;
  for (const f of files) {
    if (!f.toLowerCase().endsWith(ext)) continue;
    let sz = 0;
    try { sz = fs.statSync(f).size; } catch { continue; }
    if (sz > bestSize) { bestSize = sz; best = f; }
  }
  return best;
}

// 在一个游戏根目录里找：主程序 / pak / utoc / ucas
function discover(root) {
  const out = { game: root, exe: '', pak: '', utoc: '', ucas: '' };
  if (!root || !fs.existsSync(root)) return out;

  const dirs = [root].concat(collectDirs(root, 6, []));

  // 主程序：优先 *-Shipping.exe，其次 Binaries\Win64 里最大的 exe，再其次任意最大的 exe
  const exeFiles = [];
  for (const d of dirs) {
    for (const e of safeListDir(d)) {
      if (e.isFile() && /\.exe$/i.test(e.name)) exeFiles.push(path.join(d, e.name));
    }
  }
  const shipping = exeFiles.filter(f => /-shipping\.exe$/i.test(f));
  const inWin64 = files => files.filter(f => /[\\/]binaries[\\/]win64[\\/]/i.test(f));
  out.exe = pickLargest(shipping, '.exe') || pickLargest(inWin64(exeFiles), '.exe') || pickLargest(exeFiles, '.exe');

  // 容器：优先 Paks 目录，找不到就全目录里找
  const paksDirs = dirs.filter(d => /[\\/]paks$/i.test(d));
  const scanDirs = paksDirs.length ? paksDirs : dirs;
  const cont = [];
  for (const d of scanDirs) {
    for (const e of safeListDir(d)) {
      if (e.isFile() && /\.(pak|utoc|ucas)$/i.test(e.name)) cont.push(path.join(d, e.name));
    }
  }
  out.pak = pickLargest(cont, '.pak');
  out.utoc = pickLargest(cont, '.utoc');
  out.ucas = pickLargest(cont, '.ucas');
  return out;
}

// ---- 读 target.json ----
let target = {};
if (fs.existsSync(TARGET_FILE)) {
  try {
    target = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8')) || {};
  } catch (e) {
    console.error('[config] target.json 解析失败：' + e.message);
    target = {};
  }
}

const env = process.env;
const GAME = argv('game') || target.game || env.UEKH_GAME || '';
let EXE = argv('exe') || target.exe || env.UEKH_EXE || '';
let PAK = argv('pak') || target.pak || env.UEKH_PAK || '';
let UTOC = argv('utoc') || target.utoc || env.UEKH_UTOC || '';
let UCAS = argv('ucas') || target.ucas || env.UEKH_UCAS || '';
let PROCESS = argv('process') || target.process || env.UEKH_PROCESS || '';

// 只要缺东西，就按游戏根目录自动补；连 game 都没给、但给了 pak，就用 pak 的兄弟文件
if (!GAME && PAK) {
  const d = path.dirname(PAK);
  const sib = safeListDir(d).filter(e => e.isFile());
  for (const e of sib) {
    const full = path.join(d, e.name);
    if (!UTOC && /\.utoc$/i.test(e.name)) UTOC = full;
    if (!UCAS && /\.ucas$/i.test(e.name)) UCAS = full;
  }
}
if (GAME && (!EXE || !PAK)) {
  const d = discover(GAME);
  EXE = EXE || d.exe;
  PAK = PAK || d.pak;
  UTOC = UTOC || d.utoc;
  UCAS = UCAS || d.ucas;
}
if (!PROCESS && EXE) PROCESS = path.basename(EXE).replace(/\.exe$/i, '');

function need(name, value, hint) {
  if (value) return value;
  console.error('');
  console.error('[' + name + ' 没配] ' + (hint || ''));
  console.error('  三种配法任选一种：');
  console.error('    1) node setup.js "游戏根目录"            ← 自动找 exe/pak/utoc/ucas 并写入 target.json');
  console.error('    2) 命令行传参  --' + name.toLowerCase() + '="完整路径"');
  console.error('    3) 手写同目录 target.json');
  console.error('');
  process.exit(2);
}

module.exports = {
  GAME, EXE, PAK, UTOC, UCAS, PROCESS,
  HIT_LOG: 'hits.txt',
  TARGET_FILE,
  discover,
  needPak: () => need('PAK', PAK, '需要一个 .pak 文件（校验器用它算 SHA1）'),
  needExe: () => need('EXE', EXE, '需要被扫描的 exe/dll，或直接用 scan-file.js 传文件路径'),
};
