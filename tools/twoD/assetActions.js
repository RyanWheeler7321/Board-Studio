'use strict';

const env = require('../../core/state');
const projectStore = require('./projectStore');
const launchTargets = require('./paintLaunchTarget');

const { fs, path } = env;

function appendAssetActionLog(scope, payload = {}) {
    try {
        const logDir = path.join(env.paths.baseDir, '..', 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, 'workboard_paint.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logPath, `[${timestamp}] assetActions.${scope} ${JSON.stringify(payload)}\n`, 'utf8');
    } catch {}
}

function createCanvasBuffer(width, height) {
    appendAssetActionLog('createCanvasBuffer.begin', { width, height });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return new Promise((resolve, reject) => {
        canvas.toBlob(async (blob) => {
            if (!blob) {
                appendAssetActionLog('createCanvasBuffer.failed', { width, height });
                reject(new Error('Unable to create blank canvas image'));
                return;
            }
            const buffer = Buffer.from(await blob.arrayBuffer());
            appendAssetActionLog('createCanvasBuffer.complete', { width, height, bytes: buffer.length });
            resolve(buffer);
        }, 'image/png');
    });
}

function buildStillOpenTarget(asset, absolutePath = '') {
    return launchTargets.normalizePaintLaunchTarget({
        mode: launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL,
        assetId: asset?.id || '',
        filePath: absolutePath || projectStore.resolvePreferredPaintFilePath(asset),
        source: 'asset-actions'
    });
}

function clampAssetCanvasDimension(value, fallback = 1024) {
    return Math.max(1, Math.min(8192, Math.round(Number(value) || fallback)));
}

async function createBlankAssetProject(options = {}) {
    appendAssetActionLog('createBlankAssetProject.begin', {
        name: String(options.name || '').trim(),
        type: String(options.type || '').trim(),
        width: options.width,
        height: options.height
    });
    const width = clampAssetCanvasDimension(options.width, 1024);
    const height = clampAssetCanvasDimension(options.height, 1024);
    const asset = projectStore.createAsset(String(options.type || 'concept').trim() || 'concept', {
        name: String(options.name || '').trim() || 'Untitled Project'
    }, 'asset2d-create-blank');
    appendAssetActionLog('createBlankAssetProject.assetCreated', {
        assetId: asset?.id || '',
        assetName: asset?.name || '',
        assetDir: projectStore.resolveAssetDir(asset?.id || '')
    });
    const buffer = await createCanvasBuffer(width, height);
    const relative = projectStore.writeBufferToAsset(asset.id, 'still/working/current.png', buffer);
    appendAssetActionLog('createBlankAssetProject.bufferWritten', {
        assetId: asset.id,
        relativePath: relative,
        absolutePath: projectStore.resolveAssetPath(asset, relative)
    });
    const updated = projectStore.updateAsset(asset.id, (draft) => {
        draft.still.workingImagePath = relative;
        draft.still.approvedImagePath = relative;
        draft.still.sourceImages = [relative];
        return draft;
    }, 'asset2d-create-blank');
    appendAssetActionLog('createBlankAssetProject.complete', {
        assetId: updated?.id || '',
        absolutePath: projectStore.resolveAssetPath(updated, relative),
        launchTarget: buildStillOpenTarget(updated)
    });
    return {
        asset: updated,
        absolutePath: projectStore.resolveAssetPath(updated, relative),
        launchTarget: buildStillOpenTarget(updated)
    };
}

async function importStillImageAsset(sourcePath, options = {}) {
    const resolvedSource = String(sourcePath || '').trim();
    appendAssetActionLog('importStillImageAsset.begin', {
        sourcePath: resolvedSource,
        name: String(options.name || '').trim(),
        type: String(options.type || '').trim()
    });
    if (!resolvedSource) {
        throw new Error('Source image path is required');
    }
    const name = String(options.name || '').trim() || path.basename(resolvedSource, path.extname(resolvedSource));
    const asset = projectStore.createAsset(String(options.type || 'concept').trim() || 'concept', { name }, 'asset2d-import-image');
    const sourceRelative = projectStore.copyFileToAsset(asset.id, resolvedSource, 'still/source');
    const workingRelative = projectStore.copyFileToAsset(asset.id, resolvedSource, 'still/working', 'current.png');
    const updated = projectStore.updateAsset(asset.id, (draft) => {
        draft.still.sourceImages = [sourceRelative];
        draft.still.workingImagePath = workingRelative;
        draft.still.approvedImagePath = workingRelative;
        return draft;
    }, 'asset2d-import-image');
    appendAssetActionLog('importStillImageAsset.complete', {
        assetId: updated?.id || '',
        sourceRelative,
        workingRelative,
        absolutePath: projectStore.resolveAssetPath(updated, workingRelative)
    });
    return {
        asset: updated,
        absolutePath: projectStore.resolveAssetPath(updated, workingRelative),
        launchTarget: buildStillOpenTarget(updated)
    };
}

async function createStillImageAssetFromBuffer(buffer, options = {}) {
    appendAssetActionLog('createStillImageAssetFromBuffer.begin', {
        bytes: Buffer.isBuffer(buffer) ? buffer.length : 0,
        name: String(options.name || '').trim(),
        width: options.width,
        height: options.height,
        sourceExt: String(options.sourceExt || '')
    });
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Image buffer is required');
    }
    const width = clampAssetCanvasDimension(options.width, 1024);
    const height = clampAssetCanvasDimension(options.height, 1024);
    const asset = projectStore.createAsset(String(options.type || 'concept').trim() || 'concept', {
        name: String(options.name || '').trim() || 'Untitled Project'
    }, 'asset2d-import-buffer');
    const sourceExt = String(options.sourceExt || 'png').trim().replace(/^\./, '') || 'png';
    const sourceRelative = projectStore.writeBufferToAsset(asset.id, `still/source/original.${sourceExt}`, buffer);
    const workingRelative = projectStore.writeBufferToAsset(asset.id, 'still/working/current.png', buffer);
    const updated = projectStore.updateAsset(asset.id, (draft) => {
        draft.still.sourceImages = [sourceRelative];
        draft.still.workingImagePath = workingRelative;
        draft.still.approvedImagePath = workingRelative;
        draft.still.width = width;
        draft.still.height = height;
        return draft;
    }, 'asset2d-import-buffer');
    appendAssetActionLog('createStillImageAssetFromBuffer.complete', {
        assetId: updated?.id || '',
        sourceRelative,
        workingRelative,
        absolutePath: projectStore.resolveAssetPath(updated, workingRelative)
    });
    return {
        asset: updated,
        absolutePath: projectStore.resolveAssetPath(updated, workingRelative),
        launchTarget: buildStillOpenTarget(updated)
    };
}

