'use strict';

// MARK: TEXT EDITING SYSTEM
const env = require('../core/state');
const { state, data, utils, constants, movement } = env;
const {
    TITLE_BASE_FONT,
    TEXT_BASE_WIDTH,
    TEXT_BASE_HEIGHT,
    TEXT_BASE_FONT
} = env.blockMetrics;

const textEditing = {};
const EDITOR_VERTICAL_BUFFER = 2;
const MIN_TEXT_GRID_CELLS = 3;
const MIN_TITLE_GRID_CELLS = 4;
const GRID_SIZE = constants.GRID_SIZE;
const COMPACT_TEXT_UPWARD_BIAS_PX = 4;
let textLineScratchEditor = null;

function measureEditorContentHeight(editor, element) {
    if (!editor) {
        return 0;
    }
    const previousHeight = editor.style.height;
    const previousPosition = editor.style.position;
    const previousTop = editor.style.top;
    const previousRight = editor.style.right;
    const previousBottom = editor.style.bottom;
    const previousLeft = editor.style.left;
    const isEditing = element?.classList?.contains('is-editing');
    if (!isEditing) {
        editor.style.position = 'relative';
        editor.style.top = 'auto';
        editor.style.right = 'auto';
        editor.style.bottom = 'auto';
        editor.style.left = 'auto';
    }
    editor.style.height = 'auto';
    const measured = editor.scrollHeight;
    editor.style.height = previousHeight;
    if (!isEditing) {
        editor.style.position = previousPosition;
        editor.style.top = previousTop;
        editor.style.right = previousRight;
        editor.style.bottom = previousBottom;
        editor.style.left = previousLeft;
    }
    return measured;
}

function snapHeight(value, allowShrink, minimum) {
    const safeMinimum = Math.max(minimum, GRID_SIZE);
    if (allowShrink) {
        const snapped = Math.floor(value / GRID_SIZE) * GRID_SIZE;
        return Math.max(snapped, safeMinimum);
    }
    return Math.max(utils.snapToGrid(value), safeMinimum);
}

function resolveGlobalFontScale(kind) {
    const settings = state.boardData?.settings;
    const key = kind === 'title' ? 'titleFontScale' : 'textFontScale';
    const raw = settings ? Number(settings[key]) : NaN;
    if (!Number.isFinite(raw)) {
        return 1;
    }
    return utils.clamp(raw, 0.35, 3.5);
}

function computeBodyTextMetrics(block) {
    if (!block) {
        return {
            fontSize: TEXT_BASE_FONT,
            lineHeight: 1.42,
            letterSpacing: 0.08,
            wordSpacing: 0,
            scale: 1,
            smallCaps: false
        };
    }
    const fontScale = Number(block.fontScale);
    const userScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
    const globalScale = resolveGlobalFontScale('text');
    const combined = utils.clamp(userScale * globalScale, 0.35, 3.2);
    const fontSize = utils.clamp(TEXT_BASE_FONT * combined, 16, 140);
    const settings = state.boardData?.settings || {};
    const defaults = data.defaultSettings();
    const baseLineHeight = utils.clamp(1.18 + Math.min(combined, 2.6) * 0.05, 1.16, 1.62);
    const baseLetterSpacing = utils.clamp(0.06 * combined, -0.02, 0.34);
    const lineDelta = Number.isFinite(settings.textLineHeight) ? settings.textLineHeight - (defaults.textLineHeight ?? 1.5) : 0;
    const letterDelta = Number.isFinite(settings.textLetterSpacing) ? settings.textLetterSpacing - (defaults.textLetterSpacing ?? 0) : 0;
    const wordSpacing = Number.isFinite(settings.textWordSpacing) ? utils.clamp(settings.textWordSpacing, -1, 16) : defaults.textWordSpacing ?? 0;
    const lineHeight = utils.clamp(baseLineHeight + lineDelta, 1, 2.6);
    const letterSpacing = utils.clamp(baseLetterSpacing + letterDelta, -2, 10);
    const smallCaps = typeof block.smallCaps === 'boolean' ? block.smallCaps : false;
    return {
        fontSize,
        lineHeight,
        letterSpacing,
        wordSpacing,
        scale: combined,
        smallCaps
    };
}

