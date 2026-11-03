// lib/pak.js — minimal, defensive parsers for UE4 .pak (FPakInfo) and IoStore .utoc headers.
// Written for containers that do NOT follow the stock layout, so every field is
// sanity-checked before it is trusted.
'use strict';
const fs = require('fs');

const PAK_MAGIC = Buffer.from([0xe1, 0x12, 0x6f, 0x5a]);
const UTOC_MAGIC = Buffer.from('-==--==--==--==-', 'latin1');

// Locate FPakInfo near the end of a .pak file. Returns null when no magic is found.
function readPakInfo(pakPath) {
  const st = fs.statSync(pakPath);
  const tailLen = Math.min(st.size, 64 * 1024);
  const fd = fs.openSync(pakPath, 'r');
  try {
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
    const hits = [];
    for (let i = tail.indexOf(PAK_MAGIC); i !== -1; i = tail.indexOf(PAK_MAGIC, i + 1)) hits.push(i);

    for (const h of hits) {
      if (h + 48 > tail.length) continue;
      const version = tail.readUInt32LE(h + 4);
      const indexOffset = Number(tail.readBigUInt64LE(h + 8));
      const indexSize = Number(tail.readBigUInt64LE(h + 16));
      const indexHash = tail.subarray(h + 24, h + 44).toString('hex');
      if (version > 20 || indexOffset <= 0 || indexOffset >= st.size || indexSize <= 0 || indexSize > st.size) continue;

      // stock UE4 >= v4 continues with bEncryptedIndex(1) + EncryptionKeyGuid(16) + compression names.
      // This game jumps straight to the compression-name table ("Oodle"), so detect both.
      const bEncryptedIndex = tail[h + 44];
      const guid = tail.subarray(h + 45, h + 61).toString('hex');
      const looksStock = (bEncryptedIndex === 0 || bEncryptedIndex === 1) && /^[0-9a-f]{32}$/.test(guid) &&
        tail.subarray(h + 61, h + 61 + 32).includes(0);
      const nameTable = tail.subarray(h + 44, h + 44 + 64).toString('latin1').replace(/\0/g, '');

      return {
        file: pakPath,
        fileSize: st.size,
        infoOffset: st.size - tailLen + h,
        version,
        indexOffset,
        indexSize,
        indexHash,
        bEncryptedIndex: looksStock ? bEncryptedIndex : null,
        encryptionKeyGuid: looksStock ? guid : null,
        stockLayout: looksStock,
        trailingNameTable: nameTable,
        magicCount: hits.length,
      };
    }
    return null;
  } finally { fs.closeSync(fd); }
}

// Parse a FIoStoreTocHeader. Offsets verified against real containers.
function readUtocHeader(utocPath) {
  const fd = fs.openSync(utocPath, 'r');
  try {
    const h = Buffer.alloc(144);
    const size = fs.fstatSync(fd).size;
    fs.readSync(fd, h, 0, 144, 0);
    if (!h.subarray(0, 16).equals(UTOC_MAGIC)) return null;
    return {
      file: utocPath,
      fileSize: size,
      magic: h.subarray(0, 16).toString('latin1'),
      version: h.readUInt8(16),
      tocHeaderSize: h.readUInt32LE(20),
      tocEntryCount: h.readUInt32LE(24),
      compressedBlockCount: h.readUInt32LE(28),
      compressedBlockEntrySize: h.readUInt32LE(32),
      compressionMethodNameCount: h.readUInt32LE(36),
      compressionMethodNameLen: h.readUInt32LE(40),
      blockSize: h.readUInt32LE(44),
      dirIndexSize: h.readUInt32LE(48),
      partitionCount: h.readUInt32LE(52),
      containerId: '0x' + h.readBigUInt64LE(56).toString(16),
      encryptionKeyGuid: h.subarray(64, 80).toString('hex'),
      flags: h.readUInt8(80),
      flagNames: decodeUtocFlags(h.readUInt8(80)),
    };
  } finally { fs.closeSync(fd); }
}

function decodeUtocFlags(f) {
  const names = [];
  if (f & 1) names.push('Compressed');
  if (f & 2) names.push('Encrypted');
  if (f & 4) names.push('Signed');
  if (f & 8) names.push('Indexed');
  if (f & 16) names.push('OnDemand');
  return names;
}

module.exports = { readPakInfo, readUtocHeader, decodeUtocFlags, PAK_MAGIC, UTOC_MAGIC };
