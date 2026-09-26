'use strict';

const env = require('../core/state');
const {
    fs,
    utils,
    state,
    data,
    constants,
    management,
    movement
} = env;
const {
    CAMERA_VIEWS,
    SPEEDS,
    normalizeAnimated3dPackageReference,
    normalizeAnimated3dPreferences,
    sanitizeAnimated3dBlockData,
    isAnimated3dExtension,
    isExcludedAnimated3dExtension,
    stageAnimated3dPackage,
    resolveAnimated3dPackage,
    describeAnimated3dPackageFailure,
    buildCapturedPosterSvg,
    isCapturedPosterSvg
} = require('./animated3dPackage');
const { createSingleActiveRuntimeLifecycle } = require('./animated3dLifecycle');

const runtimeLifecycle = createSingleActiveRuntimeLifecycle();
let runtimeSequence = 0;
let selectionActivationSequence = 0;
let posterCaptureQueue = Promise.resolve();
const posterCaptureAttempts = new Set();
const CAMERA_VIEW_LABELS = Object.freeze({
    front: 'Front',
    rear: 'Rear',
    'left-profile': 'Left profile',
    'right-profile': 'Right profile',
    top: 'Top',
    below: 'Below',
    diagonal: 'Diagonal'
});

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function stopEvent(event) {
    event.stopPropagation();
}

function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (text) {
        element.textContent = text;
    }
    return element;
}

function createButton(label, className, title, onClick) {
    const button = createElement('button', className, label);
    button.type = 'button';
    button.title = title || label;
    button.addEventListener('pointerdown', stopEvent);
    button.addEventListener('dblclick', stopEvent);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
    });
    return button;
}

function packageForBlock(block) {
    return resolveAnimated3dPackage(block?.packageRef, { assetsDir: env.paths.assetsDir });
}

function makeHeader(packageResult, options = {}) {
    const header = createElement('div', 'animated3d-header');
    header.dataset.animated3dDragHandle = 'true';
    header.title = 'Drag to move this 3D block';

    const grip = createElement('span', 'animated3d-grip');
    grip.setAttribute('aria-hidden', 'true');
    const title = createElement('span', 'animated3d-title', packageResult?.displayName || 'Animated 3D');
    const status = createElement('span', 'animated3d-state', options.active ? 'Active' : options.failure ? 'Unavailable' : 'Inactive');
    status.classList.toggle('is-failure', !!options.failure);
    header.append(grip, title, status);

    if (options.runtime) {
        const close = createButton('Close', 'animated3d-close', 'Deactivate 3D review', () => {
            options.runtime.dispose('deactivate');
        });
        header.appendChild(close);
        options.runtime.headerState = status;
    }
    return header;
}

function posterUrl(packageResult) {
    if (!packageResult?.posterPath) {
        return '';
    }
    let cacheKey = '';
    try {
        cacheKey = String(Math.trunc(fs.statSync(packageResult.posterPath).mtimeMs));
    } catch {}
    const url = utils.toFileUrl(packageResult.posterPath);
    return cacheKey ? `${url}?v=${cacheKey}` : url;
}

function renderInactiveShell(block, element, packageResult, options = {}) {
    element.classList.remove('animated3d-is-active');
    element.replaceChildren();

    const shell = createElement('div', 'animated3d-block');
    shell.appendChild(makeHeader(packageResult, { failure: !!options.failure || !packageResult?.ok }));
    const stage = createElement('div', 'animated3d-stage animated3d-stage-inactive');

    if (packageResult?.ok) {
        const image = createElement('img', 'animated3d-poster');
        image.alt = `${packageResult.displayName || 'Animated 3D model'} poster`;
        image.decoding = 'async';
        image.src = posterUrl(packageResult);
        const detail = createElement('div', 'animated3d-stage-detail', options.message || 'Select to review in 3D');
        image.addEventListener('error', () => {
            detail.textContent = '3D package poster is unavailable';
            stage.classList.add('is-failure');
        }, { once: true });
        stage.append(image, detail);
    } else {
        stage.classList.add('is-failure');
        const failure = createElement('div', 'animated3d-failure', options.message || describeAnimated3dPackageFailure(packageResult?.reason));
        const detail = createElement('div', 'animated3d-stage-detail', 'Reimport the self-contained GLB package to restore this block.');
        stage.append(failure, detail);
    }

    shell.appendChild(stage);
    element.appendChild(shell);
    if (packageResult?.ok) {
        queueFirstFramePosterCapture(block, element, packageResult);
    }
}

function createRuntime(block, element, packageResult) {
    const runtime = {
        id: ++runtimeSequence,
        block,
        element,
        packageResult,
        preferences: normalizeAnimated3dPreferences(block.preferences),
        disposed: false,
        mounted: false,
        loadingStartedAt: nowMs(),
        rafId: null,
        lastFrameAt: 0,
        cleanupListeners: [],
        controlsUi: null,
        renderer: null,
        scene: null,
        camera: null,
        orbit: null,
        model: null,
        mixer: null,
        clips: [],
        activeAction: null,
        activeClipIndex: 0,
        playing: false,
        skeletonHelper: null,
        originalMaterials: new Map(),
        clayMaterial: null,
        rootMotionTarget: null,
        rootMotionOrigin: null,
        modelOrigin: null,
        resizeObserver: null,
        unsubscribeWindowActivity: null,
        viewport: null,
        canvas: null,
        statusEl: null,
        headerState: null,
        three: null
    };
    runtime.dispose = (reason, options) => disposeRuntime(runtime, reason, options);
    return runtime;
}

function isRuntimeAlive(runtime) {
    return !!runtime
        && !runtime.disposed
        && runtimeLifecycle.isActive(runtime)
        && !!runtime.element?.isConnected;
}

function updateRuntimeStatus(runtime, text) {
    if (!isRuntimeAlive(runtime)) {
        return;
    }
    if (runtime.statusEl) {
        runtime.statusEl.textContent = text;
    }
    if (runtime.headerState) {
        runtime.headerState.textContent = 'Active';
    }
}

function addRuntimeListener(runtime, target, type, listener, options) {
    if (!target?.addEventListener) {
        return;
    }
    target.addEventListener(type, listener, options);
    runtime.cleanupListeners.push(() => target.removeEventListener(type, listener, options));
}

