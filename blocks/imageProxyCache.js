'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IMAGE_PROXY_RECIPE_VERSION = 'p1';
const IMAGE_PROXY_MAX_EDGE = 768;
const IMAGE_PROXY_CACHE_LIMIT_BYTES = 768 * 1024 * 1024;
const IMAGE_PROXY_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const GIF_LOOP_SCAN_BYTES = 64 * 1024;
const GIF_LOOP_EXTENSIONS = ['NETSCAPE2.0', 'ANIMEXTS1.0'].map((identifier) => (
    Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from(identifier, 'ascii')])
));

function sanitizeMaxEdge(value) {
    const parsed = Math.round(Number(value) || IMAGE_PROXY_MAX_EDGE);
    return Math.min(2048, Math.max(256, parsed));
}

function isPathInside(rootPath, candidatePath) {
    const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function writeFileAtomic(targetPath, buffer) {
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await fs.promises.writeFile(tempPath, buffer);
    try {
        await fs.promises.rename(tempPath, targetPath);
    } catch (error) {
        try {
            await fs.promises.unlink(tempPath);
        } catch {}
        if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
            try {
                await fs.promises.access(targetPath, fs.constants.R_OK);
                return;
            } catch {}
        }
        throw error;
    }
}

function isAnimatedGifRequest(sourcePath, animation) {
    return animation === true && path.extname(sourcePath).toLowerCase() === '.gif';
}

