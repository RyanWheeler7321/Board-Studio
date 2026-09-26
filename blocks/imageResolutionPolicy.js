'use strict';

const IMAGE_PROXY_TIERS = Object.freeze([768, 1536, 2048]);
const PROXY_UPGRADE_HEADROOM = 1.05;
const PROXY_DOWNGRADE_HEADROOM = 0.78;
const PROXY_DECODED_PIXEL_BUDGET = 36_000_000;

function normalizePositive(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function calculatePixelDemand(rect = {}, devicePixelRatio = 1) {
    const width = normalizePositive(rect.width);
    const height = normalizePositive(rect.height);
    const ratio = Math.max(1, normalizePositive(devicePixelRatio, 1));
    return {
        longEdge: Math.max(width, height) * ratio,
        pixels: width * height * ratio * ratio
    };
}

function getAvailableProxyTiers(sourceMaxEdge = 0, tiers = IMAGE_PROXY_TIERS) {
    const sourceLimit = normalizePositive(sourceMaxEdge);
    const available = Array.from(tiers, (tier) => Math.round(normalizePositive(tier)))
        .filter(Boolean)
        .sort((left, right) => left - right);
    if (!sourceLimit) {
        return available;
    }
    const capped = available.filter((tier) => tier <= sourceLimit);
    return capped.length > 0 ? capped : [Math.min(sourceLimit, available[0])];
}

function selectProxyMaxEdge(candidate = {}, options = {}) {
    const tiers = getAvailableProxyTiers(candidate.sourceMaxEdge, options.tiers);
    const minimumTier = tiers[0];
    if (!candidate.strictlyVisible) {
        return minimumTier;
    }

    const demand = normalizePositive(candidate.pixelDemand);
    const current = normalizePositive(candidate.currentProxyMaxEdge);
    if (current && tiers.includes(current)) {
        const currentIndex = tiers.indexOf(current);
        const lowerTier = tiers[currentIndex - 1];
        if (demand <= current * PROXY_UPGRADE_HEADROOM
            && (!lowerTier || demand > lowerTier * PROXY_DOWNGRADE_HEADROOM)) {
            return current;
        }
    }
    return tiers.find((tier) => demand <= tier) || tiers[tiers.length - 1];
}

function estimateProxyPixels(candidate = {}, maxEdge = 0) {
    const sourcePixels = normalizePositive(candidate.sourcePixels);
    const edgePixels = Math.max(1, maxEdge * maxEdge);
    return sourcePixels ? Math.min(sourcePixels, edgePixels) : edgePixels;
}

function allocateProxyCandidates(candidates = [], options = {}) {
    const pixelBudget = Math.max(1, normalizePositive(options.pixelBudget, PROXY_DECODED_PIXEL_BUDGET));
    const selected = new Map();
    let allocatedPixels = 0;

    for (const candidate of candidates) {
        if (!candidate?.id) {
            continue;
        }
        const preferredMaxEdge = selectProxyMaxEdge(candidate, options);
        const baseMaxEdge = getAvailableProxyTiers(candidate.sourceMaxEdge, options.tiers)[0];
        let maxEdge = preferredMaxEdge;
        let pixels = estimateProxyPixels(candidate, maxEdge);
        if (maxEdge !== baseMaxEdge && allocatedPixels + pixels > pixelBudget) {
            maxEdge = baseMaxEdge;
            pixels = estimateProxyPixels(candidate, maxEdge);
        }
        selected.set(candidate.id, maxEdge);
        allocatedPixels += pixels;
    }

    return {
        selected,
        allocatedPixels,
        pixelBudget
    };
}

module.exports = {
    IMAGE_PROXY_TIERS,
    PROXY_UPGRADE_HEADROOM,
    PROXY_DOWNGRADE_HEADROOM,
    PROXY_DECODED_PIXEL_BUDGET,
    calculatePixelDemand,
    getAvailableProxyTiers,
    selectProxyMaxEdge,
    estimateProxyPixels,
    allocateProxyCandidates
};