function bindViewportOwnership(runtime) {
    const viewport = runtime.viewport;
    if (!viewport) {
        return;
    }
    addRuntimeListener(runtime, viewport, 'pointerdown', () => {
        if (!state.selectedBlockIds.has(runtime.block.id)) {
            movement.selectBlock?.(runtime.block.id);
        }
        try {
            runtime.canvas?.focus?.({ preventScroll: true });
        } catch {}
    }, { capture: true });
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'dblclick', 'contextmenu', 'mousedown', 'auxclick', 'click'].forEach((type) => {
        addRuntimeListener(runtime, viewport, type, stopEvent, { passive: false });
    });
}

function buildRuntimeControls(runtime) {
    const controls = createElement('div', 'animated3d-controls');
    const timeline = createElement('div', 'animated3d-timeline-row');
    const play = createButton('▶', 'animated3d-control animated3d-icon-control animated3d-play', 'Play animation', () => togglePlayback(runtime));
    play.setAttribute('aria-label', 'Play animation');
    const scrub = createElement('input', 'animated3d-scrub');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = '1';
    scrub.step = '0.01';
    scrub.value = '0';
    scrub.disabled = true;
    scrub.title = 'Scrub animation time';
    scrub.addEventListener('pointerdown', stopEvent);
    scrub.addEventListener('input', (event) => {
        event.stopPropagation();
        scrubAnimation(runtime, Number(scrub.value));
    });
    timeline.append(play, scrub);

    const toolbar = createElement('div', 'animated3d-toolbar-row');
    const restart = createButton('↺', 'animated3d-control animated3d-icon-control', 'Restart the active animation clip', () => restartAnimation(runtime));
    restart.setAttribute('aria-label', 'Restart animation');
    const clip = createElement('select', 'animated3d-clip-select');
    clip.title = 'Animation clip';
    clip.disabled = true;
    clip.addEventListener('pointerdown', stopEvent);
    clip.addEventListener('change', (event) => {
        event.stopPropagation();
        selectAnimationClip(runtime, Number(clip.value), { persist: true, play: true });
    });

    const speeds = createElement('div', 'animated3d-control-group');
    const speedButtons = new Map();
    SPEEDS.forEach((speed) => {
        const button = createButton(`${speed}x`, 'animated3d-control animated3d-speed', `Set animation speed to ${speed}x`, () => {
            setAnimationSpeed(runtime, speed, { persist: true });
        });
        speedButtons.set(speed, button);
        speeds.appendChild(button);
    });

    const preview = createElement('div', 'animated3d-control-group');
    const clay = createButton('Clay', 'animated3d-control', 'Toggle clay material override', () => {
        runtime.preferences.clay = !runtime.preferences.clay;
        syncClayPreview(runtime);
        persistPreferences(runtime, 'clay');
        refreshControlState(runtime);
    });
    const bones = createButton('Bones', 'animated3d-control', 'Toggle skeleton preview', () => {
        runtime.preferences.showBones = !runtime.preferences.showBones;
        syncSkeletonPreview(runtime);
        persistPreferences(runtime, 'bones');
        refreshControlState(runtime);
    });
    const rootMotion = createButton('Root motion', 'animated3d-control', 'Toggle root-motion preview', () => {
        runtime.preferences.rootMotionPreview = !runtime.preferences.rootMotionPreview;
        if (runtime.preferences.rootMotionPreview && runtime.modelOrigin) {
            runtime.model.position.copy(runtime.modelOrigin);
        } else {
            applyRootMotionPreview(runtime);
        }
        persistPreferences(runtime, 'root-motion');
        refreshControlState(runtime);
    });
    preview.append(clay, bones, rootMotion);

    const view = createElement('select', 'animated3d-view-select');
    view.title = 'Camera view (character-relative)';
    view.setAttribute('aria-label', 'Camera view (character-relative)');
    view.addEventListener('pointerdown', stopEvent);
    view.addEventListener('change', (event) => {
        event.stopPropagation();
        setCameraView(runtime, view.value, { persist: true });
    });
    CAMERA_VIEWS.forEach((cameraView) => {
        const option = createElement('option', '', CAMERA_VIEW_LABELS[cameraView]);
        option.value = cameraView;
        view.appendChild(option);
    });

    toolbar.append(clip, restart, speeds, preview, view);
    controls.append(timeline, toolbar);
    runtime.controlsUi = { controls, play, restart, clip, view, scrub, speedButtons, clay, bones, rootMotion };
    return controls;
}

function renderActiveShell(runtime) {
    const { element, packageResult } = runtime;
    element.classList.add('animated3d-is-active');
    element.replaceChildren();

    const shell = createElement('div', 'animated3d-block animated3d-block-active');
    shell.appendChild(makeHeader(packageResult, { active: true, runtime }));
    const viewport = createElement('div', 'animated3d-viewport');
    viewport.dataset.boardViewportOwner = 'animated3d';
    viewport.dataset.animated3dViewport = 'true';
    const status = createElement('div', 'animated3d-runtime-status', 'Loading 3D package…');
    runtime.viewport = viewport;
    runtime.statusEl = status;
    const controls = buildRuntimeControls(runtime);
    viewport.append(status, controls);
    shell.appendChild(viewport);
    element.appendChild(shell);
    bindViewportOwnership(runtime);
}

function activateBlock(block, element, packageResult) {
    const currentPackage = packageResult?.ok ? packageResult : packageForBlock(block);
    if (!currentPackage?.ok) {
        renderInactiveShell(block, element, currentPackage, { failure: true });
        return;
    }
    if (env.windowActivity?.isBackground?.()) {
        renderInactiveShell(block, element, currentPackage, { message: 'Bring Board Studio to the foreground before activating 3D review.' });
        return;
    }
    const runtime = createRuntime(block, element, currentPackage);
    runtimeLifecycle.activate(runtime, 'activate');
    renderActiveShell(runtime);
    attachRuntimeLifecycle(runtime);
    if (!isRuntimeAlive(runtime)) {
        return;
    }
    runtime.mountPromise = mountRuntime(runtime);
    return runtime;
}

function attachRuntimeLifecycle(runtime) {
    const releaseForBlur = () => {
        if (isRuntimeAlive(runtime)) {
            runtime.dispose('focus-loss');
        }
    };
    const releaseForHidden = () => {
        if (document.visibilityState === 'hidden' && isRuntimeAlive(runtime)) {
            runtime.dispose('hidden');
        }
    };
    addRuntimeListener(runtime, window, 'blur', releaseForBlur);
    addRuntimeListener(runtime, document, 'visibilitychange', releaseForHidden);
    runtime.unsubscribeWindowActivity = env.windowActivity?.subscribe?.((snapshot) => {
        if (snapshot?.mode !== 'active' && isRuntimeAlive(runtime)) {
            runtime.dispose(`window-${snapshot.mode || 'background'}`);
        }
    }) || null;
    if (env.windowActivity?.isBackground?.() || document.visibilityState === 'hidden') {
        runtime.dispose('background-before-mount');
    }
}

