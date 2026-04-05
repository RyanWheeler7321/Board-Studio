'use strict';

// MARK: MODULE
module.exports = function createPaintAdjustmentsModule(deps) {
    const {
        dom,
        GRADIENT_MAPS,
        clamp,
        clamp01,
        getSession,
        normalizeHexColor,
        parseHexColor,
        renderStageUi,
        pushUndoAction
    } = deps;

    const session = new Proxy({}, {
        get(_target, prop) {
            return getSession()?.[prop];
        },
        set(_target, prop, value) {
            const current = getSession();
            if (!current) {
                return false;
            }
            current[prop] = value;
            return true;
        }
    });

function defaultAdjustSettings() {
    return {
        hue: 0,
        sat: 0,
        val: 0,
        contrast: 0,
        gamma: 1,
        colorizeStrength: 0,
        shadowColor: '#3b2a5a',
        midColor: '#5b6ee1',
        lightColor: '#ffd6a5',
        gradientMap: 'none',
        gradientStrength: 0,
        blur: 0,
        noise: 0,
        posterize: 0,
        halftoneStrength: 0,
        halftoneScale: 12,
        halftoneMin: 0,
        halftoneMax: 100
    };
}

function isAdjustPanelOpen() {
    return !!(session?.adjustPanel?.open);
}

const GRADIENT_MAP_LABELS = {
    none: 'None',
    teal_orange: 'Teal / Orange',
    vaporwave: 'Vaporwave',
    autumn: 'Autumn',
    emerald: 'Emerald',
    inferno: 'Inferno',
    noir: 'Noir',
    icefire: 'Icefire',
    cyberpunk: 'Cyberpunk',
    forest_moss: 'Forest Moss',
    sunset_pop: 'Sunset Pop',
    rose_gold: 'Rose Gold',
    arctic: 'Arctic',
    sepia: 'Sepia',
    pastel: 'Pastel'
};

const GRADIENT_MAP_ORDER = [
    'none',
    'teal_orange',
    'vaporwave',
    'autumn',
    'emerald',
    'inferno',
    'noir',
    'icefire',
    'cyberpunk',
    'sunset_pop',
    'forest_moss',
    'rose_gold',
    'arctic',
    'sepia',
    'pastel'
];

function resolveGradientMapLabel(key) {
    const normalized = String(key || 'none');
    return GRADIENT_MAP_LABELS[normalized] || normalized;
}

function gradientStopsToCss(stops) {
    if (!Array.isArray(stops) || stops.length === 0) {
        return 'linear-gradient(to right, rgb(40,40,48), rgb(235,235,240))';
    }
    const parts = stops.map((stop) => {
        const t = clamp01(Number(stop.t) || 0);
        const rgb = Array.isArray(stop.rgb) ? stop.rgb : [0, 0, 0];
        const r = clamp(Math.round(Number(rgb[0]) || 0), 0, 255);
        const g = clamp(Math.round(Number(rgb[1]) || 0), 0, 255);
        const b = clamp(Math.round(Number(rgb[2]) || 0), 0, 255);
        return `rgb(${r}, ${g}, ${b}) ${Math.round(t * 100)}%`;
    });
    return `linear-gradient(to right, ${parts.join(', ')})`;
}

function syncAdjustGradientPicker(settings) {
    if (!settings) {
        return;
    }
    const key = String(settings.gradientMap || 'none');
    if (dom.paintAdjustGradientMap) {
        dom.paintAdjustGradientMap.value = key;
    }
    if (dom.paintAdjustGradientBtnLabel) {
        dom.paintAdjustGradientBtnLabel.textContent = resolveGradientMapLabel(key);
    }
    if (dom.paintAdjustGradientBtnSwatch) {
        dom.paintAdjustGradientBtnSwatch.style.background = gradientStopsToCss(GRADIENT_MAPS[key]);
    }
}

function syncAdjustPanelValueLabels(settings) {
    if (!settings) {
        return;
    }
    if (dom.paintAdjustHueValue) {
        dom.paintAdjustHueValue.textContent = `${Math.round(Number(settings.hue) || 0)}°`;
    }
    if (dom.paintAdjustSatValue) {
        dom.paintAdjustSatValue.textContent = `${Math.round(Number(settings.sat) || 0)}%`;
    }
    if (dom.paintAdjustValValue) {
        dom.paintAdjustValValue.textContent = `${Math.round(Number(settings.val) || 0)}%`;
    }
    if (dom.paintAdjustContrastValue) {
        dom.paintAdjustContrastValue.textContent = `${Math.round(Number(settings.contrast) || 0)}%`;
    }
    if (dom.paintAdjustGammaValue) {
        const gamma = Number(settings.gamma);
        dom.paintAdjustGammaValue.textContent = Number.isFinite(gamma) ? gamma.toFixed(2) : '1.00';
    }
    if (dom.paintAdjustColorizeStrengthValue) {
        dom.paintAdjustColorizeStrengthValue.textContent = `${Math.round(Number(settings.colorizeStrength) || 0)}%`;
    }
    if (dom.paintAdjustGradientStrengthValue) {
        dom.paintAdjustGradientStrengthValue.textContent = `${Math.round(Number(settings.gradientStrength) || 0)}%`;
    }
    if (dom.paintAdjustBlurValue) {
        const blur = clamp(Number(settings.blur) || 0, 0, 20);
        dom.paintAdjustBlurValue.textContent = `${blur.toFixed(1)}px`;
    }
    if (dom.paintAdjustNoiseValue) {
        dom.paintAdjustNoiseValue.textContent = `${Math.round(Number(settings.noise) || 0)}%`;
    }
    if (dom.paintAdjustPosterizeValue) {
        const levels = clamp(Math.round(Number(settings.posterize) || 0), 0, 16);
        dom.paintAdjustPosterizeValue.textContent = levels <= 0 ? 'Off' : String(levels);
    }
    if (dom.paintAdjustHalftoneStrengthValue) {
        dom.paintAdjustHalftoneStrengthValue.textContent = `${Math.round(Number(settings.halftoneStrength) || 0)}%`;
    }
    if (dom.paintAdjustHalftoneScaleValue) {
        const scale = clamp(Math.round(Number(settings.halftoneScale) || 12), 2, 48);
        dom.paintAdjustHalftoneScaleValue.textContent = `${scale}px`;
    }
    if (dom.paintAdjustHalftoneMinValue) {
        dom.paintAdjustHalftoneMinValue.textContent = `${Math.round(Number(settings.halftoneMin) || 0)}%`;
    }
    if (dom.paintAdjustHalftoneMaxValue) {
        dom.paintAdjustHalftoneMaxValue.textContent = `${Math.round(Number(settings.halftoneMax) || 0)}%`;
    }
}

function syncAdjustPanelControls(settings) {
    if (!settings) {
        return;
    }
    if (dom.paintAdjustHue) {
        dom.paintAdjustHue.value = String(Math.round(Number(settings.hue) || 0));
    }
    if (dom.paintAdjustSat) {
        dom.paintAdjustSat.value = String(Math.round(Number(settings.sat) || 0));
    }
    if (dom.paintAdjustVal) {
        dom.paintAdjustVal.value = String(Math.round(Number(settings.val) || 0));
    }
    if (dom.paintAdjustContrast) {
        dom.paintAdjustContrast.value = String(Math.round(Number(settings.contrast) || 0));
    }
    if (dom.paintAdjustGamma) {
        const gamma = clamp(Number(settings.gamma) || 1, 0.25, 2.5);
        dom.paintAdjustGamma.value = String(gamma);
    }
    if (dom.paintAdjustColorizeStrength) {
        dom.paintAdjustColorizeStrength.value = String(Math.round(Number(settings.colorizeStrength) || 0));
    }
    if (dom.paintAdjustShadowColor) {
        dom.paintAdjustShadowColor.value = normalizeHexColor(settings.shadowColor) || '#3b2a5a';
    }
    if (dom.paintAdjustMidColor) {
        dom.paintAdjustMidColor.value = normalizeHexColor(settings.midColor) || '#5b6ee1';
    }
    if (dom.paintAdjustLightColor) {
        dom.paintAdjustLightColor.value = normalizeHexColor(settings.lightColor) || '#ffd6a5';
    }
    if (dom.paintAdjustGradientMap) {
        dom.paintAdjustGradientMap.value = String(settings.gradientMap || 'none');
    }
    if (dom.paintAdjustGradientStrength) {
        dom.paintAdjustGradientStrength.value = String(Math.round(Number(settings.gradientStrength) || 0));
    }
    if (dom.paintAdjustBlur) {
        dom.paintAdjustBlur.value = String(clamp(Number(settings.blur) || 0, 0, 20));
    }
    if (dom.paintAdjustNoise) {
        dom.paintAdjustNoise.value = String(clamp(Math.round(Number(settings.noise) || 0), 0, 100));
    }
    if (dom.paintAdjustPosterize) {
        dom.paintAdjustPosterize.value = String(clamp(Math.round(Number(settings.posterize) || 0), 0, 16));
    }
    if (dom.paintAdjustHalftoneStrength) {
        dom.paintAdjustHalftoneStrength.value = String(clamp(Math.round(Number(settings.halftoneStrength) || 0), 0, 100));
    }
    if (dom.paintAdjustHalftoneScale) {
        dom.paintAdjustHalftoneScale.value = String(clamp(Math.round(Number(settings.halftoneScale) || 12), 2, 48));
    }
    if (dom.paintAdjustHalftoneMin) {
        dom.paintAdjustHalftoneMin.value = String(clamp(Math.round(Number(settings.halftoneMin) || 0), 0, 100));
    }
    if (dom.paintAdjustHalftoneMax) {
        dom.paintAdjustHalftoneMax.value = String(clamp(Math.round(Number(settings.halftoneMax) || 100), 0, 100));
    }
    syncAdjustGradientPicker(settings);
    syncAdjustPanelValueLabels(settings);
}

function collectAdjustSettingsFromDom(current) {
    const next = { ...(current || defaultAdjustSettings()) };
    if (dom.paintAdjustHue) {
        next.hue = clamp(Math.round(Number(dom.paintAdjustHue.value) || 0), -180, 180);
    }
    if (dom.paintAdjustSat) {
        next.sat = clamp(Math.round(Number(dom.paintAdjustSat.value) || 0), -100, 100);
    }
    if (dom.paintAdjustVal) {
        next.val = clamp(Math.round(Number(dom.paintAdjustVal.value) || 0), -100, 100);
    }
    if (dom.paintAdjustContrast) {
        next.contrast = clamp(Math.round(Number(dom.paintAdjustContrast.value) || 0), -100, 100);
    }
    if (dom.paintAdjustGamma) {
        next.gamma = clamp(Number(dom.paintAdjustGamma.value) || 1, 0.25, 2.5);
    }
    if (dom.paintAdjustColorizeStrength) {
        next.colorizeStrength = clamp(Math.round(Number(dom.paintAdjustColorizeStrength.value) || 0), 0, 100);
    }
    if (dom.paintAdjustShadowColor) {
        next.shadowColor = normalizeHexColor(dom.paintAdjustShadowColor.value) || next.shadowColor;
    }
    if (dom.paintAdjustMidColor) {
        next.midColor = normalizeHexColor(dom.paintAdjustMidColor.value) || next.midColor;
    }
    if (dom.paintAdjustLightColor) {
        next.lightColor = normalizeHexColor(dom.paintAdjustLightColor.value) || next.lightColor;
    }
    if (dom.paintAdjustGradientMap) {
        next.gradientMap = String(dom.paintAdjustGradientMap.value || 'none');
    }
    if (dom.paintAdjustGradientStrength) {
        next.gradientStrength = clamp(Math.round(Number(dom.paintAdjustGradientStrength.value) || 0), 0, 100);
    }
    if (dom.paintAdjustBlur) {
        next.blur = clamp(Number(dom.paintAdjustBlur.value) || 0, 0, 20);
    }
    if (dom.paintAdjustNoise) {
        next.noise = clamp(Math.round(Number(dom.paintAdjustNoise.value) || 0), 0, 100);
    }
    if (dom.paintAdjustPosterize) {
        next.posterize = clamp(Math.round(Number(dom.paintAdjustPosterize.value) || 0), 0, 16);
    }
    if (dom.paintAdjustHalftoneStrength) {
        next.halftoneStrength = clamp(Math.round(Number(dom.paintAdjustHalftoneStrength.value) || 0), 0, 100);
    }
    if (dom.paintAdjustHalftoneScale) {
        next.halftoneScale = clamp(Math.round(Number(dom.paintAdjustHalftoneScale.value) || 12), 2, 48);
    }
    if (dom.paintAdjustHalftoneMin) {
        next.halftoneMin = clamp(Math.round(Number(dom.paintAdjustHalftoneMin.value) || 0), 0, 100);
    }
    if (dom.paintAdjustHalftoneMax) {
        next.halftoneMax = clamp(Math.round(Number(dom.paintAdjustHalftoneMax.value) || 100), 0, 100);
    }
    return next;
}

function getAdjustSettingsSignature(current) {
    const settings = { ...defaultAdjustSettings(), ...(current || {}) };
    return [
        clamp(Math.round(Number(settings.hue) || 0), -180, 180),
        clamp(Math.round(Number(settings.sat) || 0), -100, 100),
        clamp(Math.round(Number(settings.val) || 0), -100, 100),
        clamp(Math.round(Number(settings.contrast) || 0), -100, 100),
        clamp(Number(settings.gamma) || 1, 0.25, 2.5).toFixed(3),
        clamp(Math.round(Number(settings.colorizeStrength) || 0), 0, 100),
        normalizeHexColor(settings.shadowColor) || '#3b2a5a',
        normalizeHexColor(settings.midColor) || '#5b6ee1',
        normalizeHexColor(settings.lightColor) || '#ffd6a5',
        String(settings.gradientMap || 'none'),
        clamp(Math.round(Number(settings.gradientStrength) || 0), 0, 100),
        clamp(Number(settings.blur) || 0, 0, 20).toFixed(2),
        clamp(Math.round(Number(settings.noise) || 0), 0, 100),
        clamp(Math.round(Number(settings.posterize) || 0), 0, 16),
        clamp(Math.round(Number(settings.halftoneStrength) || 0), 0, 100),
        clamp(Math.round(Number(settings.halftoneScale) || 12), 2, 48),
        clamp(Math.round(Number(settings.halftoneMin) || 0), 0, 100),
        clamp(Math.round(Number(settings.halftoneMax) || 100), 0, 100)
    ].join('|');
}

function setAdjustPanelVisible(visible) {
    if (!dom.paintAdjustPanel) {
        return;
    }
    if (visible) {
        dom.paintAdjustPanel.hidden = false;
        requestAnimationFrame(() => {
            dom.paintAdjustPanel.classList.add('is-open');
        });
        return;
    }
    dom.paintAdjustPanel.classList.remove('is-open');
    window.setTimeout(() => {
        if (dom.paintAdjustPanel && !dom.paintAdjustPanel.classList.contains('is-open')) {
            dom.paintAdjustPanel.hidden = true;
        }
    }, 190);
}

function isAdjustGradientMenuOpen() {
    return !!(dom.paintAdjustGradientMenu && !dom.paintAdjustGradientMenu.hidden);
}

function renderAdjustGradientMenu(activeKey = '') {
    if (!dom.paintAdjustGradientMenu) {
        return;
    }
    const key = String(activeKey || session?.adjustPanel?.settings?.gradientMap || dom.paintAdjustGradientMap?.value || 'none');
    dom.paintAdjustGradientMenu.innerHTML = '';
    for (const candidate of GRADIENT_MAP_ORDER) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `paint-adjust-gradient-option${candidate === key ? ' is-active' : ''}`;
        btn.setAttribute('data-gradient-key', candidate);
        const label = document.createElement('span');
        label.textContent = resolveGradientMapLabel(candidate);
        const swatch = document.createElement('span');
        swatch.className = 'paint-adjust-gradient-option-swatch';
        swatch.style.background = gradientStopsToCss(GRADIENT_MAPS[candidate]);
        btn.appendChild(label);
        btn.appendChild(swatch);
        dom.paintAdjustGradientMenu.appendChild(btn);
    }
}

