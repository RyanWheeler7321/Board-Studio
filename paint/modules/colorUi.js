'use strict';

// MARK: MODULE
module.exports = function createPaintColorUiModule(deps) {
    const {
        dom,
        recentColors,
        TOOL_AIR,
        DEFAULT_COLOR,
        DEFAULT_BRUSH_SIZE,
        COLOR_PICKER_WIDTH,
        COLOR_PICKER_HEIGHT,
        RECENT_COLORS_MAX,
        clamp,
        clamp01,
        getSession,
        updateHud,
        persistPaintPreferences,
        updateTransformPreviewGeometry,
        renderStageUi
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

    let colorPickTimer = null;

function showColorPickIndicator(color, clientX, clientY) {
    if (!dom.paintColorPickIndicator) {
        return;
    }
    const x = Number(clientX);
    const y = Number(clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
    }
    const sizeBase = session?.tool === TOOL_AIR ? (session.size * 3) : session?.size || DEFAULT_BRUSH_SIZE;
    const radius = (sizeBase / 2) * (session?.view?.scale || 1);
    const nudge = 42;
    dom.paintColorPickIndicator.style.left = `${Math.round(x - radius - nudge)}px`;
    dom.paintColorPickIndicator.style.top = `${Math.round(y)}px`;
    dom.paintColorPickIndicator.style.background = color || DEFAULT_COLOR;
    dom.paintColorPickIndicator.hidden = false;
    if (colorPickTimer) {
        clearTimeout(colorPickTimer);
    }
    colorPickTimer = setTimeout(() => {
        if (dom.paintColorPickIndicator) {
            dom.paintColorPickIndicator.hidden = true;
        }
        colorPickTimer = null;
    }, 500);
}

function hideColorPickIndicator() {
    if (colorPickTimer) {
        clearTimeout(colorPickTimer);
        colorPickTimer = null;
    }
    if (dom.paintColorPickIndicator) {
        dom.paintColorPickIndicator.hidden = true;
    }
}

function normalizeHexColor(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    const hex = withHash.toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(hex)) {
        return hex;
    }
    if (/^#[0-9a-f]{3}$/.test(hex)) {
        const r = hex[1];
        const g = hex[2];
        const b = hex[3];
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return '';
}

function parseHexColor(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) {
        return null;
    }
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    if (![r, g, b].every((value) => Number.isFinite(value))) {
        return null;
    }
    return { r, g, b };
}

function rgbToHex(rgb) {
    const toByte = (value) => clamp(Math.round(value), 0, 255);
    const r = toByte(rgb?.r);
    const g = toByte(rgb?.g);
    const b = toByte(rgb?.b);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function rgbToRgbaString(rgb, alpha) {
    const toByte = (value) => clamp(Math.round(value), 0, 255);
    const r = toByte(rgb?.r);
    const g = toByte(rgb?.g);
    const b = toByte(rgb?.b);
    return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

function rgbToHsl(rgb) {
    const r = clamp01(rgb.r / 255);
    const g = clamp01(rgb.g / 255);
    const b = clamp01(rgb.b / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta) {
        if (max === r) {
            h = ((g - b) / delta) % 6;
        } else if (max === g) {
            h = (b - r) / delta + 2;
        } else {
            h = (r - g) / delta + 4;
        }
    }
    h = ((h * 60) + 360) % 360;
    const l = (max + min) / 2;
    const s = delta ? (delta / (1 - Math.abs((2 * l) - 1))) : 0;
    return { h, s, l };
}

function hslToRgb(hsl) {
    const h = ((Number(hsl.h) % 360) + 360) % 360;
    const s = clamp01(hsl.s);
    const l = clamp01(hsl.l);
    const c = (1 - Math.abs((2 * l) - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - (c / 2);
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) {
        r = c;
        g = x;
    } else if (h < 120) {
        r = x;
        g = c;
    } else if (h < 180) {
        g = c;
        b = x;
    } else if (h < 240) {
        g = x;
        b = c;
    } else if (h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

function hslToHex(hsl) {
    return rgbToHex(hslToRgb(hsl));
}

function buildRelatedColors(hex) {
    const rgb = parseHexColor(hex);
    if (!rgb) {
        return [];
    }
    const hsl = rgbToHsl(rgb);
    const variants = [
        { h: hsl.h, s: hsl.s, l: clamp01(hsl.l + 0.2) },
        { h: hsl.h, s: hsl.s, l: clamp01(hsl.l - 0.2) },
        { h: (hsl.h + 30) % 360, s: clamp01(hsl.s * 0.95), l: hsl.l },
        { h: (hsl.h + 330) % 360, s: clamp01(hsl.s * 0.95), l: hsl.l },
        { h: (hsl.h + 180) % 360, s: hsl.s, l: hsl.l },
        { h: hsl.h, s: clamp01(hsl.s + 0.2), l: hsl.l }
    ];
    const out = [];
    const seen = new Set();
    for (const variant of variants) {
        const color = normalizeHexColor(hslToHex(variant));
        if (color && !seen.has(color)) {
            out.push(color);
            seen.add(color);
        }
    }
    return out;
}

function hsvToRgb(hsv) {
    const h = ((Number(hsv?.h) % 360) + 360) % 360;
    const s = clamp01(Number(hsv?.s));
    const v = clamp01(Number(hsv?.v));
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) {
        r = c; g = x; b = 0;
    } else if (h < 120) {
        r = x; g = c; b = 0;
    } else if (h < 180) {
        r = 0; g = c; b = x;
    } else if (h < 240) {
        r = 0; g = x; b = c;
    } else if (h < 300) {
        r = x; g = 0; b = c;
    } else {
        r = c; g = 0; b = x;
    }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

function rgbToHsv(rgb) {
    const r = clamp01(Number(rgb?.r) / 255);
    const g = clamp01(Number(rgb?.g) / 255);
    const b = clamp01(Number(rgb?.b) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * (((b - r) / delta) + 2);
        else h = 60 * (((r - g) / delta) + 4);
    }
    if (h < 0) {
        h += 360;
    }
    const s = max === 0 ? 0 : delta / max;
    const v = max;
    return { h, s, v };
}

function hexToRgba(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) {
        return null;
    }
    const value = normalized.slice(1);
    if (value.length === 3) {
        const r = parseInt(value[0] + value[0], 16);
        const g = parseInt(value[1] + value[1], 16);
        const b = parseInt(value[2] + value[2], 16);
        return { r, g, b, a: 255 };
    }
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return { r, g, b, a: 255 };
}

function updateRecentColors(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) {
        return;
    }
    const existing = recentColors.indexOf(normalized);
    if (existing >= 0) {
        recentColors.splice(existing, 1);
    }
    recentColors.unshift(normalized);
    while (recentColors.length > RECENT_COLORS_MAX) {
        recentColors.pop();
    }
}

function renderRecentColorSwatches() {
    if (!dom.paintColorSwatches) {
        return;
    }
    dom.paintColorSwatches.innerHTML = '';
    for (const color of recentColors) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'paint-color-swatch';
        button.style.background = color;
        button.title = color;
        button.dataset.color = color;
        dom.paintColorSwatches.appendChild(button);
    }
}

function renderRelatedColorSwatches() {
    if (!dom.paintColorRelated) {
        return;
    }
    dom.paintColorRelated.innerHTML = '';
    const colors = buildRelatedColors(session?.color || DEFAULT_COLOR);
    for (const color of colors) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'paint-color-swatch';
        button.style.background = color;
        button.title = color;
        button.dataset.color = color;
        dom.paintColorRelated.appendChild(button);
    }
}

function toNeutralHex(value) {
    const channel = Math.round(clamp(value, 0, 1) * 255);
    const hex = channel.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
}

function renderNeutralSwatches() {
    if (!dom.paintColorNeutrals) {
        return;
    }
    dom.paintColorNeutrals.innerHTML = '';
    const groups = [
        { main: 0.85, lighter: 0.9, darker: 0.8 },
        { main: 0.55, lighter: 0.6, darker: 0.5 },
        { main: 0.15, lighter: 0.2, darker: 0.1 }
    ];
    for (const groupDef of groups) {
        const group = document.createElement('div');
        group.className = 'paint-color-neutral-group';

        const stack = document.createElement('div');
        stack.className = 'paint-color-neutral-stack';
        const lightHex = toNeutralHex(groupDef.lighter);
        const darkHex = toNeutralHex(groupDef.darker);
        const mainHex = toNeutralHex(groupDef.main);

        const lightButton = document.createElement('button');
        lightButton.type = 'button';
        lightButton.className = 'paint-color-swatch';
        lightButton.style.background = lightHex;
        lightButton.title = lightHex;
        lightButton.dataset.color = lightHex;
        stack.appendChild(lightButton);

        const darkButton = document.createElement('button');
        darkButton.type = 'button';
        darkButton.className = 'paint-color-swatch';
        darkButton.style.background = darkHex;
        darkButton.title = darkHex;
        darkButton.dataset.color = darkHex;
        stack.appendChild(darkButton);

        const mainButton = document.createElement('button');
        mainButton.type = 'button';
        mainButton.className = 'paint-color-swatch paint-color-swatch-main';
        mainButton.style.background = mainHex;
        mainButton.title = mainHex;
        mainButton.dataset.color = mainHex;

        group.appendChild(stack);
        group.appendChild(mainButton);
        dom.paintColorNeutrals.appendChild(group);
    }
}

function setSessionColor(hex, options = {}) {
    if (!session) {
        return;
    }
    const normalized = normalizeHexColor(hex);
    if (!normalized) {
        return;
    }
    session.color = normalized;
    const skipRecent = options.skipRecent !== false;
    if (!skipRecent) {
        updateRecentColors(normalized);
        renderRecentColorSwatches();
    }
    renderRelatedColorSwatches();
    if (dom.paintColorHexInput) {
        dom.paintColorHexInput.value = normalized;
    }
    updateHud();
    persistPaintPreferences();
}

function isColorPopoverOpen() {
    return !!session?.colorPicker?.open;
}

function hideColorPopover() {
    if (!dom.paintColorPopover) {
        return;
    }
    dom.paintColorPopover.hidden = true;
    if (session?.colorPicker) {
        session.colorPicker.open = false;
        session.colorPicker.dragTarget = 'none';
    }
}

function resolvePopoverPosition(clientX, clientY, popoverWidth, popoverHeight) {
    const margin = 10;
    const width = Math.max(0, Math.round(Number(popoverWidth) || COLOR_PICKER_WIDTH));
    const height = Math.max(0, Math.round(Number(popoverHeight) || COLOR_PICKER_HEIGHT));
    const safeX = clamp(Math.round(clientX - width), margin, Math.max(margin, window.innerWidth - width - margin));
    const safeY = clamp(Math.round(clientY - height), margin, Math.max(margin, window.innerHeight - height - margin));
    return { x: safeX, y: safeY };
}

function renderHueCanvas() {
    if (!dom.paintColorHueCanvas || !session?.colorPicker) {
        return;
    }
    const canvas = dom.paintColorHueCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return;
    }
    const width = canvas.width;
    const height = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    for (let index = 0; index <= 6; index += 1) {
        const hue = index * 60;
        gradient.addColorStop(index / 6, rgbToHex(hsvToRgb({ h: hue, s: 1, v: 1 })));
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const x = clamp(Math.round((session.colorPicker.hue / 360) * width), 0, Math.max(0, width - 1));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(clamp(x - 2, 0, Math.max(0, width - 4)) + 0.5, 0.5, 4, height - 1);
    ctx.stroke();
    ctx.restore();
}

function renderSvCanvas() {
    if (!dom.paintColorSvCanvas || !session?.colorPicker) {
        return;
    }
    const canvas = dom.paintColorSvCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return;
    }
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const hueRgb = hsvToRgb({ h: session.colorPicker.hue, s: 1, v: 1 });
    ctx.fillStyle = rgbToHex(hueRgb);
    ctx.fillRect(0, 0, width, height);

    const whiteGrad = ctx.createLinearGradient(0, 0, width, 0);
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, width, height);

    const blackGrad = ctx.createLinearGradient(0, 0, 0, height);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, width, height);

    const markerX = clamp(Math.round(session.colorPicker.s * width), 0, Math.max(0, width - 1));
    const markerY = clamp(Math.round((1 - session.colorPicker.v) * height), 0, Math.max(0, height - 1));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(markerX, markerY, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function requestCancelPaint() {
    if (!session) {
        return;
    }
    setExitMenuVisible(true);
}

function fitTransformToCanvas() {
    if (!session?.transform?.active || !session.transform.contentCanvas) {
        return;
    }
    const transform = session.transform;
    const canvasW = session.width;
    const canvasH = session.height;
    const srcW = transform.contentCanvas.width || 1;
    const srcH = transform.contentCanvas.height || 1;
    const scale = Math.max(0.0001, Math.min(canvasW / srcW, canvasH / srcH));

    transform.scaleX = scale;
    transform.scaleY = scale;
    transform.rotation = 0;
    transform.dx = 0;
    transform.dy = 0;
    transform.centerX = canvasW / 2;
    transform.centerY = canvasH / 2;
    updateTransformPreviewGeometry();
    renderStageUi();
}

function syncColorPickerFromSession() {
    if (!session?.colorPicker) {
        return;
    }
    const rgb = parseHexColor(session.color);
    if (!rgb) {
        return;
    }
    const hsv = rgbToHsv(rgb);
    session.colorPicker.hue = hsv.h;
    session.colorPicker.s = hsv.s;
    session.colorPicker.v = hsv.v;
    if (dom.paintColorHexInput) {
        dom.paintColorHexInput.value = session.color;
    }
}

function commitColorPickerToSession() {
    if (!session?.colorPicker) {
        return;
    }
    const rgb = hsvToRgb({ h: session.colorPicker.hue, s: session.colorPicker.s, v: session.colorPicker.v });
    setSessionColor(rgbToHex(rgb));
}

function showColorPopoverAt(clientX, clientY) {
    if (!session || !dom.paintColorPopover) {
        return;
    }
    if (!session.colorPicker) {
        session.colorPicker = {
            open: false,
            hue: 0,
            s: 1,
            v: 1,
            dragTarget: 'none'
        };
    }
    syncColorPickerFromSession();
    renderHueCanvas();
    renderSvCanvas();
    renderRecentColorSwatches();
    renderRelatedColorSwatches();
    renderNeutralSwatches();

    const wasHidden = dom.paintColorPopover.hidden;
    dom.paintColorPopover.hidden = false;
    if (wasHidden) {
        dom.paintColorPopover.style.visibility = 'hidden';
    }

    const rect = dom.paintColorPopover.getBoundingClientRect();
    const pos = resolvePopoverPosition(clientX, clientY, rect.width, rect.height);
    dom.paintColorPopover.style.left = `${pos.x}px`;
    dom.paintColorPopover.style.top = `${pos.y}px`;
    if (wasHidden) {
        dom.paintColorPopover.style.visibility = '';
    }
    session.colorPicker.open = true;
    session.colorPicker.dragTarget = 'none';

    if (dom.paintColorHexInput) {
        dom.paintColorHexInput.value = session.color;
        dom.paintColorHexInput.focus({ preventScroll: true });
        const length = dom.paintColorHexInput.value.length;
        dom.paintColorHexInput.setSelectionRange(length, length);
    }
}

function resolveCanvasPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const x = clamp((Number(event?.clientX) - rect.left) * (canvas.width / rect.width), 0, canvas.width);
    const y = clamp((Number(event?.clientY) - rect.top) * (canvas.height / rect.height), 0, canvas.height);
    return { x, y };
}