function getThreeModules() {
    const loadModules = window.__boardStudioLoadAnimated3dModules;
    if (typeof loadModules !== 'function') {
        return Promise.reject(new Error('Board Studio 3D modules are unavailable'));
    }
    return loadModules();
}

function addLighting(runtime) {
    const { THREE, scene } = runtime.three;
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x202639, 1.5);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3.5, 5, 4);
    const fill = new THREE.DirectionalLight(0xd9c6ff, 0.7);
    fill.position.set(-3, 2, 2);
    const rim = new THREE.DirectionalLight(0xffd6f0, 0.9);
    rim.position.set(-3, 3, -4);
    scene.add(hemisphere, key, fill, rim);
}

function resizeRuntime(runtime) {
    if (!isRuntimeAlive(runtime) || !runtime.renderer || !runtime.camera || !runtime.viewport) {
        return;
    }
    const width = Math.max(1, runtime.viewport.clientWidth || 1);
    const height = Math.max(1, runtime.viewport.clientHeight || 1);
    runtime.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    runtime.renderer.setSize(width, height, false);
    runtime.camera.aspect = width / height;
    runtime.camera.updateProjectionMatrix();
}

function parseGlb(loader, sourceBuffer) {
    const arrayBuffer = sourceBuffer.buffer.slice(sourceBuffer.byteOffset, sourceBuffer.byteOffset + sourceBuffer.byteLength);
    return new Promise((resolve, reject) => {
        loader.parse(arrayBuffer, '', resolve, reject);
    });
}

function mountRuntimeModel(runtime, gltf) {
    if (!isRuntimeAlive(runtime)) {
        disposeObjectResources(gltf?.scene);
        return;
    }
    const model = gltf?.scene;
    if (!model) {
        throw new Error('GLB has no scene');
    }
    runtime.model = model;
    runtime.mounted = true;
    runtime.scene.add(model);
    runtime.modelOrigin = model.position.clone();
    runtime.clips = Array.isArray(gltf.animations) ? gltf.animations.filter((clip) => clip?.tracks?.length) : [];
    runtime.activeClipIndex = Math.min(runtime.preferences.activeClip, Math.max(0, runtime.clips.length - 1));
    if (runtime.clips.length) {
        runtime.mixer = new runtime.three.THREE.AnimationMixer(model);
        runtime.mixer.timeScale = runtime.preferences.speed;
        populateClipSelect(runtime);
        selectAnimationClip(runtime, runtime.activeClipIndex, { persist: false, play: true });
    }
    captureOriginalMaterials(runtime);
    captureFirstFramePoster(runtime);
    syncClayPreview(runtime);
    syncSkeletonPreview(runtime);
    setCameraView(runtime, runtime.preferences.view, { persist: false });
    refreshControlState(runtime);
    const bones = countBones(model);
    const resources = countMaterialResources(model);
    console.info(`animated3d status=ok,operation=mount,id=${runtime.block.id},dur_ms=${Math.round(nowMs() - runtime.loadingStartedAt)},clips=${runtime.clips.length},bones=${bones},materials=${resources.materialCount},textures=${resources.textureCount}`);
}

function captureFirstFramePoster(runtime) {
    if (!runtime.packageResult?.posterPath || !runtime.renderer || !runtime.scene || !runtime.camera || !runtime.model) {
        return;
    }
    const selectedClipIndex = runtime.activeClipIndex;
    const selectedView = runtime.preferences.view;
    const wasPlaying = runtime.playing;
    let previewStateApplied = false;
    try {
        const existingPoster = fs.readFileSync(runtime.packageResult.posterPath, 'utf8');
        if (isCapturedPosterSvg(existingPoster)) {
            return;
        }
        previewStateApplied = true;
        if (runtime.clips.length) {
            selectAnimationClip(runtime, 0, { persist: false, play: false });
        }
        setCameraView(runtime, 'diagonal', { persist: false });
        runtime.model.updateMatrixWorld?.(true);
        runtime.orbit?.update?.();
        runtime.renderer.render(runtime.scene, runtime.camera);
        const imageDataUrl = runtime.canvas.toDataURL('image/jpeg', 0.9);
        const posterSvg = buildCapturedPosterSvg(
            imageDataUrl,
            runtime.canvas.width,
            runtime.canvas.height,
            runtime.packageResult.displayName
        );
        fs.writeFileSync(runtime.packageResult.posterPath, posterSvg, 'utf8');
        console.info(`animated3d status=ok,operation=poster-capture,id=${runtime.block.id},clip=0,view=diagonal,width=${runtime.canvas.width},height=${runtime.canvas.height}`);
    } catch (error) {
        console.warn(`animated3d status=failed,operation=poster-capture,id=${runtime.block.id},message=${error?.message || 'unknown'}`);
    } finally {
        if (previewStateApplied && isRuntimeAlive(runtime)) {
            if (runtime.clips.length) {
                selectAnimationClip(runtime, selectedClipIndex, { persist: false, play: wasPlaying });
            }
            setCameraView(runtime, selectedView, { persist: false });
        }
    }
}

function packageHasCapturedPoster(packageResult) {
    if (!packageResult?.posterPath) {
        return false;
    }
    try {
        return isCapturedPosterSvg(fs.readFileSync(packageResult.posterPath, 'utf8'));
    } catch {
        return false;
    }
}

