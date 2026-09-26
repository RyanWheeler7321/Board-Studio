'use strict';

const env = require('../core/state');
const { constants } = env;

const DEFAULT_SEGMENT = constants.GRID_SIZE * 6;
const DEFAULT_PADDING = Math.max(36, Math.round(constants.GRID_SIZE * 1.4));
const HANDLE_SIZE = 16;
const WAYPOINT_SIZE = 12;
const BASE_HALF_WIDTH = 10;
const NECK_HALF_WIDTH = 7;
const HEAD_LENGTH = 26;
const HEAD_HALF_WIDTH = 16;
const CORNER_RADIUS = 18;
const CURVE_STEPS = 7;
const WAYPOINT_INSERT_MIN_DISTANCE = 28;
const HIT_PAD = 14;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function roundPoint(point) {
    return {
        x: Math.round(Number(point?.x) || 0),
        y: Math.round(Number(point?.y) || 0)
    };
}

function distance(a, b) {
    return Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0));
}

function normalizeVector(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) {
        return { x: 1, y: 0 };
    }
    return { x: dx / len, y: dy / len };
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function interpolatePoint(a, b, t) {
    return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t)
    };
}

function sampleQuadratic(a, control, b, steps) {
    const samples = [];
    for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const mt = 1 - t;
        samples.push({
            x: (mt * mt * a.x) + (2 * mt * t * control.x) + (t * t * b.x),
            y: (mt * mt * a.y) + (2 * mt * t * control.y) + (t * t * b.y)
        });
    }
    return samples;
}

function clonePoints(points) {
    return Array.isArray(points) ? points.map((point) => roundPoint(point)) : [];
}

function getWidthScale() {
    const settingsScale = Number(env.state?.boardData?.settings?.arrowWidthScale);
    return Number.isFinite(settingsScale) ? clamp(settingsScale, 0.35, 1.8) : 0.49;
}

function getEffectiveWidths(block) {
    const scale = getWidthScale();
    const baseWidth = Math.max(10, Math.round(Number(block?.baseWidth) || (BASE_HALF_WIDTH * 2)));
    const neckWidth = Math.max(8, Math.round(Number(block?.neckWidth) || (NECK_HALF_WIDTH * 2)));
    const headWidth = Math.max(neckWidth + 6, Math.round(Number(block?.headWidth) || (HEAD_HALF_WIDTH * 2)));
    return {
        scale,
        baseWidth: Math.max(8, baseWidth * scale),
        neckWidth: Math.max(6, neckWidth * scale),
        headWidth: Math.max(10, headWidth * scale)
    };
}

function resolveFallbackPoints(block) {
    const x = Number(block?.x) || constants.GRID_SIZE * 6;
    const y = Number(block?.y) || constants.GRID_SIZE * 6;
    const width = Number(block?.width) || DEFAULT_SEGMENT;
    const height = Number(block?.height) || constants.GRID_SIZE * 2;
    const midY = y + Math.round(height / 2);
    return [
        { x, y: midY },
        { x: x + Math.max(width, DEFAULT_SEGMENT), y: midY }
    ];
}

function normalizePoints(points, block = null) {
    const source = Array.isArray(points) && points.length >= 2 ? points : resolveFallbackPoints(block);
    const cloned = clonePoints(source);
    const normalized = [];
    cloned.forEach((point) => {
        const previous = normalized[normalized.length - 1];
        if (!previous || previous.x !== point.x || previous.y !== point.y) {
            normalized.push(point);
        }
    });
    if (normalized.length === 1 && cloned.length >= 2) {
        normalized.push({ ...cloned[cloned.length - 1] });
    }
    return normalized.length >= 2 ? normalized : resolveFallbackPoints(block);
}

function getArrowPadding(block) {
    const widths = getEffectiveWidths(block);
    const handlePad = Math.max(HANDLE_SIZE, WAYPOINT_SIZE) + 14;
    const arrowWidth = Math.max(widths.headWidth, widths.baseWidth);
    return Math.max(DEFAULT_PADDING, Math.round(arrowWidth * 0.95), handlePad, HIT_PAD + 10);
}

function getBoundsFromPoints(points, block = null) {
    const normalized = normalizePoints(points, block);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    normalized.forEach((point) => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    });
    const padding = getArrowPadding(block);
    return {
        x: Math.round(minX - padding),
        y: Math.round(minY - padding),
        width: Math.max(1, Math.round((maxX - minX) + (padding * 2))),
        height: Math.max(1, Math.round((maxY - minY) + (padding * 2)))
    };
}