function setAdjustGradientMenuVisible(visible) {
    if (!dom.paintAdjustGradientMenu || !dom.paintAdjustGradientBtn) {
        return;
    }
    const next = !!visible;
    dom.paintAdjustGradientMenu.hidden = !next;
    dom.paintAdjustGradientBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) {
        renderAdjustGradientMenu();
    }
}

function cancelAdjustJob() {
    if (!session?.adjustPanel) {
        return;
    }
    if (session.adjustPanel.job) {
        session.adjustPanel.job.cancelled = true;
        session.adjustPanel.job = null;
    }
    if (session.adjustPanel.fastJob) {
        session.adjustPanel.fastJob.cancelled = true;
        session.adjustPanel.fastJob = null;
    }
    if (session.adjustPanel.previewTimer) {
        clearTimeout(session.adjustPanel.previewTimer);
        session.adjustPanel.previewTimer = null;
    }
    if (session.adjustPanel.hqTimer) {
        clearTimeout(session.adjustPanel.hqTimer);
        session.adjustPanel.hqTimer = null;
    }
}

function openAdjustPanel() {
    if (!session || !dom.paintAdjustPanel || !session.baseCtx) {
        return;
    }
    if (session.isDrawing || session.crop.active || session.zoomDrag.active || session.pan.active) {
        return;
    }
    if (isAdjustPanelOpen()) {
        return;
    }
    const prev = session.adjustPanel?.settings && typeof session.adjustPanel.settings === 'object'
        ? session.adjustPanel.settings
        : defaultAdjustSettings();
    const settings = { ...defaultAdjustSettings(), ...prev };
    const original = session.baseCtx.getImageData(0, 0, session.width, session.height);
    const originalCanvas = document.createElement('canvas');
    originalCanvas.width = session.width;
    originalCanvas.height = session.height;
    const originalCtx = originalCanvas.getContext('2d', { willReadFrequently: false });
    if (originalCtx) {
        try {
            originalCtx.putImageData(original, 0, 0);
        } catch {}
    }
    const maxPreviewPixels = 360000;
    const pixels = Math.max(1, session.width * session.height);
    const scale = clamp(Math.sqrt(maxPreviewPixels / pixels), 0.08, 1);
    const previewW = Math.max(1, Math.round(session.width * scale));
    const previewH = Math.max(1, Math.round(session.height * scale));
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = previewW;
    previewCanvas.height = previewH;
    const previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
    let previewOriginal = null;
    if (previewCtx) {
        previewCtx.save();
        previewCtx.setTransform(1, 0, 0, 1, 0, 0);
        previewCtx.clearRect(0, 0, previewW, previewH);
        previewCtx.imageSmoothingEnabled = true;
        previewCtx.drawImage(originalCanvas, 0, 0, session.width, session.height, 0, 0, previewW, previewH);
        previewCtx.restore();
        try {
            previewOriginal = previewCtx.getImageData(0, 0, previewW, previewH);
        } catch {}
    }
    session.adjustPanel = {
        open: true,
        settings,
        original,
        originalCanvas,
        originalCtx,
        preview: { canvas: previewCanvas, ctx: previewCtx, scale, width: previewW, height: previewH, original: previewOriginal },
        job: null,
        fastJob: null,
        previewTimer: null,
        hqTimer: null,
        lastFastSignature: '',
        lastHqSignature: '',
        lastScheduledHqSignature: ''
    };
    syncAdjustPanelControls(settings);
    setAdjustPanelVisible(true);
}