function queueFirstFramePosterCapture(block, element, packageResult) {
    const packageRef = String(packageResult?.packageRef || '');
    if (!packageRef || packageHasCapturedPoster(packageResult) || posterCaptureAttempts.has(packageRef)) {
        return;
    }
    posterCaptureAttempts.add(packageRef);
    posterCaptureQueue = posterCaptureQueue.then(async () => {
        if (!element.isConnected || packageHasCapturedPoster(packageResult)) {
            return;
        }
        if (runtimeLifecycle.getActive()) {
            posterCaptureAttempts.delete(packageRef);
            return;
        }
        const host = createElement('div', 'animated3d-poster-capture-host');
        const viewport = createElement('div', 'animated3d-viewport');
        host.style.cssText = 'position:fixed;left:-10000px;top:0;width:960px;height:540px;visibility:hidden;pointer-events:none;';
        viewport.style.cssText = 'width:960px;height:540px;';
        host.appendChild(viewport);
        document.body.appendChild(host);
        const runtime = createRuntime(block, host, packageResult);
        runtime.viewport = viewport;
        runtimeLifecycle.activate(runtime, 'poster-capture');
        try {
            runtime.mountPromise = mountRuntime(runtime);
            await runtime.mountPromise;
        } finally {
            runtime.dispose('poster-capture-complete');
            host.remove();
        }
        if (packageHasCapturedPoster(packageResult)
            && element.isConnected
            && !runtimeLifecycle.getActive()) {
            renderInactiveShell(block, element, packageForBlock(block));
        }
    }).catch((error) => {
        console.warn(`animated3d status=failed,operation=poster-capture-queue,package=${packageRef},message=${error?.message || 'unknown'}`);
    });
}

async function mountRuntime(runtime) {
    try {
        const modules = await getThreeModules();
        if (!isRuntimeAlive(runtime)) {
            return;
        }
        const THREE = modules?.THREE;
        const OrbitControls = modules?.OrbitControls;
        const GLTFLoader = modules?.GLTFLoader;
        if (!THREE || !OrbitControls || !GLTFLoader) {
            throw new Error('Board Studio 3D modules are incomplete');
        }
        const scene = new THREE.Scene();
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        const boardBackground = getComputedStyle(document.documentElement)
            .getPropertyValue('--bg-card-deep')
            .trim() || '#1e1e22';
        renderer.setClearColor(new THREE.Color(boardBackground), 1);
        const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10000);
        const orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.08;
        orbit.screenSpacePanning = true;
        orbit.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        renderer.domElement.classList.add('animated3d-canvas');
        renderer.domElement.tabIndex = 0;
        runtime.three = { THREE, scene };
        runtime.scene = scene;
        runtime.renderer = renderer;
        runtime.camera = camera;
        runtime.orbit = orbit;
        runtime.canvas = renderer.domElement;
        runtime.viewport.prepend(renderer.domElement);
        addLighting(runtime);
        resizeRuntime(runtime);
        if (typeof ResizeObserver === 'function') {
            runtime.resizeObserver = new ResizeObserver(() => resizeRuntime(runtime));
            runtime.resizeObserver.observe(runtime.viewport);
        }
        startRenderLoop(runtime);
        updateRuntimeStatus(runtime, 'Decoding GLB package…');
        const sourceBuffer = await fs.promises.readFile(runtime.packageResult.modelPath);
        if (!isRuntimeAlive(runtime)) {
            return;
        }
        const loader = new GLTFLoader();
        const gltf = await parseGlb(loader, sourceBuffer);
        mountRuntimeModel(runtime, gltf);
        if (isRuntimeAlive(runtime)) {
            updateRuntimeStatus(runtime, runtime.clips.length ? `${runtime.clips.length} animation clip${runtime.clips.length === 1 ? '' : 's'}` : 'Model loaded');
        }
    } catch (error) {
        if (isRuntimeAlive(runtime)) {
            const message = error?.message || 'Unable to load 3D package';
            console.warn(`animated3d status=failed,operation=mount,id=${runtime.block.id},stage=load,message=${message}`);
            runtime.dispose('load-failed', { failure: true, message: 'Unable to load this GLB package.' });
        }
    }
}

function startRenderLoop(runtime) {
    if (!isRuntimeAlive(runtime) || runtime.rafId !== null) {
        return;
    }
    runtime.lastFrameAt = nowMs();
    runtime.rafId = window.requestAnimationFrame((timestamp) => renderRuntimeFrame(runtime, timestamp));
}

function renderRuntimeFrame(runtime, timestamp) {
    runtime.rafId = null;
    if (!isRuntimeAlive(runtime) || !runtime.renderer || !runtime.scene || !runtime.camera) {
        return;
    }
    const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - runtime.lastFrameAt) / 1000));
    runtime.lastFrameAt = timestamp;
    try {
        if (runtime.mixer && runtime.playing) {
            runtime.mixer.update(deltaSeconds);
            applyRootMotionPreview(runtime);
        }
        runtime.orbit?.update?.();
        runtime.skeletonHelper?.update?.();
        runtime.renderer.render(runtime.scene, runtime.camera);
        refreshPlaybackUi(runtime);
    } catch (error) {
        console.warn(`animated3d status=failed,operation=render,id=${runtime.block.id},message=${error?.message || 'unknown'}`);
        runtime.dispose('render-failed', { failure: true, message: '3D review stopped after a rendering error.' });
        return;
    }
    if (isRuntimeAlive(runtime)) {
        runtime.rafId = window.requestAnimationFrame((nextTimestamp) => renderRuntimeFrame(runtime, nextTimestamp));
    }
}

function countBones(model) {
    let count = 0;
    model?.traverse?.((node) => {
        if (node?.isBone) {
            count += 1;
        }
    });
    return count;
}

function countMaterialResources(model) {
    const materials = new Set();
    const textures = new Set();
    model?.traverse?.((node) => {
        const entries = Array.isArray(node?.material) ? node.material : [node?.material];
        entries.forEach((material) => {
            if (!material) {
                return;
            }
            materials.add(material);
            Object.values(material).forEach((value) => {
                if (value?.isTexture) {
                    textures.add(value);
                }
            });
        });
    });
    return { materialCount: materials.size, textureCount: textures.size };
}

function disposeMaterialResources(material, textures) {
    if (!material) {
        return;
    }
    Object.values(material).forEach((value) => {
        if (value?.isTexture && !textures.has(value)) {
            textures.add(value);
            value.dispose?.();
        }
    });
    material.dispose?.();
}

function disposeObjectResources(root) {
    if (!root) {
        return;
    }
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    root.traverse?.((node) => {
        if (node?.geometry && !geometries.has(node.geometry)) {
            geometries.add(node.geometry);
            node.geometry.dispose?.();
        }
        const entries = Array.isArray(node?.material) ? node.material : [node?.material];
        entries.forEach((material) => {
            if (material && !materials.has(material)) {
                materials.add(material);
                disposeMaterialResources(material, textures);
            }
        });
    });
    root.parent?.remove?.(root);
}