function syncBlockGeometry(block) {
    if (!block) {
        return block;
    }
    block.type = 'arrow';
    block.points = normalizePoints(block.points, block);
    const bounds = getBoundsFromPoints(block.points, block);
    block.x = bounds.x;
    block.y = bounds.y;
    block.width = bounds.width;
    block.height = bounds.height;
    block.baseWidth = Math.max(10, Math.round(Number(block.baseWidth) || (BASE_HALF_WIDTH * 2)));
    block.neckWidth = Math.max(8, Math.round(Number(block.neckWidth) || (NECK_HALF_WIDTH * 2)));
    block.headLength = Math.max(18, Math.round(Number(block.headLength) || HEAD_LENGTH));
    block.headWidth = Math.max(block.neckWidth + 6, Math.round(Number(block.headWidth) || (HEAD_HALF_WIDTH * 2)));
    block.cornerRadius = Math.max(6, Math.round(Number(block.cornerRadius) || CORNER_RADIUS));
    delete block.color;
    return block;
}

function shiftBlock(block, dx, dy) {
    if (!block) {
        return;
    }
    const offsetX = Math.round(Number(dx) || 0);
    const offsetY = Math.round(Number(dy) || 0);
    block.points = normalizePoints(block.points, block).map((point) => ({
        x: point.x + offsetX,
        y: point.y + offsetY
    }));
    syncBlockGeometry(block);
}

function setPoint(block, pointIndex, point) {
    if (!block) {
        return;
    }
    const normalized = normalizePoints(block.points, block);
    if (pointIndex < 0 || pointIndex >= normalized.length) {
        return;
    }
    normalized[pointIndex] = roundPoint(point);
    block.points = normalized;
    syncBlockGeometry(block);
}

function canAddWaypointAt(block, point, minDistance = WAYPOINT_INSERT_MIN_DISTANCE) {
    const normalized = normalizePoints(block?.points, block);
    const candidate = roundPoint(point);
    return normalized.every((existingPoint) => distance(existingPoint, candidate) >= minDistance);
}

function addWaypoint(block, point) {
    if (!block) {
        return null;
    }
    if (!canAddWaypointAt(block, point)) {
        return null;
    }
    const normalized = normalizePoints(block.points, block);
    normalized.splice(Math.max(normalized.length - 1, 1), 0, roundPoint(point));
    block.points = normalized;
    syncBlockGeometry(block);
    return normalized.length - 2;
}

function insertWaypointBeforeEnd(block, point, options = {}) {
    if (!block) {
        return null;
    }
    const normalized = normalizePoints(block.points, block);
    if (normalized.length < 2) {
        return null;
    }
    const endpointIndex = normalized.length - 1;
    const previousPoint = normalized[endpointIndex - 1];
    const candidate = point ? roundPoint(point) : { ...normalized[endpointIndex] };
    const minDistance = Number.isFinite(Number(options.minDistance))
        ? Math.max(0, Number(options.minDistance))
        : WAYPOINT_INSERT_MIN_DISTANCE;
    if (distance(previousPoint, candidate) < minDistance) {
        return null;
    }
    normalized.splice(endpointIndex, 0, candidate);
    const liveEndpointIndex = endpointIndex + 1;
    const liveEndpoint = normalized[liveEndpointIndex];
    if (liveEndpoint && distance(candidate, liveEndpoint) < 0.5) {
        let direction = normalizeVector(candidate.x - previousPoint.x, candidate.y - previousPoint.y);
        let offsetX = Math.round(direction.x);
        let offsetY = Math.round(direction.y);
        if (offsetX === 0 && offsetY === 0) {
            if (Math.abs(direction.x) >= Math.abs(direction.y)) {
                offsetX = direction.x >= 0 ? 1 : -1;
                offsetY = 0;
            } else {
                offsetX = 0;
                offsetY = direction.y >= 0 ? 1 : -1;
            }
        }
        if (offsetX === 0 && offsetY === 0) {
            offsetX = 1;
        }
        normalized[liveEndpointIndex] = {
            x: candidate.x + offsetX,
            y: candidate.y + offsetY
        };
    }
    block.points = normalized;
    syncBlockGeometry(block);
    return endpointIndex;
}

function getLocalPoints(block) {
    syncBlockGeometry(block);
    return block.points.map((point) => ({
        x: point.x - block.x,
        y: point.y - block.y
    }));
}