function closeAdjustPanel(options = {}) {
    if (!session?.adjustPanel?.open) {
        setAdjustPanelVisible(false);
        return;
    }
    setAdjustGradientMenuVisible(false);
    const apply = !!options.apply;
    cancelAdjustJob();
    if (!apply && session.adjustPanel.original && session.baseCtx) {
        try {
            session.baseCtx.putImageData(session.adjustPanel.original, 0, 0);
        } catch (error) {
            console.warn('Adjust: restore failed', error);
        }
    }
    const keepSettings = session.adjustPanel.settings && typeof session.adjustPanel.settings === 'object'
        ? { ...session.adjustPanel.settings }
        : defaultAdjustSettings();
    session.adjustPanel = { open: false, settings: keepSettings, original: null, job: null, previewTimer: null };
    setAdjustPanelVisible(false);
    renderStageUi();
}

function scheduleAdjustHighQuality() {
    if (!session?.adjustPanel?.open || !session.adjustPanel.original) {
        return;
    }
    const signature = getAdjustSettingsSignature(session.adjustPanel.settings);
    if (session.adjustPanel.hqTimer && session.adjustPanel.lastScheduledHqSignature === signature) {
        return;
    }
    if (session.adjustPanel.hqTimer) {
        clearTimeout(session.adjustPanel.hqTimer);
    }
    session.adjustPanel.lastScheduledHqSignature = signature;
    session.adjustPanel.hqTimer = window.setTimeout(() => {
        session.adjustPanel.hqTimer = null;
        session.adjustPanel.lastScheduledHqSignature = '';
        beginAdjustRender({ quality: 'hq', commit: false });
    }, 260);
}

