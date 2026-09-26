'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PACKAGE_SCHEMA_VERSION = 1;
const PACKAGE_KIND = 'board-studio-animated3d-glb';
const MODELS_DIRECTORY = 'models';
const PACKAGE_PREFIX = 'animated3d-';
const MANIFEST_SUFFIX = '.manifest.json';
const MODEL_SUFFIX = '.glb';
const POSTER_SUFFIX = '.poster.svg';
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const SPEEDS = Object.freeze([0.25, 0.5, 1]);
const CAMERA_VIEWS = Object.freeze([
    'front',
    'rear',
    'left-profile',
    'right-profile',
    'top',
    'below',
    'diagonal'
]);
const DEFAULT_ANIMATED3D_PREFERENCES = Object.freeze({
    activeClip: 0,
    speed: 1,
    showBones: false,
    clay: false,
    rootMotionPreview: false,
    view: 'diagonal'
});

function normalizeAssetReference(value) {
    const raw = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
    if (!raw || raw.includes('\0') || raw.startsWith('/')) {
        return '';
    }
    const withoutAssetsPrefix = raw.replace(/^assets\//i, '');
    const normalized = path.posix.normalize(withoutAssetsPrefix).replace(/^\.\//, '');
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
        return '';
    }
    return normalized;
}

function packagePathsForReference(value) {
    const packageRef = normalizeAssetReference(value);
    const pattern = /^models\/animated3d-([a-f0-9]{16,64})\.manifest\.json$/i;
    const match = packageRef.match(pattern);
    if (!match) {
        return null;
    }
    const digest = match[1].toLowerCase();
    const stem = `${PACKAGE_PREFIX}${digest}`;
    return {
        digest,
        stem,
        packageRef: `${MODELS_DIRECTORY}/${stem}${MANIFEST_SUFFIX}`,
        modelRef: `${MODELS_DIRECTORY}/${stem}${MODEL_SUFFIX}`,
        posterRef: `${MODELS_DIRECTORY}/${stem}${POSTER_SUFFIX}`
    };
}

function normalizeAnimated3dPackageReference(value) {
    return packagePathsForReference(value)?.packageRef || '';
}

function getAnimated3dPackageReferences(value) {
    const paths = packagePathsForReference(value);
    return paths ? [paths.packageRef, paths.modelRef, paths.posterRef] : [];
}

function normalizeAnimated3dPreferences(raw) {
    const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const activeClipValue = Number(candidate.activeClip);
    const speedValue = Number(candidate.speed);
    const requestedView = candidate.view === 'side' ? 'left-profile' : candidate.view;
    const view = CAMERA_VIEWS.includes(requestedView) ? requestedView : DEFAULT_ANIMATED3D_PREFERENCES.view;
    return {
        activeClip: Number.isSafeInteger(activeClipValue) && activeClipValue >= 0 && activeClipValue <= 999
            ? activeClipValue
            : DEFAULT_ANIMATED3D_PREFERENCES.activeClip,
        speed: SPEEDS.includes(speedValue) ? speedValue : DEFAULT_ANIMATED3D_PREFERENCES.speed,
        showBones: candidate.showBones === true,
        clay: candidate.clay === true,
        rootMotionPreview: candidate.rootMotionPreview === true,
        view
    };
}

function sanitizeAnimated3dBlockData(block) {
    if (!block || typeof block !== 'object') {
        return block;
    }
    block.packageRef = normalizeAnimated3dPackageReference(block.packageRef || block.manifestRef);
    block.preferences = normalizeAnimated3dPreferences(block.preferences);
    [
        'manifestRef',
        'assetName',
        'poster',
        'manifest',
        'model',
        'modelPath',
        'sourcePath',
        'runtime',
        'runtimeState',
        'viewer',
        'renderer',
        'scene',
        'camera',
        'controls',
        'mixer',
        'animationRuntime',
        'active',
        'isActive',
        'isPlaying',
        'title'
    ].forEach((key) => delete block[key]);
    return block;
}

function isAnimated3dExtension(extension) {
    return String(extension || '').trim().toLowerCase() === MODEL_SUFFIX;
}

function isExcludedAnimated3dExtension(extension) {
    return String(extension || '').trim().toLowerCase() === '.gltf';
}

function sourceNameForManifest(value) {
    const raw = path.basename(String(value || '').trim());
    const stem = raw.replace(/\.[^.]+$/, '').trim().replace(/\s+/g, ' ');
    return (stem || 'Animated model').slice(0, 96);
}

function escapeXml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
    }[character]));
}