async function importAnimationSheetAsset(assetId, sourcePath, options = {}) {
    const resolvedSource = String(sourcePath || '').trim();
    appendAssetActionLog('importAnimationSheetAsset.begin', {
        assetId,
        sourcePath: resolvedSource,
        name: String(options.name || '').trim()
    });
    if (!assetId || !resolvedSource) {
        throw new Error('Asset id and source sheet path are required');
    }
    const asset = projectStore.getAsset(assetId);
    if (!asset) {
        throw new Error('Asset not found');
    }
    const animation = projectStore.createAnimation(assetId, {
        name: String(options.name || '').trim() || `${path.basename(resolvedSource, path.extname(resolvedSource))} Animation`
    }, 'asset2d-animation-import');
    const sourceSheetPath = projectStore.copyFileToAsset(assetId, resolvedSource, `animations/${animation.id}/source`, 'sheet.png');
    projectStore.updateAnimation(assetId, animation.id, (draft, parent) => {
        draft.sourceSheetPath = sourceSheetPath;
        draft.starterImagePath = parent.still.approvedImagePath || parent.still.workingImagePath || parent.still.sourceImages?.[0] || '';
        draft.motionPrompt = draft.motionPrompt || parent.still.prompt || '';
        return draft;
    }, 'asset2d-animation-import');
    const updatedAsset = projectStore.getAsset(assetId);
    const updatedAnimation = updatedAsset?.animations?.[animation.id] || animation;
    const absolutePath = projectStore.resolveAssetPath(updatedAsset, updatedAnimation.sourceSheetPath || updatedAnimation.starterImagePath || '');
    appendAssetActionLog('importAnimationSheetAsset.complete', {
        assetId,
        animationId: updatedAnimation?.id || '',
        absolutePath
    });
    return {
        asset: updatedAsset,
        animation: updatedAnimation,
        absolutePath,
        launchTarget: launchTargets.normalizePaintLaunchTarget({
            mode: launchTargets.PAINT_LAUNCH_MODES.ANIMATION_SHEET,
            assetId,
            animationId: updatedAnimation.id,
            filePath: absolutePath,
            source: 'asset-actions'
        })
    };
}

async function duplicateAssetProject(assetId, options = {}) {
    appendAssetActionLog('duplicateAssetProject.begin', {
        assetId,
        name: String(options.name || '').trim()
    });
    const asset = projectStore.duplicateAsset(assetId, options, 'asset2d-duplicate');
    if (!asset) {
        throw new Error('Asset not found');
    }
    const launchTarget = projectStore.resolveLastOpenedTarget(asset.id);
    const absolutePath = projectStore.resolvePreferredPaintFilePath(asset, launchTarget);
    appendAssetActionLog('duplicateAssetProject.complete', {
        assetId: asset.id,
        absolutePath,
        launchTarget
    });
    return {
        asset,
        absolutePath,
        launchTarget
    };
}

function buildBoardImageLinkTarget(block, target = {}) {
    const boardId = String(env.state.currentBoardId || '').trim();
    return launchTargets.normalizePaintLaunchTarget({
        ...target,
        boardId,
        blockId: String(block?.id || '').trim()
    });
}

module.exports = {
    createBlankAssetProject,
    createStillImageAssetFromBuffer,
    importStillImageAsset,
    importAnimationSheetAsset,
    duplicateAssetProject,
    buildStillOpenTarget,
    buildBoardImageLinkTarget
};