function disposeSkeletonPreview(runtime) {
    if (!runtime.skeletonHelper) {
        return;
    }
    runtime.skeletonHelper.parent?.remove?.(runtime.skeletonHelper);
    runtime.skeletonHelper.geometry?.dispose?.();
    runtime.skeletonHelper.material?.dispose?.();
    runtime.skeletonHelper = null;
}

function syncSkeletonPreview(runtime) {
    if (!runtime.model || !runtime.scene) {
        return;
    }
    disposeSkeletonPreview(runtime);
    if (!runtime.preferences.showBones) {
        return;
    }
    const helper = new runtime.three.THREE.SkeletonHelper(runtime.model);
    helper.material.color.set(0xff81d7);
    helper.material.depthTest = false;
    helper.renderOrder = 20;
    runtime.scene.add(helper);
    runtime.skeletonHelper = helper;
}

function captureOriginalMaterials(runtime) {
    runtime.originalMaterials.clear();
    runtime.model?.traverse?.((node) => {
        if (node?.isMesh && node.material) {
            runtime.originalMaterials.set(node, node.material);
        }
    });
}

function restoreOriginalMaterials(runtime) {
    runtime.originalMaterials.forEach((material, node) => {
        if (node) {
            node.material = material;
        }
    });
}

function syncClayPreview(runtime) {
    if (!runtime.model || !runtime.three?.THREE) {
        return;
    }
    if (!runtime.preferences.clay) {
        restoreOriginalMaterials(runtime);
        return;
    }
    if (!runtime.clayMaterial) {
        runtime.clayMaterial = new runtime.three.THREE.MeshStandardMaterial({
            color: 0xc9b6dc,
            roughness: 0.82,
            metalness: 0
        });
    }
    runtime.originalMaterials.forEach((_material, node) => {
        if (node) {
            node.material = runtime.clayMaterial;
        }
    });
}

function findRootMotionTarget(model) {
    let selected = null;
    let score = 0;
    model?.traverse?.((node) => {
        const name = String(node?.name || '').toLowerCase();
        if (!name) {
            return;
        }
        let candidateScore = 0;
        if (/\b(root|rootmotion)\b/.test(name)) {
            candidateScore = 5;
        } else if (/hips?|pelvis/.test(name)) {
            candidateScore = 4;
        } else if (/armature/.test(name)) {
            candidateScore = 2;
        }
        if (node.isBone) {
            candidateScore += 1;
        }
        if (candidateScore > score) {
            score = candidateScore;
            selected = node;
        }
    });
    return selected;
}

function resetRootMotionReference(runtime) {
    if (!runtime.model || !runtime.modelOrigin) {
        return;
    }
    runtime.model.position.copy(runtime.modelOrigin);
    runtime.model.updateMatrixWorld?.(true);
    runtime.rootMotionTarget = findRootMotionTarget(runtime.model);
    runtime.rootMotionOrigin = runtime.rootMotionTarget
        ? runtime.rootMotionTarget.getWorldPosition(new runtime.three.THREE.Vector3())
        : null;
    applyRootMotionPreview(runtime);
}

function applyRootMotionPreview(runtime) {
    if (!runtime.model || !runtime.rootMotionTarget || !runtime.rootMotionOrigin || !runtime.modelOrigin || runtime.preferences.rootMotionPreview) {
        return;
    }
    runtime.model.position.copy(runtime.modelOrigin);
    runtime.model.updateMatrixWorld?.(true);
    const delta = runtime.rootMotionTarget
        .getWorldPosition(new runtime.three.THREE.Vector3())
        .sub(runtime.rootMotionOrigin);
    runtime.model.position.x -= delta.x;
    runtime.model.position.z -= delta.z;
    runtime.model.updateMatrixWorld?.(true);
}

function populateClipSelect(runtime) {
    const select = runtime.controlsUi?.clip;
    if (!select) {
        return;
    }
    select.replaceChildren();
    runtime.clips.forEach((clip, index) => {
        const option = createElement('option', '', clip.name?.trim?.() || `Clip ${index + 1}`);
        option.value = String(index);
        select.appendChild(option);
    });
    select.disabled = runtime.clips.length === 0;
}

function selectAnimationClip(runtime, index, options = {}) {
    if (!isRuntimeAlive(runtime) || !runtime.mixer || !runtime.clips.length) {
        return;
    }
    const nextIndex = Math.max(0, Math.min(runtime.clips.length - 1, Number.isSafeInteger(index) ? index : 0));
    runtime.activeAction?.stop?.();
    runtime.activeClipIndex = nextIndex;
    runtime.activeAction = runtime.mixer.clipAction(runtime.clips[nextIndex]);
    runtime.activeAction.reset();
    runtime.activeAction.enabled = true;
    runtime.playing = options.play !== false;
    runtime.activeAction.paused = !runtime.playing;
    runtime.activeAction.play();
    runtime.preferences.activeClip = nextIndex;
    runtime.mixer.update(0);
    resetRootMotionReference(runtime);
    if (options.persist) {
        persistPreferences(runtime, 'clip');
    }
    refreshControlState(runtime);
}

function setAnimationSpeed(runtime, speed, options = {}) {
    if (!isRuntimeAlive(runtime) || !SPEEDS.includes(speed)) {
        return;
    }
    runtime.preferences.speed = speed;
    if (runtime.mixer) {
        runtime.mixer.timeScale = speed;
    }
    if (options.persist) {
        persistPreferences(runtime, 'speed');
    }
    refreshControlState(runtime);
}

function togglePlayback(runtime) {
    if (!isRuntimeAlive(runtime) || !runtime.clips.length) {
        return;
    }
    if (!runtime.activeAction) {
        selectAnimationClip(runtime, runtime.activeClipIndex, { play: true });
        return;
    }
    runtime.playing = !runtime.playing;
    runtime.activeAction.paused = !runtime.playing;
    refreshControlState(runtime);
}

function restartAnimation(runtime) {
    if (!isRuntimeAlive(runtime) || !runtime.clips.length) {
        return;
    }
    if (!runtime.activeAction) {
        selectAnimationClip(runtime, runtime.activeClipIndex, { play: true });
        return;
    }
    runtime.activeAction.reset();
    runtime.activeAction.paused = false;
    runtime.playing = true;
    runtime.mixer?.update?.(0);
    resetRootMotionReference(runtime);
    refreshControlState(runtime);
}

