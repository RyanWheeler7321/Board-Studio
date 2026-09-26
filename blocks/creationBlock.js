'use strict';

// MARK: CREATION BLOCK RENDERER
const env = require('../core/state');
const { state, data, movement, utils } = env;

const CREATION_FIELDS = [
    {
        key: 'conception',
        label: 'CONCEPTION',
        placeholder: 'Significant',
        help: 'The completed body, medium defines how it increases territory'
    },
    {
        key: 'combination',
        label: 'COMBINATION',
        placeholder: 'Creative',
        help: '99% Robbery. Reap directly to make strange forces'
    },
    {
        key: 'contradiction',
        label: 'CONTRADICTION',
        placeholder: 'Challenging',
        help: 'Define some part that cannot be, and make it so'
    },
    {
        key: 'circumstance',
        label: 'CIRCUMSTANCE',
        placeholder: 'Real',
        help: 'Frame the object so it is forced to reveal itself'
    },
    {
        key: 'counterplay',
        label: 'COUNTERPLAY',
        placeholder: 'Impactful',
        help: 'Respond against an existing idea to make more sense'
    },
    {
        key: 'condition',
        label: 'CONDITION',
        placeholder: 'Engaging',
        help: 'Constrict the content and watch it resolve within bounds'
    },
    {
        key: 'clue',
        label: 'CLUE',
        placeholder: 'Interesting',
        help: 'Find an essential truth, but leave it empty and only show the edges'
    }
];

// One accent hue per C, spread around the wheel.
const FIELD_ACCENT_HUES = [350, 22, 48, 150, 190, 232, 285];
const MAX_LINES_PER_FIELD = 2;
const MAX_CHARS_PER_FIELD = 280;
let outsideBlurBound = false;

function normalizeFieldValue(value) {
    const raw = typeof value === 'string' ? value : String(value ?? '');
    const normalized = raw.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n').slice(0, MAX_LINES_PER_FIELD);
    return lines.join('\n').slice(0, MAX_CHARS_PER_FIELD);
}

function createDefaultFields() {
    return CREATION_FIELDS.reduce((acc, field) => {
        acc[field.key] = '';
        return acc;
    }, {});
}

function ensureFieldMap(block) {
    if (!block || typeof block !== 'object') {
        return createDefaultFields();
    }
    const existing = (block.fields && typeof block.fields === 'object') ? block.fields : {};
    const next = createDefaultFields();
    CREATION_FIELDS.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(existing, field.key)) {
            next[field.key] = normalizeFieldValue(existing[field.key]);
        } else if (Object.prototype.hasOwnProperty.call(block, field.key)) {
            next[field.key] = normalizeFieldValue(block[field.key]);
        }
    });
    block.fields = next;
    return next;
}

function focusField(blockId, index = 0) {
    if (!blockId) {
        return false;
    }
    const selector = `.board-block[data-id="${blockId}"] .creation-field-input[data-creation-field-index="${index}"]`;
    const target = document.querySelector(selector);
    if (!target) {
        return false;
    }
    target.focus({ preventScroll: true });
    const end = target.value.length;
    target.setSelectionRange(end, end);
    return true;
}

function focusNextField(blockId, currentIndex) {
    const nextIndex = Number(currentIndex) + 1;
    if (nextIndex < CREATION_FIELDS.length) {
        focusField(blockId, nextIndex);
        return;
    }
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
        active.blur();
    }
}

function commitField(block, key, value) {
    if (!block || !key) {
        return;
    }
    const fields = ensureFieldMap(block);
    const nextValue = normalizeFieldValue(value);
    if (fields[key] === nextValue) {
        return;
    }
    fields[key] = nextValue;
    block.updatedAt = new Date().toISOString();
    data.queueSave('creation-edit');
}

function resolveFieldMetrics(input) {
    if (!input || typeof window === 'undefined') {
        return { lineHeight: 0, paddingTotal: 0 };
    }
    const computed = window.getComputedStyle(input);
    let lineHeight = Number.parseFloat(computed?.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        const fontSize = Number.parseFloat(computed?.fontSize);
        lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.3 : 22;
    }
    const paddingTop = Number.parseFloat(computed?.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed?.paddingBottom) || 0;
    return { lineHeight, paddingTotal: paddingTop + paddingBottom };
}

function measureFieldContentHeight(input) {
    if (!input) {
        return 0;
    }
    const previousHeight = input.style.height;
    const previousMinHeight = input.style.minHeight;
    const previousMaxHeight = input.style.maxHeight;
    input.style.height = '0px';
    input.style.minHeight = '0px';
    input.style.maxHeight = 'none';
    const height = Number(input.scrollHeight) || 0;
    input.style.height = previousHeight;
    input.style.minHeight = previousMinHeight;
    input.style.maxHeight = previousMaxHeight;
    return height;
}

function resolveVisualLineCount(input) {
    if (!input) {
        return 1;
    }
    const text = input.value || '';
    if (!text) {
        return 1;
    }
    const { lineHeight, paddingTotal } = resolveFieldMetrics(input);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        return 1;
    }
    const measured = measureFieldContentHeight(input);
    const contentOnly = Math.max(0, measured - paddingTotal);
    const lines = Math.max(1, Math.round(contentOnly / lineHeight));
    return lines;
}