function computeTitleVisualMetrics(block) {
    if (!block) {
        return {
            fontSize: TITLE_BASE_FONT,
            lineHeight: 1.12,
            letterSpacing: 0.32,
            wordSpacing: 0,
            scale: 1,
            smallCaps: false
        };
    }
    const fontScale = Number(block.fontScale);
    const userScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
    const globalScale = resolveGlobalFontScale('title');
    const combined = utils.clamp(userScale * globalScale, 0.35, 3.6);
    const fontSize = utils.clamp(TITLE_BASE_FONT * combined, 24, 200);
    const settings = state.boardData?.settings || {};
    const defaults = data.defaultSettings();
    const baseLineHeight = utils.clamp(1.02 + Math.min(combined, 2.4) * 0.06, 1.08, 1.28);
    const baseLetterSpacing = utils.clamp(0.28 * combined, 0.18, 0.85);
    const lineDelta = Number.isFinite(settings.titleLineHeight) ? settings.titleLineHeight - (defaults.titleLineHeight ?? 1.2) : 0;
    const letterDelta = Number.isFinite(settings.titleLetterSpacing) ? settings.titleLetterSpacing - (defaults.titleLetterSpacing ?? 0) : 0;
    const wordSpacing = Number.isFinite(settings.titleWordSpacing) ? utils.clamp(settings.titleWordSpacing, -1, 20) : defaults.titleWordSpacing ?? 0;
    const lineHeight = utils.clamp(baseLineHeight + lineDelta, 0.8, 2.4);
    const letterSpacing = utils.clamp(baseLetterSpacing + letterDelta, -2, 12);
    const defaultSmallCaps = !!settings.titleSmallCaps;
    const overrideSmallCaps = typeof block.smallCaps === 'boolean' ? block.smallCaps : null;
    const smallCaps = overrideSmallCaps === null ? defaultSmallCaps : overrideSmallCaps;
    return {
        fontSize,
        lineHeight,
        letterSpacing,
        wordSpacing,
        scale: combined,
        smallCaps
    };
}

function lookupBlock(blockId) {
    if (env.blockLifecycle && typeof env.blockLifecycle.getBlockById === 'function') {
        return env.blockLifecycle.getBlockById(blockId);
    }
    const board = state.boardData?.boards?.[state.currentBoardId];
    if (!board) {
        return null;
    }
    return board.blocks.find((block) => block.id === blockId) || null;
}

function applyTextBlockVisuals(block, element) {
    if (!block || !element) {
        return;
    }
    const isTitle = block.type === 'title';
    if (isTitle) {
        element.classList.toggle('title-border-visible', !!block.showBorder);
        element.classList.toggle('title-shadow-visible', !!block.showShadow);
        element.classList.toggle('title-underline-visible', !!block.showUnderline);
    }
    const metrics = isTitle ? computeTitleVisualMetrics(block) : computeBodyTextMetrics(block);
    const display = element.querySelector('.text-block-display');
    const editor = element.querySelector('.text-block-editor');
    if (display) {
        display.style.fontSize = `${metrics.fontSize}px`;
        display.style.lineHeight = `${metrics.lineHeight}`;
        display.style.letterSpacing = `${metrics.letterSpacing}px`;
        display.style.wordSpacing = `${metrics.wordSpacing || 0}px`;
        display.style.fontVariant = metrics.smallCaps ? 'small-caps' : 'normal';
    }
    if (editor) {
        editor.style.fontSize = `${metrics.fontSize}px`;
        editor.style.lineHeight = `${metrics.lineHeight}`;
        editor.style.letterSpacing = `${metrics.letterSpacing}px`;
        editor.style.wordSpacing = `${metrics.wordSpacing || 0}px`;
        editor.style.fontVariant = metrics.smallCaps ? 'small-caps' : 'normal';
    }
    if (block && block.type === 'text') {
        updateTextOverflowState(block, element);
    } else {
        clearCompactTextVerticalAlignment(element);
    }
}

function applyTitleVisuals(block, element) {
    applyTextBlockVisuals(block, element);
}

