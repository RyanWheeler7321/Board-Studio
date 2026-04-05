'use strict';

// MARK: CONSTANTS
const SAMPLE_SIZE = 40;
const MIN_ALPHA = 24;
const MAX_THEME_SAT = 20;
const RANDOM_THEME_SAT_MIN = 8;
const RANDOM_THEME_SAT_MAX = 16;
const GRAY_THEME_SAT = 1.8;
const CHROMA_THRESHOLD = 0.065;
const FRAME_INTERVAL_MS = 32;
const BACKGROUND_FRAME_INTERVAL_MS = 1400;
const HIDDEN_FRAME_INTERVAL_MS = 5000;
const HUE_SEGMENT_MIN_MS = 60000;
const HUE_SEGMENT_MAX_MS = 180000;
const SAT_SEGMENT_MIN_MS = 45000;
const SAT_SEGMENT_MAX_MS = 150000;
const BG_SEGMENT_MIN_MS = 30000;
const BG_SEGMENT_MAX_MS = 120000;
const DEFAULT_THEME_HUE = 214;

const TOKEN_KEYS = Object.freeze([
    '--paint-theme-bg-top',
    '--paint-theme-bg-bottom',
    '--paint-theme-body-glow',
    '--paint-theme-body-glow-x',
    '--paint-theme-body-glow-y',
    '--paint-theme-grid-line',
    '--paint-theme-grid-line-soft',
    '--paint-theme-grid-wash-a',
    '--paint-theme-grid-wash-b',
    '--paint-theme-grid-wash-c',
    '--paint-theme-glow-primary',
    '--paint-theme-glow-primary-x',
    '--paint-theme-glow-primary-y',
    '--paint-theme-glow-secondary',
    '--paint-theme-glow-secondary-x',
    '--paint-theme-glow-secondary-y',
    '--paint-theme-glow-tertiary',
    '--paint-theme-glow-tertiary-x',
    '--paint-theme-glow-tertiary-y',
    '--paint-theme-sweep-angle',
    '--paint-theme-sweep-color',
    '--paint-theme-sweep-soft',
    '--paint-theme-surface-0',
    '--paint-theme-surface-1',
    '--paint-theme-surface-2',
    '--paint-theme-surface-3',
    '--paint-theme-surface-4',
    '--paint-theme-border',
    '--paint-theme-border-strong',
    '--paint-theme-border-accent',
    '--paint-theme-text',
    '--paint-theme-text-soft',
    '--paint-theme-text-dim',
    '--paint-theme-accent',
    '--paint-theme-accent-strong',
    '--paint-theme-accent-soft',
    '--paint-theme-accent-fill',
    '--paint-theme-accent-fill-strong',
    '--paint-theme-accent-glow',
    '--paint-theme-accent-text',
    '--paint-theme-slider-accent',
    '--paint-theme-progress',
    '--paint-theme-progress-strong',
    '--paint-theme-canvas-border',
    '--paint-theme-erase',
    '--accent',
    '--accent-strong',
    '--accent-soft',
    '--accent-outline',
    '--border-subtle'
]);

// MARK: UTILS
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function wrapHue(value) {
    const hue = Number(value) || 0;
    return ((hue % 360) + 360) % 360;
}

function randomBetween(randomFn, min, max) {
    return min + ((max - min) * randomFn());
}

function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - (2 * t));
}

function lerp(start, end, amount) {
    return start + ((end - start) * amount);
}

function lerpHue(start, end, amount) {
    let delta = wrapHue(end) - wrapHue(start);
    if (delta > 180) {
        delta -= 360;
    } else if (delta < -180) {
        delta += 360;
    }
    return wrapHue(start + (delta * amount));
}