function sampleCenterline(points, cornerRadius) {
    const normalized = normalizePoints(points);
    if (normalized.length <= 2) {
        return normalized.map((point) => ({ ...point }));
    }
    const sampled = [{ ...normalized[0] }];
    for (let index = 1; index < normalized.length - 1; index += 1) {
        const prev = normalized[index - 1];
        const current = normalized[index];
        const next = normalized[index + 1];
        const inLen = distance(prev, current);
        const outLen = distance(current, next);
        if (inLen < 0.001 || outLen < 0.001) {
            sampled.push({ ...current });
            continue;
        }
        const radius = Math.min(cornerRadius, inLen * 0.4, outLen * 0.4);
        if (radius < 1) {
            sampled.push({ ...current });
            continue;
        }
        const inDir = normalizeVector(current.x - prev.x, current.y - prev.y);
        const outDir = normalizeVector(next.x - current.x, next.y - current.y);
        const start = {
            x: current.x - (inDir.x * radius),
            y: current.y - (inDir.y * radius)
        };
        const end = {
            x: current.x + (outDir.x * radius),
            y: current.y + (outDir.y * radius)
        };
        sampled.push(start);
        sampleQuadratic(start, current, end, CURVE_STEPS).forEach((sample) => sampled.push(sample));
    }
    sampled.push({ ...normalized[normalized.length - 1] });
    return sampled;
}

function getPolylineLengths(points) {
    const lengths = [0];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += distance(points[index - 1], points[index]);
        lengths.push(total);
    }
    return { lengths, total };
}

function pointAtLength(points, lengths, targetLength) {
    if (!points.length) {
        return { point: { x: 0, y: 0 }, index: 0 };
    }
    if (targetLength <= 0) {
        return { point: { ...points[0] }, index: 0 };
    }
    const total = lengths[lengths.length - 1] || 0;
    if (targetLength >= total) {
        return { point: { ...points[points.length - 1] }, index: points.length - 1 };
    }
    for (let index = 1; index < points.length; index += 1) {
        const prevLength = lengths[index - 1];
        const nextLength = lengths[index];
        if (targetLength <= nextLength) {
            const span = nextLength - prevLength;
            const t = span <= 0.0001 ? 0 : ((targetLength - prevLength) / span);
            return {
                point: interpolatePoint(points[index - 1], points[index], t),
                index
            };
        }
    }
    return { point: { ...points[points.length - 1] }, index: points.length - 1 };
}

function slicePolyline(points, lengths, targetLength) {
    const sliced = [];
    if (!points.length) {
        return sliced;
    }
    sliced.push({ ...points[0] });
    const total = lengths[lengths.length - 1] || 0;
    if (targetLength >= total) {
        return points.map((point) => ({ ...point }));
    }
    for (let index = 1; index < points.length; index += 1) {
        const nextLength = lengths[index];
        if (nextLength < targetLength) {
            sliced.push({ ...points[index] });
            continue;
        }
        const prevLength = lengths[index - 1];
        const span = nextLength - prevLength;
        const t = span <= 0.0001 ? 0 : ((targetLength - prevLength) / span);
        sliced.push(interpolatePoint(points[index - 1], points[index], t));
        break;
    }
    return sliced;
}

function buildArrowGeometry(localPoints, block) {
    const centerline = sampleCenterline(localPoints, Number(block?.cornerRadius) || CORNER_RADIUS);
    if (centerline.length < 2) {
        return null;
    }
    const { lengths, total } = getPolylineLengths(centerline);
    if (total < 0.001) {
        return null;
    }
    const widths = getEffectiveWidths(block);
    const headLength = clamp(Number(block?.headLength) || HEAD_LENGTH, 14, Math.max(18, total * 0.42));
    const shaftLength = Math.max(1, total - headLength);
    const basePoint = pointAtLength(centerline, lengths, shaftLength).point;
    const shaftPoints = slicePolyline(centerline, lengths, shaftLength);
    const tip = centerline[centerline.length - 1];
    const tipDir = normalizeVector(tip.x - basePoint.x, tip.y - basePoint.y);
    const tipNormal = { x: -tipDir.y, y: tipDir.x };
    const headHalfWidth = widths.headWidth / 2;
    const tailHalfWidth = widths.baseWidth / 2;
    const neckHalfWidth = widths.neckWidth / 2;
    const shaftMetrics = getPolylineLengths(shaftPoints);
    const left = [];
    const right = [];
    for (let index = 0; index < shaftPoints.length; index += 1) {
        const point = shaftPoints[index];
        const prev = shaftPoints[index - 1] || point;
        const next = shaftPoints[index + 1] || point;
        const dir = normalizeVector(next.x - prev.x, next.y - prev.y);
        const normal = { x: -dir.y, y: dir.x };
        const t = shaftMetrics.total <= 0.0001 ? 1 : (shaftMetrics.lengths[index] / shaftMetrics.total);
        const halfWidth = lerp(tailHalfWidth, neckHalfWidth, t);
        left.push({ x: point.x + (normal.x * halfWidth), y: point.y + (normal.y * halfWidth) });
        right.push({ x: point.x - (normal.x * halfWidth), y: point.y - (normal.y * halfWidth) });
    }
    const leftBase = { x: basePoint.x + (tipNormal.x * headHalfWidth), y: basePoint.y + (tipNormal.y * headHalfWidth) };
    const rightBase = { x: basePoint.x - (tipNormal.x * headHalfWidth), y: basePoint.y - (tipNormal.y * headHalfWidth) };
    return {
        centerline,
        hitWidth: Math.max(widths.headWidth, widths.baseWidth) + (HIT_PAD * 2),
        polygonPoints: [...left, leftBase, tip, rightBase, ...right.reverse()]
    };
}