function updateTextOverflowState(block, element) {
    if (!element) {
        return;
    }
    const display = element.querySelector('.text-block-display');
    if (!display) {
        return;
    }
    if (!block || block.type !== 'text' || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
        display.classList.remove('text-block-display-overflowing', 'text-block-display--clamped');
        display.style.removeProperty('--text-block-line-clamp');
        return;
    }
    const computed = window.getComputedStyle(display);
    if (!computed || computed.display === 'none' || computed.visibility === 'hidden') {
        display.classList.remove('text-block-display-overflowing', 'text-block-display--clamped');
        display.style.removeProperty('--text-block-line-clamp');
        return;
    }
    const clientHeight = display.clientHeight;
    const clientWidth = display.clientWidth;
    const overflowY = display.scrollHeight - clientHeight > 1;
    const overflowX = display.scrollWidth - clientWidth > 1;
    const hasOverflow = overflowY || overflowX;
    let maxLines = 0;
    if (hasOverflow) {
        const lineHeightValue = resolveComputedLineHeightPx(computed);
        if (Number.isFinite(lineHeightValue) && lineHeightValue > 0) {
            const usableHeight = Math.max(clientHeight, lineHeightValue);
            maxLines = Math.max(1, Math.floor(usableHeight / lineHeightValue));
        } else {
            maxLines = 1;
        }
    }
    display.classList.toggle('text-block-display-overflowing', hasOverflow);
    if (hasOverflow && maxLines > 0) {
        display.classList.add('text-block-display--clamped');
        display.style.setProperty('--text-block-line-clamp', `${maxLines}`);
    } else {
        display.classList.remove('text-block-display--clamped');
        display.style.removeProperty('--text-block-line-clamp');
    }
}

