// 校验器自检：拿一把已知 key 造一段"伪造已加密索引"，看 scanBuffer 能不能把它捞出来
'use strict';
const crypto = require('crypto');
const { buildOracles, scanBuffer } = require('./lib/oracle');

// 期望的明文块：FString mountpoint "../../../" = 长度 10 + 9 字符 + 00，再补 2 字节
const mount = Buffer.from('../../../\x00', 'latin1');
const pt = Buffer.alloc(16);
pt.writeInt32LE(mount.length, 0);
mount.copy(pt, 4);

const key = crypto.randomBytes(32);
const c = crypto.createCipheriv('aes-256-ecb', key, null);
c.setAutoPadding(false);
const ct = Buffer.concat([c.update(pt), c.final()]);

console.log('明文块: ' + pt.toString('hex') + '   "' + pt.toString('latin1').replace(/[^\x20-\x7e]/g, '.') + '"');
console.log('key   : ' + key.toString('hex'));

// 造一个 4KB 的缓冲区，key 藏在偏移 1000 处，伪造密文块放在偏移 0（模拟 pak 索引起点）
const buf = Buffer.alloc(4096, 0x41);
ct.copy(buf, 0);
key.copy(buf, 1000);

const oracles = [{ name: 'fake-pakIndex', ct, kind: 'mount' }];
const res = scanBuffer(buf, oracles, {
  start: 0, end: buf.length, stride: 1,
  onHit: (i, keyHex, name) => console.log('>>> 命中: offset=' + i + ' oracle=' + name + ' key=' + keyHex),
});
console.log('扫完: hits=' + (res.hits ? res.hits.length : JSON.stringify(res)));

// 反向对照：把 key 换个位置但密文块不改，应该扫不到
const buf2 = Buffer.alloc(4096, 0x41);
ct.copy(buf2, 0);
const res2 = scanBuffer(buf2, oracles, { start: 0, end: buf2.length, stride: 1 });
const n2 = res2.hits ? res2.hits.length : 0;
console.log('对照（不藏 key）: hits=' + n2 + '  -> ' + (n2 === 0 ? 'OK 不会误报' : '异常：误报'));
