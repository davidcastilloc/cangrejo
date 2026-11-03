import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Standard PKZIP (`PK\x03\x04` / `PK\x01\x02` / `PK\x05\x06`) DEFLATE codec
 * used for `.mtgx` and `.mtgj` container archives without external native dependencies.
 */
export class ZipContainerCodec {
  public static buildZipArchive(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let currentOffset = 0;
    let entryCount = 0;

    for (const [rawPath, uncompressedBytes] of entries.entries()) {
      const normalizedPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const nameBuf = Buffer.from(normalizedPath, 'utf-8');
      const crc = computeCrc32(uncompressedBytes);
      const compressedBuf = deflateRawSync(uncompressedBytes);

      // Local File Header (30 bytes + file name)
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0); // Signature PK\x03\x04
      localHeader.writeUInt16LE(20, 4); // Version needed (2.0)
      localHeader.writeUInt16LE(0x0800, 6); // General purpose bit flag (UTF-8 filename)
      localHeader.writeUInt16LE(8, 8); // Compression method: 8 = DEFLATE
      localHeader.writeUInt16LE(0, 10); // Mod time
      localHeader.writeUInt16LE(0, 12); // Mod date
      localHeader.writeUInt32LE(crc, 14); // CRC-32
      localHeader.writeUInt32LE(compressedBuf.length, 18); // Compressed size
      localHeader.writeUInt32LE(uncompressedBytes.length, 22); // Uncompressed size
      localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
      localHeader.writeUInt16LE(0, 28); // Extra field length

      localChunks.push(localHeader, nameBuf, compressedBuf);

      // Central Directory Header (46 bytes + file name)
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0); // Signature PK\x01\x02
      centralHeader.writeUInt16LE(20, 4); // Version made by
      centralHeader.writeUInt16LE(20, 6); // Version needed
      centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
      centralHeader.writeUInt16LE(8, 10); // Compression method: DEFLATE
      centralHeader.writeUInt16LE(0, 12); // Mod time
      centralHeader.writeUInt16LE(0, 14); // Mod date
      centralHeader.writeUInt32LE(crc, 16); // CRC-32
      centralHeader.writeUInt32LE(compressedBuf.length, 20); // Compressed size
      centralHeader.writeUInt32LE(uncompressedBytes.length, 24); // Uncompressed size
      centralHeader.writeUInt16LE(nameBuf.length, 28); // File name length
      centralHeader.writeUInt16LE(0, 30); // Extra field length
      centralHeader.writeUInt16LE(0, 32); // File comment length
      centralHeader.writeUInt16LE(0, 34); // Disk number start
      centralHeader.writeUInt16LE(0, 36); // Internal file attrs
      centralHeader.writeUInt32LE(0, 38); // External file attrs
      centralHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header

      centralChunks.push(centralHeader, nameBuf);
      currentOffset += localHeader.length + nameBuf.length + compressedBuf.length;
      entryCount++;
    }

    const centralDirBuffer = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // EOCD Signature PK\x05\x06
    eocd.writeUInt16LE(0, 4); // Disk number
    eocd.writeUInt16LE(0, 6); // Disk with central dir
    eocd.writeUInt16LE(entryCount, 8); // Entries on this disk
    eocd.writeUInt16LE(entryCount, 10); // Total entries
    eocd.writeUInt32LE(centralDirBuffer.length, 12); // Size of central directory
    eocd.writeUInt32LE(currentOffset, 16); // Offset of central directory
    eocd.writeUInt16LE(0, 20); // Comment length

    return new Uint8Array(Buffer.concat([...localChunks, centralDirBuffer, eocd]));
  }

  public static extractZipArchive(zipBytes: Uint8Array): Map<string, Uint8Array> {
    const buf = Buffer.from(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
      throw new Error('Invalid PKZIP archive: missing PK\\x03\\x04 signature.');
    }

    // Locate End of Central Directory (PK\x05\x06) from the end of the buffer
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      throw new Error('Invalid PKZIP archive: End of Central Directory (PK\\x05\\x06) not found.');
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

    const files = new Map<string, Uint8Array>();
    let cdPtr = centralDirOffset;

    for (let i = 0; i < totalEntries; i++) {
      if (buf.readUInt32LE(cdPtr) !== 0x02014b50) {
        throw new Error(`Corrupt Central Directory entry at offset ${cdPtr}`);
      }
      const method = buf.readUInt16LE(cdPtr + 10);
      const expectedCrc = buf.readUInt32LE(cdPtr + 16);
      const compressedSize = buf.readUInt32LE(cdPtr + 20);
      const fileNameLen = buf.readUInt16LE(cdPtr + 28);
      const extraLen = buf.readUInt16LE(cdPtr + 30);
      const commentLen = buf.readUInt16LE(cdPtr + 32);
      const localHeaderOffset = buf.readUInt32LE(cdPtr + 42);

      const fileName = buf.toString('utf-8', cdPtr + 46, cdPtr + 46 + fileNameLen);
      cdPtr += 46 + fileNameLen + extraLen + commentLen;

      const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedSlice = buf.subarray(dataStart, dataStart + compressedSize);

      let uncompressed: Uint8Array;
      if (method === 0) {
        uncompressed = new Uint8Array(compressedSlice);
      } else if (method === 8) {
        uncompressed = new Uint8Array(inflateRawSync(compressedSlice));
      } else {
        throw new Error(`Unsupported ZIP compression method ${method} for ${fileName}`);
      }

      const actualCrc = computeCrc32(uncompressed);
      if (actualCrc !== expectedCrc) {
        throw new Error(
          `CRC-32 mismatch for '${fileName}': expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)}`
        );
      }

      files.set(fileName, uncompressed);
    }

    return files;
  }
}