function scrubAnimation(runtime, value) {
    if (!isRuntimeAlive(runtime) || !runtime.activeAction) {
        return;
    }
    const duration = Math.max(0.001, runtime.clips[runtime.activeClipIndex]?.duration || 0.001);
    runtime.activeAction.time = Math.max(0, Math.min(duration, Number(value) || 0));
    runtime.activeAction.paused = true;
    runtime.playing = false;
    runtime.mixer?.update?.(0);
    applyRootMotionPreview(runtime);
    refreshControlState(runtime);
}

function setCameraView(runtime, view, options = {}) {
    if (!isRuntimeAlive(runtime) || !runtime.model || !CAMERA_VIEWS.includes(view)) {
        return;
    }
    const { THREE } = runtime.three;
    const bounds = new THREE.Box3().setFromObject(runtime.model);
    if (bounds.isEmpty()) {
        return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(0.1, size.length() * 0.5);
    const directions = {
        front: new THREE.Vector3(0, 0, 1),
        rear: new THREE.Vector3(0, 0, -1),
        // Nix's live GLB verifies character-right as -X and character-forward as +Z.
        'left-profile': new THREE.Vector3(1, 0, 0),
        'right-profile': new THREE.Vector3(-1, 0, 0),
        top: new THREE.Vector3(0, 1, 0),
        below: new THREE.Vector3(0, -1, 0),
        diagonal: new THREE.Vector3(-1, 0.65, 1)
    };
    const upVectors = {
        top: new THREE.Vector3(0, 0, 1),
        below: new THREE.Vector3(0, 0, 1)
    };
    const direction = directions[view].normalize();
    const distance = radius / Math.tan((runtime.camera.fov * Math.PI) / 360) * 1.22;
    runtime.orbit.target.copy(center);
    runtime.camera.up.copy(upVectors[view] || new THREE.Vector3(0, 1, 0));
    runtime.camera.position.copy(center).addScaledVector(direction, distance);
    runtime.camera.near = Math.max(0.01, radius / 100);
    runtime.camera.far = Math.max(100, radius * 100);
    runtime.camera.updateProjectionMatrix();
    runtime.orbit.update();
    runtime.preferences.view = view;
    if (runtime.controlsUi?.view) {
        runtime.controlsUi.view.value = view;
    }
    if (options.persist) {
        persistPreferences(runtime, 'view');
    }
}

function refreshPlaybackUi(runtime) {
    const scrub = runtime.controlsUi?.scrub;
    if (!scrub || !runtime.activeAction || document.activeElement === scrub) {
        return;
    }
    const duration = Math.max(0.001, runtime.clips[runtime.activeClipIndex]?.duration || 0.001);
    scrub.value = String(Math.max(0, Math.min(duration, runtime.activeAction.time)));
}

function refreshControlState(runtime) {
    const controls = runtime.controlsUi;
    if (!controls) {
        return;
    }
    const hasClips = runtime.clips.length > 0;
    controls.play.disabled = !hasClips;
    controls.restart.disabled = !hasClips;
    controls.scrub.disabled = !hasClips;
    controls.clip.disabled = !hasClips;
    controls.view.value = runtime.preferences.view;
    const playLabel = runtime.playing ? 'Pause animation' : 'Play animation';
    controls.play.textContent = runtime.playing ? '❚❚' : '▶';
    controls.play.title = playLabel;
    controls.play.setAttribute('aria-label', playLabel);
    if (hasClips) {
        const duration = Math.max(0.001, runtime.clips[runtime.activeClipIndex]?.duration || 0.001);
        controls.scrub.max = String(duration);
        controls.clip.value = String(runtime.activeClipIndex);
    }
    controls.speedButtons.forEach((button, speed) => {
        button.classList.toggle('is-active', runtime.preferences.speed === speed);
    });
    controls.clay.classList.toggle('is-active', runtime.preferences.clay);
    controls.bones.classList.toggle('is-active', runtime.preferences.showBones);
    controls.rootMotion.classList.toggle('is-active', runtime.preferences.rootMotionPreview);
    controls.rootMotion.textContent = runtime.preferences.rootMotionPreview ? 'Root motion on' : 'Root motion off';
}

function persistPreferences(runtime, reason) {
    if (!isRuntimeAlive(runtime)) {
        return;
    }
    runtime.block.preferences = normalizeAnimated3dPreferences(runtime.preferences);
    runtime.block.updatedAt = new Date().toISOString();
    data.queueSave(`animated3d-${reason}`);
}

function disposeRuntime(runtime, reason = 'dispose', options = {}) {
    if (!runtime || runtime.disposed) {
        return false;
    }
    runtime.disposed = true;
    if (runtime.rafId !== null) {
        window.cancelAnimationFrame(runtime.rafId);
        runtime.rafId = null;
    }
    runtime.resizeObserver?.disconnect?.();
    runtime.resizeObserver = null;
    runtime.unsubscribeWindowActivity?.();
    runtime.unsubscribeWindowActivity = null;
    runtime.cleanupListeners.splice(0).forEach((cleanup) => {
        try {
            cleanup();
        } catch {}
    });
    runtime.orbit?.dispose?.();
    disposeSkeletonPreview(runtime);
    restoreOriginalMaterials(runtime);
    runtime.clayMaterial?.dispose?.();
    runtime.clayMaterial = null;
    disposeObjectResources(runtime.model);
    runtime.originalMaterials.clear();
    runtime.model = null;
    runtime.scene?.clear?.();
    runtime.renderer?.renderLists?.dispose?.();
    runtime.renderer?.dispose?.();
    runtime.renderer?.forceContextLoss?.();
    runtime.canvas?.remove?.();
    runtimeLifecycle.release(runtime);
    if (runtime.element?.isConnected) {
        renderInactiveShell(runtime.block, runtime.element, packageForBlock(runtime.block), {
            failure: !!options.failure,
            message: options.message || ''
        });
    }
    console.info(`animated3d status=ok,operation=dispose,id=${runtime.block.id},reason=${reason}`);
    return true;
}

function disposeActiveRuntime(reason = 'dispose') {
    return runtimeLifecycle.disposeActive(reason);
}

function disposeRuntimeForBlock(blockId, reason = 'dispose') {
    const runtime = runtimeLifecycle.getActive();
    if (!runtime || runtime.block?.id !== blockId) {
        return false;
    }
    return runtimeLifecycle.disposeActive(reason);
}

function bindBlockSelectionOwnership(block, element) {
    if (element.dataset.animated3dSelectionBound === 'true') {
        return;
    }
    element.dataset.animated3dSelectionBound = 'true';
    element.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target?.closest?.('.animated3d-close')) {
            return;
        }
        const blockId = block.id;
        const append = event.shiftKey === true;
        window.setTimeout(() => {
            if (!element.isConnected || runtimeLifecycle.getActive()?.block?.id === blockId) {
                return;
            }
            const board = state.boardData?.boards?.[state.currentBoardId];
            if (!board?.blocks?.some?.((candidate) => candidate?.id === blockId && candidate?.type === 'animated3d')) {
                return;
            }
            movement.selectBlock?.(blockId, { append });
            console.info(`animated3d status=ok,operation=pointer-select,id=${blockId},target=${String(event.target?.className || event.target?.tagName || 'unknown').replace(/\s+/g, '_')}`);
        }, 0);
    }, { capture: true });
}