function buildPosterSvg(displayName) {
    const title = escapeXml(displayName || 'Animated model');
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="Animated 3D model preview pending">',
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#121822"/><stop offset="1" stop-color="#291b38"/></linearGradient></defs>',
        '<rect width="960" height="540" fill="url(#bg)"/>',
        '<text x="480" y="260" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="700" text-anchor="middle">' + title + '</text>',
        '<text x="480" y="302" fill="#d5b8ff" font-family="Segoe UI, Arial, sans-serif" font-size="17" letter-spacing="2" text-anchor="middle">PREPARING FIRST-FRAME PREVIEW</text>',
        '</svg>'
    ].join('');
}

function buildCapturedPosterSvg(imageDataUrl, width, height, displayName) {
    if (!/^data:image\/(?:jpeg|png);base64,[a-z0-9+/=]+$/i.test(String(imageDataUrl || ''))) {
        throw new Error('Captured 3D poster image is invalid');
    }
    const safeWidth = Math.max(1, Math.round(Number(width) || 1));
    const safeHeight = Math.max(1, Math.round(Number(height) || 1));
    const label = escapeXml(displayName || 'Animated model');
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="${label} first-frame preview" data-animated3d-poster="first-frame">`,
        '<rect width="100%" height="100%" fill="#1e1e22"/>',
        `<image width="${safeWidth}" height="${safeHeight}" href="${imageDataUrl}" preserveAspectRatio="xMidYMid meet"/>`,
        '</svg>'
    ].join('');
}

function isCapturedPosterSvg(contents) {
    return String(contents || '').includes('data-animated3d-poster="first-frame"');
}

function assertGlbHeader(header, expectedLength) {
    if (!Buffer.isBuffer(header) || header.length < 12) {
        throw new Error('GLB file is too small');
    }
    if (header.readUInt32LE(0) !== GLB_MAGIC) {
        throw new Error('Only binary GLB files can be imported');
    }
    if (header.readUInt32LE(4) !== GLB_VERSION) {
        throw new Error('Only GLB version 2 files can be imported');
    }
    const declaredLength = header.readUInt32LE(8);
    if (!Number.isSafeInteger(expectedLength) || expectedLength < 12 || declaredLength !== expectedLength) {
        throw new Error('GLB file length is invalid');
    }
}

function ensureGlbSourceName(sourceName) {
    if (!isAnimated3dExtension(path.extname(String(sourceName || '')))) {
        throw new Error('Only single-file .glb animation packages can be imported');
    }
}

function normalizeSource(source) {
    if (typeof source === 'string') {
        return { path: source.trim(), name: source.trim(), arrayBuffer: null };
    }
    const value = source && typeof source === 'object' ? source : {};
    const sourcePath = typeof value.path === 'string' ? value.path.trim() : '';
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : sourcePath;
    return {
        path: sourcePath,
        name,
        arrayBuffer: typeof value.arrayBuffer === 'function' ? () => value.arrayBuffer() : null
    };
}

function asBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new Error('GLB source is unreadable');
}

function tempPath(modelsDir) {
    return path.join(modelsDir, `.${PACKAGE_PREFIX}stage-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
}

async function copySourceFileToTemp(sourcePath, destinationPath) {
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
        const read = fs.createReadStream(sourcePath);
        const write = fs.createWriteStream(destinationPath, { flags: 'wx' });
        let settled = false;
        const finish = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            if (error) {
                read.destroy();
                write.destroy();
                reject(error);
                return;
            }
            resolve();
        };
        read.on('data', (chunk) => hash.update(chunk));
        read.once('error', finish);
        write.once('error', finish);
        write.once('finish', () => finish());
        read.pipe(write);
    });
    return hash.digest('hex');
}