function hslString(hue, saturation, lightness, alpha = 1) {
    return `hsl(${wrapHue(hue).toFixed(2)} ${clamp(saturation, 0, 100).toFixed(2)}% ${clamp(lightness, 0, 100).toFixed(2)}% / ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function rgbToHsv(red, green, blue) {
    const r = clamp(red, 0, 255) / 255;
    const g = clamp(green, 0, 255) / 255;
    const b = clamp(blue, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta > 0.000001) {
        if (max === r) {
            hue = 60 * (((g - b) / delta) % 6);
        } else if (max === g) {
            hue = 60 * (((b - r) / delta) + 2);
        } else {
            hue = 60 * (((r - g) / delta) + 4);
        }
    }
    return {
        h: wrapHue(hue),
        s: max <= 0.000001 ? 0 : (delta / max),
        v: max
    };
}

function luminance(red, green, blue) {
    const r = clamp(red, 0, 255) / 255;
    const g = clamp(green, 0, 255) / 255;
    const b = clamp(blue, 0, 255) / 255;
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function createSampleCanvas(size) {
    if (typeof document !== 'undefined' && document.createElement) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        return canvas;
    }
    return null;
}

function applyTokensToElement(element, tokens) {
    if (!element || !element.style || !tokens) {
        return;
    }
    for (const [key, value] of Object.entries(tokens)) {
        element.style.setProperty(key, value);
    }
}

function clearTokensFromElement(element) {
    if (!element || !element.style) {
        return;
    }
    TOKEN_KEYS.forEach((key) => {
        element.style.removeProperty(key);
    });
}

function normalizeMotionMode(value) {
    const normalized = String(value || 'active').trim().toLowerCase();
    if (normalized === 'hidden') {
        return 'hidden';
    }
    if (normalized === 'background') {
        return 'background';
    }
    return 'active';
}

// MARK: SAMPLING
function sampleCanvasThemeSeed(canvas) {
    if (!canvas || !canvas.width || !canvas.height) {
        return {
            mode: 'random',
            hue: DEFAULT_THEME_HUE,
            saturation: RANDOM_THEME_SAT_MIN,
            chroma: 0
        };
    }
    const sampleCanvas = createSampleCanvas(SAMPLE_SIZE);
    if (!sampleCanvas) {
        return {
            mode: 'random',
            hue: DEFAULT_THEME_HUE,
            saturation: RANDOM_THEME_SAT_MIN,
            chroma: 0
        };
    }
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        return {
            mode: 'random',
            hue: DEFAULT_THEME_HUE,
            saturation: RANDOM_THEME_SAT_MIN,
            chroma: 0
        };
    }
    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(canvas, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    let data = null;
    try {
        data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    } catch {
        return {
            mode: 'random',
            hue: DEFAULT_THEME_HUE,
            saturation: RANDOM_THEME_SAT_MIN,
            chroma: 0
        };
    }

    let hueX = 0;
    let hueY = 0;
    let hueWeight = 0;
    let chromaTotal = 0;
    let visibleCount = 0;

    for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3];
        if (alpha < MIN_ALPHA) {
            continue;
        }
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const hsv = rgbToHsv(red, green, blue);
        const lum = luminance(red, green, blue);
        const lumWeight = clamp(1 - Math.abs((lum * 2) - 1), 0.12, 1);
        const chromaWeight = hsv.s * lumWeight * (alpha / 255);
        visibleCount += 1;
        chromaTotal += chromaWeight;
        if (chromaWeight <= 0.0001) {
            continue;
        }
        const radians = (hsv.h * Math.PI) / 180;
        hueX += Math.cos(radians) * chromaWeight;
        hueY += Math.sin(radians) * chromaWeight;
        hueWeight += chromaWeight;
    }

    if (!visibleCount || chromaTotal <= 0.0001 || hueWeight <= 0.0001) {
        return {
            mode: 'random',
            hue: DEFAULT_THEME_HUE,
            saturation: RANDOM_THEME_SAT_MIN,
            chroma: 0
        };
    }

    const averageChroma = chromaTotal / visibleCount;
    if (averageChroma < CHROMA_THRESHOLD) {
        return {
            mode: 'gray',
            hue: DEFAULT_THEME_HUE,
            saturation: GRAY_THEME_SAT,
            chroma: averageChroma
        };
    }

    const hue = wrapHue((Math.atan2(hueY, hueX) * 180) / Math.PI);
    const saturation = clamp(6 + (averageChroma * 42), 7, MAX_THEME_SAT);
    return {
        mode: 'color',
        hue,
        saturation,
        chroma: averageChroma
    };
}

// MARK: STATE
function createChannel(startValue, targetValue, now, minDurationMs, maxDurationMs, randomFn) {
    const durationMs = Math.round(randomBetween(randomFn, minDurationMs, maxDurationMs));
    return {
        startValue,
        currentValue: startValue,
        targetValue,
        startedAt: now,
        endsAt: now + durationMs,
        minDurationMs,
        maxDurationMs
    };
}

function buildInitialState(seed, now, randomFn) {
    const baseHue = seed.mode === 'color'
        ? wrapHue(seed.hue)
        : wrapHue(randomBetween(randomFn, 0, 360));
    const baseSaturation = seed.mode === 'color'
        ? clamp(seed.saturation, 0, MAX_THEME_SAT)
        : (seed.mode === 'gray'
            ? GRAY_THEME_SAT
            : randomBetween(randomFn, RANDOM_THEME_SAT_MIN, RANDOM_THEME_SAT_MAX));
    const glowX = randomBetween(randomFn, 18, 82);
    const glowY = randomBetween(randomFn, 8, 92);
    const sweepAngle = randomBetween(randomFn, 95, 155);

    return {
        seedMode: seed.mode,
        hue: createChannel(baseHue, wrapHue(baseHue + randomBetween(randomFn, -38, 38)), now, HUE_SEGMENT_MIN_MS, HUE_SEGMENT_MAX_MS, randomFn),
        saturation: createChannel(baseSaturation, chooseNextSaturation(randomFn), now, SAT_SEGMENT_MIN_MS, SAT_SEGMENT_MAX_MS, randomFn),
        glowX: createChannel(glowX, randomBetween(randomFn, 16, 84), now, BG_SEGMENT_MIN_MS, BG_SEGMENT_MAX_MS, randomFn),
        glowY: createChannel(glowY, randomBetween(randomFn, 6, 94), now, BG_SEGMENT_MIN_MS, BG_SEGMENT_MAX_MS, randomFn),
        sweepAngle: createChannel(sweepAngle, randomBetween(randomFn, 92, 160), now, BG_SEGMENT_MIN_MS, BG_SEGMENT_MAX_MS, randomFn)
    };
}

function chooseNextSaturation(randomFn) {
    const coolDownChance = randomFn();
    if (coolDownChance < 0.34) {
        return randomBetween(randomFn, 0, 4.5);
    }
    return randomBetween(randomFn, 6.5, MAX_THEME_SAT);
}

function updateChannel(channel, now, randomFn, nextValueFactory) {
    if (!channel) {
        return 0;
    }
    if (now >= channel.endsAt) {
        channel.startValue = channel.currentValue;
        channel.targetValue = nextValueFactory(channel.currentValue);
        channel.startedAt = now;
        channel.endsAt = now + Math.round(randomBetween(randomFn, channel.minDurationMs, channel.maxDurationMs));
    }
    const duration = Math.max(1, channel.endsAt - channel.startedAt);
    const progress = smoothstep((now - channel.startedAt) / duration);
    channel.currentValue = lerp(channel.startValue, channel.targetValue, progress);
    return channel.currentValue;
}

function updateHueChannel(channel, now, randomFn) {
    if (!channel) {
        return 0;
    }
    if (now >= channel.endsAt) {
        channel.startValue = channel.currentValue;
        channel.targetValue = wrapHue(channel.currentValue + randomBetween(randomFn, -65, 65));
        channel.startedAt = now;
        channel.endsAt = now + Math.round(randomBetween(randomFn, channel.minDurationMs, channel.maxDurationMs));
    }
    const duration = Math.max(1, channel.endsAt - channel.startedAt);
    const progress = smoothstep((now - channel.startedAt) / duration);
    channel.currentValue = lerpHue(channel.startValue, channel.targetValue, progress);
    return channel.currentValue;
}

function advanceState(state, now, randomFn) {
    const hue = updateHueChannel(state.hue, now, randomFn);
    const saturation = updateChannel(state.saturation, now, randomFn, () => chooseNextSaturation(randomFn));
    const glowX = updateChannel(state.glowX, now, randomFn, () => randomBetween(randomFn, 16, 84));
    const glowY = updateChannel(state.glowY, now, randomFn, () => randomBetween(randomFn, 6, 94));
    const sweepAngle = updateChannel(state.sweepAngle, now, randomFn, () => randomBetween(randomFn, 92, 160));
    return {
        hue,
        saturation,
        glowX,
        glowY,
        sweepAngle
    };
}

// MARK: TOKENS
function buildTokens(stateValues) {
    const hue = wrapHue(stateValues.hue);
    const saturation = clamp(stateValues.saturation, 0, MAX_THEME_SAT);
    const softSaturation = clamp(saturation * 0.72, 0, MAX_THEME_SAT);
    const washSaturation = clamp(saturation * 0.48, 0, MAX_THEME_SAT);
    const accentSaturation = clamp(saturation + 4, 2, MAX_THEME_SAT + 2);
    const glowX = clamp(stateValues.glowX, 0, 100);
    const glowY = clamp(stateValues.glowY, 0, 100);
    const secondaryX = clamp((100 - glowX) * 0.88, 0, 100);
    const secondaryY = clamp((glowY * 0.42) + 12, 0, 100);
    const tertiaryX = clamp((glowX * 0.36) + 12, 0, 100);
    const tertiaryY = clamp(100 - (glowY * 0.74), 0, 100);

    return {
        '--paint-theme-bg-top': hslString(hue, washSaturation, 10.5, 0.985),
        '--paint-theme-bg-bottom': hslString(hue, washSaturation * 0.8, 5.8, 0.995),
        '--paint-theme-body-glow': hslString(hue, softSaturation, 34, 0.17),
        '--paint-theme-body-glow-x': `${glowX.toFixed(2)}%`,
        '--paint-theme-body-glow-y': `${Math.max(0, Math.min(100, glowY * 0.76)).toFixed(2)}%`,
        '--paint-theme-grid-line': 'rgba(255, 255, 255, 0.022)',
        '--paint-theme-grid-line-soft': 'rgba(255, 255, 255, 0.014)',
        '--paint-theme-grid-wash-a': hslString(hue, washSaturation, 62, 0.055),
        '--paint-theme-grid-wash-b': hslString(hue, washSaturation, 48, 0.12),
        '--paint-theme-grid-wash-c': hslString(hue + 22, washSaturation * 0.8, 74, 0.045),
        '--paint-theme-glow-primary': hslString(hue, softSaturation, 38, 0.16),
        '--paint-theme-glow-primary-x': `${glowX.toFixed(2)}%`,
        '--paint-theme-glow-primary-y': `${glowY.toFixed(2)}%`,
        '--paint-theme-glow-secondary': hslString(hue + 18, softSaturation * 0.78, 72, 0.05),
        '--paint-theme-glow-secondary-x': `${secondaryX.toFixed(2)}%`,
        '--paint-theme-glow-secondary-y': `${secondaryY.toFixed(2)}%`,
        '--paint-theme-glow-tertiary': hslString(hue - 20, washSaturation, 28, 0.085),
        '--paint-theme-glow-tertiary-x': `${tertiaryX.toFixed(2)}%`,
        '--paint-theme-glow-tertiary-y': `${tertiaryY.toFixed(2)}%`,
        '--paint-theme-sweep-angle': `${clamp(stateValues.sweepAngle, 0, 360).toFixed(2)}deg`,
        '--paint-theme-sweep-color': hslString(hue - 14, washSaturation, 34, 0.11),
        '--paint-theme-sweep-soft': hslString(hue + 14, washSaturation, 74, 0.04),
        '--paint-theme-surface-0': hslString(hue, washSaturation, 7.2, 0.98),
        '--paint-theme-surface-1': hslString(hue, washSaturation, 8.8, 0.96),
        '--paint-theme-surface-2': hslString(hue, softSaturation, 10.8, 0.92),
        '--paint-theme-surface-3': hslString(hue, softSaturation, 13.5, 0.88),
        '--paint-theme-surface-4': hslString(hue, softSaturation, 16.2, 0.82),
        '--paint-theme-border': 'rgba(255, 255, 255, 0.12)',
        '--paint-theme-border-strong': 'rgba(255, 255, 255, 0.24)',
        '--paint-theme-border-accent': hslString(hue, accentSaturation, 74, 0.58),
        '--paint-theme-text': 'rgba(255, 255, 255, 0.94)',
        '--paint-theme-text-soft': 'rgba(255, 255, 255, 0.74)',
        '--paint-theme-text-dim': 'rgba(255, 255, 255, 0.58)',
        '--paint-theme-accent': hslString(hue, accentSaturation, 74, 0.95),
        '--paint-theme-accent-strong': hslString(hue, accentSaturation, 88, 0.98),
        '--paint-theme-accent-soft': hslString(hue, accentSaturation, 74, 0.18),
        '--paint-theme-accent-fill': hslString(hue, accentSaturation, 64, 0.22),
        '--paint-theme-accent-fill-strong': hslString(hue, accentSaturation, 66, 0.32),
        '--paint-theme-accent-glow': hslString(hue, accentSaturation, 68, 0.28),
        '--paint-theme-accent-text': hslString(hue, accentSaturation, 88, 0.98),
        '--paint-theme-slider-accent': 'rgba(244, 245, 248, 0.94)',
        '--paint-theme-progress': hslString(hue, accentSaturation, 70, 0.92),
        '--paint-theme-progress-strong': hslString(hue, accentSaturation, 88, 0.98),
        '--paint-theme-canvas-border': hslString(hue, accentSaturation, 82, 0.28),
        '--paint-theme-erase': hslString(hue, accentSaturation, 76, 0.94),
        '--accent': hslString(hue, accentSaturation, 74, 1),
        '--accent-strong': hslString(hue, accentSaturation, 88, 1),
        '--accent-soft': hslString(hue, accentSaturation, 74, 0.18),
        '--accent-outline': hslString(hue, accentSaturation, 74, 0.5),
        '--border-subtle': 'rgba(255, 255, 255, 0.14)'
    };
}

// MARK: CONTROLLER
function createPaintThemeController(options = {}) {
    const randomFn = typeof options.random === 'function' ? options.random : Math.random;
    const nowFn = typeof options.now === 'function'
        ? options.now
        : () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
    const getMotionMode = typeof options.getMotionMode === 'function' ? options.getMotionMode : null;
    const getTargets = typeof options.getTargets === 'function' ? options.getTargets : () => ({ overlayEl: null, bodyEl: null });
    const onApply = typeof options.onApply === 'function' ? options.onApply : null;
    const log = typeof options.log === 'function' ? options.log : null;

    let state = null;
    let tokens = null;
    let rafId = 0;
    let timerId = 0;
    let running = false;
    let lastFrameAt = 0;
    let motionMode = normalizeMotionMode(getMotionMode ? getMotionMode() : 'active');

    function apply(meta = {}) {
        if (!state) {
            return null;
        }
        const values = advanceState(state, nowFn(), randomFn);
        tokens = buildTokens(values);
        const targets = getTargets() || {};
        applyTokensToElement(targets.overlayEl, tokens);
        if (targets.bodyEl) {
            applyTokensToElement(targets.bodyEl, tokens);
        }
        if (onApply) {
            onApply(tokens, {
                ...meta,
                hue: values.hue,
                saturation: values.saturation,
                glowX: values.glowX,
                glowY: values.glowY,
                sweepAngle: values.sweepAngle
            });
        }
        return tokens;
    }

    function clearScheduledFrame() {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        if (timerId) {
            window.clearTimeout(timerId);
            timerId = 0;
        }
    }

    function resolveCurrentMotionMode() {
        return normalizeMotionMode(getMotionMode ? getMotionMode() : motionMode);
    }

    function scheduleNextFrame() {
        clearScheduledFrame();
        if (!running) {
            return;
        }
        motionMode = resolveCurrentMotionMode();
        if (motionMode === 'active') {
            rafId = window.requestAnimationFrame(frame);
            return;
        }
        const waitMs = motionMode === 'hidden'
            ? HIDDEN_FRAME_INTERVAL_MS
            : BACKGROUND_FRAME_INTERVAL_MS;
        timerId = window.setTimeout(() => {
            timerId = 0;
            if (!running) {
                return;
            }
            apply();
            scheduleNextFrame();
        }, waitMs);
    }

    function frame(now) {
        if (!running) {
            return;
        }
        if (resolveCurrentMotionMode() !== 'active') {
            lastFrameAt = 0;
            scheduleNextFrame();
            return;
        }
        if (!lastFrameAt || (now - lastFrameAt) >= FRAME_INTERVAL_MS) {
            lastFrameAt = now;
            const previousHueTarget = state?.hue?.targetValue;
            const previousSatTarget = state?.saturation?.targetValue;
            const previousGlowXTarget = state?.glowX?.targetValue;
            const previousGlowYTarget = state?.glowY?.targetValue;
            const previousSweepTarget = state?.sweepAngle?.targetValue;
            apply();
            if (log && state) {
                if (previousHueTarget !== state.hue.targetValue) {
                    log('paint.theme.target.hue', { targetHue: state.hue.targetValue, durationMs: state.hue.endsAt - state.hue.startedAt });
                }
                if (previousSatTarget !== state.saturation.targetValue) {
                    log('paint.theme.target.saturation', { targetSaturation: state.saturation.targetValue, durationMs: state.saturation.endsAt - state.saturation.startedAt });
                }
                if (previousGlowXTarget !== state.glowX.targetValue || previousGlowYTarget !== state.glowY.targetValue || previousSweepTarget !== state.sweepAngle.targetValue) {
                    log('paint.theme.target.background', {
                        glowX: state.glowX.targetValue,
                        glowY: state.glowY.targetValue,
                        sweepAngle: state.sweepAngle.targetValue,
                        durationMs: Math.max(state.glowX.endsAt - state.glowX.startedAt, state.glowY.endsAt - state.glowY.startedAt)
                    });
                }
            }
        }
        scheduleNextFrame();
    }

    function start(startOptions = {}) {
        const sourceCanvas = startOptions.sourceCanvas || null;
        const seed = sampleCanvasThemeSeed(sourceCanvas);
        if (log) {
            log('paint.theme.seed.begin', {
                reason: startOptions.reason || 'start',
                hasCanvas: !!sourceCanvas,
                width: Number(sourceCanvas?.width) || 0,
                height: Number(sourceCanvas?.height) || 0
            });
        }
        if (log) {
            if (seed.mode === 'gray') {
                log('paint.theme.seed.gray', {
                    saturation: seed.saturation,
                    chroma: seed.chroma
                });
            } else if (seed.mode === 'color') {
                log('paint.theme.seed.sampled', {
                    hue: seed.hue,
                    saturation: seed.saturation,
                    chroma: seed.chroma
                });
            } else {
                log('paint.theme.seed.fallbackRandom', {
                    reason: startOptions.reason || 'start'
                });
            }
        }
        stop();
        state = buildInitialState(seed, nowFn(), randomFn);
        running = true;
        motionMode = resolveCurrentMotionMode();
        lastFrameAt = 0;
        apply({
            reason: startOptions.reason || 'start',
            seedMode: seed.mode
        });
        if (log && state) {
            log('paint.theme.apply', {
                reason: startOptions.reason || 'start',
                seedMode: seed.mode,
                hue: state.hue.currentValue,
                saturation: state.saturation.currentValue
            });
            log('paint.theme.target.hue', { targetHue: state.hue.targetValue, durationMs: state.hue.endsAt - state.hue.startedAt });
            log('paint.theme.target.saturation', { targetSaturation: state.saturation.targetValue, durationMs: state.saturation.endsAt - state.saturation.startedAt });
            log('paint.theme.target.background', {
                glowX: state.glowX.targetValue,
                glowY: state.glowY.targetValue,
                sweepAngle: state.sweepAngle.targetValue,
                durationMs: Math.max(state.glowX.endsAt - state.glowX.startedAt, state.glowY.endsAt - state.glowY.startedAt)
            });
        }
        scheduleNextFrame();
        return {
            seed,
            tokens
        };
    }

    function stop() {
        running = false;
        clearScheduledFrame();
        lastFrameAt = 0;
        const targets = getTargets() || {};
        clearTokensFromElement(targets.overlayEl);
        clearTokensFromElement(targets.bodyEl);
        state = null;
        tokens = null;
    }

    function setMotionMode(nextMode, options = {}) {
        const normalized = normalizeMotionMode(nextMode);
        if (motionMode === normalized && options.force !== true) {
            return motionMode;
        }
        motionMode = normalized;
        lastFrameAt = 0;
        if (running) {
            scheduleNextFrame();
        }
        return motionMode;
    }

    function getTokens() {
        return tokens;
    }

    return {
        start,
        stop,
        getTokens,
        setMotionMode
    };
}

module.exports = {
    createPaintThemeController,
    sampleCanvasThemeSeed
};
