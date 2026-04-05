'use strict';

// MARK: MODULE
module.exports = function createPaintImageIoModule(deps) {
    const {
        env,
        launchTargets,
        MAX_CANVAS_DIMENSION
    } = deps;

    async function loadImageForAsset(assetName) {
        const src = env.blocks.image.resolveImageAssetUrl(assetName);
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = src;
        try {
            await img.decode();
        } catch {}
        if (!img.naturalWidth || !img.naturalHeight) {
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = (error) => reject(error);
            });
        }
        return img;
    }

    async function loadImageForPath(filePath) {
        const resolved = typeof filePath === 'string' ? filePath.trim() : '';
        if (!resolved) {
            throw new Error('File path missing');
        }
        const src = `${env.utils.toFileUrl(resolved)}?v=${Date.now()}`;
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = src;
        try {
            await img.decode();
        } catch {}
        if (!img.naturalWidth || !img.naturalHeight) {
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = (error) => reject(error);
            });
        }
        return img;
    }

    function resolvePaintCanvasSize(img, block) {
        const imgWidth = Math.max(1, Number(img?.naturalWidth) || 1);
        const imgHeight = Math.max(1, Number(img?.naturalHeight) || 1);
        const blockWidth = Number(block?.width);
        const blockHeight = Number(block?.height);
        if (!Number.isFinite(blockWidth) || !Number.isFinite(blockHeight) || blockWidth <= 0 || blockHeight <= 0) {
            return { width: imgWidth, height: imgHeight };
        }
        const targetRatio = blockWidth / blockHeight;
        if (!Number.isFinite(targetRatio) || targetRatio <= 0) {
            return { width: imgWidth, height: imgHeight };
        }
        const imgRatio = imgWidth / imgHeight;
        if (Math.abs(targetRatio - imgRatio) < 0.005) {
            return { width: imgWidth, height: imgHeight };
        }
        const area = imgWidth * imgHeight;
        let targetWidth = Math.round(Math.sqrt(area * targetRatio));
        let targetHeight = Math.round(targetWidth / targetRatio);
        if (targetWidth < 1 || targetHeight < 1) {
            return { width: imgWidth, height: imgHeight };
        }
        const scale = Math.min(1, MAX_CANVAS_DIMENSION / targetWidth, MAX_CANVAS_DIMENSION / targetHeight);
        if (scale < 1) {
            targetWidth = Math.max(1, Math.round(targetWidth * scale));
            targetHeight = Math.max(1, Math.round(targetHeight * scale));
        }
        return { width: targetWidth, height: targetHeight };
    }

    function resolvePaintTargetForBlock(block, boardId) {
        const linkedTarget = block?.twoDLink && typeof block.twoDLink === 'object'
            ? block.twoDLink
            : null;
        if (linkedTarget && linkedTarget.assetId) {
            return launchTargets.normalizePaintLaunchTarget({
                ...linkedTarget,
                boardId,
                blockId: String(block?.id || '').trim(),
                source: 'board-image-link'
            });
        }
        const temporaryTarget = block?.tempTwoDLink && typeof block.tempTwoDLink === 'object'
            ? block.tempTwoDLink
            : null;
        if (temporaryTarget && temporaryTarget.assetId) {
            return launchTargets.normalizePaintLaunchTarget({
                ...temporaryTarget,
                boardId,
                blockId: String(block?.id || '').trim(),
                source: 'board-image-temp'
            });
        }
        return launchTargets.normalizePaintLaunchTarget({
            mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
            boardId,
            blockId: String(block?.id || '').trim(),
            source: 'board-image'
        });
    }

    return {
        loadImageForAsset,
        loadImageForPath,
        resolvePaintCanvasSize,
        resolvePaintTargetForBlock
    };
};
