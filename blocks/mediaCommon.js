'use strict';

// MARK: MEDIA BLOCK SHARED HELPERS
const { pathToFileURL } = require('url');
const env = require('../core/state');
const { fs, path, data, utils } = env;

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const MULTI_SEPARATOR_PATTERN = /[\s_-]+/g;
const LEADING_TRAILING_SEPARATORS = /^[-_.]+|[-_.]+$/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const MAX_FILENAME_LENGTH = 80;

function resolveAssetTargetPath(assetName) {
	if (!assetName) {
		return '';
	}
	if (typeof data.resolveAssetTargetPath === 'function') {
		const resolved = data.resolveAssetTargetPath(assetName);
		if (resolved) {
			return resolved;
		}
	}
	const normalized = String(assetName).replace(/\\/g, '/');
	return path.join(env.paths.assetsDir, normalized.replace(/\//g, path.sep));
}

function resolveExistingAssetPath(assetName, options = {}) {
	if (!assetName) {
		return '';
	}
	if (typeof data.findAssetFilePath === 'function') {
		const located = data.findAssetFilePath(assetName, options);
		if (located) {
			return located;
		}
	}
	const target = resolveAssetTargetPath(assetName);
	if (target && fs.existsSync(target)) {
		return target;
	}
	return '';
}

function invalidateAssetIndex() {
	if (typeof data.invalidateAssetIndex === 'function') {
		data.invalidateAssetIndex();
	}
}

function ensureMediaDirectories() {
	data.ensureDataDirectories();
	if (!fs.existsSync(env.paths.audioDir)) {
		fs.mkdirSync(env.paths.audioDir, { recursive: true });
	}
	if (!fs.existsSync(env.paths.videoDir)) {
		fs.mkdirSync(env.paths.videoDir, { recursive: true });
	}
}

function sanitizeTitle(filePath) {
	const base = path.basename(filePath || '').trim();
	if (!base) {
		return 'Untitled';
	}
	const index = base.lastIndexOf('.');
	if (index <= 0) {
		return base;
	}
	return base.slice(0, index);
}

function generateAssetName(category, extension) {
	const safeExtension = extension && extension.startsWith('.') ? extension.toLowerCase() : '.bin';
	const id = utils.createId(category);
	return `${category}/${id}${safeExtension}`;
}

function resolveTitleSource(source) {
	if (!source) {
		return '';
	}
	if (typeof source === 'string') {
		return source;
	}
	if (typeof source.name === 'string' && source.name.trim()) {
		return source.name;
	}
	if (typeof source.path === 'string') {
		return source.path;
	}
	return '';
}

function resolveMediaSource(source) {
	if (!source) {
		return {
			path: '',
			name: '',
			extension: '',
			arrayBuffer: null
		};
	}
	if (typeof source === 'string') {
		const trimmed = source.trim();
		return {
			path: trimmed,
			name: trimmed,
			extension: path.extname(trimmed),
			arrayBuffer: null
		};
	}
	const resolvedPath = typeof source.path === 'string' ? source.path.trim() : '';
	const resolvedName = typeof source.name === 'string' ? source.name : resolvedPath;
	const extension = path.extname(resolvedName || resolvedPath);
	const hasArrayBuffer = typeof source.arrayBuffer === 'function';
	return {
		path: resolvedPath,
		name: resolvedName,
		extension,
		arrayBuffer: hasArrayBuffer ? () => source.arrayBuffer() : null
	};
}

async function copyMediaAsset(sourcePath, category) {
	ensureMediaDirectories();
	const normalizedPath = typeof sourcePath === 'string' ? sourcePath.trim() : '';
	if (!normalizedPath || !fs.existsSync(normalizedPath)) {
		const error = new Error('media-source-missing');
		error.code = 'MEDIA_SOURCE_MISSING';
		throw error;
	}
	const extension = path.extname(normalizedPath || '').toLowerCase();
	const assetName = generateAssetName(category, extension);
	const targetPath = resolveAssetTargetPath(assetName);
	try {
		await fs.promises.copyFile(normalizedPath, targetPath);
	} catch (error) {
		if (!error.code) {
			error.code = 'MEDIA_COPY_FAILED';
		}
		throw error;
	}
	invalidateAssetIndex();
	return assetName;
}

async function stageMediaAsset(source, category) {
	ensureMediaDirectories();
	const descriptor = resolveMediaSource(source);
	if (descriptor.path && fs.existsSync(descriptor.path)) {
		const asset = await copyMediaAsset(descriptor.path, category);
		console.info('Media asset staged from path', { category, assetName: asset, source: descriptor.path });
		return asset;
	}
	if (descriptor.arrayBuffer) {
		try {
			const buffer = await descriptor.arrayBuffer();
			const assetName = generateAssetName(category, descriptor.extension);
			const targetPath = resolveAssetTargetPath(assetName);
			await fs.promises.writeFile(targetPath, Buffer.from(buffer));
			console.info('Media asset staged from buffer', { category, assetName });
			invalidateAssetIndex();
			return assetName;
		} catch (error) {
			if (!error.code) {
				error.code = 'MEDIA_COPY_FAILED';
			}
			throw error;
		}
	}
	const error = new Error('media-source-missing');
	error.code = 'MEDIA_SOURCE_MISSING';
	throw error;
}

function resolveAssetFilePath(assetName) {
	return resolveAssetTargetPath(assetName);
}

function sanitizeFilenameComponent(value, fallback) {
	const raw = typeof value === 'string' ? value : '';
	const normalized = raw.normalize('NFKD').replace(COMBINING_MARKS, '');
	const stripped = normalized.replace(INVALID_FILENAME_CHARS, ' ');
	let filtered = stripped.replace(/[^A-Za-z0-9 _.-]+/g, ' ');
	filtered = filtered.trim().replace(MULTI_SEPARATOR_PATTERN, '-').replace(LEADING_TRAILING_SEPARATORS, '');
	if (!filtered) {
		const alt = typeof fallback === 'string' ? fallback : '';
		return alt.toLowerCase();
	}
	return filtered.slice(0, MAX_FILENAME_LENGTH).toLowerCase();
}

function ensureUniqueAssetName(category, base, extension, currentAssetName) {
	let safeBase = sanitizeFilenameComponent(base, category);
	const safeExtension = extension && extension.startsWith('.') ? extension.toLowerCase() : '';
	if (safeExtension && safeBase.endsWith(safeExtension)) {
		safeBase = safeBase.slice(0, safeBase.length - safeExtension.length);
	}
	if (safeExtension && safeBase.endsWith('.')) {
		safeBase = safeBase.slice(0, -1);
	}
	safeBase = safeBase.replace(LEADING_TRAILING_SEPARATORS, '');
	if (!safeBase) {
		safeBase = category;
	}
	const normalizedCurrent = (currentAssetName || '').toLowerCase();
	let candidateBase = safeBase || category;
	let attempt = 0;
	let candidate;
	do {
		const suffix = attempt === 0 ? '' : `-${attempt}`;
		candidate = `${category}/${candidateBase}${suffix}${safeExtension}`;
		attempt += 1;
		if (candidate.toLowerCase() === normalizedCurrent) {
			return currentAssetName;
		}
	} while (fs.existsSync(resolveAssetFilePath(candidate)));
	return candidate;
}

async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(currentPath, nextPath, attempts = 3) {
    const parentDir = path.dirname(nextPath);
    try {
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
    } catch {}
    for (let i = 0; i < attempts; i += 1) {
        try {
            await fs.promises.rename(currentPath, nextPath);
            return true;
        } catch (error) {
            // If post-condition already holds, treat as success
            try {
                const nextExists = fs.existsSync(nextPath);
                const currExists = fs.existsSync(currentPath);
                if (nextExists && !currExists) {
                    return true;
                }
            } catch {}
            if (i < attempts - 1) {
                await wait(80);
                continue;
            }
            throw error;
        }
    }
    return false;
}

async function renameBlockAsset(block, title, options = {}) {
	if (!block || !block.assetName) {
		return { renamed: false, assetName: block?.assetName || '' };
	}
	const category = options.category || (block.type === 'audio' ? 'audio' : block.type === 'video' ? 'video' : null);
	if (!category) {
		return { renamed: false, assetName: block.assetName };
	}
	ensureMediaDirectories();
	const currentAssetName = block.assetName;
	const extension = path.extname(currentAssetName) || '';
	const desiredName = ensureUniqueAssetName(category, title, extension, currentAssetName);
	if (!desiredName || desiredName === currentAssetName) {
		return { renamed: false, assetName: currentAssetName };
	}
    const currentExistingPath = resolveExistingAssetPath(currentAssetName, { type: category });
    const currentPath = currentExistingPath || resolveAssetFilePath(currentAssetName);
    const nextPath = resolveAssetFilePath(desiredName);
    try {
        if (!currentPath || !fs.existsSync(currentPath)) {
            throw new Error('media-source-missing');
        }
        const ok = await renameWithRetry(currentPath, nextPath, 4);
        if (!ok) {
            throw new Error('media-rename-failed');
        }
        block.assetName = desiredName;
        if (typeof options.afterRename === 'function') {
            options.afterRename({ block, previous: currentAssetName, next: desiredName });
        }
        console.info('Media asset renamed', { blockId: block.id, type: block.type, from: currentAssetName, to: desiredName });
        invalidateAssetIndex();
        return { renamed: true, assetName: desiredName };
    } catch (error) {
        // If the move actually happened, accept success
        try {
            const nextExists = fs.existsSync(nextPath);
            const currExists = currentPath ? fs.existsSync(currentPath) : false;
            if (nextExists && !currExists) {
                block.assetName = desiredName;
                if (typeof options.afterRename === 'function') {
                    options.afterRename({ block, previous: currentAssetName, next: desiredName });
                }
                console.warn('Media rename reported error but post-check passed', { blockId: block.id, from: currentAssetName, to: desiredName });
                invalidateAssetIndex();
                return { renamed: true, assetName: desiredName };
            }
        } catch {}
        console.error('Failed to rename media asset', { blockId: block.id, error });
        throw error;
    }
}

function makeMediaPath(assetName) {
	if (!assetName) {
		return '';
	}
	const absolute = resolveExistingAssetPath(assetName) || resolveAssetTargetPath(assetName);
	if (!absolute) {
		return '';
	}
	try {
		return pathToFileURL(absolute).href;
	} catch (error) {
		console.error('Failed to create media file URL', error);
		return `file://${absolute.replace(/\\/g, '/')}`;
	}
}

module.exports = {
	ensureMediaDirectories,
	sanitizeTitle,
	generateAssetName,
	resolveTitleSource,
	resolveMediaSource,
	stageMediaAsset,
	resolveAssetFilePath,
	resolveExistingAssetPath,
	sanitizeFilenameComponent,
	ensureUniqueAssetName,
	renameBlockAsset,
	makeMediaPath
};
