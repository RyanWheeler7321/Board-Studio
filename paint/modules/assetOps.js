'use strict';

// MARK: MODULE
module.exports = function createPaintAssetOpsModule(deps) {
    const {
        env,
        utils,
        assetActions,
        launchTargets,
        projectStore,
        getSession,
        logPaintTrace,
        resolveWorkspaceAsset,
        switchPaintFile,
        renderPaintWorkspaceUi,
        frameListForPaint,
        resolveFramePath,
        captureCurrentAnimationFrameState,
        persistLoadedTimelineStates,
        resolveSessionLaunchTarget,
        resolveAnimationUnityBinding,
        resolveEffectiveUnitySheetBinding,
        normalizeUnitySheetBindingConfig,
        normalizeAnimationUnityBindingConfig,
        exportCanvasToPngBuffer,
        loadImageForPath,
        promptForSheetGrid,
    } = deps;

    const session = new Proxy({}, {
        get(_target, prop) {
            return getSession()?.[prop];
        }
    });

    function unsupportedAutomation(message) {
        const error = new Error(message || 'This public build does not include automated generation tools.');
        utils.showToast?.(error.message);
        throw error;
    }

    function resolveSessionAnimationContext(asset = resolveWorkspaceAsset()) {
        if (!asset) {
            return { asset, animation: null, frame: null, frameIndex: -1 };
        }
        const launchTarget = resolveSessionLaunchTarget();
        if (launchTarget.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME && launchTarget.assetId === asset.id) {
            let animation = asset.animations?.[launchTarget.animationId] || null;
            let frames = Array.isArray(animation?.frames) ? frameListForPaint(animation) : [];
            let frameIndex = frames.findIndex((entry) => entry.id === launchTarget.frameId);
            let frame = frameIndex >= 0 ? (frames[frameIndex] || null) : null;
            if (!frame) {
                const animationEntries = Object.values(asset.animations || {});
                for (const candidateAnimation of animationEntries) {
                    const candidateFrames = frameListForPaint(candidateAnimation);
                    const candidateIndex = candidateFrames.findIndex((entry) => entry.id === launchTarget.frameId);
                    if (candidateIndex >= 0) {
                        animation = candidateAnimation;
                        frameIndex = candidateIndex;
                        frame = candidateFrames[candidateIndex] || null;
                        break;
                    }
                }
            }
            if (animation && frame) {
                return {
                    asset,
                    animation,
                    frame,
                    frameIndex
                };
            }
        }
        if (!session?.filePath) {
            const animations = Object.values(asset.animations || {});
            const activeAnimation = asset.activeAnimationId && asset.animations?.[asset.activeAnimationId]
                ? asset.animations[asset.activeAnimationId]
                : (animations[0] || null);
            return { asset, animation: activeAnimation, frame: null, frameIndex: -1 };
        }
        const context = projectStore.findAssetContextByFilePath(session.filePath);
        if (context?.asset?.id === asset.id) {
            return {
                asset,
                animation: context.animation || null,
                frame: context.frame || null,
                frameIndex: Number.isFinite(Number(context.frameIndex)) ? Number(context.frameIndex) : -1
            };
        }
        const animations = Object.values(asset.animations || {});
        const activeAnimation = asset.activeAnimationId && asset.animations?.[asset.activeAnimationId]
            ? asset.animations[asset.activeAnimationId]
            : (animations[0] || null);
        return { asset, animation: activeAnimation, frame: null, frameIndex: -1 };
    }

    async function importBoundSpriteSheetInPaint(asset, animation = null) {
        if (!asset?.id) {
            throw new Error('Asset missing');
        }
        const effective = resolveEffectiveUnitySheetBinding(asset, animation);
        const binding = normalizeUnitySheetBindingConfig(effective.binding);
        const targetPath = String(binding.targetPath || '').trim();
        if (!targetPath) {
            throw new Error('Set a sprite sheet path first');
        }
        const resolvedPath = env.path.resolve(targetPath);
        if (!env.fs.existsSync(resolvedPath)) {
            throw new Error('Linked sprite sheet file not found');
        }
        const result = await assetActions.importAnimationSheetAsset(asset.id, resolvedPath, {
            name: `${env.path.basename(resolvedPath, env.path.extname(resolvedPath))} Animation`
        });
        const importedAsset = projectStore.getAsset(asset.id) || result?.asset || asset;
        const importedAnimation = result?.animation?.id
            ? (importedAsset.animations?.[result.animation.id] || result.animation)
            : null;
        if (!importedAnimation?.id) {
            throw new Error('Imported animation was not created');
        }
        projectStore.updateAsset(importedAsset.id, (draft) => {
            draft.activeAnimationId = importedAnimation.id;
            return draft;
        }, 'asset2d-unity-import-sheet-select');
        projectStore.updateAnimation(importedAsset.id, importedAnimation.id, (draft) => {
            draft.columns = Math.max(1, Number(binding.columns) || 1);
            draft.rows = Math.max(1, Number(binding.rows) || 1);
            draft.frameWidth = Math.max(0, Number(binding.frameWidth) || 0);
            draft.frameHeight = Math.max(0, Number(binding.frameHeight) || 0);
            draft.export = draft.export && typeof draft.export === 'object' ? draft.export : {};
            draft.export.unity = {
                ...normalizeAnimationUnityBindingConfig(draft.export.unity),
                useProjectBinding: false,
                enabled: true,
                targetPath: resolvedPath,
                columns: Math.max(1, Number(binding.columns) || 1),
                rows: Math.max(1, Number(binding.rows) || 1),
                frameWidth: Math.max(0, Number(binding.frameWidth) || 0),
                frameHeight: Math.max(0, Number(binding.frameHeight) || 0),
                downscale: Math.max(1, Number(binding.downscale) || 1)
            };
            return draft;
        }, 'asset2d-unity-import-sheet-bind');
        const refreshedAsset = projectStore.getAsset(importedAsset.id) || importedAsset;
        const refreshedAnimation = refreshedAsset.animations?.[importedAnimation.id] || importedAnimation;
        await sliceAnimationSheetInPaint(refreshedAsset, refreshedAnimation);
        return {
            asset: projectStore.getAsset(importedAsset.id) || refreshedAsset,
            animation: projectStore.getAsset(importedAsset.id)?.animations?.[importedAnimation.id] || refreshedAnimation
        };
    }

    async function updateUnitySpriteSheetInPaint(asset, animation) {
        if (!asset?.id || !animation?.id) {
            throw new Error('Animation missing');
        }
        const effective = resolveEffectiveUnitySheetBinding(asset, animation);
        const binding = normalizeUnitySheetBindingConfig(effective.binding);
        const targetPath = String(binding.targetPath || '').trim();
        if (!targetPath) {
            throw new Error('Set a sprite sheet path first');
        }
        const resolvedPath = env.path.resolve(targetPath);
        const frames = frameListForPaint(animation);
        if (!frames.length) {
            throw new Error('No frames available to export');
        }
        const slotCount = Math.max(1, Number(binding.columns) || 1) * Math.max(1, Number(binding.rows) || 1);
        if (frames.length > slotCount) {
            throw new Error(`Animation has ${frames.length} frames but the linked sheet only has ${slotCount} slots`);
        }
        const firstFrame = frames.find((entry) => !!resolveFramePath(entry));
        if (!firstFrame) {
            throw new Error('No frame images available to export');
        }
        const firstImage = await loadImageForPath(projectStore.resolveAssetPath(asset, resolveFramePath(firstFrame)));
        const baseFrameWidth = Math.max(1, Number(animation.frameWidth) || firstImage.naturalWidth || 1);
        const baseFrameHeight = Math.max(1, Number(animation.frameHeight) || firstImage.naturalHeight || 1);
        const downscale = Math.max(1, Number(binding.downscale) || 1);
        const frameWidth = Math.max(1, Number(binding.frameWidth) || Math.round(baseFrameWidth / downscale) || baseFrameWidth);
        const frameHeight = Math.max(1, Number(binding.frameHeight) || Math.round(baseFrameHeight / downscale) || baseFrameHeight);
        const columns = Math.max(1, Number(binding.columns) || 1);
        const rows = Math.max(1, Number(binding.rows) || 1);
        const canvas = document.createElement('canvas');
        canvas.width = columns * frameWidth;
        canvas.height = rows * frameHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            throw new Error('Could not build sprite sheet canvas');
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < frames.length; index += 1) {
            const frame = frames[index];
            const relativePath = resolveFramePath(frame);
            if (!relativePath) {
                continue;
            }
            const sourcePath = projectStore.resolveAssetPath(asset, relativePath);
            if (!sourcePath || !env.fs.existsSync(sourcePath)) {
                continue;
            }
            const image = await loadImageForPath(sourcePath);
            const x = (index % columns) * frameWidth;
            const y = Math.floor(index / columns) * frameHeight;
            ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x, y, frameWidth, frameHeight);
        }
        env.fs.mkdirSync(env.path.dirname(resolvedPath), { recursive: true });
        env.fs.writeFileSync(resolvedPath, await exportCanvasToPngBuffer(canvas));
        logPaintTrace('unity.updateSheet.complete', {
            assetId: asset.id,
            animationId: animation.id,
            targetPath: resolvedPath,
            width: canvas.width,
            height: canvas.height,
            frameCount: frames.length
        });
        return {
            targetPath: resolvedPath,
            width: canvas.width,
            height: canvas.height,
            frameCount: frames.length
        };
    }

    async function updateUnityAssetSheetInPaint(asset, animation) {
        if (!asset?.id || !animation?.id) {
            throw new Error('Animation missing');
        }
        captureCurrentAnimationFrameState('unity-asset-sheet-export.capture');
        await persistLoadedTimelineStates(asset, animation, {
            reason: 'unity-asset-sheet-export'
        });
        const refreshedAsset = projectStore.getAsset(asset.id) || asset;
        const refreshedAnimation = refreshedAsset.animations?.[animation.id] || animation;
        const frames = frameListForPaint(refreshedAnimation).filter((frame) => !!resolveFramePath(frame) && !!String(frame.unityAssetPath || '').trim());
        if (!frames.length) {
            throw new Error('Bind at least one frame to a Unity asset path first');
        }
        const exportedPaths = [];
        for (const frame of frames) {
            const sourcePath = projectStore.resolveAssetPath(refreshedAsset, resolveFramePath(frame));
            const targetPath = env.path.resolve(String(frame.unityAssetPath || '').trim());
            if (!sourcePath || !env.fs.existsSync(sourcePath)) {
                throw new Error(`Frame ${frame.index + 1} image is missing`);
            }
            if (!targetPath) {
                throw new Error(`Frame ${frame.index + 1} Unity asset path is invalid`);
            }
            env.fs.mkdirSync(env.path.dirname(targetPath), { recursive: true });
            env.fs.copyFileSync(sourcePath, targetPath);
            exportedPaths.push(targetPath);
        }
        return { outputPaths: exportedPaths };
    }

    function resolveImageResultOutputBuffer(responseImage, options = {}) {
        const sourcePath = String(options.sourcePath || '').trim();
        const base64 = String(responseImage?.base64 || '').trim();
        if (sourcePath) {
            const resolvedSourcePath = env.path.resolve(sourcePath);
            if (!env.fs.existsSync(resolvedSourcePath)) {
                throw new Error('Source image file is missing');
            }
            return env.fs.readFileSync(resolvedSourcePath);
        }
        if (base64) {
            return Buffer.from(base64, 'base64');
        }
        throw new Error('Image import requires either base64 data or a source path');
    }

    function buildAnimationFramePrompt(asset, animation, frame, options = {}) {
        const total = Math.max(1, Number(animation?.frameCount) || frameListForPaint(animation).length || 1);
        const details = [
            `Project "${asset?.name || 'Untitled Project'}"`,
            `Animation "${animation?.name || 'Animation'}"`,
            `Frame ${Math.max(1, Number(frame?.index) + 1)} of ${total}`
        ];
        if (options.label) {
            details.push(String(options.label).trim());
        }
        return details.join(' | ');
    }

    async function sliceAnimationSheetInPaint(asset, animation) {
        if (!asset || !animation?.sourceSheetPath) {
            throw new Error('Import a sprite sheet first');
        }
        const sheetPath = projectStore.resolveAssetPath(asset, animation.sourceSheetPath);
        if (!sheetPath || !env.fs.existsSync(sheetPath)) {
            throw new Error('Sheet file missing');
        }
        const image = await loadImageForPath(sheetPath);
        const grid = (Number(animation.columns) > 0 && Number(animation.rows) > 0)
            ? {
                columns: Math.max(1, Number(animation.columns)),
                rows: Math.max(1, Number(animation.rows))
            }
            : await promptForSheetGrid(animation);
        if (!grid) {
            return;
        }
        const frameWidth = Math.max(1, Number(animation.frameWidth) || Math.floor(image.naturalWidth / grid.columns) || image.naturalWidth);
        const frameHeight = Math.max(1, Number(animation.frameHeight) || Math.floor(image.naturalHeight / grid.rows) || image.naturalHeight);
        const total = Math.max(1, grid.columns * grid.rows);
        const frames = [];
        for (let index = 0; index < total; index += 1) {
            const canvas = document.createElement('canvas');
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                continue;
            }
            const x = (index % grid.columns) * frameWidth;
            const y = Math.floor(index / grid.columns) * frameHeight;
            ctx.clearRect(0, 0, frameWidth, frameHeight);
            ctx.drawImage(image, x, y, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            const buffer = await exportCanvasToPngBuffer(canvas);
            const fileName = `frame-${String(index + 1).padStart(4, '0')}.png`;
            const originalPath = projectStore.writeBufferToAsset(asset.id, `animations/${animation.id}/frames/original/${fileName}`, buffer);
            const workingPath = projectStore.writeBufferToAsset(asset.id, `animations/${animation.id}/frames/working/${fileName}`, buffer);
            frames.push({
                id: utils.createId('frame'),
                index,
                originalPath,
                workingPath,
                approvedPath: workingPath,
                hold: 1,
                status: 'ready',
                notes: '',
                promptHistory: [],
                manualEdited: false,
                approved: true,
                isReference: false,
                keyframe: false,
                selected: false,
                reviewStatus: 'approved',
                lastRunAt: '',
                lastRunType: '',
                unityAssetPath: ''
            });
        }
        projectStore.updateAnimation(asset.id, animation.id, (draft, parent) => {
            draft.frameWidth = frameWidth;
            draft.frameHeight = frameHeight;
            draft.columns = grid.columns;
            draft.rows = grid.rows;
            draft.frameCount = frames.length;
            draft.frames = frames;
            draft.starterImagePath = draft.starterImagePath || parent.still.approvedImagePath || parent.still.workingImagePath || '';
            draft.history = Array.isArray(draft.history) ? draft.history : [];
            draft.history.unshift({
                type: 'slice-sheet',
                frameCount: frames.length,
                targetId: draft.id,
                at: new Date().toISOString()
            });
            return draft;
        }, 'asset2d-animation-slice');
        const refreshedAsset = projectStore.getAsset(asset.id) || asset;
        const refreshedAnimation = refreshedAsset.animations?.[animation.id] || animation;
        const firstFrame = frameListForPaint(refreshedAnimation)[0];
        if (firstFrame && resolveFramePath(firstFrame)) {
            await switchPaintFile(projectStore.resolveAssetPath(refreshedAsset, resolveFramePath(firstFrame)));
        } else {
            renderPaintWorkspaceUi();
        }
    }

    async function rebuildAnimationSheetInPaint(asset, animation, options = {}) {
        if (!asset || !animation) {
            throw new Error('Animation missing');
        }
        const frames = frameListForPaint(animation).filter((frame) => !!resolveFramePath(frame));
        if (!frames.length) {
            throw new Error('No frames available to rebuild');
        }
        const firstImage = await loadImageForPath(projectStore.resolveAssetPath(asset, resolveFramePath(frames[0])));
        const frameWidth = Math.max(1, Number(animation.frameWidth) || firstImage.naturalWidth || 1);
        const frameHeight = Math.max(1, Number(animation.frameHeight) || firstImage.naturalHeight || 1);
        const columns = Math.max(1, Number(animation.columns) || Math.ceil(Math.sqrt(frames.length)));
        const rows = Math.max(1, Number(animation.rows) || Math.ceil(frames.length / columns));
        const canvas = document.createElement('canvas');
        canvas.width = columns * frameWidth;
        canvas.height = rows * frameHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            throw new Error('Unable to rebuild sheet');
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < frames.length; index += 1) {
            const frame = frames[index];
            const sourcePath = projectStore.resolveAssetPath(asset, resolveFramePath(frame));
            const image = await loadImageForPath(sourcePath);
            const x = (index % columns) * frameWidth;
            const y = Math.floor(index / columns) * frameHeight;
            ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x, y, frameWidth, frameHeight);
        }
        const relative = projectStore.writeBufferToAsset(
            asset.id,
            `animations/${animation.id}/exports/${options.fileName || 'sheet.png'}`,
            await exportCanvasToPngBuffer(canvas)
        );
        projectStore.updateAnimation(asset.id, animation.id, (draft) => {
            draft.frameWidth = frameWidth;
            draft.frameHeight = frameHeight;
            draft.columns = columns;
            draft.rows = rows;
            draft.exportSheetPath = relative;
            draft.history = Array.isArray(draft.history) ? draft.history : [];
            draft.history.unshift({
                type: options.historyType || 'rebuild-sheet',
                frameCount: frames.length,
                outputPaths: [relative],
                targetId: draft.id,
                at: new Date().toISOString()
            });
            return draft;
        }, options.reason || 'asset2d-animation-rebuild-sheet');
        return projectStore.getAsset(asset.id)?.animations?.[animation.id]?.exportSheetPath || relative;
    }

    async function exportAnimationBundle(asset, animation) {
        if (!asset || !animation) {
            throw new Error('Animation missing');
        }
        const refreshedAsset = projectStore.getAsset(asset.id) || asset;
        const refreshedAnimation = refreshedAsset.animations?.[animation.id] || animation;
        const frames = frameListForPaint(refreshedAnimation).filter((frame) => !!resolveFramePath(frame));
        if (!frames.length) {
            throw new Error('No frames available to export');
        }
        const exportSheetPath = await rebuildAnimationSheetInPaint(refreshedAsset, refreshedAnimation, {
            fileName: 'sheet.png',
            historyType: 'export-sheet',
            reason: 'asset2d-animation-export-sheet'
        });
        const afterSheetAsset = projectStore.getAsset(asset.id) || refreshedAsset;
        const afterSheetAnimation = afterSheetAsset.animations?.[animation.id] || refreshedAnimation;
        const exportFramesDir = `animations/${animation.id}/exports/frames`;
        const manifestFrames = [];
        frameListForPaint(afterSheetAnimation).forEach((frame) => {
            const sourceRelative = resolveFramePath(frame);
            if (!sourceRelative) {
                return;
            }
            const sourceAbsolute = projectStore.resolveAssetPath(afterSheetAsset, sourceRelative);
            if (!sourceAbsolute || !env.fs.existsSync(sourceAbsolute)) {
                return;
            }
            const fileName = `frame-${String(frame.index + 1).padStart(4, '0')}.png`;
            const targetRelative = projectStore.writeBufferToAsset(
                afterSheetAsset.id,
                `${exportFramesDir}/${fileName}`,
                env.fs.readFileSync(sourceAbsolute)
            );
            manifestFrames.push({
                index: frame.index,
                hold: Math.max(1, Number(frame.hold) || 1),
                file: env.path.basename(targetRelative),
                relativePath: targetRelative,
                sourcePath: sourceRelative,
                approved: frame.approved !== false
            });
        });
        const sheetAbsolute = projectStore.resolveAssetPath(afterSheetAsset, exportSheetPath);
        const sheetImage = await loadImageForPath(sheetAbsolute);
        const manifest = {
            animationId: afterSheetAnimation.id,
            animationName: afterSheetAnimation.name,
            fps: Math.max(1, Number(afterSheetAnimation.fps) || 12),
            frameWidth: Math.max(1, Number(afterSheetAnimation.frameWidth) || 0) || sheetImage.naturalWidth,
            frameHeight: Math.max(1, Number(afterSheetAnimation.frameHeight) || 0) || sheetImage.naturalHeight,
            columns: Math.max(1, Number(afterSheetAnimation.columns) || 1),
            rows: Math.max(1, Number(afterSheetAnimation.rows) || 1),
            frameCount: manifestFrames.length,
            sheetPath: exportSheetPath,
            frames: manifestFrames
        };
        const manifestPath = projectStore.writeJsonToAsset(afterSheetAsset.id, `animations/${animation.id}/exports/manifest.json`, manifest);
        projectStore.updateAnimation(afterSheetAsset.id, animation.id, (draft) => {
            draft.exportSheetPath = exportSheetPath;
            draft.exportManifestPath = manifestPath;
            draft.exportFramesDir = exportFramesDir;
            draft.history = Array.isArray(draft.history) ? draft.history : [];
            draft.history.unshift({
                type: 'export-animation',
                frameCount: manifestFrames.length,
                outputPaths: [exportSheetPath, manifestPath],
                targetId: draft.id,
                at: new Date().toISOString()
            });
            return draft;
        }, 'asset2d-animation-export');
        return {
            exportSheetPath,
            manifestPath,
            exportFramesDir
        };
    }

    async function insertImageResultIntoCurrentLayer() {
        return unsupportedAutomation('Automated image placement is not included in the public build.');
    }

    async function insertImageResultAsLayer() {
        return unsupportedAutomation('Automated image placement is not included in the public build.');
    }

    async function insertGeneratedImagesIntoLayerStack() {
        return unsupportedAutomation('Automated image placement is not included in the public build.');
    }

    async function persistGeneratedVariants() {
        return unsupportedAutomation('Generated variant storage is not included in the public build.');
    }

    async function runAnimationFrameBatch() {
        return unsupportedAutomation('Frame generation is not included in the public build.');
    }

    async function runBreakoutGeneration() {
        return unsupportedAutomation('Breakout generation is not included in the public build.');
    }

    async function runCurrentFrameRepair() {
        return unsupportedAutomation('Frame repair generation is not included in the public build.');
    }

    return {
        resolveSessionAnimationContext,
        importBoundSpriteSheetInPaint,
        updateUnitySpriteSheetInPaint,
        updateUnityAssetSheetInPaint,
        resolveImageResultOutputBuffer,
        insertImageResultIntoCurrentLayer,
        insertImageResultAsLayer,
        insertGeneratedImagesIntoLayerStack,
        persistGeneratedVariants,
        buildAnimationFramePrompt,
        sliceAnimationSheetInPaint,
        rebuildAnimationSheetInPaint,
        exportAnimationBundle,
        runAnimationFrameBatch,
        runBreakoutGeneration,
        runCurrentFrameRepair,
    };
};