async function moveTempIntoPlace(tempFile, destinationPath) {
    try {
        await fs.promises.link(tempFile, destinationPath);
        await fs.promises.unlink(tempFile);
        return true;
    } catch (error) {
        if (error?.code === 'EEXIST') {
            try {
                await fs.promises.unlink(tempFile);
            } catch {}
            return false;
        }
        if (error?.code !== 'EPERM' && error?.code !== 'EXDEV' && error?.code !== 'EOPNOTSUPP') {
            try {
                await fs.promises.unlink(tempFile);
            } catch {}
            throw error;
        }
    }
    try {
        await fs.promises.copyFile(tempFile, destinationPath, fs.constants.COPYFILE_EXCL);
        return true;
    } catch (error) {
        if (error?.code === 'EEXIST') {
            return false;
        }
        throw error;
    } finally {
        try {
            await fs.promises.unlink(tempFile);
        } catch {}
    }
}

async function writeTextIfMissing(destinationPath, contents) {
    const stagedPath = `${destinationPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.promises.writeFile(stagedPath, contents, { encoding: 'utf8', flag: 'wx' });
    return moveTempIntoPlace(stagedPath, destinationPath);
}

function resolveManagedPath(assetsDir, assetRef) {
    const root = path.resolve(String(assetsDir || ''));
    if (!root || !assetRef) {
        return '';
    }
    const candidate = path.resolve(root, assetRef.replace(/\//g, path.sep));
    const relative = path.relative(root, candidate);
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return '';
    }
    return candidate;
}

function buildManifest(packagePaths, sourceName, sha256, byteLength, createdAt) {
    return {
        schemaVersion: PACKAGE_SCHEMA_VERSION,
        kind: PACKAGE_KIND,
        packageRef: packagePaths.packageRef,
        modelRef: packagePaths.modelRef,
        posterRef: packagePaths.posterRef,
        sourceName,
        sha256,
        byteLength,
        createdAt
    };
}

function validateManifest(manifest, packagePaths) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return null;
    }
    if (manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION || manifest.kind !== PACKAGE_KIND) {
        return null;
    }
    if (manifest.packageRef !== packagePaths.packageRef || manifest.modelRef !== packagePaths.modelRef || manifest.posterRef !== packagePaths.posterRef) {
        return null;
    }
    if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
        return null;
    }
    if (!Number.isSafeInteger(manifest.byteLength) || manifest.byteLength < 12) {
        return null;
    }
    const sourceName = sourceNameForManifest(manifest.sourceName);
    if (!sourceName) {
        return null;
    }
    return {
        schemaVersion: PACKAGE_SCHEMA_VERSION,
        kind: PACKAGE_KIND,
        packageRef: packagePaths.packageRef,
        modelRef: packagePaths.modelRef,
        posterRef: packagePaths.posterRef,
        sourceName,
        sha256: manifest.sha256.toLowerCase(),
        byteLength: manifest.byteLength,
        createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : ''
    };
}

async function stageAnimated3dPackage(source, options = {}) {
    const assetsDir = typeof options.assetsDir === 'string' ? options.assetsDir.trim() : '';
    if (!assetsDir) {
        throw new Error('Board Studio assets directory is required');
    }
    const descriptor = normalizeSource(source);
    ensureGlbSourceName(descriptor.name || descriptor.path);
    const modelsDir = path.join(path.resolve(assetsDir), MODELS_DIRECTORY);
    await fs.promises.mkdir(modelsDir, { recursive: true });

    const stagedModel = tempPath(modelsDir);
    let sha256 = '';
    let byteLength = 0;
    try {
        if (descriptor.path) {
            const sourcePath = path.resolve(descriptor.path);
            const sourceStats = await fs.promises.stat(sourcePath);
            if (!sourceStats.isFile()) {
                throw new Error('GLB source is not a file');
            }
            byteLength = sourceStats.size;
            const handle = await fs.promises.open(sourcePath, 'r');
            try {
                const header = Buffer.alloc(12);
                const { bytesRead } = await handle.read(header, 0, header.length, 0);
                assertGlbHeader(header.subarray(0, bytesRead), byteLength);
            } finally {
                await handle.close();
            }
            sha256 = await copySourceFileToTemp(sourcePath, stagedModel);
        } else if (descriptor.arrayBuffer) {
            const buffer = asBuffer(await descriptor.arrayBuffer());
            byteLength = buffer.byteLength;
            assertGlbHeader(buffer.subarray(0, 12), byteLength);
            sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            await fs.promises.writeFile(stagedModel, buffer, { flag: 'wx' });
        } else {
            throw new Error('GLB source is unavailable');
        }

        const packagePaths = packagePathsForReference(`${MODELS_DIRECTORY}/${PACKAGE_PREFIX}${sha256}${MANIFEST_SUFFIX}`);
        if (!packagePaths) {
            throw new Error('Unable to create GLB package reference');
        }
        const modelPath = resolveManagedPath(assetsDir, packagePaths.modelRef);
        const posterPath = resolveManagedPath(assetsDir, packagePaths.posterRef);
        const manifestPath = resolveManagedPath(assetsDir, packagePaths.packageRef);
        const createdPaths = [];
        try {
            const modelCreated = await moveTempIntoPlace(stagedModel, modelPath);
            if (modelCreated) {
                createdPaths.push(modelPath);
            }
            const sourceName = sourceNameForManifest(descriptor.name || descriptor.path);
            const posterCreated = await writeTextIfMissing(posterPath, buildPosterSvg(sourceName));
            if (posterCreated) {
                createdPaths.push(posterPath);
            }
            const manifest = buildManifest(packagePaths, sourceName, sha256, byteLength, options.createdAt || new Date().toISOString());
            const manifestCreated = await writeTextIfMissing(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
            if (manifestCreated) {
                createdPaths.push(manifestPath);
            }
            return {
                ...packagePaths,
                sourceName,
                sha256,
                byteLength,
                created: modelCreated || posterCreated || manifestCreated,
                createdFiles: { model: modelCreated, poster: posterCreated, manifest: manifestCreated }
            };
        } catch (error) {
            await Promise.all(createdPaths.reverse().map(async (filePath) => {
                try {
                    await fs.promises.unlink(filePath);
                } catch {}
            }));
            throw error;
        }
    } catch (error) {
        try {
            await fs.promises.unlink(stagedModel);
        } catch {}
        throw error;
    }
}

function resolveAnimated3dPackage(packageRef, options = {}) {
    const packagePaths = packagePathsForReference(packageRef);
    const assetsDir = typeof options.assetsDir === 'string' ? options.assetsDir.trim() : '';
    if (!packagePaths || !assetsDir) {
        return { ok: false, reason: 'invalid-package-reference' };
    }
    const manifestPath = resolveManagedPath(assetsDir, packagePaths.packageRef);
    const modelPath = resolveManagedPath(assetsDir, packagePaths.modelRef);
    const posterPath = resolveManagedPath(assetsDir, packagePaths.posterRef);
    if (!manifestPath || !modelPath || !posterPath || !fs.existsSync(manifestPath)) {
        return { ok: false, reason: 'missing-manifest', ...packagePaths };
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return { ok: false, reason: 'invalid-manifest', ...packagePaths };
    }
    const manifest = validateManifest(parsed, packagePaths);
    if (!manifest) {
        return { ok: false, reason: 'invalid-manifest', ...packagePaths };
    }
    if (!fs.existsSync(modelPath)) {
        return { ok: false, reason: 'missing-model', ...packagePaths, manifest };
    }
    if (!fs.existsSync(posterPath)) {
        return { ok: false, reason: 'missing-poster', ...packagePaths, manifest };
    }
    return {
        ok: true,
        ...packagePaths,
        manifest,
        manifestPath,
        modelPath,
        posterPath,
        displayName: manifest.sourceName
    };
}

function describeAnimated3dPackageFailure(reason) {
    switch (reason) {
        case 'missing-manifest':
            return '3D package manifest is missing';
        case 'missing-model':
            return '3D package GLB is missing';
        case 'missing-poster':
            return '3D package poster is missing';
        case 'invalid-manifest':
            return '3D package manifest is invalid';
        default:
            return '3D package is unavailable';
    }
}

module.exports = {
    PACKAGE_SCHEMA_VERSION,
    PACKAGE_KIND,
    MODELS_DIRECTORY,
    DEFAULT_ANIMATED3D_PREFERENCES,
    CAMERA_VIEWS,
    SPEEDS,
    normalizeAnimated3dPackageReference,
    getAnimated3dPackageReferences,
    normalizeAnimated3dPreferences,
    sanitizeAnimated3dBlockData,
    isAnimated3dExtension,
    isExcludedAnimated3dExtension,
    stageAnimated3dPackage,
    resolveAnimated3dPackage,
    describeAnimated3dPackageFailure,
    buildPosterSvg,
    buildCapturedPosterSvg,
    isCapturedPosterSvg,
    assertGlbHeader
};