function resolveComputedLineHeightPx(computed) {
    if (!computed) {
        return NaN;
    }
    const raw = String(computed.lineHeight || '').trim();
    const numeric = Number.parseFloat(raw);
    if (raw.endsWith('px') && Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const fontSize = Number.parseFloat(computed.fontSize);
    if (Number.isFinite(numeric) && numeric > 0) {
        if (Number.isFinite(fontSize) && fontSize > 0 && numeric <= 6) {
            return numeric * fontSize;
        }
        return numeric;
    }
    if (Number.isFinite(fontSize) && fontSize > 0) {
        return fontSize * 1.25;
    }
    return NaN;
}

function clearCompactTextVerticalAlignment(element) {
    if (!element) {
        return;
    }
    element.classList.remove('text-block-compact-lines');
    element.style.removeProperty('--text-block-compact-top-padding');
    element.style.removeProperty('--text-block-compact-bottom-padding');
}

function measureTextEditorContentHeight(editor, element) {
    if (!editor) {
        return 0;
    }
    const previousHeight = editor.style.height;
    const previousMinHeight = editor.style.minHeight;
    const previousMaxHeight = editor.style.maxHeight;
    const previousPosition = editor.style.position;
    const previousTop = editor.style.top;
    const previousRight = editor.style.right;
    const previousBottom = editor.style.bottom;
    const previousLeft = editor.style.left;
    const isEditing = element?.classList?.contains('is-editing');
    if (!isEditing) {
        editor.style.position = 'relative';
        editor.style.top = 'auto';
        editor.style.right = 'auto';
        editor.style.bottom = 'auto';
        editor.style.left = 'auto';
    }
    editor.style.minHeight = '0px';
    editor.style.maxHeight = 'none';
    editor.style.height = '0px';
    const measured = Number(editor.scrollHeight) || 0;
    editor.style.height = previousHeight;
    editor.style.minHeight = previousMinHeight;
    editor.style.maxHeight = previousMaxHeight;
    if (!isEditing) {
        editor.style.position = previousPosition;
        editor.style.top = previousTop;
        editor.style.right = previousRight;
        editor.style.bottom = previousBottom;
        editor.style.left = previousLeft;
    }
    return measured;
}

function ensureTextLineScratchEditor() {
    if (textLineScratchEditor && textLineScratchEditor.isConnected) {
        return textLineScratchEditor;
    }
    if (typeof document === 'undefined' || !document.body) {
        return null;
    }
    const scratch = document.createElement('textarea');
    scratch.setAttribute('rows', '1');
    scratch.setAttribute('wrap', 'soft');
    scratch.setAttribute('spellcheck', 'false');
    scratch.tabIndex = -1;
    scratch.setAttribute('aria-hidden', 'true');
    scratch.style.position = 'fixed';
    scratch.style.left = '-99999px';
    scratch.style.top = '0';
    scratch.style.width = '1px';
    scratch.style.height = '0px';
    scratch.style.minHeight = '0px';
    scratch.style.maxHeight = 'none';
    scratch.style.padding = '0';
    scratch.style.border = '0';
    scratch.style.margin = '0';
    scratch.style.outline = 'none';
    scratch.style.opacity = '0';
    scratch.style.pointerEvents = 'none';
    scratch.style.overflow = 'hidden';
    scratch.style.whiteSpace = 'pre-wrap';
    scratch.style.resize = 'none';
    scratch.style.boxSizing = 'content-box';
    document.body.appendChild(scratch);
    textLineScratchEditor = scratch;
    return scratch;
}

function measureVisualTextLineCount(editor, computed, lineHeight, content) {
    const scratch = ensureTextLineScratchEditor();
    if (!scratch) {
        return null;
    }
    const paddingLeft = Number.parseFloat(computed?.paddingLeft);
    const paddingRight = Number.parseFloat(computed?.paddingRight);
    const padLeft = Number.isFinite(paddingLeft) ? paddingLeft : 0;
    const padRight = Number.isFinite(paddingRight) ? paddingRight : 0;
    const contentWidth = Math.max((Number(editor?.clientWidth) || 0) - padLeft - padRight, 1);
    scratch.style.width = `${contentWidth}px`;
    scratch.style.fontFamily = computed?.fontFamily || '';
    scratch.style.fontSize = computed?.fontSize || '';
    scratch.style.fontWeight = computed?.fontWeight || '';
    scratch.style.fontStyle = computed?.fontStyle || '';
    scratch.style.fontVariant = computed?.fontVariant || '';
    scratch.style.letterSpacing = computed?.letterSpacing || 'normal';
    scratch.style.wordSpacing = computed?.wordSpacing || 'normal';
    scratch.style.lineHeight = `${lineHeight}px`;
    scratch.style.textTransform = computed?.textTransform || 'none';
    scratch.style.textIndent = computed?.textIndent || '0px';
    scratch.style.tabSize = computed?.tabSize || '8';
    const normalized = typeof content === 'string' ? content : String(content ?? '');
    let probe = normalized;
    if (!probe.length) {
        probe = ' ';
    } else if (/\n$/.test(probe)) {
        probe = `${probe}\u200b`;
    }
    scratch.value = probe;
    scratch.scrollTop = 0;
    const measuredHeight = Math.max(Number(scratch.scrollHeight) || lineHeight, lineHeight);
    const explicitLineCount = Math.max(normalized.split('\n').length, 1);
    const measuredLineCount = Math.max(1, Math.round(measuredHeight / lineHeight));
    const lineCount = Math.max(measuredLineCount, explicitLineCount);
    return {
        lineCount,
        contentHeight: lineCount * lineHeight
    };
}

function resolveTextContentLineCount(block, element, editor, content) {
    if (!block || block.type !== 'text' || !element || !editor || typeof window === 'undefined') {
        return null;
    }
    const computed = window.getComputedStyle(editor);
    const lineHeight = resolveComputedLineHeightPx(computed);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        return null;
    }
    const visual = measureVisualTextLineCount(editor, computed, lineHeight, content);
    if (!visual) {
        const measuredHeight = measureTextEditorContentHeight(editor, element);
        const paddingTop = Number.parseFloat(computed?.paddingTop);
        const paddingBottom = Number.parseFloat(computed?.paddingBottom);
        const padTop = Number.isFinite(paddingTop) ? paddingTop : 0;
        const padBottom = Number.isFinite(paddingBottom) ? paddingBottom : 0;
        const fallbackContentHeight = Math.max(measuredHeight - padTop - padBottom, lineHeight);
        const fallbackLines = Math.max(1, Math.round(fallbackContentHeight / lineHeight));
        return {
            lineCount: fallbackLines,
            lineHeight,
            contentHeight: fallbackLines * lineHeight
        };
    }
    return {
        lineCount: Math.max(visual.lineCount, 1),
        lineHeight,
        contentHeight: Math.max(visual.contentHeight, lineHeight)
    };
}