function populateAnimated3dBlockElement(block, element) {
    disposeRuntimeForBlock(block.id, 'block-rerender');
    element.classList.add('animated3d-board-block');
    bindBlockSelectionOwnership(block, element);
    const packageResult = packageForBlock(block);
    renderInactiveShell(block, element, packageResult);
}

function handleSelectionChanged(selectedIds, primaryId) {
    const activationSequence = ++selectionActivationSequence;
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    const activeRuntime = runtimeLifecycle.getActive();
    if (activeRuntime && !selected.has(activeRuntime.block?.id)) {
        activeRuntime.dispose('selection-loss');
    }
    const board = state.boardData?.boards?.[state.currentBoardId];
    const preferredIds = primaryId && selected.has(primaryId)
        ? [primaryId, ...Array.from(selected).filter((id) => id !== primaryId)]
        : Array.from(selected);
    const block = preferredIds
        .map((id) => board?.blocks?.find?.((candidate) => candidate?.id === id))
        .find((candidate) => candidate?.type === 'animated3d');
    if (!block || runtimeLifecycle.getActive()?.block?.id === block.id || env.windowActivity?.isBackground?.()) {
        return;
    }
    queueMicrotask(() => {
        if (activationSequence !== selectionActivationSequence
            || !state.selectedBlockIds.has(block.id)
            || runtimeLifecycle.getActive()?.block?.id === block.id
            || env.windowActivity?.isBackground?.()) {
            return;
        }
        const element = Array.from(document.querySelectorAll('.board-block'))
            .find((candidate) => candidate.dataset?.id === block.id);
        if (element) {
            activateBlock(block, element, packageForBlock(block));
        }
    });
}

function createAnimated3dBlockRecord(packageRef, position) {
    const now = new Date().toISOString();
    const fallback = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const snapped = utils.snapPointToGrid(position || fallback);
    return {
        id: utils.createId('animated3d'),
        type: 'animated3d',
        x: snapped.x,
        y: snapped.y,
        width: constants.GRID_SIZE * 26,
        height: constants.GRID_SIZE * 18,
        packageRef: normalizeAnimated3dPackageReference(packageRef),
        preferences: normalizeAnimated3dPreferences(),
        createdAt: now,
        updatedAt: now
    };
}

async function importAnimated3dFile(source, position) {
    try {
        data.ensureDataDirectories?.();
        const staged = await stageAnimated3dPackage(source, { assetsDir: env.paths.assetsDir });
        data.invalidateAssetIndex?.();
        const block = createAnimated3dBlockRecord(staged.packageRef, position);
        management.insertBlock(block, { saveReason: 'animated3d-added' });
        movement.selectBlock(block.id);
        console.info(`animated3d status=ok,operation=import,id=${block.id},package=${staged.packageRef},created=${staged.created ? 1 : 0}`);
        return block;
    } catch (error) {
        const message = error?.message || 'Unable to import GLB package';
        console.warn(`animated3d status=failed,operation=import,stage=package,message=${message}`);
        utils.showToast('Use a valid self-contained GLB animation package');
        return null;
    }
}

function setAnimated3dPackageReference(block, packageRef, options = {}) {
    if (!block || block.type !== 'animated3d') {
        return false;
    }
    const normalized = normalizeAnimated3dPackageReference(packageRef);
    if (!normalized) {
        return false;
    }
    if (block.packageRef === normalized) {
        return true;
    }
    disposeRuntimeForBlock(block.id, 'source-change');
    block.packageRef = normalized;
    block.preferences = normalizeAnimated3dPreferences(block.preferences);
    block.updatedAt = new Date().toISOString();
    if (!options.skipSave) {
        data.queueSave('animated3d-source-change');
    }
    if (!options.skipRender) {
        management.renderBoard?.();
    }
    return true;
}

async function replaceAnimated3dSource(block, source) {
    if (!block || block.type !== 'animated3d') {
        return false;
    }
    try {
        data.ensureDataDirectories?.();
        const staged = await stageAnimated3dPackage(source, { assetsDir: env.paths.assetsDir });
        data.invalidateAssetIndex?.();
        return setAnimated3dPackageReference(block, staged.packageRef);
    } catch (error) {
        console.warn(`animated3d status=failed,operation=source-change,id=${block.id},message=${error?.message || 'unknown'}`);
        utils.showToast('Unable to replace the GLB package');
        return false;
    }
}

function handleGlobalKeydown(event) {
    if (event?.key !== 'Escape' || !runtimeLifecycle.getActive()) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    disposeActiveRuntime('escape');
    return true;
}

function ownsKeyboardEvent(event) {
    const runtime = runtimeLifecycle.getActive();
    if (!runtime || !runtime.element?.isConnected) {
        return false;
    }
    const active = document.activeElement;
    return !!(runtime.element.contains(event?.target) || runtime.element.contains(active));
}