function updateColorPickerFromSvEvent(event) {
    if (!session?.colorPicker || !dom.paintColorSvCanvas) {
        return;
    }
    const point = resolveCanvasPoint(dom.paintColorSvCanvas, event);
    session.colorPicker.s = clamp01(point.x / dom.paintColorSvCanvas.width);
    session.colorPicker.v = clamp01(1 - (point.y / dom.paintColorSvCanvas.height));
    commitColorPickerToSession();
    renderSvCanvas();
}

function updateColorPickerFromHueEvent(event) {
    if (!session?.colorPicker || !dom.paintColorHueCanvas) {
        return;
    }
    const point = resolveCanvasPoint(dom.paintColorHueCanvas, event);
    const raw = (point.x / dom.paintColorHueCanvas.width) * 360;
    session.colorPicker.hue = clamp(raw, 0, 359.999);
    commitColorPickerToSession();
    renderHueCanvas();
    renderSvCanvas();
}

function handleColorSvPointerDown(event) {
    if (!session?.colorPicker || !dom.paintColorSvCanvas) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    dom.paintColorSvCanvas.setPointerCapture(event.pointerId);
    session.colorPicker.dragTarget = 'sv';
    updateColorPickerFromSvEvent(event);
}

function handleColorSvPointerMove(event) {
    if (!session?.colorPicker || session.colorPicker.dragTarget !== 'sv') {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    updateColorPickerFromSvEvent(event);
}

function handleColorHuePointerDown(event) {
    if (!session?.colorPicker || !dom.paintColorHueCanvas) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    dom.paintColorHueCanvas.setPointerCapture(event.pointerId);
    session.colorPicker.dragTarget = 'hue';
    updateColorPickerFromHueEvent(event);
}

function handleColorHuePointerMove(event) {
    if (!session?.colorPicker || session.colorPicker.dragTarget !== 'hue') {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    updateColorPickerFromHueEvent(event);
}

function handleColorPickerPointerUp(event) {
    if (!session?.colorPicker) {
        return;
    }
    if (session.colorPicker.dragTarget === 'none') {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    session.colorPicker.dragTarget = 'none';
}

function handleColorHexInput(event) {
    if (!session?.colorPicker || !dom.paintColorHexInput) {
        return;
    }
    const value = normalizeHexColor(dom.paintColorHexInput.value);
    if (!value) {
        return;
    }
    setSessionColor(value);
    syncColorPickerFromSession();
    renderHueCanvas();
    renderSvCanvas();
}

function handleColorSwatchClick(event) {
    const button = event.target?.closest?.('button.paint-color-swatch');
    if (!button) {
        return;
    }
    const color = normalizeHexColor(button.dataset.color);
    if (!color) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSessionColor(color);
    syncColorPickerFromSession();
    renderHueCanvas();
    renderSvCanvas();
}

    return {
        showColorPickIndicator,
        hideColorPickIndicator,
        normalizeHexColor,
        parseHexColor,
        rgbToHex,
        rgbToRgbaString,
        rgbToHsl,
        hslToRgb,
        hslToHex,
        buildRelatedColors,
        hsvToRgb,
        rgbToHsv,
        hexToRgba,
        updateRecentColors,
        renderRecentColorSwatches,
        renderRelatedColorSwatches,
        setSessionColor,
        isColorPopoverOpen,
        hideColorPopover,
        renderHueCanvas,
        renderSvCanvas,
        fitTransformToCanvas,
        syncColorPickerFromSession,
        showColorPopoverAt,
        handleColorSvPointerDown,
        handleColorSvPointerMove,
        handleColorHuePointerDown,
        handleColorHuePointerMove,
        handleColorPickerPointerUp,
        handleColorHexInput,
        handleColorSwatchClick
    };
};
