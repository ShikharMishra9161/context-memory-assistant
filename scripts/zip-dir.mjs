// Minimal ZIP writer (deflate, forward-slash paths) so the Web Store package
// can be built on any OS without a zip tool. Windows PowerShell 5.1's
// Compress-Archive writes backslash paths, which Chrome cannot install.
// Usage: node scripts/zip-dir.mjs <sourceDir> <out.zip>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
// Fixed DOS date (2020-01-01) keeps builds reproducible.
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function walk(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function zipDir(srcDir, outFile) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const files = walk(srcDir);
  for (const file of files) {
    const name = Buffer.from(relative(srcDir, file).split(sep).join('/'));
    const data = readFileSync(file);
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8); head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    locals.push(head, name, packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10); cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += head.length + name.length + packed.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, central, end]));
  return files.length;
}

if (process.argv[2] && process.argv[3]) {
  const n = zipDir(process.argv[2], process.argv[3]);
  console.log(`Zipped ${n} files → ${process.argv[3]}`);
}