function updateCompactTextVerticalAlignment(block, element, editor, content) {
    if (!block || block.type !== 'text' || !element || !editor) {
        clearCompactTextVerticalAlignment(element);
        return;
    }
    const isEditing = element.classList.contains('is-editing');
    if (isEditing) {
        clearCompactTextVerticalAlignment(element);
        return;
    }
    const display = element.querySelector('.text-block-display');
    const isOverflowing = display?.classList?.contains('text-block-display-overflowing');
    if (isOverflowing) {
        clearCompactTextVerticalAlignment(element);
        return;
    }
    const lineInfo = resolveTextContentLineCount(block, element, editor, content);
    if (!lineInfo) {
        clearCompactTextVerticalAlignment(element);
        return;
    }
    const lineCount = Number(lineInfo.lineCount) || 1;
    if (lineCount > 2) {
        clearCompactTextVerticalAlignment(element);
        return;
    }
    const blockHeight = Math.max(
        Number(block.height) || 0,
        Number(editor.clientHeight) || 0,
        Number(element.clientHeight) || 0
    );
    if (!Number.isFinite(blockHeight) || blockHeight <= 0) {
        clearCompactTextVerticalAlignment(element);
        return;
    }
    const usedHeight = Math.max(lineInfo.contentHeight || 0, lineInfo.lineHeight);
    if (!Number.isFinite(usedHeight) || usedHeight <= 0 || usedHeight > (blockHeight - 1)) {
        clearCompactTextVerticalAlignment(element);
        return;
    }
    const availablePadding = Math.max(blockHeight - usedHeight, 0);
    const topPadding = Math.min(Math.max((availablePadding / 2) - COMPACT_TEXT_UPWARD_BIAS_PX, 0), availablePadding);
    const bottomPadding = Math.max(availablePadding - topPadding, 0);
    element.classList.add('text-block-compact-lines');
    element.style.setProperty('--text-block-compact-top-padding', `${topPadding.toFixed(2)}px`);
    element.style.setProperty('--text-block-compact-bottom-padding', `${bottomPadding.toFixed(2)}px`);
}

function autoSizeTextBlock(block, element, content, options = {}) {
    if (!element) {
        return;
    }
    const editor = element.querySelector('.text-block-editor');
    if (!editor) {
        return;
    }
    const display = element.querySelector('.text-block-display');
    editor.value = content;
    if (display) {
        display.textContent = content;
    }
    const isTitle = block.type === 'title';
    const isText = block.type === 'text';
    if (isText) {
        clearCompactTextVerticalAlignment(element);
    }
    const isManualTitle = isTitle && block.layoutMode === 'manual';
    const isManualText = isText && block.layoutMode === 'manual';
    const triggeredByInput = options.trigger === 'input';
    const allowShrink = !!options.forceShrink;
    const baseMinimum = constants.GRID_SIZE * (isTitle ? MIN_TITLE_GRID_CELLS : MIN_TEXT_GRID_CELLS);
    const currentHeight = Math.max(block.height || 0, baseMinimum);
    if (isTitle && !isManualTitle) {
        applyTextBlockVisuals(block, element);
        const targetHeight = Math.max(block.height || 0, baseMinimum);
        block.height = targetHeight;
        element.style.height = `${targetHeight}px`;
        editor.style.height = `${targetHeight}px`;
        editor.style.overflowY = 'hidden';
        updateTextOverflowState(block, element);
        clearCompactTextVerticalAlignment(element);
        return;
    }
    if (isManualText) {
        const manualHeightCandidate = Number(block.manualHeight);
        const manualWidthCandidate = Number(block.manualWidth);
        const manualHeightRaw = Number.isFinite(manualHeightCandidate) && manualHeightCandidate > 0 ? manualHeightCandidate : block.height;
        const manualWidthRaw = Number.isFinite(manualWidthCandidate) && manualWidthCandidate > 0 ? manualWidthCandidate : block.width;
        const isEditing = element.classList.contains('is-editing');
        const minimum = baseMinimum;
        const rawHeight = measureEditorContentHeight(editor, element);
        const measured = Math.max(rawHeight + EDITOR_VERTICAL_BUFFER, minimum);
        const snapped = snapHeight(measured, allowShrink, minimum);
        if (manualWidthRaw) {
            element.style.width = `${manualWidthRaw}px`;
        }
        if (isEditing) {
            editor.style.overflowY = 'hidden';
            const effective = snapped;
            block.height = effective;
            block.manualHeight = effective;
            element.style.height = `${effective}px`;
            editor.style.height = `${effective}px`;
            applyTextBlockVisuals(block, element);
            updateTextOverflowState(block, element);
            updateCompactTextVerticalAlignment(block, element, editor, content);
            return;
        }
        const effective = allowShrink ? snapped : Math.max(manualHeightRaw || 0, minimum);
        block.height = effective;
        block.manualHeight = effective;
        element.style.height = `${effective}px`;
        editor.style.height = `${effective}px`;
        editor.style.overflowY = 'hidden';
        applyTextBlockVisuals(block, element);
        updateTextOverflowState(block, element);
        updateCompactTextVerticalAlignment(block, element, editor, content);
        return;
    }
    if (isManualTitle && !triggeredByInput) {
        const minimum = baseMinimum;
        const rawHeight = measureEditorContentHeight(editor, element);
        const measured = Math.max(rawHeight + EDITOR_VERTICAL_BUFFER, minimum);
        const snapped = snapHeight(measured, allowShrink, minimum);
        const manualHeightCandidate = Number(block.manualHeight);
        const manualHeightRaw = Number.isFinite(manualHeightCandidate) && manualHeightCandidate > 0 ? manualHeightCandidate : currentHeight;
        const effective = allowShrink ? snapped : Math.max(manualHeightRaw || 0, minimum);
        block.height = effective;
        block.manualHeight = effective;
        element.style.height = `${effective}px`;
        editor.style.height = `${effective}px`;
        editor.style.overflowY = 'hidden';
        applyTextBlockVisuals(block, element);
        updateTextOverflowState(block, element);
        clearCompactTextVerticalAlignment(element);
        return;
    }
    applyTextBlockVisuals(block, element);
    editor.style.overflowY = 'hidden';
    const rawHeight = measureEditorContentHeight(editor, element);
    const measured = Math.max(rawHeight + EDITOR_VERTICAL_BUFFER, baseMinimum);
    const snappedMeasured = snapHeight(measured, allowShrink, baseMinimum);
    const shouldApplyMeasured = (measured > currentHeight + 2) || (allowShrink && measured < currentHeight - 2);
    const nextHeight = shouldApplyMeasured ? snappedMeasured : currentHeight;
    block.height = nextHeight;
    element.style.height = `${nextHeight}px`;
    editor.style.height = `${shouldApplyMeasured ? nextHeight : Math.max(measured, currentHeight)}px`;
    if (isManualTitle && shouldApplyMeasured) {
        block.manualHeight = nextHeight;
    }
    if (!isManualTitle || shouldApplyMeasured) {
        applyTextBlockVisuals(block, element);
    }
    updateTextOverflowState(block, element);
    updateCompactTextVerticalAlignment(block, element, editor, content);
}