function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - (2 * t));
}

function resolveGradientRgb(stops, t) {
    if (!Array.isArray(stops) || stops.length === 0) {
        return [0, 0, 0];
    }
    const x = clamp01(t);
    let prev = stops[0];
    for (let i = 1; i < stops.length; i += 1) {
        const next = stops[i];
        if (x <= next.t) {
            const span = Math.max(0.000001, next.t - prev.t);
            const u = clamp01((x - prev.t) / span);
            return [
                Math.round(prev.rgb[0] + ((next.rgb[0] - prev.rgb[0]) * u)),
                Math.round(prev.rgb[1] + ((next.rgb[1] - prev.rgb[1]) * u)),
                Math.round(prev.rgb[2] + ((next.rgb[2] - prev.rgb[2]) * u))
            ];
        }
        prev = next;
    }
    return prev.rgb.slice();
}

function rgbToHsvFast(r, g, b) {
    const rf = clamp01(r / 255);
    const gf = clamp01(g / 255);
    const bf = clamp01(b / 255);
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === rf) {
            h = 60 * (((gf - bf) / delta) % 6);
        } else if (max === gf) {
            h = 60 * (((bf - rf) / delta) + 2);
        } else {
            h = 60 * (((rf - gf) / delta) + 4);
        }
    }
    if (h < 0) {
        h += 360;
    }
    const s = max === 0 ? 0 : (delta / max);
    return [h, s, max];
}