function pointsToClosedPath(points) {
    if (!Array.isArray(points) || !points.length) {
        return '';
    }
    const parts = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
    for (let index = 1; index < points.length; index += 1) {
        parts.push(`L ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)}`);
    }
    parts.push('Z');
    return parts.join(' ');
}

function pointsToLinePath(points) {
    if (!Array.isArray(points) || !points.length) {
        return '';
    }
    const parts = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
    for (let index = 1; index < points.length; index += 1) {
        parts.push(`L ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)}`);
    }
    return parts.join(' ');
}

function createHandle(point, kind, index) {
    const handle = document.createElement('div');
    handle.classList.add('arrow-point-handle');
    handle.classList.add(kind === 'waypoint' ? 'arrow-point-handle-waypoint' : 'arrow-point-handle-endpoint');
    const size = kind === 'waypoint' ? WAYPOINT_SIZE : HANDLE_SIZE;
    handle.dataset.arrowHandle = kind;
    handle.dataset.pointIndex = String(index);
    handle.style.left = `${point.x - (size / 2)}px`;
    handle.style.top = `${point.y - (size / 2)}px`;
    handle.style.width = `${size}px`;
    handle.style.height = `${size}px`;
    return handle;
}

function render(block, element) {
    if (!block || !element) {
        return;
    }
    syncBlockGeometry(block);
    element.classList.add('arrow-block');
    element.innerHTML = '';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'arrow-svg');
    svg.setAttribute('width', String(block.width));
    svg.setAttribute('height', String(block.height));
    svg.setAttribute('viewBox', `0 0 ${block.width} ${block.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const geometry = buildArrowGeometry(getLocalPoints(block), block);
    if (geometry?.polygonPoints?.length) {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('class', 'arrow-shape');
        shape.setAttribute('d', pointsToClosedPath(geometry.polygonPoints));
        shape.style.fill = 'var(--accent)';
        svg.appendChild(shape);

        const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitPath.setAttribute('class', 'arrow-hit-path');
        hitPath.setAttribute('d', pointsToLinePath(geometry.centerline));
        hitPath.setAttribute('stroke', 'rgba(0,0,0,0.001)');
        hitPath.setAttribute('stroke-width', String(geometry.hitWidth.toFixed(2)));
        hitPath.setAttribute('stroke-linecap', 'round');
        hitPath.setAttribute('stroke-linejoin', 'round');
        hitPath.setAttribute('fill', 'none');
        svg.appendChild(hitPath);
    }
    element.appendChild(svg);

    getLocalPoints(block).forEach((point, index, points) => {
        const isEndpoint = index === 0 || index === points.length - 1;
        element.appendChild(createHandle(point, isEndpoint ? 'endpoint' : 'waypoint', index));
    });
}

function createBlock(startPoint, endPoint, options = {}) {
    const now = new Date().toISOString();
    const block = {
        id: options.id || env.utils.createId('arrow'),
        type: 'arrow',
        points: normalizePoints([roundPoint(startPoint), roundPoint(endPoint)]),
        baseWidth: options.baseWidth,
        neckWidth: options.neckWidth,
        headLength: options.headLength,
        headWidth: options.headWidth,
        cornerRadius: options.cornerRadius,
        color: options.color,
        createdAt: options.createdAt || now,
        updatedAt: options.updatedAt || now
    };
    syncBlockGeometry(block);
    return block;
}

const api = {
    render,
    createBlock,
    syncBlockGeometry,
    normalizePoints,
    shiftBlock,
    setPoint,
    addWaypoint,
    insertWaypointBeforeEnd,
    canAddWaypointAt,
    getBoundsFromPoints,
    getWidthScale
};

env.blocks.arrow = {
    ...(env.blocks.arrow || {}),
    ...api
};

module.exports = env.blocks.arrow;