function trimTextBlockHeight(blockId) {
    const block = lookupBlock(blockId);
    if (!block || (block.type !== 'text' && block.type !== 'title')) {
        return;
    }
    const element = document.querySelector(`.board-block[data-id="${blockId}"]`);
    if (!element) {
        return;
    }
    autoSizeTextBlock(block, element, block.content || '', { trigger: 'trim', forceShrink: true });
    block.updatedAt = new Date().toISOString();
    data.queueSave('text-trim-height');
    movement.updateGridBackground();
}

function syncTextBlockContent(blockId, value, options = {}) {
    const block = lookupBlock(blockId);
    if (!block) {
        return;
    }
    const element = document.querySelector(`.board-block[data-id="${blockId}"]`);
    if (!element) {
        return;
    }
    const content = value ?? '';
    block.content = content;
    if (!options.skipSave) {
        block.updatedAt = new Date().toISOString();
    }
    autoSizeTextBlock(block, element, content, options);
    if (!options.skipSave) {
        data.queueSave('text-edit');
    }
}

function refreshTextBlock(blockId) {
    const block = lookupBlock(blockId);
    if (!block) {
        return;
    }
    const element = document.querySelector(`.board-block[data-id="${blockId}"]`);
    if (!element) {
        return;
    }
    if (block.type === 'text' || block.type === 'title') {
        autoSizeTextBlock(block, element, block.content || '', { trigger: 'refresh' });
    }
}

function refreshAllTextBlocks() {
    const board = state.boardData?.boards?.[state.currentBoardId];
    if (!board) {
        return;
    }
    board.blocks.forEach((block) => {
        if (block.type === 'text' || block.type === 'title') {
            refreshTextBlock(block.id);
        }
    });
}

function getNodeTextLength(node) {
    if (!node) {
        return 0;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ? node.textContent.length : 0;
    }
    let total = 0;
    const children = node.childNodes;
    for (let index = 0; index < children.length; index += 1) {
        total += getNodeTextLength(children[index]);
    }
    return total;
}

