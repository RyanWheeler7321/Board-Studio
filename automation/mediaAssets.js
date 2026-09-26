'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MIME_EXTENSIONS = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/gif', '.gif'],
    ['image/webp', '.webp'],
    ['image/svg+xml', '.svg'],
    ['image/bmp', '.bmp']
]);

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function aspectRatio(width, height) {
    const safeWidth = Number(width);
    const safeHeight = Number(height);
    return Number.isFinite(safeWidth) && Number.isFinite(safeHeight) && safeWidth > 0 && safeHeight > 0
        ? safeWidth / safeHeight
        : null;
}

function inferSvgSize(text) {
    const viewBox = String(text || '').match(/viewBox\s*=\s*['"]([^'"]+)['"]/i);
    if (viewBox) {
        const values = viewBox[1].trim().split(/[\s,]+/).map(Number);
        if (values.length === 4 && Number.isFinite(values[2]) && Number.isFinite(values[3]) && values[2] > 0 && values[3] > 0) {
            return { width: values[2], height: values[3] };
        }
    }
    const widthMatch = String(text || '').match(/width\s*=\s*['"]([^'"]+)['"]/i);
    const heightMatch = String(text || '').match(/height\s*=\s*['"]([^'"]+)['"]/i);
    if (!widthMatch || !heightMatch) {
        return null;
    }
    const width = Number(String(widthMatch[1]).replace(/[^0-9.]/g, ''));
    const height = Number(String(heightMatch[1]).replace(/[^0-9.]/g, ''));
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? { width, height }
        : null;
}

function jpegOrientation(app1) {
    if (!Buffer.isBuffer(app1) || app1.length < 14 || app1.toString('ascii', 0, 6) !== 'Exif\0\0') {
        return 1;
    }
    const tiff = 6;
    const endian = app1.toString('ascii', tiff, tiff + 2);
    const littleEndian = endian === 'II';
    if (!littleEndian && endian !== 'MM') {
        return 1;
    }
    const read16 = (offset) => littleEndian ? app1.readUInt16LE(offset) : app1.readUInt16BE(offset);
    const read32 = (offset) => littleEndian ? app1.readUInt32LE(offset) : app1.readUInt32BE(offset);
    try {
        const ifdOffset = tiff + read32(tiff + 4);
        if (ifdOffset < tiff || ifdOffset + 2 > app1.length) {
            return 1;
        }
        const count = read16(ifdOffset);
        for (let index = 0; index < count; index += 1) {
            const entry = ifdOffset + 2 + (index * 12);
            if (entry + 12 > app1.length) {
                break;
            }
            if (read16(entry) === 0x0112) {
                const value = read16(entry + 8);
                return value >= 1 && value <= 8 ? value : 1;
            }
        }
    } catch {}
    return 1;
}

function inspectJpeg(buffer) {
    let offset = 2;
    let width = 0;
    let height = 0;
    let orientation = 1;
    while (offset + 4 <= buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        while (offset < buffer.length && buffer[offset] === 0xff) {
            offset += 1;
        }
        const marker = buffer[offset];
        offset += 1;
        if (marker === 0xd9 || marker === 0xda) {
            break;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            continue;
        }
        if (offset + 2 > buffer.length) {
            break;
        }
        const length = buffer.readUInt16BE(offset);
        if (length < 2 || offset + length > buffer.length) {
            break;
        }
        const start = offset + 2;
        const end = offset + length;
        if (marker === 0xe1) {
            orientation = jpegOrientation(buffer.subarray(start, end));
        }
        const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
            || (marker >= 0xc5 && marker <= 0xc7)
            || (marker >= 0xc9 && marker <= 0xcb)
            || (marker >= 0xcd && marker <= 0xcf);
        if (isStartOfFrame && start + 5 <= end) {
            height = buffer.readUInt16BE(start + 1);
            width = buffer.readUInt16BE(start + 3);
        }
        offset = end;
    }
    if (!width || !height) {
        return null;
    }
    const rotated = orientation >= 5 && orientation <= 8;
    return {
        width: rotated ? height : width,
        height: rotated ? width : height,
        encodedWidth: width,
        encodedHeight: height,
        orientation,
        hasAlpha: false
    };
}

function inspectImageBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        throw new Error('Image file is empty or unreadable');
    }
    let result = null;
    let mimeType = '';
    if (buffer.length >= 26 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString('ascii', 1, 4) === 'PNG') {
        const colorType = buffer[25];
        result = {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20),
            orientation: 1,
            hasAlpha: colorType === 4 || colorType === 6 || buffer.includes(Buffer.from('tRNS'))
        };
        mimeType = 'image/png';
    } else if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
        result = {
            width: buffer.readUInt16LE(6),
            height: buffer.readUInt16LE(8),
            orientation: 1,
            hasAlpha: buffer.includes(Buffer.from([0x21, 0xf9, 0x04]))
        };
        mimeType = 'image/gif';
    } else if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        const chunkType = buffer.toString('ascii', 12, 16);
        if (chunkType === 'VP8X') {
            result = {
                width: 1 + buffer.readUIntLE(24, 3),
                height: 1 + buffer.readUIntLE(27, 3),
                orientation: 1,
                hasAlpha: (buffer[20] & 0x10) !== 0
            };
        } else if (chunkType === 'VP8 ') {
            result = {
                width: buffer.readUInt16LE(26) & 0x3fff,
                height: buffer.readUInt16LE(28) & 0x3fff,
                orientation: 1,
                hasAlpha: false
            };
        } else if (chunkType === 'VP8L' && buffer.length >= 25) {
            const bits = buffer.readUInt32LE(21);
            result = {
                width: (bits & 0x3fff) + 1,
                height: ((bits >> 14) & 0x3fff) + 1,
                orientation: 1,
                hasAlpha: true
            };
        }
        mimeType = 'image/webp';
    } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        result = inspectJpeg(buffer);
        mimeType = 'image/jpeg';
    } else if (buffer.length >= 26 && buffer.toString('ascii', 0, 2) === 'BM') {
        const width = Math.abs(buffer.readInt32LE(18));
        const height = Math.abs(buffer.readInt32LE(22));
        const bitsPerPixel = buffer.readUInt16LE(28);
        result = { width, height, orientation: 1, hasAlpha: bitsPerPixel === 32 };
        mimeType = 'image/bmp';
    } else {
        const text = buffer.toString('utf8', 0, Math.min(buffer.length, 65536));
        if (/<svg[\s>]/i.test(text)) {
            const size = inferSvgSize(text);
            if (size) {
                result = { ...size, orientation: 1, hasAlpha: null };
                mimeType = 'image/svg+xml';
            }
        }
    }
    if (!result || !Number.isFinite(result.width) || !Number.isFinite(result.height) || result.width <= 0 || result.height <= 0) {
        throw new Error('Unsupported image format or invalid dimensions');
    }
    return {
        ...result,
        mimeType,
        aspectRatio: aspectRatio(result.width, result.height)
    };
}

function readImageInfoSync(filePath) {
    const resolvedPath = path.resolve(String(filePath || '').trim());
    const buffer = fs.readFileSync(resolvedPath);
    const info = inspectImageBuffer(buffer);
    const stats = fs.statSync(resolvedPath);
    return {
        ...info,
        path: resolvedPath,
        byteLength: stats.size,
        sha256: sha256(buffer)
    };
}

async function stageBoardImage(source, options = {}) {
    const rawSource = String(source || '').trim();
    if (!rawSource) {
        throw new Error('Replacement image path is required');
    }
    if (/^https?:\/\//i.test(rawSource)) {
        throw new Error('Replacement images must be prepared local files');
    }
    const rawBoardDataDir = String(options.boardDataDir || '').trim();
    if (!rawBoardDataDir) {
        throw new Error('Board Studio data directory is required');
    }
    const cwd = path.resolve(String(options.cwd || process.cwd()));
    const sourcePath = path.isAbsolute(rawSource) ? path.resolve(rawSource) : path.resolve(cwd, rawSource);
    const buffer = await fsp.readFile(sourcePath);
    const info = inspectImageBuffer(buffer);
    const contentHash = sha256(buffer);
    const extension = MIME_EXTENSIONS.get(info.mimeType);
    if (!extension) {
        throw new Error(`Unsupported replacement image type: ${info.mimeType || 'unknown'}`);
    }
    const boardDataDir = path.resolve(rawBoardDataDir);
    const imagesDir = path.join(boardDataDir, 'assets', 'images');
    await fsp.mkdir(imagesDir, { recursive: true });
    const fileName = `board-agent-${contentHash.slice(0, 24)}${extension}`;
    const destinationPath = path.join(imagesDir, fileName);
    let created = false;
    try {
        const current = await fsp.readFile(destinationPath);
        if (sha256(current) !== contentHash) {
            throw new Error(`Board asset hash collision: ${fileName}`);
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
        const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
        await fsp.writeFile(tempPath, buffer, { flag: 'wx' });
        try {
            await fsp.rename(tempPath, destinationPath);
            created = true;
        } finally {
            await fsp.unlink(tempPath).catch(() => {});
        }
    }
    return {
        assetName: `images/${fileName}`,
        destinationPath,
        sourcePath,
        created,
        width: info.width,
        height: info.height,
        aspectRatio: info.aspectRatio,
        orientation: info.orientation,
        hasAlpha: info.hasAlpha,
        mimeType: info.mimeType,
        byteLength: buffer.length,
        sha256: contentHash
    };
}

module.exports = {
    MIME_EXTENSIONS,
    aspectRatio,
    inspectImageBuffer,
    readImageInfoSync,
    stageBoardImage
};
