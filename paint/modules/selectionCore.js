'use strict';

// MARK: MODULE
module.exports = function createPaintSelectionTransformModule(deps) {
    const {
        env,
        utils,
        MAX_CANVAS_DIMENSION,
        CROP_NUDGE_STEP,
        CROP_NUDGE_STEP_FAST,
        LAYER_BASE_NAME,
        paintWorkspaceState,
        getSession,
        clamp,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        renderStageUi,
        renderCursorCanvas,
        clearSelectionCanvas,
        clearOverlayCanvas,
        clearUiCanvas,
        pushUndoAction,
        updateHud,
        updateStageCursor,
        resizeCanvases,
        createDynamicPaintLayerCanvas,
        createLayerRecord,
        buildLayerName,
        syncPaintLayerCanvasOrder,
        setActiveLayerRefs,
        getActiveLayer,
        setActiveLayerById,
        fitToScreen,
        createPaintLayer,
        refreshTimelinePreviewForCurrentFrame,
        isTimelineBarVisible,
        renderLayerBar,
        exportCanvasToPngBuffer,
        setWrapTransform,
        applyCanvasResizeSnapshot,
        logPaintTrace
    } = deps;

    let session = null;
    let lassoPreviewQueued = false;

    function bindSession() {
        session = getSession();
        return session;
    }

    function nowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    function buildPath2D(points, offsetX = 0, offsetY = 0) {
        if (!Array.isArray(points) || points.length < 2) {
            return null;
        }
        const path = new Path2D();
        const first = points[0];
        path.moveTo(first.x + offsetX, first.y + offsetY);
        for (let index = 1; index < points.length; index += 1) {
            const point = points[index];
            path.lineTo(point.x + offsetX, point.y + offsetY);
        }
        path.closePath();
        return path;
    }

    function buildPath2DFromLoops(loops) {
        if (!Array.isArray(loops) || loops.length === 0) {
            return null;
        }
        const path = new Path2D();
        let hasPath = false;
        for (const loop of loops) {
            if (!Array.isArray(loop) || loop.length < 2) {
                continue;
            }
            const first = loop[0];
            path.moveTo(first.x, first.y);
            for (let index = 1; index < loop.length; index += 1) {
                const point = loop[index];
                path.lineTo(point.x, point.y);
            }
            path.closePath();
            hasPath = true;
        }
        return hasPath ? path : null;
    }

    function computeAabb(points) {
        if (!Array.isArray(points) || points.length === 0) {
            return null;
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of points) {
            if (!point) {
                continue;
            }
            const x = Number(point.x);
            const y = Number(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return null;
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    function transformPoint(point, transform) {
        const cx = transform.centerX;
        const cy = transform.centerY;
        const sx = transform.scaleX;
        const sy = transform.scaleY;
        const rot = transform.rotation;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const px = (point.x - cx) * sx;
        const py = (point.y - cy) * sy;
        const rx = (px * cos) - (py * sin);
        const ry = (px * sin) + (py * cos);
        return {
            x: rx + cx + transform.dx,
            y: ry + cy + transform.dy
        };
    }

    function transformBoundsCorners(bounds, transform) {
        const corners = [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
            { x: bounds.x, y: bounds.y + bounds.height }
        ];
        return corners.map((corner) => transformPoint(corner, transform));
    }

    function updateTransformPreviewGeometry() {
        if (!session?.transform?.active || !session.selection?.components || session.selection.inverted) {
            return;
        }
        const transformedComponents = [];
        const allPoints = [];
        for (const component of session.selection.components) {
            if (!component || !Array.isArray(component.points)) {
                continue;
            }
            const nextPoints = component.points.map((point) => transformPoint(point, session.transform));
            transformedComponents.push({ op: component.op, points: nextPoints });
            allPoints.push(...nextPoints);
        }
        session.transform.previewComponents = transformedComponents;
        const previewComponentPath = buildSelectionPathFromComponents(transformedComponents, false, 0, 0);
        if (Array.isArray(session.selection.outlineLoops) && session.selection.outlineLoops.length) {
            const previewOutlineLoops = session.selection.outlineLoops.map((loop) => loop.map((point) => transformPoint(point, session.transform)));
            session.transform.previewOutlineLoops = previewOutlineLoops;
            session.transform.previewOutlinePath = buildPath2DFromLoops(previewOutlineLoops);
        } else {
            session.transform.previewOutlineLoops = null;
            session.transform.previewOutlinePath = null;
        }
        session.transform.previewPath = session.transform.previewOutlinePath || previewComponentPath;
        session.transform.previewBounds = computeAabb(allPoints);
        session.transform.previewCorners = transformBoundsCorners(session.selection.bounds, session.transform);
        const corners = session.transform.previewCorners;
        if (corners && corners.length === 4) {
            const p0 = corners[0];
            const p1 = corners[1];
            const p2 = corners[2];
            const p3 = corners[3];
            session.transform.handles = {
                top: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
                right: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
                bottom: { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 },
                left: { x: (p3.x + p0.x) / 2, y: (p3.y + p0.y) / 2 },
                uniform: { x: p2.x, y: p2.y }
            };
        } else {
            session.transform.handles = null;
        }
    }

    function resolveTransformHandleAtStage(stageX, stageY) {
        if (!session?.transform?.active || !session.transform.handles) {
            return null;
        }
        const handles = session.transform.handles;
        const radius = 10;
        const radiusSq = radius * radius;
        const candidates = ['top', 'right', 'bottom', 'left', 'uniform'];
        for (const key of candidates) {
            const handle = handles[key];
            if (!handle) {
                continue;
            }
            const pos = deps.imageToStage(handle.x, handle.y);
            const dx = stageX - pos.x;
            const dy = stageY - pos.y;
            if ((dx * dx) + (dy * dy) <= radiusSq) {
                return key;
            }
        }
        return null;
    }

    function beginTransformDrag(ix, iy, stageX, stageY) {
        if (!bindSession() || !session?.transform?.active || !session.selection?.path) {
            return false;
        }
        updateTransformPreviewGeometry();
        const transform = session.transform;
        const handleHit = resolveTransformHandleAtStage(stageX, stageY);
        const hitPath = transform.previewOutlinePath || transform.previewPath || session.selection.path;
        const hit = session.baseCtx.isPointInPath(hitPath, ix, iy, session.selection.fillRule || 'nonzero');
        transform.dragging = true;
        transform.startX = ix;
        transform.startY = iy;
        transform.startDx = transform.dx;
        transform.startDy = transform.dy;
        transform.startScaleX = transform.scaleX;
        transform.startScaleY = transform.scaleY;
        transform.startRotation = transform.rotation;
        const centerX = transform.centerX + transform.startDx;
        const centerY = transform.centerY + transform.startDy;
        const vx = ix - centerX;
        const vy = iy - centerY;
        const cos = Math.cos(transform.startRotation);
        const sin = Math.sin(transform.startRotation);
        const projX = (vx * cos) + (vy * sin);
        const projY = (-vx * sin) + (vy * cos);
        const dist = Math.hypot(projX, projY);
        transform.startProjX = Math.abs(projX) > 0.001 ? projX : (projX < 0 ? -1 : 1);
        transform.startProjY = Math.abs(projY) > 0.001 ? projY : (projY < 0 ? -1 : 1);
        transform.startDist = dist > 0.001 ? dist : 1;
        if (handleHit) {
            transform.handle = handleHit;
            if (handleHit === 'left' || handleHit === 'right') {
                transform.mode = 'scale-x';
            } else if (handleHit === 'top' || handleHit === 'bottom') {
                transform.mode = 'scale-y';
            } else {
                transform.mode = 'scale-uniform';
            }
            return true;
        }
        transform.handle = null;
        if (hit) {
            transform.mode = 'move';
            return true;
        }
        transform.mode = 'rotate';
        transform.startAngle = Math.atan2(vy, vx);
        return true;
    }

    function updateTransformDrag(ix, iy) {
        if (!bindSession() || !session?.transform?.active || !session.transform.dragging) {
            return;
        }
        const transform = session.transform;
        const mode = transform.mode;
        if (mode === 'move') {
            transform.dx = transform.startDx + (ix - transform.startX);
            transform.dy = transform.startDy + (iy - transform.startY);
            updateTransformPreviewGeometry();
            return;
        }
        transform.dx = transform.startDx;
        transform.dy = transform.startDy;
        const centerX = transform.centerX + transform.startDx;
        const centerY = transform.centerY + transform.startDy;
        const vx = ix - centerX;
        const vy = iy - centerY;
        if (mode === 'rotate') {
            const angle = Math.atan2(vy, vx);
            transform.rotation = deps.normalizeAngleRad(transform.startRotation + (angle - transform.startAngle));
            updateTransformPreviewGeometry();
            return;
        }
        transform.rotation = transform.startRotation;
        const cos = Math.cos(transform.rotation);
        const sin = Math.sin(transform.rotation);
        const projX = (vx * cos) + (vy * sin);
        const projY = (-vx * sin) + (vy * cos);
        const dist = Math.hypot(projX, projY);
        if (mode === 'scale-x') {
            const ratio = projX / transform.startProjX;
            transform.scaleX = clamp(transform.startScaleX * Math.max(0.05, ratio), 0.05, 20);
            transform.scaleY = transform.startScaleY;
        } else if (mode === 'scale-y') {
            const ratio = projY / transform.startProjY;
            transform.scaleY = clamp(transform.startScaleY * Math.max(0.05, ratio), 0.05, 20);
            transform.scaleX = transform.startScaleX;
        } else if (mode === 'scale-uniform') {
            const ratio = dist / transform.startDist;
            const safe = Math.max(0.05, ratio);
            transform.scaleX = clamp(transform.startScaleX * safe, 0.05, 20);
            transform.scaleY = clamp(transform.startScaleY * safe, 0.05, 20);
        }
        updateTransformPreviewGeometry();
    }

    function computePolygonBounds(points) {
        if (!Array.isArray(points) || points.length === 0) {
            return null;
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of points) {
            if (!point) {
                continue;
            }
            const x = Number(point.x);
            const y = Number(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return null;
        }
        const width = Math.max(1, Math.ceil(maxX - minX));
        const height = Math.max(1, Math.ceil(maxY - minY));
        return { x: Math.floor(minX), y: Math.floor(minY), width, height };
    }

    function reversePoints(points) {
        if (!Array.isArray(points)) {
            return [];
        }
        const out = points.slice();
        out.reverse();
        return out;
    }

    function unionBounds(a, b) {
        if (!a) {
            return b ? { ...b } : null;
        }
        if (!b) {
            return { ...a };
        }
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x + a.width, b.x + b.width);
        const y1 = Math.max(a.y + a.height, b.y + b.height);
        return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
    }

    function simplifyClosedLoop(points) {
        if (!Array.isArray(points) || points.length < 4) {
            return Array.isArray(points) ? points.slice() : [];
        }
        const out = [];
        const length = points.length;
        for (let index = 0; index < length; index += 1) {
            const prev = points[(index + length - 1) % length];
            const curr = points[index];
            const next = points[(index + 1) % length];
            if (!prev || !curr || !next) {
                continue;
            }
            const dx1 = curr.x - prev.x;
            const dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x;
            const dy2 = next.y - curr.y;
            const collinear = ((dx1 === 0 && dx2 === 0) || (dy1 === 0 && dy2 === 0));
            if (collinear) {
                continue;
            }
            out.push(curr);
        }
        return out.length >= 3 ? out : points.slice();
    }

    function buildOutlineLoopsFromMask(bounds, maskCanvas) {
        if (!bounds || !maskCanvas) {
            return [];
        }
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
        if (!maskCtx) {
            return [];
        }
        const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const { data, width, height } = imageData;
        const isFilled = (x, y) => {
            if (x < 0 || y < 0 || x >= width || y >= height) {
                return false;
            }
            return data[((y * width) + x) * 4 + 3] > 0;
        };
        const edgeMap = new Map();
        const addEdge = (x0, y0, x1, y1) => {
            const startKey = `${x0 + bounds.x},${y0 + bounds.y}`;
            const next = { x: x1 + bounds.x, y: y1 + bounds.y };
            let list = edgeMap.get(startKey);
            if (!list) {
                list = [];
                edgeMap.set(startKey, list);
            }
            list.push(next);
        };
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (!isFilled(x, y)) {
                    continue;
                }
                if (!isFilled(x, y - 1)) {
                    addEdge(x, y, x + 1, y);
                }
                if (!isFilled(x + 1, y)) {
                    addEdge(x + 1, y, x + 1, y + 1);
                }
                if (!isFilled(x, y + 1)) {
                    addEdge(x + 1, y + 1, x, y + 1);
                }
                if (!isFilled(x - 1, y)) {
                    addEdge(x, y + 1, x, y);
                }
            }
        }
        const takeNextEdge = (key) => {
            const list = edgeMap.get(key);
            if (!list || !list.length) {
                return null;
            }
            const next = list.shift();
            if (!list.length) {
                edgeMap.delete(key);
            }
            return next;
        };
        const loops = [];
        while (edgeMap.size) {
            const entry = edgeMap.entries().next().value;
            if (!entry) {
                break;
            }
            const [startKey] = entry;
            const [startX, startY] = startKey.split(',').map(Number);
            const start = { x: startX, y: startY };
            const loop = [start];
            let next = takeNextEdge(startKey);
            let guard = 0;
            while (next && guard < 100000) {
                if (next.x === start.x && next.y === start.y) {
                    break;
                }
                loop.push(next);
                next = takeNextEdge(`${next.x},${next.y}`);
                guard += 1;
            }
            const simplified = simplifyClosedLoop(loop);
            if (simplified.length >= 3) {
                loops.push(simplified);
            }
        }
        return loops;
    }

    function buildSelectionPathFromComponents(components, inverted, offsetX = 0, offsetY = 0) {
        if (!session) {
            return null;
        }
        const path = new Path2D();
        const safeComponents = Array.isArray(components) ? components : [];
        if (inverted) {
            const rectPath = new Path2D();
            rectPath.rect(0 + offsetX, 0 + offsetY, session.width, session.height);
            path.addPath(rectPath);
        }
        for (const component of safeComponents) {
            if (!component || !Array.isArray(component.points) || component.points.length < 3) {
                continue;
            }
            const op = component.op === 'sub' ? 'sub' : 'add';
            const effective = inverted ? (op === 'add' ? 'sub' : 'add') : op;
            const points = effective === 'sub' ? reversePoints(component.points) : component.points;
            const subPath = buildPath2D(points, offsetX, offsetY);
            if (subPath) {
                path.addPath(subPath);
            }
        }
        return path;
    }

    function buildResolvedSelectionPath(path, outlinePath) {
        if (outlinePath) {
            return {
                path: outlinePath,
                fillRule: 'evenodd'
            };
        }
        return {
            path,
            fillRule: 'nonzero'
        };
    }

    function computeSelectionBoundsFromComponents(components, inverted) {
        if (!session) {
            return null;
        }
        if (inverted) {
            return { x: 0, y: 0, width: session.width, height: session.height };
        }
        const safeComponents = Array.isArray(components) ? components : [];
        let out = null;
        for (const component of safeComponents) {
            if (!component || !Array.isArray(component.points)) {
                continue;
            }
            const bounds = computePolygonBounds(component.points);
            if (bounds) {
                out = unionBounds(out, bounds);
            }
        }
        return out;
    }

    function buildRectComponent(bounds) {
        if (!bounds) {
            return null;
        }
        return {
            op: 'add',
            points: [
                { x: bounds.x, y: bounds.y },
                { x: bounds.x + bounds.width, y: bounds.y },
                { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
                { x: bounds.x, y: bounds.y + bounds.height }
            ]
        };
    }

    function computeAlphaBounds(imageData) {
        if (!imageData?.data || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height)) {
            return null;
        }
        const { data, width, height } = imageData;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const alpha = data[((y * width) + x) * 4 + 3];
                if (alpha <= 0) {
                    continue;
                }
                if (x < minX) {
                    minX = x;
                }
                if (y < minY) {
                    minY = y;
                }
                if (x > maxX) {
                    maxX = x;
                }
                if (y > maxY) {
                    maxY = y;
                }
            }
        }
        if (maxX < minX || maxY < minY) {
            return null;
        }
        return {
            x: minX,
            y: minY,
            width: (maxX - minX) + 1,
            height: (maxY - minY) + 1
        };
    }

    function buildMaskCanvasFromAlphaBounds(imageData, bounds) {
        if (!imageData?.data || !bounds) {
            return null;
        }
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = bounds.width;
        maskCanvas.height = bounds.height;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: false });
        if (!maskCtx) {
            return null;
        }
        const out = maskCtx.createImageData(bounds.width, bounds.height);
        const src = imageData.data;
        const dst = out.data;
        const srcWidth = imageData.width;
        for (let row = 0; row < bounds.height; row += 1) {
            const srcY = bounds.y + row;
            for (let col = 0; col < bounds.width; col += 1) {
                const srcX = bounds.x + col;
                const srcIndex = ((srcY * srcWidth) + srcX) * 4;
                const alpha = src[srcIndex + 3];
                if (alpha <= 0) {
                    continue;
                }
                const dstIndex = ((row * bounds.width) + col) * 4;
                dst[dstIndex] = 255;
                dst[dstIndex + 1] = 255;
                dst[dstIndex + 2] = 255;
                dst[dstIndex + 3] = alpha;
            }
        }
        maskCtx.putImageData(out, 0, 0);
        return maskCanvas;
    }

    function rebuildSelectionFromMask(bounds, maskCanvas, components = null) {
        if (!session || !bounds || !maskCanvas) {
            return null;
        }
        const startedAt = nowMs();
        if (session.selectionEdit) {
            session.selectionEdit = null;
            clearSelectionCanvas();
        }
        const rectComponent = buildRectComponent(bounds);
        const safeComponents = Array.isArray(components) && components.length ? components : (rectComponent ? [rectComponent] : []);
        const componentPath = buildSelectionPathFromComponents(safeComponents, false, 0, 0);
        const outlineLoops = buildOutlineLoopsFromMask(bounds, maskCanvas);
        const outlinePath = buildPath2DFromLoops(outlineLoops);
        const resolved = buildResolvedSelectionPath(componentPath, outlinePath);
        if (!resolved.path) {
            clearSelection();
            return null;
        }
        const metrics = {
            source: 'mask',
            ms: Number((nowMs() - startedAt).toFixed(2)),
            componentCount: safeComponents.length,
            boundsWidth: bounds.width,
            boundsHeight: bounds.height,
            maskPixels: maskCanvas.width * maskCanvas.height,
            loopCount: outlineLoops.length
        };
        session.selection = {
            components: safeComponents,
            inverted: false,
            fillRule: resolved.fillRule,
            path: resolved.path,
            outlineLoops,
            outlinePath,
            bounds: { ...bounds },
            maskCanvas,
            metrics
        };
        if (metrics.ms >= 8) {
            logPaintTrace('paint.selection.rebuild.slow', metrics);
        }
        renderStageUi();
        renderCursorCanvas();
        return metrics;
    }

    function ensureTransformSelection() {
        if (!bindSession() || !session) {
            return false;
        }
        if (session.selection?.bounds && session.selection?.maskCanvas && !session.selection.inverted) {
            return true;
        }
        if (session.selection?.inverted) {
            utils.showToast?.('Paint: inverted selections cannot be transformed yet');
            return false;
        }
        const activeLayer = getActiveLayer();
        if (!activeLayer?.ctx) {
            return false;
        }
        const imageData = activeLayer.ctx.getImageData(0, 0, session.width, session.height);
        const bounds = computeAlphaBounds(imageData);
        if (!bounds) {
            utils.showToast?.('Paint: active layer is empty');
            return false;
        }
        const maskCanvas = buildMaskCanvasFromAlphaBounds(imageData, bounds);
        if (!maskCanvas) {
            return false;
        }
        return rebuildSelectionFromMask(bounds, maskCanvas);
    }

    function rebuildSelectionFromComponents(components, inverted = false) {
        if (!session) {
            return null;
        }
        const startedAt = nowMs();
        if (session.selectionEdit) {
            session.selectionEdit = null;
            clearSelectionCanvas();
        }
        const safeComponents = Array.isArray(components) ? components.filter((c) => c && Array.isArray(c.points) && c.points.length >= 3) : [];
        if (safeComponents.length === 0) {
            clearSelection();
            return null;
        }
        const bounds = computeSelectionBoundsFromComponents(safeComponents, inverted);
        if (!bounds) {
            clearSelection();
            return null;
        }
        const clampedBounds = {
            x: clamp(Math.floor(bounds.x), 0, session.width - 1),
            y: clamp(Math.floor(bounds.y), 0, session.height - 1),
            width: clamp(Math.ceil(bounds.width), 1, session.width),
            height: clamp(Math.ceil(bounds.height), 1, session.height)
        };
        const componentPath = buildSelectionPathFromComponents(safeComponents, inverted, 0, 0);
        if (!componentPath) {
            clearSelection();
            return null;
        }
        let maskCanvas = null;
        let outlineLoops = [];
        let outlinePath = null;
        let resolvedBounds = clampedBounds;
        let fillRule = 'nonzero';
        if (!inverted) {
            const maskStartedAt = nowMs();
            maskCanvas = document.createElement('canvas');
            maskCanvas.width = clampedBounds.width;
            maskCanvas.height = clampedBounds.height;
            const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: false });
            if (!maskCtx) {
                clearSelection();
                return null;
            }
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            maskCtx.fillStyle = '#fff';
            const localPath = buildSelectionPathFromComponents(safeComponents, false, -clampedBounds.x, -clampedBounds.y);
            if (localPath) {
                maskCtx.fill(localPath, 'nonzero');
            }
            const localImageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            const localBounds = computeAlphaBounds(localImageData);
            if (!localBounds) {
                clearSelection();
                return null;
            }
            if (
                localBounds.x !== 0
                || localBounds.y !== 0
                || localBounds.width !== maskCanvas.width
                || localBounds.height !== maskCanvas.height
            ) {
                const croppedMaskCanvas = buildMaskCanvasFromAlphaBounds(localImageData, localBounds);
                if (!croppedMaskCanvas) {
                    clearSelection();
                    return null;
                }
                maskCanvas = croppedMaskCanvas;
            }
            resolvedBounds = {
                x: clampedBounds.x + localBounds.x,
                y: clampedBounds.y + localBounds.y,
                width: localBounds.width,
                height: localBounds.height
            };
            const outlineStartedAt = nowMs();
            outlineLoops = buildOutlineLoopsFromMask(resolvedBounds, maskCanvas);
            outlinePath = buildPath2DFromLoops(outlineLoops);
            const resolved = buildResolvedSelectionPath(componentPath, outlinePath);
            fillRule = resolved.fillRule;
            const metrics = {
                source: 'components',
                ms: Number((nowMs() - startedAt).toFixed(2)),
                maskMs: Number((outlineStartedAt - maskStartedAt).toFixed(2)),
                outlineMs: Number((nowMs() - outlineStartedAt).toFixed(2)),
                componentCount: safeComponents.length,
                boundsWidth: resolvedBounds.width,
                boundsHeight: resolvedBounds.height,
                maskPixels: maskCanvas.width * maskCanvas.height,
                loopCount: outlineLoops.length,
                inverted: false
            };
            session.selection = {
                components: safeComponents,
                inverted: false,
                fillRule,
                path: resolved.path,
                outlineLoops,
                outlinePath,
                bounds: resolvedBounds,
                maskCanvas,
                metrics
            };
            if (metrics.ms >= 8 || metrics.outlineMs >= 6) {
                logPaintTrace('paint.selection.rebuild.slow', metrics);
            }
            renderStageUi();
            renderCursorCanvas();
            return metrics;
        }
        const metrics = {
            source: 'components',
            ms: Number((nowMs() - startedAt).toFixed(2)),
            componentCount: safeComponents.length,
            boundsWidth: resolvedBounds.width,
            boundsHeight: resolvedBounds.height,
            maskPixels: 0,
            loopCount: 0,
            inverted: true
        };
        session.selection = {
            components: safeComponents,
            inverted: !!inverted,
            fillRule,
            path: componentPath,
            outlineLoops,
            outlinePath,
            bounds: resolvedBounds,
            maskCanvas,
            metrics
        };
        if (inverted) {
            session.transform = null;
            if (session.editMode === deps.EDIT_MODE_TRANSFORM) {
                session.editMode = session.select?.toolLocked ? deps.EDIT_MODE_SELECT : deps.EDIT_MODE_PAINT;
            }
        }
        renderStageUi();
        renderCursorCanvas();
        return metrics;
    }

    function renderLassoPreview() {
        if (lassoPreviewQueued) {
            return;
        }
        lassoPreviewQueued = true;
        window.requestAnimationFrame(() => {
            lassoPreviewQueued = false;
            const previewStartedAt = nowMs();
            renderStageUi();
            const trace = session?.select?.trace;
            if (!trace) {
                return;
            }
            trace.previewFrames = (Number(trace.previewFrames) || 0) + 1;
            const previewMs = nowMs() - previewStartedAt;
            trace.maxPreviewMs = Math.max(Number(trace.maxPreviewMs) || 0, previewMs);
            trace.totalPreviewMs = (Number(trace.totalPreviewMs) || 0) + previewMs;
            const lastSlowLoggedAt = Number(trace.lastSlowLoggedAt) || 0;
            const now = nowMs();
            if (previewMs >= 10 && (now - lastSlowLoggedAt) >= 200) {
                trace.lastSlowLoggedAt = now;
                logPaintTrace('paint.selection.preview.slow', {
                    ms: Number(previewMs.toFixed(2)),
                    mode: String(session.select?.mode || 'lasso'),
                    op: String(session.select?.op || 'replace'),
                    points: Array.isArray(session.select?.points) ? session.select.points.length : 0,
                    previewFrames: trace.previewFrames
                });
            }
        });
    }

    function extractImageDataRegion(fullImageData, x, y, width, height) {
        if (!fullImageData || width <= 0 || height <= 0) {
            return null;
        }
        const srcWidth = fullImageData.width;
        const srcHeight = fullImageData.height;
        const src = fullImageData.data;
        const out = new ImageData(width, height);
        const dst = out.data;
        for (let row = 0; row < height; row += 1) {
            const sy = y + row;
            if (sy < 0 || sy >= srcHeight) {
                continue;
            }
            for (let col = 0; col < width; col += 1) {
                const sx = x + col;
                if (sx < 0 || sx >= srcWidth) {
                    continue;
                }
                const srcIndex = (sy * srcWidth + sx) * 4;
                const dstIndex = (row * width + col) * 4;
                dst[dstIndex] = src[srcIndex];
                dst[dstIndex + 1] = src[srcIndex + 1];
                dst[dstIndex + 2] = src[srcIndex + 2];
                dst[dstIndex + 3] = src[srcIndex + 3];
            }
        }
        return out;
    }

    function renderSelectionOverlay() {
        renderStageUi();
    }

    function cloneSelectionComponents(components) {
        if (!Array.isArray(components)) {
            return [];
        }
        return components.map((component) => ({
            op: component.op,
            points: Array.isArray(component.points) ? component.points.map((point) => ({ x: point.x, y: point.y })) : []
        }));
    }

    function captureSelectionSnapshot() {
        if (!session?.selection?.components) {
            return null;
        }
        return {
            components: cloneSelectionComponents(session.selection.components),
            inverted: !!session.selection.inverted
        };
    }

    function captureFullSnapshot() {
        if (!bindSession() || !session) {
            return null;
        }
        const width = session.width;
        const height = session.height;
        const snapshotLayers = [];
        for (const layer of Array.isArray(session.layers) ? session.layers : []) {
            if (!layer?.ctx) {
                continue;
            }
            snapshotLayers.push({
                id: layer.id || '',
                name: layer.name || '',
                isBase: layer.isBase === true,
                visible: normalizeLayerVisibility(layer.visible, true),
                opacity: normalizeLayerOpacity(layer.opacity),
                imageData: layer.ctx.getImageData(0, 0, width, height)
            });
        }
        const activeLayer = getActiveLayer();
        return {
            width,
            height,
            imageData: activeLayer?.ctx ? activeLayer.ctx.getImageData(0, 0, width, height) : null,
            activeLayerId: activeLayer?.id || '',
            layers: snapshotLayers
        };
    }

    function applySelectionSnapshot(snapshot) {
        if (!session) {
            return;
        }
        if (session.selectionEdit) {
            session.selectionEdit = null;
            clearSelectionCanvas();
        }
        if (!snapshot) {
            clearSelection();
            return;
        }
        rebuildSelectionFromComponents(snapshot.components, !!snapshot.inverted);
        session.editMode = session.select?.toolLocked ? deps.EDIT_MODE_SELECT : deps.EDIT_MODE_PAINT;
        updateHud();
        updateStageCursor();
        renderStageUi();
        renderCursorCanvas();
    }

    function clearSelectionAndQueueUndo() {
        const before = captureSelectionSnapshot();
        clearSelection();
        if (before) {
            pushUndoAction({ type: 'selection', before, after: null });
        }
        updateHud();
        updateStageCursor();
        renderStageUi();
        renderCursorCanvas();
    }

    function applySelectionEditsAndClearSelection() {
        if (!bindSession() || !session?.selection?.path || !session.selection?.bounds || !session.selection?.maskCanvas) {
            return false;
        }
        if (session.selection.inverted) {
            utils.showToast?.('Paint: cannot apply selection edits (inverted selection)');
            return false;
        }
        if (!session.selectionEdit?.dirty || !session.selectionEdit.canvas) {
            return false;
        }
        const bounds = session.selectionEdit.bounds;
        const x0 = clamp(Math.floor(bounds.x), 0, Math.max(0, session.width - 1));
        const y0 = clamp(Math.floor(bounds.y), 0, Math.max(0, session.height - 1));
        const x1 = clamp(Math.ceil(bounds.x + bounds.width), 0, session.width);
        const y1 = clamp(Math.ceil(bounds.y + bounds.height), 0, session.height);
        const safeBounds = {
            x: x0,
            y: y0,
            width: Math.max(1, x1 - x0),
            height: Math.max(1, y1 - y0)
        };
        const selectionBefore = captureSelectionSnapshot();
        const before = session.baseCtx.getImageData(safeBounds.x, safeBounds.y, safeBounds.width, safeBounds.height);
        session.baseCtx.save();
        session.baseCtx.globalCompositeOperation = 'destination-out';
        session.baseCtx.globalAlpha = 1;
        session.baseCtx.drawImage(session.selection.maskCanvas, bounds.x, bounds.y);
        session.baseCtx.restore();
        session.baseCtx.save();
        session.baseCtx.globalCompositeOperation = 'source-over';
        session.baseCtx.globalAlpha = 1;
        session.baseCtx.drawImage(session.selectionEdit.canvas, bounds.x, bounds.y);
        session.baseCtx.restore();
        const after = session.baseCtx.getImageData(safeBounds.x, safeBounds.y, safeBounds.width, safeBounds.height);
        clearSelection();
        pushUndoAction({ type: 'pixels-selection', bounds: safeBounds, before, after, selectionBefore, selectionAfter: null });
        updateHud();
        renderStageUi();
        renderCursorCanvas();
        return true;
    }

    function clearSelection() {
        if (!session) {
            return;
        }
        const nextEditMode = (session.editMode === deps.EDIT_MODE_SELECT || session.select?.toolLocked === true)
            ? deps.EDIT_MODE_SELECT
            : deps.EDIT_MODE_PAINT;
        session.selectionEdit = null;
        clearSelectionCanvas();
        session.selection = null;
        session.transform = null;
        session.editMode = nextEditMode;
        clearOverlayCanvas();
        clearUiCanvas();
    }

    function finalizeSelection(points, op = 'replace') {
        if (!bindSession() || !session) {
            return;
        }
        const finalizeStartedAt = nowMs();
        const safe = Array.isArray(points) ? points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
        if (safe.length < 3) {
            logPaintTrace('paint.selection.finalize.skipped', {
                reason: 'too-few-points',
                pointCount: safe.length,
                mode: String(session.select?.mode || 'lasso'),
                op: String(op || 'replace')
            });
            if (session.select?.trace) {
                session.select.trace = null;
            }
            return;
        }
        const before = captureSelectionSnapshot();
        const normalizedOp = typeof op === 'string' ? op.trim() : 'replace';
        const mode = (normalizedOp === 'add' || normalizedOp === 'sub') ? normalizedOp : 'replace';
        const current = session.selection && Array.isArray(session.selection.components) ? session.selection : null;
        const wasInverted = !!current?.inverted;
        let rebuildMetrics = null;
        if (session.select) {
            session.select.toolLocked = true;
        }
        if (!current) {
            if (mode === 'sub') {
                if (session.select?.trace) {
                    session.select.trace = null;
                }
                logPaintTrace('paint.selection.finalize.skipped', {
                    reason: 'subtract-without-selection',
                    pointCount: safe.length,
                    mode: String(session.select?.mode || 'lasso')
                });
                return;
            }
            rebuildMetrics = rebuildSelectionFromComponents([{ points: safe, op: 'add' }], false);
            pushUndoAction({ type: 'selection', before, after: captureSelectionSnapshot() });
            session.editMode = deps.EDIT_MODE_SELECT;
        } else if (mode === 'replace' || wasInverted) {
            rebuildMetrics = rebuildSelectionFromComponents([{ points: safe, op: 'add' }], false);
            pushUndoAction({ type: 'selection', before, after: captureSelectionSnapshot() });
            session.editMode = deps.EDIT_MODE_SELECT;
        } else if (mode === 'add') {
            rebuildMetrics = rebuildSelectionFromComponents([...current.components, { points: safe, op: 'add' }], false);
            pushUndoAction({ type: 'selection', before, after: captureSelectionSnapshot() });
            session.editMode = deps.EDIT_MODE_SELECT;
        } else if (mode === 'sub') {
            rebuildMetrics = rebuildSelectionFromComponents([...current.components, { points: safe, op: 'sub' }], false);
            pushUndoAction({ type: 'selection', before, after: captureSelectionSnapshot() });
            session.editMode = deps.EDIT_MODE_SELECT;
        }
        const trace = session.select?.trace || null;
        const previewAvgMs = trace?.previewFrames
            ? Number((((Number(trace.totalPreviewMs) || 0) / trace.previewFrames)).toFixed(2))
            : 0;
        logPaintTrace('paint.selection.finalize.complete', {
            mode: String(session.select?.mode || 'lasso'),
            op: mode,
            pointCount: safe.length,
            elapsedMs: Number((nowMs() - finalizeStartedAt).toFixed(2)),
            existingSelection: !!current,
            previousComponents: Array.isArray(current?.components) ? current.components.length : 0,
            nextComponents: Array.isArray(session.selection?.components) ? session.selection.components.length : 0,
            previewFrames: Number(trace?.previewFrames) || 0,
            previewMaxMs: Number((Number(trace?.maxPreviewMs) || 0).toFixed(2)),
            previewAvgMs,
            sampledPoints: Number(trace?.sampledPoints) || safe.length,
            storedPoints: Number(trace?.storedPoints) || safe.length,
            replacedPoints: Number(trace?.replacedPoints) || 0,
            compactedPoints: Number(trace?.compactedPoints) || 0,
            rebuild: rebuildMetrics || null
        });
        if (session.select?.trace) {
            session.select.trace = null;
        }
        updateHud();
        updateStageCursor();
        renderStageUi();
        renderCursorCanvas();
    }

    function beginTransformMode() {
        if (!bindSession()) {
            return;
        }
        if (!ensureTransformSelection() || !session?.selection?.bounds || !session?.selection?.maskCanvas) {
            return;
        }
        if (session.transform?.active) {
            return;
        }
        const snapshot = captureFullSnapshot();
        if (!snapshot) {
            return;
        }
        const bounds = session.selection.bounds;
        const centerX = bounds.x + (bounds.width / 2);
        const centerY = bounds.y + (bounds.height / 2);
        const contentCanvas = document.createElement('canvas');
        contentCanvas.width = bounds.width;
        contentCanvas.height = bounds.height;
        const contentCtx = contentCanvas.getContext('2d', { willReadFrequently: true });
        if (!contentCtx) {
            return;
        }
        contentCtx.clearRect(0, 0, bounds.width, bounds.height);
        contentCtx.drawImage(session.baseCanvas, -bounds.x, -bounds.y);
        contentCtx.globalCompositeOperation = 'destination-in';
        contentCtx.drawImage(session.selection.maskCanvas, 0, 0);
        contentCtx.globalCompositeOperation = 'source-over';
        session.baseCtx.save();
        session.baseCtx.globalCompositeOperation = 'destination-out';
        session.baseCtx.globalAlpha = 1;
        session.baseCtx.drawImage(session.selection.maskCanvas, bounds.x, bounds.y);
        session.baseCtx.restore();
        session.transform = {
            active: true,
            dragging: false,
            mode: 'move',
            handle: null,
            startX: 0,
            startY: 0,
            dx: 0,
            dy: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            centerX,
            centerY,
            startDx: 0,
            startDy: 0,
            startScaleX: 1,
            startScaleY: 1,
            startRotation: 0,
            startAngle: 0,
            startProjX: 1,
            startProjY: 1,
            startDist: 1,
            contentCanvas,
            snapshot,
            opacity: 1,
            source: '',
            previewPath: session.selection.path,
            previewOutlineLoops: session.selection.outlineLoops || null,
            previewOutlinePath: session.selection.outlinePath || null,
            previewComponents: null,
            previewBounds: bounds,
            previewCorners: null,
            handles: null
        };
        session.editMode = deps.EDIT_MODE_TRANSFORM;
        updateTransformPreviewGeometry();
        updateStageCursor();
        renderStageUi();
    }

    function renderTransformPreview() {
        if (!session?.transform?.active || !session?.selection?.bounds) {
            return;
        }
        clearOverlayCanvas();
        updateTransformPreviewGeometry();
        renderStageUi();
    }

    function cancelTransformMode() {
        if (!bindSession() || !session?.transform?.active) {
            return;
        }
        const snapshot = session.transform.cancelSnapshot || session.transform.snapshot;
        applyCanvasResizeSnapshot(snapshot, { skipFit: true });
        clearOverlayCanvas();
        session.transform = null;
        session.editMode = session.select?.toolLocked ? deps.EDIT_MODE_SELECT : deps.EDIT_MODE_PAINT;
        setWrapTransform();
        updateStageCursor();
    }

    function applyTransformMode() {
        if (!bindSession() || !session?.transform?.active || !session?.selection?.bounds) {
            return;
        }
        updateTransformPreviewGeometry();
        const transform = session.transform;
        const bounds = session.selection.bounds;
        const selectionBefore = captureSelectionSnapshot();
        const beforeSnapshot = transform.snapshot;
        const beforeBounds = bounds;
        const afterBounds = transform.previewBounds || beforeBounds;
        const padLeft = Math.max(0, Math.ceil(-afterBounds.x));
        const padTop = Math.max(0, Math.ceil(-afterBounds.y));
        const padRight = Math.max(0, Math.ceil((afterBounds.x + afterBounds.width) - session.width));
        const padBottom = Math.max(0, Math.ceil((afterBounds.y + afterBounds.height) - session.height));
        const wantsResize = paintWorkspaceState.noBoundaryClip !== false && (padLeft || padTop || padRight || padBottom);
        if (wantsResize) {
            const desiredWidth = session.width + padLeft + padRight;
            const desiredHeight = session.height + padTop + padBottom;
            const newWidth = clamp(desiredWidth, 1, MAX_CANVAS_DIMENSION);
            const newHeight = clamp(desiredHeight, 1, MAX_CANVAS_DIMENSION);
            const shiftX = clamp(padLeft, 0, Math.max(0, newWidth - session.width));
            const shiftY = clamp(padTop, 0, Math.max(0, newHeight - session.height));
            if (newWidth !== desiredWidth || newHeight !== desiredHeight) {
                utils.showToast?.('Paint: max canvas size reached (transform clipped)');
            }
            const snapshots = [];
            for (const layer of session.layers || []) {
                if (!layer?.canvas || !layer.id) {
                    continue;
                }
                const copy = document.createElement('canvas');
                copy.width = session.width;
                copy.height = session.height;
                const copyCtx = copy.getContext('2d', { willReadFrequently: false });
                if (!copyCtx) {
                    continue;
                }
                copyCtx.drawImage(layer.canvas, 0, 0);
                snapshots.push({ id: layer.id, canvas: copy });
            }
            resizeCanvases(newWidth, newHeight);
            bindSession();
            for (const snapshot of snapshots) {
                const target = session.layers.find((layer) => layer && layer.id === snapshot.id);
                if (!target?.ctx) {
                    continue;
                }
                target.ctx.clearRect(0, 0, newWidth, newHeight);
                target.ctx.drawImage(snapshot.canvas, shiftX, shiftY);
            }
            setActiveLayerById(beforeSnapshot.activeLayerId || getActiveLayer()?.id, { force: true, keepSelection: true, skipUi: true });
            session.selection.components = session.selection.components.map((component) => ({
                op: component.op,
                points: component.points.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY }))
            }));
            session.selection.bounds = {
                ...session.selection.bounds,
                x: session.selection.bounds.x + shiftX,
                y: session.selection.bounds.y + shiftY
            };
            session.selection.path = buildSelectionPathFromComponents(session.selection.components, false, 0, 0);
            transform.centerX += shiftX;
            transform.centerY += shiftY;
            updateTransformPreviewGeometry();
        }
        const union = {
            x: Math.min(beforeBounds.x, afterBounds.x),
            y: Math.min(beforeBounds.y, afterBounds.y),
            width: Math.max(beforeBounds.x + beforeBounds.width, afterBounds.x + afterBounds.width) - Math.min(beforeBounds.x, afterBounds.x),
            height: Math.max(beforeBounds.y + beforeBounds.height, afterBounds.y + afterBounds.height) - Math.min(beforeBounds.y, afterBounds.y)
        };
        const x0 = clamp(Math.floor(union.x), 0, Math.max(0, session.width - 1));
        const y0 = clamp(Math.floor(union.y), 0, Math.max(0, session.height - 1));
        const x1 = clamp(Math.ceil(union.x + union.width), 0, session.width);
        const y1 = clamp(Math.ceil(union.y + union.height), 0, session.height);
        const safeUnion = { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
        const before = (wantsResize || !beforeSnapshot?.imageData)
            ? null
            : extractImageDataRegion(beforeSnapshot.imageData, safeUnion.x, safeUnion.y, safeUnion.width, safeUnion.height);
        session.baseCtx.save();
        session.baseCtx.globalCompositeOperation = 'source-over';
        session.baseCtx.globalAlpha = deps.clamp01(transform.opacity ?? 1);
        session.baseCtx.translate(transform.centerX + transform.dx, transform.centerY + transform.dy);
        session.baseCtx.rotate(transform.rotation);
        session.baseCtx.scale(transform.scaleX, transform.scaleY);
        session.baseCtx.translate(-transform.centerX, -transform.centerY);
        const drawBounds = session.selection.bounds;
        session.baseCtx.drawImage(transform.contentCanvas, drawBounds.x, drawBounds.y);
        session.baseCtx.restore();
        session.transform = null;
        session.editMode = session.select?.toolLocked ? deps.EDIT_MODE_SELECT : deps.EDIT_MODE_PAINT;
        clearOverlayCanvas();
        const finalComponents = transform.previewComponents || session.selection.components;
        rebuildSelectionFromComponents(finalComponents, false);
        const selectionAfter = captureSelectionSnapshot();
        if (wantsResize) {
            const afterSnapshot = captureFullSnapshot();
            if (afterSnapshot) {
                pushUndoAction({ type: 'resize', before: beforeSnapshot, after: afterSnapshot, selectionBefore, selectionAfter });
            }
        } else {
            const after = session.baseCtx.getImageData(safeUnion.x, safeUnion.y, safeUnion.width, safeUnion.height);
            if (before) {
                pushUndoAction({ type: 'pixels-selection', bounds: safeUnion, before, after, selectionBefore, selectionAfter });
            }
        }
        renderCursorCanvas();
        updateStageCursor();
    }

    async function copyCanvasToClipboard(canvas) {
        const { electron } = env;
        if (!electron?.nativeImage || !electron?.clipboard) {
            utils.showToast?.('Clipboard unavailable');
            return false;
        }
        const buffer = await exportCanvasToPngBuffer(canvas);
        if (!buffer) {
            utils.showToast?.('Copy failed');
            return false;
        }
        const nativeImg = electron.nativeImage.createFromBuffer(buffer);
        if (!nativeImg || nativeImg.isEmpty()) {
            utils.showToast?.('Copy failed');
            return false;
        }
        electron.clipboard.writeImage(nativeImg);
        return true;
    }


    return {
        buildPath2D,
        computeAabb,
        updateTransformPreviewGeometry,
        resolveTransformHandleAtStage,
        beginTransformDrag,
        updateTransformDrag,
        computePolygonBounds,
        buildSelectionPathFromComponents,
        rebuildSelectionFromComponents,
        renderLassoPreview,
        extractImageDataRegion,
        renderSelectionOverlay,
        captureSelectionSnapshot,
        captureFullSnapshot,
        applySelectionSnapshot,
        clearSelectionAndQueueUndo,
        applySelectionEditsAndClearSelection,
        clearSelection,
        finalizeSelection,
        beginTransformMode,
        renderTransformPreview,
        cancelTransformMode,
        applyTransformMode
    };
};