function computeCaretOffsetWithin(root, node, offset) {
    if (!root || !node) {
        return null;
    }
    let total = Math.max(offset || 0, 0);
    let current = node;
    while (current && current !== root) {
        let sibling = current.previousSibling;
        while (sibling) {
            total += getNodeTextLength(sibling);
            sibling = sibling.previousSibling;
        }
        current = current.parentNode;
    }
    if (current !== root) {
        return null;
    }
    return total;
}

function resolveCaretOffsetFromDisplay(display) {
    if (!display || typeof window.getSelection !== 'function') {
        return null;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (!display.contains(range.startContainer)) {
        return null;
    }
    return computeCaretOffsetWithin(display, range.startContainer, range.startOffset);
}

function beginTextEditing(blockId, options = {}) {
    const element = document.querySelector(`.board-block[data-id="${blockId}"]`);
    if (!element) {
        return;
    }
    const block = lookupBlock(blockId);
    if (!block) {
        return;
    }
    movement.selectBlock(blockId);
    element.classList.add('is-editing');
    const editor = element.querySelector('.text-block-editor');
    const text = block.content || '';
    if (editor) {
        editor.value = text;
        editor.focus({ preventScroll: true });
        const rawOffset = typeof options.caretOffset === 'number' ? options.caretOffset : null;
        const length = text.length;
        const caret = rawOffset !== null ? utils.clamp(rawOffset, 0, length) : length;
        try {
            editor.setSelectionRange(caret, caret);
        } catch {}
    }
    autoSizeTextBlock(block, element, text, { trigger: 'edit-begin' });
}

function finishTextEditing(blockId, value, options = {}) {
    const block = lookupBlock(blockId);
    if (!block) {
        return;
    }
    const element = document.querySelector(`.board-block[data-id="${blockId}"]`);
    if (!element) {
        return;
    }
    const finalValue = options.cancel ? block.content || '' : value;
    const editor = element.querySelector('.text-block-editor');
    if (editor && typeof editor.blur === 'function') {
        editor.blur();
    }
    element.classList.remove('is-editing');
    syncTextBlockContent(blockId, finalValue ?? '', { skipSave: !!options.cancel });
}

function cancelActiveTextEdit() {
    const active = document.querySelector('.board-block.is-editing');
    if (!active) {
        return false;
    }
    const blockId = active.dataset.id;
    if (!blockId) {
        return false;
    }
    finishTextEditing(blockId, lookupBlock(blockId)?.content || '', { cancel: true });
    return true;
}

function commitActiveTextEdit() {
    const active = document.querySelector('.board-block.is-editing');
    if (!active) {
        return false;
    }
    const blockId = active.dataset.id;
    if (!blockId) {
        return false;
    }
    const editor = active.querySelector('.text-block-editor');
    const value = editor ? editor.value : lookupBlock(blockId)?.content || '';
    finishTextEditing(blockId, value ?? '');
    return true;
}

textEditing.applyTitleVisuals = applyTitleVisuals;
textEditing.applyTextBlockVisuals = applyTextBlockVisuals;
textEditing.autoSizeTextBlock = autoSizeTextBlock;
textEditing.trimTextBlockHeight = trimTextBlockHeight;
textEditing.syncTextBlockContent = syncTextBlockContent;
textEditing.refreshTextBlock = refreshTextBlock;
textEditing.refreshAllTextBlocks = refreshAllTextBlocks;
textEditing.resolveCaretOffsetFromDisplay = resolveCaretOffsetFromDisplay;
textEditing.beginTextEditing = beginTextEditing;
textEditing.finishTextEditing = finishTextEditing;
textEditing.cancelActiveTextEdit = cancelActiveTextEdit;
textEditing.commitActiveTextEdit = commitActiveTextEdit;

env.textEditing = textEditing;

env.management = env.management || {};
env.management.applyTitleVisuals = applyTitleVisuals;
env.management.refreshTextBlock = refreshTextBlock;
env.management.commitActiveTextEdit = commitActiveTextEdit;
env.management.beginTextEditing = beginTextEditing;
env.management.finishTextEditing = finishTextEditing;
env.management.cancelActiveTextEdit = cancelActiveTextEdit;
env.management.syncTextBlockContent = syncTextBlockContent;
env.management.autoSizeTextBlock = autoSizeTextBlock;
env.management.resolveCaretOffsetFromDisplay = resolveCaretOffsetFromDisplay;
env.management.refreshAllTextBlocks = refreshAllTextBlocks;
env.management.trimTextBlockHeight = trimTextBlockHeight;

env.textEditing.lookupBlock = lookupBlock;

module.exports = env;