function hsvToRgbFast(h, s, v) {
    const hh = ((Number(h) % 360) + 360) % 360;
    const ss = clamp01(s);
    const vv = clamp01(v);
    const c = vv * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = vv - c;
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hh < 60) {
        r1 = c; g1 = x; b1 = 0;
    } else if (hh < 120) {
        r1 = x; g1 = c; b1 = 0;
    } else if (hh < 180) {
        r1 = 0; g1 = c; b1 = x;
    } else if (hh < 240) {
        r1 = 0; g1 = x; b1 = c;
    } else if (hh < 300) {
        r1 = x; g1 = 0; b1 = c;
    } else {
        r1 = c; g1 = 0; b1 = x;
    }
    return [
        Math.round((r1 + m) * 255),
        Math.round((g1 + m) * 255),
        Math.round((b1 + m) * 255)
    ];
}

function beginAdjustRender(options = {}) {
    if (!session?.adjustPanel?.open || !session.adjustPanel.original || !session.baseCtx) {
        return;
    }
    const commit = !!options.commit;
    const quality = options.quality === 'fast' ? 'fast' : 'hq';

    const settings = session.adjustPanel.settings || defaultAdjustSettings();
    const signature = getAdjustSettingsSignature(settings);
    if (!commit) {
        if (quality === 'fast' && session.adjustPanel.lastFastSignature === signature) {
            return;
        }
        if (quality === 'hq' && session.adjustPanel.lastHqSignature === signature) {
            return;
        }
    }

    cancelAdjustJob();
    syncAdjustPanelValueLabels(settings);

    const hueShift = clamp(Number(settings.hue) || 0, -180, 180);
    const sat = clamp(Number(settings.sat) || 0, -100, 100);
    const val = clamp(Number(settings.val) || 0, -100, 100);
    const contrast = clamp(Number(settings.contrast) || 0, -100, 100);
    const gamma = clamp(Number(settings.gamma) || 1, 0.25, 2.5);
    const colorizeStrength = clamp(Number(settings.colorizeStrength) || 0, 0, 100) / 100;
    const gradientStrength = clamp(Number(settings.gradientStrength) || 0, 0, 100) / 100;
    const gradientStops = GRADIENT_MAPS[settings.gradientMap] || null;
    const shadowRgb = parseHexColor(settings.shadowColor) || { r: 0, g: 0, b: 0 };
    const midRgb = parseHexColor(settings.midColor) || { r: 128, g: 128, b: 128 };
    const lightRgb = parseHexColor(settings.lightColor) || { r: 255, g: 255, b: 255 };
    const blurPx = clamp(Number(settings.blur) || 0, 0, 20);
    const noiseStrength = clamp(Number(settings.noise) || 0, 0, 100) / 100;
    const posterizeLevels = clamp(Math.round(Number(settings.posterize) || 0), 0, 16);
    const halftoneStrength = clamp(Number(settings.halftoneStrength) || 0, 0, 100) / 100;
    const halftoneScale = clamp(Math.round(Number(settings.halftoneScale) || 12), 2, 48);
    const halftoneMin = clamp(Number(settings.halftoneMin) || 0, 0, 100) / 100;
    const halftoneMax = clamp(Number(settings.halftoneMax) || 100, 0, 100) / 100;

    const satMul = 1 + (sat / 100);
    const valMul = 1 + (val / 100);
    const contrastFactor = Math.pow(2, contrast / 50);
    const invGamma = 1 / gamma;

    const resolved = quality === 'fast'
        ? (session.adjustPanel.preview && session.adjustPanel.preview.ctx ? session.adjustPanel.preview : null)
        : null;
    const width = resolved ? resolved.width : session.adjustPanel.original.width;
    const height = resolved ? resolved.height : session.adjustPanel.original.height;

    let src = session.adjustPanel.original.data;
    if (resolved) {
        const srcCtx = resolved.ctx;
        if (!srcCtx) {
            return;
        }
        if (!resolved.original) {
            const srcCanvas = session.adjustPanel.originalCanvas;
            if (!srcCanvas) {
                return;
            }
            srcCtx.save();
            srcCtx.setTransform(1, 0, 0, 1, 0, 0);
            srcCtx.clearRect(0, 0, width, height);
            srcCtx.imageSmoothingEnabled = true;
            srcCtx.drawImage(srcCanvas, 0, 0, session.width, session.height, 0, 0, width, height);
            srcCtx.restore();
            try {
                resolved.original = srcCtx.getImageData(0, 0, width, height);
            } catch {
                return;
            }
        }
        if (resolved.original) {
            src = resolved.original.data;
        }
    }
    const dst = new Uint8ClampedArray(src.length);

    const job = {
        cancelled: false,
        index: 0,
        width,
        height,
        src,
        dst,
        commit,
        quality,
        signature,
        params: {
            hueShift,
            satMul,
            valMul,
            contrastFactor,
            invGamma,
            colorizeStrength,
            shadowRgb,
            midRgb,
            lightRgb,
            gradientStrength,
            gradientStops,
            blurPx,
            noiseStrength,
            posterizeLevels,
            halftoneStrength,
            halftoneScale,
            halftoneMin,
            halftoneMax
        }
    };
    if (quality === 'fast') {
        session.adjustPanel.fastJob = job;
    } else {
        session.adjustPanel.job = job;
    }

    const processChunk = () => {
        const currentJob = job.quality === 'fast' ? session?.adjustPanel?.fastJob : session?.adjustPanel?.job;
        if (!currentJob || currentJob !== job || job.cancelled) {
            return;
        }
        const t0 = performance.now();
        const { src, dst } = job;
        const p = job.params;
        const needsXy = p.noiseStrength > 0.0001 || p.halftoneStrength > 0.0001;
        let pixel = job.index >> 2;
        let x = needsXy ? (pixel % job.width) : 0;
        let y = needsXy ? ((pixel - x) / job.width) : 0;
        for (; job.index < src.length; job.index += 4) {
            const r0 = src[job.index];
            const g0 = src[job.index + 1];
            const b0 = src[job.index + 2];
            const a0 = src[job.index + 3];

            let r = r0;
            let g = g0;
            let b = b0;

            if (p.hueShift || p.satMul !== 1 || p.valMul !== 1) {
                const hsv = rgbToHsvFast(r, g, b);
                const h = hsv[0] + p.hueShift;
                const s = clamp01(hsv[1] * p.satMul);
                const v = clamp01(hsv[2] * p.valMul);
                const rgb = hsvToRgbFast(h, s, v);
                r = rgb[0]; g = rgb[1]; b = rgb[2];
            }

            if (p.contrastFactor !== 1) {
                r = clamp(Math.round((((r / 255) - 0.5) * p.contrastFactor + 0.5) * 255), 0, 255);
                g = clamp(Math.round((((g / 255) - 0.5) * p.contrastFactor + 0.5) * 255), 0, 255);
                b = clamp(Math.round((((b / 255) - 0.5) * p.contrastFactor + 0.5) * 255), 0, 255);
            }

            if (p.invGamma !== 1) {
                r = clamp(Math.round(Math.pow(r / 255, p.invGamma) * 255), 0, 255);
                g = clamp(Math.round(Math.pow(g / 255, p.invGamma) * 255), 0, 255);
                b = clamp(Math.round(Math.pow(b / 255, p.invGamma) * 255), 0, 255);
            }

            if (p.noiseStrength > 0.0001) {
                const hx = Math.imul(x + 1, 374761393);
                const hy = Math.imul(y + 1, 668265263);
                let h = (hx ^ hy) >>> 0;
                h ^= h >>> 13;
                h = Math.imul(h, 1274126177) >>> 0;
                const n = (((h >>> 0) / 4294967295) * 2 - 1) * (p.noiseStrength * 36);
                r = clamp(Math.round(r + n), 0, 255);
                g = clamp(Math.round(g + n), 0, 255);
                b = clamp(Math.round(b + n), 0, 255);
            }

            if (p.colorizeStrength > 0.0001) {
                const lum = ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / 255;
                let wShadow = 1 - smoothstep(0.15, 0.55, lum);
                let wLight = smoothstep(0.45, 0.9, lum);
                let wMid = 1 - wShadow - wLight;
                wShadow = clamp01(wShadow);
                wMid = clamp01(wMid);
                wLight = clamp01(wLight);
                const sum = Math.max(0.000001, wShadow + wMid + wLight);
                wShadow /= sum;
                wMid /= sum;
                wLight /= sum;
                let tr = (p.shadowRgb.r * wShadow) + (p.midRgb.r * wMid) + (p.lightRgb.r * wLight);
                let tg = (p.shadowRgb.g * wShadow) + (p.midRgb.g * wMid) + (p.lightRgb.g * wLight);
                let tb = (p.shadowRgb.b * wShadow) + (p.midRgb.b * wMid) + (p.lightRgb.b * wLight);
                const tLum = ((0.2126 * tr) + (0.7152 * tg) + (0.0722 * tb)) / 255;
                const scale = tLum > 0.000001 ? (lum / tLum) : 1;
                tr = clamp(Math.round(tr * scale), 0, 255);
                tg = clamp(Math.round(tg * scale), 0, 255);
                tb = clamp(Math.round(tb * scale), 0, 255);
                const mix = p.colorizeStrength;
                r = clamp(Math.round(r + ((tr - r) * mix)), 0, 255);
                g = clamp(Math.round(g + ((tg - g) * mix)), 0, 255);
                b = clamp(Math.round(b + ((tb - b) * mix)), 0, 255);
            }

            if (p.gradientStops && p.gradientStrength > 0.0001) {
                const lum = ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / 255;
                const mapped = resolveGradientRgb(p.gradientStops, lum);
                const mix = p.gradientStrength;
                r = clamp(Math.round(r + ((mapped[0] - r) * mix)), 0, 255);
                g = clamp(Math.round(g + ((mapped[1] - g) * mix)), 0, 255);
                b = clamp(Math.round(b + ((mapped[2] - b) * mix)), 0, 255);
            }

            if (p.posterizeLevels >= 2) {
                const levels = p.posterizeLevels;
                const step = 255 / Math.max(1, levels - 1);
                r = clamp(Math.round(Math.round(r / step) * step), 0, 255);
                g = clamp(Math.round(Math.round(g / step) * step), 0, 255);
                b = clamp(Math.round(Math.round(b / step) * step), 0, 255);
            }

            if (p.halftoneStrength > 0.0001) {
                const lum = ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / 255;
                const min = Math.min(p.halftoneMin, p.halftoneMax);
                const max = Math.max(p.halftoneMin, p.halftoneMax);
                const band = Math.max(0.000001, max - min);
                const fade = Math.min(0.18, band * 0.25);
                const w = smoothstep(min, min + fade, lum) * (1 - smoothstep(max - fade, max, lum));
                const mix = clamp01(p.halftoneStrength * w);
                if (mix > 0.0001) {
                    const cell = p.halftoneScale;
                    const dx = ((x % cell) + 0.5) - (cell / 2);
                    const dy = ((y % cell) + 0.5) - (cell / 2);
                    const dist = Math.hypot(dx, dy);
                    const radius = (1 - lum) * (cell * 0.5);
                    const edge = smoothstep(radius, radius + 1.0, dist);
                    const rr = r * edge;
                    const gg = g * edge;
                    const bb = b * edge;
                    r = clamp(Math.round(r + ((rr - r) * mix)), 0, 255);
                    g = clamp(Math.round(g + ((gg - g) * mix)), 0, 255);
                    b = clamp(Math.round(b + ((bb - b) * mix)), 0, 255);
                }
            }

            dst[job.index] = r;
            dst[job.index + 1] = g;
            dst[job.index + 2] = b;
            dst[job.index + 3] = a0;

            if (needsXy) {
                x += 1;
                if (x >= job.width) {
                    x = 0;
                    y += 1;
                }
            }

            if ((performance.now() - t0) > 12) {
                break;
            }
        }

        if (job.cancelled) {
            return;
        }
        if (job.index < src.length) {
            requestAnimationFrame(processChunk);
            return;
        }

        let imageData = null;
        try {
            imageData = new ImageData(dst, width, height);
        } catch {
            imageData = session.baseCtx.createImageData(width, height);
            imageData.data.set(dst);
        }
        try {
            if (job.quality === 'fast' && session.adjustPanel.preview?.ctx) {
                const previewCtx = session.adjustPanel.preview.ctx;
                previewCtx.putImageData(imageData, 0, 0);
                session.baseCtx.save();
                session.baseCtx.setTransform(1, 0, 0, 1, 0, 0);
                session.baseCtx.clearRect(0, 0, session.width, session.height);
                session.baseCtx.filter = p.blurPx > 0.001 ? `blur(${p.blurPx}px)` : 'none';
                session.baseCtx.imageSmoothingEnabled = true;
                session.baseCtx.drawImage(session.adjustPanel.preview.canvas, 0, 0, width, height, 0, 0, session.width, session.height);
                session.baseCtx.restore();
            } else {
                if (p.blurPx > 0.001 && session?.adjustPanel) {
                    if (!session.adjustPanel.hqCanvas) {
                        const hqCanvas = document.createElement('canvas');
                        hqCanvas.width = session.width;
                        hqCanvas.height = session.height;
                        const hqCtx = hqCanvas.getContext('2d', { willReadFrequently: false });
                        session.adjustPanel.hqCanvas = hqCanvas;
                        session.adjustPanel.hqCtx = hqCtx;
                    }
                    if (session.adjustPanel.hqCtx) {
                        session.adjustPanel.hqCtx.putImageData(imageData, 0, 0);
                        session.baseCtx.save();
                        session.baseCtx.setTransform(1, 0, 0, 1, 0, 0);
                        session.baseCtx.clearRect(0, 0, session.width, session.height);
                        session.baseCtx.filter = `blur(${p.blurPx}px)`;
                        session.baseCtx.drawImage(session.adjustPanel.hqCanvas, 0, 0);
                        session.baseCtx.restore();
                    } else {
                        session.baseCtx.putImageData(imageData, 0, 0);
                    }
                } else {
                    session.baseCtx.putImageData(imageData, 0, 0);
                }
            }
        } catch (error) {
            console.warn('Adjust: render failed', error);
        }
        if (job.quality === 'fast') {
            session.adjustPanel.lastFastSignature = job.signature;
        } else {
            session.adjustPanel.lastHqSignature = job.signature;
        }
        renderStageUi();

        if (commit) {
            const before = session.adjustPanel.original;
            const bounds = { x: 0, y: 0, width: session.width, height: session.height };
            const after = session.baseCtx.getImageData(0, 0, session.width, session.height);
            pushUndoAction({ type: 'pixels', bounds, before, after });
            closeAdjustPanel({ apply: true });
        }
    };

    requestAnimationFrame(processChunk);
}

    return {
        defaultAdjustSettings,
        isAdjustPanelOpen,
        syncAdjustGradientPicker,
        syncAdjustPanelValueLabels,
        syncAdjustPanelControls,
        collectAdjustSettingsFromDom,
        getAdjustSettingsSignature,
        setAdjustPanelVisible,
        isAdjustGradientMenuOpen,
        renderAdjustGradientMenu,
        setAdjustGradientMenuVisible,
        cancelAdjustJob,
        openAdjustPanel,
        closeAdjustPanel,
        scheduleAdjustHighQuality,
        beginAdjustRender
    };
};