function updateCreationFieldLayout(input) {
    if (!input) {
        return;
    }
    input.classList.remove('is-single-line');
    input.classList.remove('is-double-line');
    const text = input.value || '';
    if (!text.trim()) {
        input.classList.add('is-single-line');
        return;
    }
    const lines = resolveVisualLineCount(input);
    input.classList.add(lines >= 2 ? 'is-double-line' : 'is-single-line');
}

function clampCreationFieldToTwoLines(input) {
    if (!input) {
        return false;
    }
    const value = input.value || '';
    const cleaned = normalizeFieldValue(value);
    const selectionStart = input.selectionStart ?? cleaned.length;
    const selectionEnd = input.selectionEnd ?? cleaned.length;
    let next = cleaned;
    input.value = next;
    const { lineHeight, paddingTotal } = resolveFieldMetrics(input);
    const maxHeight = Number.isFinite(lineHeight) && lineHeight > 0
        ? (paddingTotal + (lineHeight * MAX_LINES_PER_FIELD) + 1)
        : (input.clientHeight + 1);
    while (next && measureFieldContentHeight(input) > maxHeight) {
        next = next.slice(0, -1);
        input.value = next;
    }
    const changed = next !== value;
    input.value = next;
    const nextPos = utils.clamp(Math.min(selectionStart, selectionEnd), 0, input.value.length);
    input.setSelectionRange(nextPos, nextPos);
    updateCreationFieldLayout(input);
    return changed;
}

function ensureOutsideBlurListener() {
    if (outsideBlurBound || typeof document === 'undefined') {
        return;
    }
    outsideBlurBound = true;
    document.addEventListener('pointerdown', (event) => {
        const active = document.activeElement;
        if (!active || !active.classList?.contains('creation-field-input')) {
            return;
        }
        const activeBlock = active.closest('.board-block');
        const targetBlock = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('.board-block')
            : null;
        if (!activeBlock) {
            return;
        }
        if (targetBlock !== activeBlock && typeof active.blur === 'function') {
            active.blur();
        }
    }, true);
}

function renderCreationBlock(block, element) {
    ensureOutsideBlurListener();
    element.classList.add('creation-block');
    const fields = ensureFieldMap(block);
    element.innerHTML = '';

    const card = document.createElement('div');
    card.classList.add('creation-block-card');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Creation fields');
    const fieldInputs = [];

    CREATION_FIELDS.forEach((field, index) => {
        const fieldWrap = document.createElement('div');
        fieldWrap.classList.add('creation-field');
        fieldWrap.style.setProperty('--creation-accent-hue', String(FIELD_ACCENT_HUES[index]));

        const label = document.createElement('div');
        label.classList.add('creation-field-title');
        label.textContent = field.label;

        const help = document.createElement('div');
        help.classList.add('creation-field-help');
        help.textContent = field.help || '';

        const input = document.createElement('textarea');
        input.classList.add('creation-field-input');
        input.value = fields[field.key] || '';
        input.placeholder = field.placeholder;
        input.setAttribute('spellcheck', 'false');
        input.dataset.creationField = field.key;
        input.dataset.creationFieldIndex = String(index);
        input.rows = 1;
        input.wrap = 'soft';

        input.addEventListener('focus', () => {
            if (!state.selectedBlockIds.has(block.id)) {
                movement.selectBlock(block.id);
            }
        });

        input.addEventListener('input', () => {
            clampCreationFieldToTwoLines(input);
            commitField(block, field.key, input.value);
        });

        input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                focusNextField(block.id, index);
                return;
            }
            if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const lineCount = (input.value.match(/\n/g) || []).length + 1;
                if (lineCount >= MAX_LINES_PER_FIELD) {
                    event.preventDefault();
                }
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                input.blur();
            }
        });

        input.addEventListener('blur', () => {
            clampCreationFieldToTwoLines(input);
            commitField(block, field.key, input.value);
        });

        clampCreationFieldToTwoLines(input);
        fieldInputs.push(input);

        fieldWrap.appendChild(label);
        fieldWrap.appendChild(help);
        fieldWrap.appendChild(input);
        card.appendChild(fieldWrap);
    });

    element.appendChild(card);

    // Re-evaluate line layout after mount so wrapped text uses the actual rendered width.
    const syncFieldLayouts = () => {
        fieldInputs.forEach((input) => {
            updateCreationFieldLayout(input);
        });
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(syncFieldLayouts);
    } else {
        syncFieldLayouts();
    }
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(syncFieldLayouts);
            } else {
                syncFieldLayouts();
            }
        }).catch(() => {});
    }
}

const creationApi = {
    fields: CREATION_FIELDS,
    createDefaultFields,
    populateElement: renderCreationBlock,
    focusField,
    focusFirstField(blockId) {
        return focusField(blockId, 0);
    }
};

env.blocks.creation = creationApi;
env.creationBlocks = creationApi;

module.exports = creationApi;