function getRuntimeDiagnostics() {
    const runtime = runtimeLifecycle.getActive();
    if (!runtime) {
        return {
            active: false,
            blockId: '',
            mounted: false,
            rafActive: false,
            rendererAllocated: false,
            clipCount: 0,
            boneCount: 0,
            playing: false
        };
    }
    const resources = countMaterialResources(runtime.model);
    const timelineRow = runtime.controlsUi?.controls?.querySelector?.('.animated3d-timeline-row');
    const toolbarRow = runtime.controlsUi?.controls?.querySelector?.('.animated3d-toolbar-row');
    return {
        active: isRuntimeAlive(runtime),
        blockId: String(runtime.block?.id || ''),
        selected: state.selectedBlockIds?.has?.(runtime.block?.id) === true,
        mounted: runtime.mounted === true,
        rafActive: runtime.rafId !== null,
        rendererAllocated: !!runtime.renderer,
        clipCount: runtime.clips.length,
        clipNames: runtime.clips.map((clip) => String(clip?.name || '')),
        activeClipIndex: runtime.activeClipIndex,
        speed: runtime.preferences.speed,
        playing: runtime.playing,
        animationTime: Number(runtime.activeAction?.time || 0),
        clay: runtime.preferences.clay,
        rootMotionPreview: runtime.preferences.rootMotionPreview,
        boneCount: countBones(runtime.model),
        materialCount: resources.materialCount,
        textureCount: resources.textureCount,
        controlLayout: {
            timelineItems: timelineRow?.children?.length || 0,
            toolbarWraps: !!toolbarRow && toolbarRow.scrollHeight > toolbarRow.clientHeight + 1,
            toolbarFits: !!toolbarRow && toolbarRow.scrollWidth <= toolbarRow.clientWidth + 1
        }
    };
}

async function activateBlockForAutomation(blockId) {
    const normalizedId = String(blockId || '').trim();
    const board = state.boardData?.boards?.[state.currentBoardId];
    const block = board?.blocks?.find?.((candidate) =>
        candidate?.type === 'animated3d'
        && (!normalizedId || candidate.id === normalizedId));
    if (!block) {
        return { success: false, error: 'animated3d-block-not-found', diagnostics: getRuntimeDiagnostics() };
    }
    const element = Array.from(document.querySelectorAll('.board-block'))
        .find((candidate) => candidate.dataset?.id === block.id);
    if (!element) {
        return { success: false, error: 'animated3d-element-not-found', diagnostics: getRuntimeDiagnostics() };
    }
    const existingRuntime = runtimeLifecycle.getActive();
    if (existingRuntime?.block?.id === block.id) {
        await existingRuntime.mountPromise;
        return {
            success: existingRuntime.mounted === true,
            error: existingRuntime.mounted === true ? '' : 'animated3d-mount-failed',
            diagnostics: getRuntimeDiagnostics()
        };
    }
    if (state.selectedBlockIds.has(block.id)) {
        movement.clearSelection?.();
    }
    const hitTarget = element.querySelector('.animated3d-stage') || element;
    const rect = hitTarget.getBoundingClientRect();
    hitTarget.addEventListener('pointerdown', (event) => event.stopPropagation(), { once: true });
    hitTarget.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        composed: true,
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerId: 913,
        clientX: rect.left + (rect.width / 2),
        clientY: rect.top + (rect.height / 2)
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
    const runtime = runtimeLifecycle.getActive();
    if (!runtime) {
        return { success: false, error: 'animated3d-activation-rejected', diagnostics: getRuntimeDiagnostics() };
    }
    await runtime.mountPromise;
    const diagnostics = getRuntimeDiagnostics();
    return {
        success: diagnostics.active && diagnostics.mounted,
        error: diagnostics.active && diagnostics.mounted ? '' : 'animated3d-mount-failed',
        diagnostics
    };
}

function deactivateBlockForAutomation(reason = 'automation') {
    const disposed = disposeActiveRuntime(reason);
    return { success: true, disposed, diagnostics: getRuntimeDiagnostics() };
}

function controlActiveRuntimeForAutomation(options = {}) {
    const runtime = runtimeLifecycle.getActive();
    if (!isRuntimeAlive(runtime) || !runtime.mounted) {
        return { success: false, error: 'animated3d-runtime-not-active', diagnostics: getRuntimeDiagnostics() };
    }
    if (options.clip !== undefined) {
        const requestedClip = String(options.clip || '').trim();
        const requestedIndex = Number(options.clip);
        const clipIndex = Number.isSafeInteger(requestedIndex)
            ? requestedIndex
            : runtime.clips.findIndex((clip) => clip?.name === requestedClip);
        if (clipIndex < 0 || clipIndex >= runtime.clips.length) {
            return { success: false, error: 'animated3d-clip-not-found', diagnostics: getRuntimeDiagnostics() };
        }
        selectAnimationClip(runtime, clipIndex, { persist: false, play: true });
    }
    if (options.speed !== undefined) {
        const speed = Number(options.speed);
        if (!SPEEDS.includes(speed)) {
            return { success: false, error: 'animated3d-speed-unsupported', diagnostics: getRuntimeDiagnostics() };
        }
        setAnimationSpeed(runtime, speed, { persist: false });
    }
    if (options.view !== undefined) {
        const view = String(options.view || '').trim();
        if (!CAMERA_VIEWS.includes(view)) {
            return { success: false, error: 'animated3d-view-unsupported', diagnostics: getRuntimeDiagnostics() };
        }
        setCameraView(runtime, view, { persist: false });
    }
    if (options.clay !== undefined) {
        runtime.preferences.clay = options.clay === true;
        syncClayPreview(runtime);
        refreshControlState(runtime);
    }
    if (options.playing === true && !runtime.playing) {
        togglePlayback(runtime);
    } else if (options.playing === false && runtime.playing) {
        togglePlayback(runtime);
    }
    const diagnostics = getRuntimeDiagnostics();
    diagnostics.activeClipName = runtime.clips[runtime.activeClipIndex]?.name || '';
    diagnostics.view = runtime.preferences.view;
    return { success: true, diagnostics };
}

const animated3dApi = {
    isAnimated3dExtension,
    isExcludedAnimated3dExtension,
    importAnimated3dFile,
    populateElement: populateAnimated3dBlockElement,
    handleSelectionChanged,
    disposeActiveRuntime,
    disposeRuntimeForBlock,
    setAnimated3dPackageReference,
    replaceAnimated3dSource,
    handleGlobalKeydown,
    ownsKeyboardEvent,
    getRuntimeDiagnostics,
    activateBlockForAutomation,
    deactivateBlockForAutomation,
    controlActiveRuntimeForAutomation,
    sanitizeBlockData: sanitizeAnimated3dBlockData,
    getActiveRuntime: runtimeLifecycle.getActive
};

env.blocks.animated3d = animated3dApi;
env.animated3dBlocks = animated3dApi;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const reactivateSelectedBlock = () => {
        window.setTimeout(() => {
            if (document.visibilityState !== 'hidden') {
                handleSelectionChanged(state.selectedBlockIds, state.selectedBlockId);
            }
        }, 0);
    };
    window.addEventListener('focus', reactivateSelectedBlock);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            reactivateSelectedBlock();
        }
    });
}

module.exports = animated3dApi;