async function readGifLoopCount(sourcePath) {
    const handle = await fs.promises.open(sourcePath, 'r');
    try {
        const buffer = Buffer.allocUnsafe(GIF_LOOP_SCAN_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const data = buffer.subarray(0, bytesRead);
        if (data.length < 6 || data.subarray(0, 3).toString('ascii') !== 'GIF') {
            return null;
        }
        const loopExtension = GIF_LOOP_EXTENSIONS
            .map((extension) => ({ extension, offset: data.indexOf(extension) }))
            .find(({ offset }) => offset >= 0);
        if (
            !loopExtension
            || data[loopExtension.offset + loopExtension.extension.length] !== 3
            || data[loopExtension.offset + loopExtension.extension.length + 1] !== 1
            || data[loopExtension.offset + loopExtension.extension.length + 4] !== 0
        ) {
            return null;
        }
        const low = data[loopExtension.offset + loopExtension.extension.length + 2];
        const high = data[loopExtension.offset + loopExtension.extension.length + 3];
        return low | (high << 8);
    } finally {
        await handle.close();
    }
}

function createTempMediaPath(cacheDir, extension) {
    return path.join(
        cacheDir,
        `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
    );
}

async function publishMediaToolOutput(tempPath, targetPath) {
    try {
        await fs.promises.rename(tempPath, targetPath);
    } catch (error) {
        await fs.promises.unlink(tempPath).catch(() => {});
        if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
            await fs.promises.access(targetPath, fs.constants.R_OK);
            return;
        }
        throw error;
    }
}

async function ensureOutputFile(outputPath) {
    const stat = await fs.promises.stat(outputPath);
    if (!stat.isFile() || stat.size === 0) {
        throw new Error('image-proxy-media-tool-empty-output');
    }
    return stat;
}

function gifScaleFilter(maxEdge) {
    return `scale='min(${maxEdge},iw)':'min(${maxEdge},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
}

function createImageProxyCache(options = {}) {
    const nativeImage = options.nativeImage;
    const runMediaTool = options.runMediaTool;
    if (!nativeImage || typeof nativeImage.createThumbnailFromPath !== 'function') {
        throw new Error('image-proxy-native-image-unavailable');
    }
    const inFlight = new Map();
    let queueTail = Promise.resolve();
    let cleanupScheduled = false;

    async function generate(payload = {}) {
        const dataDir = path.resolve(String(payload.dataDir || '').trim());
        const sourcePath = path.resolve(String(payload.sourcePath || '').trim());
        const assetsDir = path.join(dataDir, 'assets');
        if (!dataDir || !sourcePath || !isPathInside(assetsDir, sourcePath)) {
            throw new Error('image-proxy-source-outside-assets');
        }
        const sourceStat = await fs.promises.stat(sourcePath);
        if (!sourceStat.isFile()) {
            throw new Error('image-proxy-source-not-file');
        }
        const maxEdge = sanitizeMaxEdge(payload.maxEdge);
        const animation = isAnimatedGifRequest(sourcePath, payload.animation);
        const sourceSha256 = await hashFile(sourcePath);
        const cacheDir = path.join(dataDir, 'cache', `image-proxies-${IMAGE_PROXY_RECIPE_VERSION}`);
        const fileStem = `${sourceSha256}-${IMAGE_PROXY_RECIPE_VERSION}-${maxEdge}${animation ? '-animated' : ''}`;
        const proxyPath = path.join(cacheDir, `${fileStem}.${animation ? 'gif' : 'png'}`);
        const posterPath = animation ? path.join(cacheDir, `${fileStem}-poster.png`) : '';
        await fs.promises.mkdir(cacheDir, { recursive: true });
        try {
            await fs.promises.access(proxyPath, fs.constants.R_OK);
            if (animation) {
                await fs.promises.access(posterPath, fs.constants.R_OK);
            }
            fs.promises.utimes(proxyPath, new Date(), new Date()).catch(() => {});
            if (animation) {
                fs.promises.utimes(posterPath, new Date(), new Date()).catch(() => {});
            }
            return {
                success: true,
                cached: true,
                path: proxyPath,
                sourceSha256,
                maxEdge,
                ...(animation ? { posterPath } : {})
            };
        } catch {}

        if (animation) {
            if (typeof runMediaTool !== 'function') {
                throw new Error('image-proxy-media-tool-unavailable');
            }
            const tempProxyPath = createTempMediaPath(cacheDir, 'gif');
            const tempPosterPath = createTempMediaPath(cacheDir, 'png');
            try {
                const loopCount = await readGifLoopCount(sourcePath);
                const scale = gifScaleFilter(maxEdge);
                await runMediaTool([
                    '-y',
                    '-hide_banner',
                    '-loglevel', 'error',
                    '-threads', '2',
                    '-filter_complex_threads', '1',
                    '-i', sourcePath,
                    '-filter_complex',
                    `[0:v]${scale},split[palette][video];[palette]palettegen=stats_mode=single:reserve_transparent=1[paletteout];[video][paletteout]paletteuse=new=1:alpha_threshold=128[gif]`,
                    '-map', '[gif]',
                    '-fps_mode', 'passthrough',
                    '-loop', String(loopCount === null ? -1 : loopCount),
                    tempProxyPath
                ]);
                await ensureOutputFile(tempProxyPath);
                await runMediaTool([
                    '-y',
                    '-hide_banner',
                    '-loglevel', 'error',
                    '-threads', '2',
                    '-filter_threads', '1',
                    '-i', sourcePath,
                    '-vf', scale,
                    '-frames:v', '1',
                    tempPosterPath
                ]);
                const [proxyStat, posterStat] = await Promise.all([
                    ensureOutputFile(tempProxyPath),
                    ensureOutputFile(tempPosterPath)
                ]);
                await publishMediaToolOutput(tempPosterPath, posterPath);
                await publishMediaToolOutput(tempProxyPath, proxyPath);
                return {
                    success: true,
                    cached: false,
                    path: proxyPath,
                    posterPath,
                    sourceSha256,
                    maxEdge,
                    byteLength: proxyStat.size,
                    posterByteLength: posterStat.size
                };
            } catch (error) {
                await Promise.all([
                    fs.promises.unlink(tempProxyPath).catch(() => {}),
                    fs.promises.unlink(tempPosterPath).catch(() => {}),
                    fs.promises.unlink(posterPath).catch(() => {}),
                    fs.promises.unlink(proxyPath).catch(() => {})
                ]);
                throw error;
            }
        }

        let thumbnail = await nativeImage.createThumbnailFromPath(sourcePath, {
            width: maxEdge,
            height: maxEdge
        });
        if (!thumbnail || thumbnail.isEmpty()) {
            throw new Error('image-proxy-thumbnail-empty');
        }
        let size = thumbnail.getSize();
        if ((Number(size?.width) || 0) > maxEdge || (Number(size?.height) || 0) > maxEdge) {
            const resizeOptions = (Number(size?.width) || 0) >= (Number(size?.height) || 0)
                ? { width: maxEdge, quality: 'good' }
                : { height: maxEdge, quality: 'good' };
            thumbnail = thumbnail.resize(resizeOptions);
            size = thumbnail.getSize();
        }
        const buffer = thumbnail.toPNG();
        if (!buffer || buffer.length === 0) {
            throw new Error('image-proxy-encode-empty');
        }
        await writeFileAtomic(proxyPath, buffer);
        return {
            success: true,
            cached: false,
            path: proxyPath,
            sourceSha256,
            maxEdge,
            width: Number(size?.width) || 0,
            height: Number(size?.height) || 0,
            byteLength: buffer.length
        };
    }

    function request(payload = {}) {
        const sourcePath = path.resolve(String(payload.sourcePath || '').trim());
        const maxEdge = sanitizeMaxEdge(payload.maxEdge);
        const animation = isAnimatedGifRequest(sourcePath, payload.animation);
        const key = `${sourcePath}\u0000${maxEdge}\u0000${animation ? 'animated' : 'static'}`;
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }
        const operation = queueTail
            .catch(() => {})
            .then(() => generate({ ...payload, sourcePath, maxEdge }));
        queueTail = operation;
        inFlight.set(key, operation);
        operation.finally(() => {
            if (inFlight.get(key) === operation) {
                inFlight.delete(key);
            }
        }).catch(() => {});
        return operation;
    }

    async function cleanup(dataDirValue, cleanupOptions = {}) {
        const dataDir = path.resolve(String(dataDirValue || '').trim());
        const cacheDir = path.join(dataDir, 'cache', `image-proxies-${IMAGE_PROXY_RECIPE_VERSION}`);
        const limitBytes = Math.max(64 * 1024 * 1024, Number(cleanupOptions.limitBytes) || IMAGE_PROXY_CACHE_LIMIT_BYTES);
        const maxAgeMs = Math.max(24 * 60 * 60 * 1000, Number(cleanupOptions.maxAgeMs) || IMAGE_PROXY_MAX_AGE_MS);
        let names;
        try {
            names = await fs.promises.readdir(cacheDir);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return { success: true, checked: 0, removed: 0, bytes: 0 };
            }
            throw error;
        }
        const entries = [];
        for (const name of names) {
            if (!name.endsWith('.png') && !name.endsWith('.gif')) {
                continue;
            }
            const filePath = path.join(cacheDir, name);
            try {
                const stat = await fs.promises.stat(filePath);
                if (stat.isFile()) {
                    entries.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
                }
            } catch {}
        }
        entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
        const now = Date.now();
        let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
        let removed = 0;
        for (const entry of entries) {
            if ((now - entry.mtimeMs) <= maxAgeMs && totalBytes <= limitBytes) {
                continue;
            }
            try {
                await fs.promises.unlink(entry.path);
                totalBytes -= entry.size;
                removed += 1;
            } catch {}
        }
        return { success: true, checked: entries.length, removed, bytes: totalBytes };
    }

    function scheduleCleanup(dataDir) {
        if (cleanupScheduled) {
            return;
        }
        cleanupScheduled = true;
        setTimeout(() => {
            queueTail
                .catch(() => {})
                .then(() => cleanup(dataDir))
                .catch(() => {});
        }, 30_000);
    }

    return {
        request,
        cleanup,
        scheduleCleanup
    };
}

module.exports = {
    IMAGE_PROXY_RECIPE_VERSION,
    IMAGE_PROXY_MAX_EDGE,
    IMAGE_PROXY_CACHE_LIMIT_BYTES,
    IMAGE_PROXY_MAX_AGE_MS,
    sanitizeMaxEdge,
    isPathInside,
    hashFile,
    createImageProxyCache
};
