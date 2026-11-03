// lib/oracle.js — the "is this the key?" test.
//
// A 32-byte window is only a *candidate*. To decide, we decrypt a known ciphertext block and
// check that the plaintext matches what UE would have written there:
//
//   mount  : FPakFile index starts with an FString mount point, e.g. "../../../"
//            -> little-endian int32 length in [1..300], followed by printable ASCII
//   magic  : an asset payload starts with the package file tag 0xC1832A9E
//
// Both are cheap (one AES block) and have a tiny false-positive rate, and every hit is then
// re-checked against the SHA-1 of the whole index, which is effectively proof.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { expandKey, decryptBlock } = require('./aes256');

const ASSET_TAG = Buffer.from([0xc1, 0x83, 0x2a, 0x9e]);

function readBlock(path, offset) {
  const fd = fs.openSync(path, 'r');
  try {
    const b = Buffer.alloc(16);
    fs.readSync(fd, b, 0, 16, offset);
    return b;
  } finally { fs.closeSync(fd); }
}

// Default oracle set for a UE4 package directory.
function buildOracles(opts) {
  const { pakPath, ucasPath, pakInfo, extra } = opts || {};
  const list = [];

  if (pakPath && pakInfo) {
    list.push({
      name: `pakIndex@${pakInfo.indexOffset}`,
      ct: readBlock(pakPath, pakInfo.indexOffset),
      kind: 'mount',
    });
  }
  if (pakPath) {
    // A second, "stub" FPakInfo sometimes sits at offset 0 with a zeroed magic.
    const stubIdx = 1486288;
    try { list.push({ name: `pak@${stubIdx}`, ct: readBlock(pakPath, stubIdx), kind: 'magic' }); } catch { }
    list.push({ name: 'pak@0', ct: readBlock(pakPath, 0), kind: 'magic' });
    list.push({ name: `pak@${pakInfo ? pakInfo.infoOffset - 1024 : 0}`, ct: readBlock(pakPath, Math.max(0, (pakInfo ? pakInfo.infoOffset : 1024) - 1024)), kind: 'magic' });
  }
  if (ucasPath) {
    list.push({ name: 'ucas@0', ct: readBlock(ucasPath, 0), kind: 'magic' });
    list.push({ name: 'ucas@1048576', ct: readBlock(ucasPath, 1048576), kind: 'magic' });
  }
  for (const e of extra || []) list.push(e);
  return list.filter(o => o.ct && o.ct.length === 16);
}

// 注意：FString 序列化是【int32 长度（含结尾 \0）】+ ASCII + '\0'。
// 长度要比实际字符数多 1，所以这里必须按 len-1 个字符判断，
// 并且当那个 '\0' 落在这 16 字节里时必须是 0 —— 之前用 len 直接判断，
// 把结尾的 \0 当作"不可打印"给否掉了，等于对正确的 key 永远返回 false。
function isMountPoint(p) {
  const len = p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24);
  if (len < 2 || len > 300) return false;
  const chars = len - 1;
  const n = Math.min(chars, 12);
  for (let i = 4; i < 4 + n; i++) { const c = p[i]; if (c < 0x20 || c > 0x7e) return false; }
  // 结尾符如果落在这一块里，必须是 0x00
  const term = 4 + chars;
  if (term < 16 && p[term] !== 0x00) return false;
  return true;
}

function isAssetTag(p) {
  return p[0] === ASSET_TAG[0] && p[1] === ASSET_TAG[1] && p[2] === ASSET_TAG[2] && p[3] === ASSET_TAG[3];
}

function matches(oracle, plain) {
  return oracle.kind === 'mount' ? isMountPoint(plain) : isAssetTag(plain);
}

// Full proof: decrypt the entire index and compare SHA-1 with the value stored in FPakInfo.
function verifyIndex(keyHex, pakPath, pakInfo) {
  const key = Buffer.from(keyHex.replace(/^0x/i, ''), 'hex');
  if (key.length !== 32) throw new Error('key must be 32 bytes (64 hex chars)');
  const fd = fs.openSync(pakPath, 'r');
  let cipher;
  try {
    cipher = Buffer.alloc(pakInfo.indexSize);
    fs.readSync(fd, cipher, 0, pakInfo.indexSize, pakInfo.indexOffset);
  } finally { fs.closeSync(fd); }
  const d = crypto.createDecipheriv('aes-256-ecb', key, null);
  d.setAutoPadding(false);
  const plain = Buffer.concat([d.update(cipher), d.final()]);
  const sha = crypto.createHash('sha1').update(plain).digest('hex');
  return {
    sha,
    stored: pakInfo.indexHash,
    match: sha === pakInfo.indexHash,
    head: plain.subarray(0, 128),
    printableRatio: printableRatio(plain),
  };
}

function printableRatio(buf) {
  let n = 0;
  for (let i = 0; i < buf.length; i++) { const c = buf[i]; if ((c >= 0x20 && c < 0x7f) || c === 0x09 || c === 0x0a || c === 0x0d) n++; }
  return n / Math.max(1, buf.length);
}

// Scan a buffer for candidate keys. onHit(candidateIndex, keyHex, oracleName) is called on a hit.
function scanBuffer(buf, oracles, opts) {
  const { start = 0, end = buf.length, stride = 1, onHit, onProgress, progressEveryMs = 5000 } = opts || {};
  const rk = new Uint8Array(240);
  const out = new Uint8Array(16);
  const limit = Math.min(end, buf.length);
  const t0 = Date.now();
  let last = t0, n = 0;

  for (let i = start; i + 32 <= limit; i += stride) {
    expandKey(buf.subarray(i, i + 32), rk);
    for (let o = 0; o < oracles.length; o++) {
      const or = oracles[o];
      decryptBlock(rk, or.ct, out);
      if (matches(or, out)) {
        onHit(i, Buffer.from(buf.subarray(i, i + 32)).toString('hex'), or.name, or);
      }
    }
    n++;
    if (onProgress && Date.now() - last >= progressEveryMs) {
      last = Date.now();
      const el = (Date.now() - t0) / 1000;
      onProgress({ scanned: n, pos: i, total: limit, ratePerSec: n / Math.max(el, 0.001), elapsedSec: el });
    }
  }
  return { scanned: n, elapsedSec: (Date.now() - t0) / 1000 };
}

module.exports = { buildOracles, scanBuffer, verifyIndex, isMountPoint, isAssetTag, printableRatio, ASSET_TAG };
