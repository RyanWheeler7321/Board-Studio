'use strict';

// MARK: SUBLISTS UI
const env = require('../core/state');
const { dom, state, data, utils, electron } = env;
const { clipboard } = electron || {};

const SUBLIST_FALLBACK_WIDTH = 280;
const SUBLIST_PANEL_MIN_WIDTH = 260;
const SUBLIST_PANEL_MAX_WIDTH = 920;
const SUBLIST_PANEL_DEFAULT_WIDTH = 420;
const SUBLIST_PANEL_STORAGE_KEY = 'workboard.sublists.width';
const SUBLIST_MIN_CH = 1;
const SUBLIST_MAX_CH = 120;
const SUBLIST_CHAR_WIDTH = 8.1;
const SUBLIST_LINE_PADDING_X = 16;
const ENTRY_DRAG_ACTIVATION_DISTANCE = 8;
const SUBLIST_WRAP_REFLOW_SETTLE_MS = 140;

function isPointInsideRect(x, y, rect, inset = 0) {
    if (!rect) {
        return false;
    }
    const left = Number(rect.left) + inset;
    const top = Number(rect.top) + inset;
    const right = Number(rect.right) - inset;
    const bottom = Number(rect.bottom) - inset;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
        return false;
    }
    return x >= left && x <= right && y >= top && y <= bottom;
}

function isBlockEligibleForListTransfer(block) {
    if (!block || typeof block !== 'object') {
        return false;
    }
    if (block.type !== 'text' && block.type !== 'title') {
        return false;
    }
    const content = typeof block.content === 'string' ? block.content : '';
    return content.trim().length > 0;
}

function getActiveBoard() {
    return state.boardData?.boards?.[state.currentBoardId] || null;
}

function getRootBoard() {
    return state.boardData?.boards?.root || null;
}

function isWordWrapEnabled() {
    const value = state.boardData?.settings?.sublistsWordWrap;
    if (typeof value === 'boolean') {
        return value;
    }
    return true;
}

function getSublistsEntryTextScale() {
    const value = Number(state.boardData?.settings?.sublistsEntryTextScale);
    return Number.isFinite(value) ? utils.clamp(value, 0.5, 2.6) : 1;
}

function hasUsableSublists(board) {
    const lists = board?.sublists;
    if (!Array.isArray(lists) || lists.length === 0) {
        return false;
    }
    for (const entry of lists) {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        if (typeof entry.id !== 'string' || !entry.id.trim()) {
            return false;
        }
        if (typeof entry.title !== 'string') {
            return false;
        }
        if (!Array.isArray(entry.lines) || entry.lines.length === 0) {
            return false;
        }
        for (const line of entry.lines) {
            if (typeof line !== 'string') {
                return false;
            }
        }
    }
    return true;
}

function ensureBoardSublists(board) {
    if (!board) {
        return;
    }
    if (hasUsableSublists(board)) {
        return;
    }
    if (data.ensureBoardSublists) {
        data.ensureBoardSublists(board);
        return;
    }
    if (!Array.isArray(board.sublists) || board.sublists.length === 0) {
        if (data.createDefaultSublists) {
            board.sublists = data.createDefaultSublists();
        } else {
            board.sublists = [
                { id: utils.createId('sublist'), title: 'EXACT', lines: [''], isCollapsed: false },
                { id: utils.createId('sublist'), title: 'CHANGE', lines: [''], isCollapsed: false }
            ];
        }
    }
}

function boardUsesLocalSublists(board) {
    if (!board) {
        return false;
    }
    if (board.id === 'root') {
        return true;
    }
    return board.useLocalSublists === true;
}

function cloneSublists(lists) {
    const raw = Array.isArray(lists) ? lists : [];
    return raw.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            return data.createDefaultSublist ? data.createDefaultSublist() : {
                id: utils.createId('sublist'),
                title: 'List',
                lines: [''],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        }
        const lines = Array.isArray(entry.lines) && entry.lines.length > 0
            ? entry.lines.map((line) => (typeof line === 'string' ? line : String(line ?? '')))
            : [''];
        return {
            ...entry,
            lines: lines.length > 0 ? lines : ['']
        };
    });
}

function resolveSublistsContext(board = getActiveBoard()) {
    const activeBoard = board || null;
    const rootBoard = getRootBoard();
    const ownerBoard = boardUsesLocalSublists(activeBoard)
        ? activeBoard
        : (rootBoard || activeBoard);
    if (ownerBoard) {
        ensureBoardSublists(ownerBoard);
    }
    return {
        activeBoard,
        rootBoard,
        ownerBoard,
        lists: Array.isArray(ownerBoard?.sublists) ? ownerBoard.sublists : [],
        isLocal: !!activeBoard && activeBoard.id !== 'root' && boardUsesLocalSublists(activeBoard)
    };
}

function touchSublistsOwnerUpdatedAt(timestamp, board = getActiveBoard()) {
    const context = resolveSublistsContext(board);
    if (context.ownerBoard) {
        context.ownerBoard.updatedAt = timestamp;
    }
}

function normalizeSublistToken(value) {
    return String(value || '').trim().toLowerCase();
}

function resolveSublistByIdOrTitle(board, listId, listTitle) {
    if (!board || !Array.isArray(board.sublists)) {
        return null;
    }
    const cleanedId = String(listId || '').trim();
    if (cleanedId) {
        for (const entry of board.sublists) {
            if (entry && entry.id === cleanedId) {
                return entry;
            }
        }
    }
    const wanted = normalizeSublistToken(listTitle);
    if (!wanted) {
        return null;
    }
    let fallback = null;
    for (const entry of board.sublists) {
        if (!entry) {
            continue;
        }
        const title = normalizeSublistToken(entry.title);
        if (!title) {
            continue;
        }
        if (title === wanted) {
            return entry;
        }
        if (!fallback && title.includes(wanted)) {
            fallback = entry;
        }
    }
    return fallback;
}

function resolveSublistEditor(list) {
    if (!list) {
        return null;
    }
    const columns = dom.sublistsColumns;
    if (!columns) {
        return null;
    }
    const card = columns.querySelector(`.sublist-card[data-id="${list.id}"]`);
    if (!card) {
        return null;
    }
    const editor = card.querySelector('.sublist-editor');
    if (!editor) {
        return null;
    }
    return { card, editor };
}

function updatePanelVisibility() {
    const panel = dom.sublistsPanel;
    const divider = dom.sublistsDivider;
    const visible = !!state.sublists.isVisible;
    if (panel) {
        panel.classList.toggle('is-collapsed', !visible);
        panel.setAttribute('aria-expanded', visible ? 'true' : 'false');
        panel.querySelectorAll('.sublists-nav-button').forEach((button) => {
            button.setAttribute('aria-expanded', visible ? 'true' : 'false');
        });
    }
    if (divider) {
        divider.classList.toggle('is-hidden', !visible);
        divider.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
}

function syncWorkspacePanels() {
    const activeView = state.sublists.activeView === 'lists' ? 'lists' : 'tool';
    if (dom.sublistsScroll) {
        dom.sublistsScroll.hidden = activeView !== 'lists';
    }
    if (dom.toolShellView) {
        dom.toolShellView.hidden = activeView === 'lists';
    }
}

function setVisibility(visible) {
    const wasVisible = state.sublists.isVisible === true;
    state.sublists.isVisible = !!visible;
    updatePanelVisibility();
    if (!wasVisible && state.sublists.isVisible && state.sublists.activeView === 'lists') {
        scheduleWrappedEditorsSettleReflow();
    }
    if (!wasVisible && state.sublists.isVisible && state.sublists.activeView !== 'lists') {
        env.toolShell?.renderActiveTool?.();
    }
    if (!state.sublists.isVisible) {
        clearDropIndicator();
        clearEntryDragState();
        closeActiveMenu();
    }
}

function toggleVisibility() {
    setVisibility(!state.sublists.isVisible);
}

function readStoredPanelWidth() {
    try {
        const stored = window.localStorage.getItem(SUBLIST_PANEL_STORAGE_KEY);
        return Number(stored);
    } catch {
        return NaN;
    }
}

function applyPanelWidth(width) {
    const panel = dom.sublistsPanel;
    if (!panel) {
        return;
    }
    const clamped = utils.clamp(Number(width) || SUBLIST_PANEL_DEFAULT_WIDTH, SUBLIST_PANEL_MIN_WIDTH, SUBLIST_PANEL_MAX_WIDTH);
    panel.style.setProperty('--sublists-panel-width', `${Math.round(clamped)}px`);
    state.sublists.panelWidth = clamped;
}

function persistPanelWidth(width) {
    try {
        window.localStorage.setItem(SUBLIST_PANEL_STORAGE_KEY, String(Math.round(width)));
    } catch {}
}

function resolveLineLimit(card) {
    let baseWidth = Number(card?.getBoundingClientRect?.().width);
    if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
        const panelWidth = Number(dom.sublistsPanel?.getBoundingClientRect?.().width);
        const sidebarWidth = Number(dom.sublistsPanel?.querySelector?.('.sublists-sidebar')?.getBoundingClientRect?.().width) || 0;
        const count = Math.max(state.sublists.lastListCount || 1, 1);
        if (Number.isFinite(panelWidth) && panelWidth > 0) {
            baseWidth = (panelWidth - sidebarWidth) / count;
        }
    }
    if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
        baseWidth = SUBLIST_FALLBACK_WIDTH;
    }
    baseWidth = Math.max(baseWidth, 1);
    const innerWidth = Math.max(baseWidth - SUBLIST_LINE_PADDING_X, 0);
    const scale = Number(state.boardData?.settings?.textFontScale);
    const textScale = Number.isFinite(scale) ? utils.clamp(scale, 0.5, 2.6) : 1;
    const sublistsTextScale = getSublistsEntryTextScale();
    const charWidth = Math.max(SUBLIST_CHAR_WIDTH * textScale * sublistsTextScale, 1);
    const estimate = Math.floor(innerWidth / charWidth);
    return utils.clamp(estimate, SUBLIST_MIN_CH, SUBLIST_MAX_CH);
}

function resolveSublistCardFromPoint(clientX, clientY) {
    const element = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(clientX, clientY)
        : null;
    const fromPoint = element?.closest?.('.sublist-card');
    if (fromPoint) {
        return fromPoint;
    }
    return resolveCardForClientX(dom.sublistsColumns, clientX);
}

function resolveRowsDropIndexFromClient(editor, clientX, clientY) {
    const entries = editor?.querySelectorAll?.('.sublist-entry');
    if (!entries || entries.length === 0) {
        return 0;
    }
    const hovered = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(clientX, clientY)?.closest?.('.sublist-entry')
        : null;
    if (hovered && editor.contains(hovered)) {
        const hoveredIndex = Number(hovered.dataset.rowIndex);
        const index = Number.isFinite(hoveredIndex) ? hoveredIndex : 0;
        const rect = hovered.getBoundingClientRect();
        const inLowerHalf = Number.isFinite(rect?.height) && rect.height > 0
            ? clientY >= (rect.top + (rect.height * 0.52))
            : false;
        return utils.clamp(index + (inLowerHalf ? 1 : 0), 0, entries.length);
    }
    const rect = editor.getBoundingClientRect();
    if (clientY <= rect.top) {
        return 0;
    }
    if (clientY >= rect.bottom) {
        return entries.length;
    }
    const first = entries[0];
    const rowHeight = resolveSublistEntryRowHeight(first) || resolveEditorLineHeight(editor) || 1;
    const relativeY = (clientY - rect.top) + (editor.scrollTop || 0);
    const rawIndex = Math.floor(relativeY / Math.max(rowHeight, 1));
    return utils.clamp(rawIndex, 0, entries.length);
}

function resolvePlainEditorDropIndex(editor, list, clientY) {
    const lines = ensureListLines(list);
    const lineCount = Math.max(lines.length, 1);
    const rect = editor.getBoundingClientRect();
    if (clientY <= rect.top) {
        return 0;
    }
    if (clientY >= rect.bottom) {
        return lineCount;
    }
    const lineHeight = resolveEditorLineHeight(editor) || 1;
    const relativeY = (clientY - rect.top) + (editor.scrollTop || 0);
    const rawIndex = Math.floor(relativeY / Math.max(lineHeight, 1));
    return utils.clamp(rawIndex, 0, lineCount);
}

function resolveDropTargetFromClient(clientX, clientY) {
    if (!state.sublists?.isVisible) {
        return null;
    }
    const panel = dom.sublistsPanel;
    if (!panel) {
        return null;
    }
    const panelRect = panel.getBoundingClientRect();
    if (!isPointInsideRect(clientX, clientY, panelRect)) {
        return null;
    }
    const context = resolveSublistsContext();
    if (!context.ownerBoard) {
        return null;
    }
    const card = resolveSublistCardFromPoint(clientX, clientY);
    if (!card) {
        return null;
    }
    const listId = String(card.dataset.id || '').trim();
    if (!listId) {
        return null;
    }
    const list = resolveSublistByIdOrTitle(context.ownerBoard, listId, '');
    if (!list) {
        return null;
    }
    const editor = card.querySelector('.sublist-editor');
    if (!editor) {
        return null;
    }
    const rowIndex = editor.classList.contains('sublist-editor--rows')
        ? resolveRowsDropIndexFromClient(editor, clientX, clientY)
        : resolvePlainEditorDropIndex(editor, list, clientY);
    return {
        listId: list.id,
        rowIndex,
        list,
        card,
        editor
    };
}

function clearDropIndicator() {
    const active = state.sublists?.dropIndicator;
    if (!active) {
        return;
    }
    if (active.card?.classList) {
        active.card.classList.remove('is-drop-target');
    }
    if (active.editor?.classList) {
        active.editor.classList.remove('is-drop-target', 'is-drop-at-end');
        active.editor.style.removeProperty('--sublist-drop-line-start');
    }
    if (active.anchorEntry?.classList) {
        active.anchorEntry.classList.remove('is-drop-anchor');
    }
    state.sublists.dropIndicator = null;
}

function setDropIndicator(target) {
    if (!target || !target.card || !target.editor) {
        clearDropIndicator();
        return;
    }
    const previous = state.sublists?.dropIndicator;
    if (previous && previous.card === target.card && previous.editor === target.editor && previous.rowIndex === target.rowIndex) {
        return;
    }
    clearDropIndicator();
    const card = target.card;
    const editor = target.editor;
    card.classList.add('is-drop-target');
    editor.classList.add('is-drop-target');
    let anchorEntry = null;
    if (editor.classList.contains('sublist-editor--rows')) {
        const entries = editor.querySelectorAll('.sublist-entry');
        const rowIndex = utils.clamp(Number(target.rowIndex) || 0, 0, entries.length);
        const atEnd = rowIndex >= entries.length;
        editor.classList.toggle('is-drop-at-end', atEnd);
        const lineHeight = resolveEditorLineHeight(editor) || resolveSublistEntryRowHeight(entries[0]) || 0;
        if (lineHeight > 0) {
            editor.style.setProperty('--sublist-drop-line-start', `${(rowIndex * lineHeight).toFixed(2)}px`);
        }
        if (!atEnd && entries[rowIndex]) {
            anchorEntry = entries[rowIndex];
            anchorEntry.classList.add('is-drop-anchor');
        }
    } else {
        const lineHeight = resolveEditorLineHeight(editor) || 0;
        const rowIndex = Math.max(Number(target.rowIndex) || 0, 0);
        if (lineHeight > 0) {
            editor.style.setProperty('--sublist-drop-line-start', `${(rowIndex * lineHeight).toFixed(2)}px`);
        }
    }
    state.sublists.dropIndicator = {
        card,
        editor,
        anchorEntry,
        rowIndex: Number(target.rowIndex) || 0
    };
}

function autoSizeEditor(editor) {
    if (!editor) {
        return;
    }
    const body = editor.parentElement;
    const bodyHeight = Number(body?.getBoundingClientRect?.().height) || 0;
    const topbar = body?.querySelector?.('.sublist-topbar');
    const topbarHeight = Number(topbar?.getBoundingClientRect?.().height) || 0;
    editor.style.height = 'auto';
    const minHeight = Math.max(bodyHeight - topbarHeight, 0);
    const next = minHeight > 0
        ? Math.max(minHeight, 120)
        : Math.max(editor.scrollHeight, 120);
    editor.style.height = `${next}px`;
}

function resolveEditorCaretLine(editor) {
    if (!editor) {
        return 0;
    }
    const text = editor.value || '';
    const caret = utils.clamp(editor.selectionStart ?? 0, 0, text.length);
    let lineIndex = 0;
    for (let i = 0; i < caret; i += 1) {
        if (text[i] === '\n') {
            lineIndex += 1;
        }
    }
    return lineIndex;
}

function updateActiveLine(editor) {
    if (!editor) {
        return;
    }
    const lineHeight = resolveEditorLineHeight(editor);
    if (!lineHeight) {
        return;
    }
    const lineIndex = resolveEditorCaretLine(editor);
    const offset = Math.max(lineIndex, 0) * lineHeight;
    editor.style.setProperty('--sublist-active-line-start', `${offset.toFixed(2)}px`);
}

function updateColumnsEditingState() {
    const columns = dom.sublistsColumns;
    if (!columns) {
        return;
    }
    const active = columns.querySelector('.sublist-editor.is-active');
    columns.classList.toggle('is-editing', !!active);
}

function setEditorActive(editor) {
    if (!editor) {
        return;
    }
    const columns = dom.sublistsColumns;
    if (columns) {
        const activeEditors = Array.from(columns.querySelectorAll('.sublist-editor.is-active'));
        activeEditors.forEach((activeEditor) => {
            if (activeEditor === editor) {
                return;
            }
            activeEditor.classList.remove('is-active');
            const activeRow = activeEditor.querySelector('.sublist-entry.is-active-row');
            if (activeRow) {
                activeRow.classList.remove('is-active-row');
            }
            activeEditor.style.setProperty('--sublist-active-line-start', '-9999px');
        });
    }
    editor.classList.add('is-active');
    updateColumnsEditingState();
}

function clearEditorActive(editor) {
    if (!editor) {
        return;
    }
    editor.classList.remove('is-active');
    const activeRow = editor.querySelector('.sublist-entry.is-active-row');
    if (activeRow) {
        activeRow.classList.remove('is-active-row');
    }
    editor.style.setProperty('--sublist-active-line-start', '-9999px');
    updateColumnsEditingState();
}

function trimTrailingEmptyEntries(list, editor, card) {
    if (!list) {
        return false;
    }
    const current = ensureListLines(list).slice();
    let changed = false;
    while (current.length > 1) {
        const tail = current[current.length - 1];
        if (typeof tail === 'string' ? tail.trim() === '' : !tail) {
            current.pop();
            changed = true;
            continue;
        }
        break;
    }
    if (!changed) {
        return false;
    }
    commitListLines(list, current);
    if (editor && editor.classList.contains('sublist-editor--rows')) {
        rebuildWrappedEditorRows(list, editor, card);
        updateEditorSurface(editor, current.join('\n'));
        return true;
    }
    if (editor) {
        editor.value = current.join('\n');
        autoSizeEditor(editor);
        updateEditorSurface(editor, editor.value || '');
        updateActiveLine(editor);
    }
    return true;
}

function blurActiveEditor() {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (!active || !active.classList) {
        return;
    }
    const classList = active.classList;
    if (!classList.contains('sublist-editor') && !classList.contains('sublist-entry')) {
        return;
    }
    const editor = classList.contains('sublist-editor') ? active : active.closest('.sublist-editor');
    const card = editor?.closest('.sublist-card');
    const listId = card?.dataset?.id || '';
    const context = resolveSublistsContext();
    const lists = context.lists;
    let list = null;
    for (const entry of lists) {
        if (entry.id === listId) {
            list = entry;
            break;
        }
    }
    if (list) {
        trimTrailingEmptyEntries(list, editor, card);
    }
    active.blur();
}

function resolveEditorLineHeight(editor) {
    if (!editor || typeof window === 'undefined') {
        return null;
    }
    const computed = window.getComputedStyle(editor);
    const lineHeight = Number.parseFloat(computed?.lineHeight);
    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : null;
}

function resolveMaxVisibleLines(editor) {
    if (!editor || typeof window === 'undefined') {
        return null;
    }
    const body = editor.parentElement;
    const bodyHeight = Number(body?.getBoundingClientRect?.().height) || 0;
    const topbar = body?.querySelector?.('.sublist-topbar');
    const topbarHeight = Number(topbar?.getBoundingClientRect?.().height) || 0;
    const computed = window.getComputedStyle(editor);
    const lineHeight = Number.parseFloat(computed?.lineHeight);
    const paddingTop = Number.parseFloat(computed?.paddingTop);
    const paddingBottom = Number.parseFloat(computed?.paddingBottom);
    const padding = (Number.isFinite(paddingTop) ? paddingTop : 0) + (Number.isFinite(paddingBottom) ? paddingBottom : 0);
    const available = Math.max(bodyHeight - topbarHeight - padding, 0);
    if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0) {
        return null;
    }
    return Math.max(Math.floor(available / lineHeight), 1);
}

function clampLineCount(text, selectionStart, selectionEnd, maxLines) {
    const lines = text.split('\n');
    if (!Number.isFinite(maxLines) || maxLines <= 0 || lines.length <= maxLines) {
        return {
            text,
            selectionStart,
            selectionEnd,
            modified: false,
            lineCount: lines.length
        };
    }
    const trimmed = lines.slice(0, maxLines);
    const nextText = trimmed.join('\n');
    const nextStart = utils.clamp(selectionStart, 0, nextText.length);
    const nextEnd = utils.clamp(selectionEnd, 0, nextText.length);
    return {
        text: nextText,
        selectionStart: nextStart,
        selectionEnd: nextEnd,
        modified: true,
        lineCount: trimmed.length
    };
}

function updateEditorSurface(editor, text) {
    if (!editor) {
        return;
    }
    const normalized = typeof text === 'string' ? text : '';
    editor.classList.remove('is-empty');
    const lineHeight = resolveEditorLineHeight(editor);
    if (!lineHeight) {
        return;
    }
    const contentHeight = Math.max(normalized.split('\n').length, 1) * lineHeight;
    editor.style.setProperty('--sublist-content-height', `${contentHeight.toFixed(2)}px`);
}

function createEntryDragGhost(text) {
    const ghost = document.createElement('div');
    ghost.classList.add('sublists-entry-drag-pill');
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    ghost.textContent = normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
    document.body.appendChild(ghost);
    return ghost;
}

function updateBoardDropHint(active) {
    const container = dom.boardContainer;
    if (!container) {
        return;
    }
    container.classList.toggle('is-list-drop-target', !!active);
}

function clearEntryDragState() {
    const drag = state.sublists?.entryDragState;
    if (!drag) {
        updateBoardDropHint(false);
        return;
    }
    if (drag.captureElement && Number.isFinite(drag.pointerId)) {
        try {
            drag.captureElement.releasePointerCapture(drag.pointerId);
        } catch {}
    }
    if (drag.ghost && drag.ghost.parentElement) {
        drag.ghost.parentElement.removeChild(drag.ghost);
    }
    document.body.classList.remove('sublists-entry-dragging');
    updateBoardDropHint(false);
    state.sublists.entryDragState = null;
}

function queueEntryDrag(payload, event) {
    if (!event || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
    }
    if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) {
        return;
    }
    clearEntryDragState();
    const captureElement = payload.captureElement && typeof payload.captureElement.setPointerCapture === 'function'
        ? payload.captureElement
        : null;
    state.sublists.entryDragState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        text: payload.text,
        sourceListId: payload.listId || '',
        sourceRowIndex: Number.isFinite(payload.rowIndex) ? payload.rowIndex : 0,
        safeRect: payload.safeRect || null,
        captureElement,
        active: false,
        ghost: null,
        boardTarget: false
    };
}

function queueWrappedEntryDrag(list, entry, event) {
    const rect = entry?.getBoundingClientRect?.();
    queueEntryDrag({
        text: entry?.value || '',
        listId: list?.id || '',
        rowIndex: Number(entry?.dataset?.rowIndex) || 0,
        safeRect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
        captureElement: entry
    }, event);
}

function queuePlainEditorLineDrag(list, editor, event) {
    if (!editor || !list) {
        return;
    }
    const lines = ensureListLines(list);
    const lineCount = Math.max(lines.length, 1);
    const lineHeight = resolveEditorLineHeight(editor) || 1;
    const rect = editor.getBoundingClientRect();
    const relativeY = (event.clientY - rect.top) + (editor.scrollTop || 0);
    const rowIndex = utils.clamp(Math.floor(relativeY / Math.max(lineHeight, 1)), 0, Math.max(lineCount - 1, 0));
    const lineText = lines[rowIndex] || '';
    const lineTop = rect.top + (rowIndex * lineHeight) - (editor.scrollTop || 0);
    const safeRect = {
        left: rect.left,
        top: lineTop,
        right: rect.right,
        bottom: lineTop + lineHeight
    };
    queueEntryDrag({
        text: lineText,
        listId: list.id,
        rowIndex,
        safeRect,
        captureElement: editor
    }, event);
}

function startEntryDrag(event, drag) {
    if (!drag || drag.active) {
        return;
    }
    drag.active = true;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (drag.captureElement && Number.isFinite(drag.pointerId)) {
        try {
            drag.captureElement.setPointerCapture(drag.pointerId);
        } catch {}
    }
    drag.ghost = createEntryDragGhost(drag.text);
    drag.ghost.style.left = `${event.clientX + 18}px`;
    drag.ghost.style.top = `${event.clientY + 16}px`;
    document.body.classList.add('sublists-entry-dragging');
}

function isBoardDropPoint(clientX, clientY) {
    const container = dom.boardContainer;
    if (!container) {
        return false;
    }
    const rect = container.getBoundingClientRect();
    return isPointInsideRect(clientX, clientY, rect);
}

function handleEntryDragMove(event) {
    const drag = state.sublists?.entryDragState;
    if (!drag || event.pointerId !== drag.pointerId) {
        return;
    }
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;
        const distanceSq = (deltaX * deltaX) + (deltaY * deltaY);
        if (distanceSq < ENTRY_DRAG_ACTIVATION_DISTANCE * ENTRY_DRAG_ACTIVATION_DISTANCE) {
            return;
        }
        if (drag.safeRect && isPointInsideRect(event.clientX, event.clientY, drag.safeRect, 2)) {
            return;
        }
        startEntryDrag(event, drag);
    }
    if (!drag.active) {
        return;
    }
    if (drag.ghost) {
        drag.ghost.style.left = `${event.clientX + 18}px`;
        drag.ghost.style.top = `${event.clientY + 16}px`;
    }
    const boardTarget = isBoardDropPoint(event.clientX, event.clientY);
    drag.boardTarget = boardTarget;
    updateBoardDropHint(boardTarget);
    event.preventDefault();
}

function handleEntryDragEnd(event) {
    const drag = state.sublists?.entryDragState;
    if (!drag) {
        return;
    }
    if (event && event.pointerId !== drag.pointerId) {
        return;
    }
    if (drag.active && drag.boardTarget && env.management?.createTextBlockWithContent) {
        const pointer = env.movement?.convertClientToBoard
            ? env.movement.convertClientToBoard(drag.clientX, drag.clientY)
            : { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
        const created = env.management.createTextBlockWithContent(pointer, drag.text, { startEditing: false, select: true });
        if (created?.id) {
            removeEntryFromListAfterDragOut(drag);
            requestAnimationFrame(() => {
                const element = document.querySelector(`.board-block[data-id="${created.id}"]`);
                if (!element) {
                    return;
                }
                element.classList.add('is-drop-born');
                window.setTimeout(() => {
                    element.classList.remove('is-drop-born');
                }, 260);
            });
        }
    }
    clearEntryDragState();
}

function removeEntryFromListAfterDragOut(drag) {
    const listId = String(drag?.sourceListId || '').trim();
    const rawIndex = Number(drag?.sourceRowIndex);
    if (!listId || !Number.isFinite(rawIndex) || rawIndex < 0) {
        return false;
    }
    const context = resolveSublistsContext();
    if (!context.ownerBoard) {
        return false;
    }
    const list = resolveSublistByIdOrTitle(context.ownerBoard, listId, '');
    if (!list) {
        return false;
    }
    const current = ensureListLines(list).slice();
    if (!current.length) {
        return false;
    }
    const rowIndex = utils.clamp(rawIndex, 0, Math.max(current.length - 1, 0));
    const nextLines = current.slice();
    if (nextLines.length > 1) {
        nextLines.splice(rowIndex, 1);
    } else {
        nextLines[0] = '';
    }
    const history = env.history;
    if (history && typeof history.record === 'function') {
        history.record('sublists-before-drag-out-entry');
    }
    commitListLines(list, nextLines);
    if (history && typeof history.record === 'function') {
        history.record('sublists-drag-out-entry');
    }
    markSublistsStructureHistoryAction('drag-out-entry');

    const resolved = resolveListEditorForDrop(context, list);
    const card = resolved?.card || null;
    const editor = resolved?.editor || null;
    const focusIndex = utils.clamp(rowIndex, 0, Math.max(nextLines.length - 1, 0));
    if (editor?.classList?.contains('sublist-editor--rows') && card) {
        rebuildWrappedEditorRows(list, editor, card, { focusIndex, focusPos: Number.MAX_SAFE_INTEGER });
    } else if (editor) {
        const text = nextLines.join('\n');
        editor.value = text;
        autoSizeEditor(editor);
        updateEditorSurface(editor, text);
        updateActiveLine(editor);
    }
    return true;
}

function ensureListLines(list) {
    if (!list) {
        return [''];
    }
    if (!Array.isArray(list.lines) || list.lines.length === 0) {
        list.lines = [''];
    }
    return list.lines;
}

function commitListLines(list, lines) {
    if (!list) {
        return;
    }
    list.lines = Array.isArray(lines) && lines.length > 0 ? lines : [''];
    list.updatedAt = new Date().toISOString();
    touchSublistsOwnerUpdatedAt(list.updatedAt);
    if (data.queueSave) {
        data.queueSave('sublists-edit');
    }
}

function normalizeImportedListLine(text, limit) {
    const raw = typeof text === 'string' ? text : String(text ?? '');
    const singleLine = raw.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!singleLine) {
        return '';
    }
    if (!Number.isFinite(limit) || limit <= 0) {
        return singleLine;
    }
    return singleLine.length > limit ? singleLine.slice(0, limit) : singleLine;
}

function insertLinesIntoList(list, rowIndex, incomingLines) {
    const current = ensureListLines(list).slice();
    const filtered = (Array.isArray(incomingLines) ? incomingLines : []).filter((line) => typeof line === 'string' && line.length > 0);
    if (filtered.length === 0) {
        return {
            lines: current,
            insertedCount: 0,
            focusIndex: utils.clamp(Number(rowIndex) || 0, 0, Math.max(current.length - 1, 0))
        };
    }
    let insertAt = Number.isFinite(rowIndex) ? utils.clamp(rowIndex, 0, current.length) : current.length;
    filtered.forEach((line) => {
        if (current.length === 1 && current[0] === '') {
            current[0] = line;
            insertAt = 1;
            return;
        }
        if (insertAt < current.length && current[insertAt] === '') {
            current[insertAt] = line;
            insertAt += 1;
            return;
        }
        current.splice(insertAt, 0, line);
        insertAt += 1;
    });
    return {
        lines: current,
        insertedCount: filtered.length,
        focusIndex: utils.clamp(insertAt - 1, 0, Math.max(current.length - 1, 0))
    };
}

function resolveListEditorForDrop(context, list) {
    if (!context?.activeBoard || !list) {
        return null;
    }
    let resolved = resolveSublistEditor(list);
    if (resolved) {
        return resolved;
    }
    renderSublists(context.activeBoard);
    resolved = resolveSublistEditor(list);
    return resolved || null;
}

function dropBlocksIntoList(blocks, target) {
    const context = resolveSublistsContext();
    if (!context.ownerBoard) {
        clearDropIndicator();
        return { movedBlockIds: [], inserted: 0, listId: '' };
    }
    const listId = String(target?.listId || '').trim();
    const list = resolveSublistByIdOrTitle(context.ownerBoard, listId, target?.listTitle || '');
    if (!list) {
        clearDropIndicator();
        return { movedBlockIds: [], inserted: 0, listId: '' };
    }
    const resolved = resolveListEditorForDrop(context, list);
    const card = resolved?.card || null;
    const editor = resolved?.editor || null;
    const limit = resolveLineLimit(card);
    const candidates = (Array.isArray(blocks) ? blocks : []).filter(isBlockEligibleForListTransfer);
    if (!candidates.length) {
        clearDropIndicator();
        return { movedBlockIds: [], inserted: 0, listId: list.id };
    }
    const lines = [];
    const movedBlockIds = [];
    candidates.forEach((block) => {
        const normalized = normalizeImportedListLine(block.content, limit);
        if (!normalized) {
            return;
        }
        lines.push(normalized);
        movedBlockIds.push(block.id);
    });
    if (!lines.length) {
        clearDropIndicator();
        return { movedBlockIds: [], inserted: 0, listId: list.id };
    }
    const history = env.history;
    if (history && typeof history.record === 'function') {
        history.record('sublists-before-drop-blocks');
    }
    const inserted = insertLinesIntoList(list, Number(target?.rowIndex), lines);
    commitListLines(list, inserted.lines);
    if (history && typeof history.record === 'function') {
        history.record('sublists-drop-blocks');
    }
    markSublistsStructureHistoryAction('drop-blocks');
    if (editor?.classList?.contains('sublist-editor--rows') && card) {
        rebuildWrappedEditorRows(list, editor, card, { focusIndex: inserted.focusIndex, focusPos: Number.MAX_SAFE_INTEGER });
    } else if (editor) {
        const nextText = inserted.lines.join('\n');
        editor.value = nextText;
        autoSizeEditor(editor);
        updateEditorSurface(editor, nextText);
        updateActiveLine(editor);
    }
    setDropIndicator({
        card,
        editor,
        rowIndex: inserted.focusIndex
    });
    setTimeout(() => clearDropIndicator(), 220);
    return {
        movedBlockIds,
        inserted: inserted.insertedCount,
        listId: list.id
    };
}

function resolveBlockDropTarget(options = {}) {
    const blocks = Array.isArray(options.blocks) ? options.blocks : [];
    if (!blocks.length || !blocks.every(isBlockEligibleForListTransfer)) {
        clearDropIndicator();
        return null;
    }
    const target = resolveDropTargetFromClient(options.clientX, options.clientY);
    if (!target) {
        clearDropIndicator();
        return null;
    }
    setDropIndicator(target);
    return {
        listId: target.listId,
        rowIndex: target.rowIndex
    };
}

function clearDropTargetIndicator() {
    clearDropIndicator();
}

function addEntryToList(listTitle, options = {}) {
    const context = resolveSublistsContext();
    if (!context.activeBoard || !context.ownerBoard) {
        return false;
    }
    const listId = options.listId || options.id || '';
    const list = resolveSublistByIdOrTitle(context.ownerBoard, listId, listTitle);
    if (!list) {
        env.utils?.showToast?.(`Sublist not found: ${listTitle || listId || 'unknown'}`);
        return false;
    }
    if (options.ensureVisible !== false) {
        setVisibility(true);
    }
    let resolved = resolveSublistEditor(list);
    if (!resolved) {
        renderSublists(context.activeBoard);
        resolved = resolveSublistEditor(list);
    }
    if (!resolved) {
        return false;
    }
    const { card, editor } = resolved;

    if (editor.classList.contains('sublist-editor--rows')) {
        const current = ensureListLines(list).slice();
        let focusIndex = Math.max(current.length - 1, 0);
        const lastValue = (current[focusIndex] || '').trim();
        if (lastValue) {
            if (env.history && typeof env.history.record === 'function') {
                env.history.record('sublists-before-insert-entry');
            }
            current.push('');
            commitListLines(list, current);
            if (env.history && typeof env.history.record === 'function') {
                env.history.record('sublists-insert-entry');
            }
            markSublistsStructureHistoryAction('insert-entry');
            focusIndex = current.length - 1;
        }
        rebuildWrappedEditorRows(list, editor, card, { focusIndex });
        const entries = editor.querySelectorAll('.sublist-entry');
        const entry = entries[focusIndex];
        if (entry) {
            try {
                entry.focus({ preventScroll: false });
            } catch {
                entry.focus();
            }
            const pos = entry.value.length;
            entry.setSelectionRange(pos, pos);
            setEditorActive(editor);
            updateActiveSublistEntry(editor, entry);
        }
        return true;
    }

    const current = ensureListLines(list).slice();
    const lastIndex = Math.max(current.length - 1, 0);
    const lastValue = (current[lastIndex] || '').trim();
    const nextLines = current.slice();
    if (lastValue) {
        if (env.history && typeof env.history.record === 'function') {
            env.history.record('sublists-before-insert-entry');
        }
        nextLines.push('');
        commitListText(list, nextLines.join('\n'));
        if (env.history && typeof env.history.record === 'function') {
            env.history.record('sublists-insert-entry');
        }
        markSublistsStructureHistoryAction('insert-entry');
    }
    const nextText = nextLines.join('\n');
    if (editor.value !== nextText) {
        editor.value = nextText;
    }
    autoSizeEditor(editor);
    updateEditorSurface(editor, nextText);
    setEditorActive(editor);
    try {
        editor.focus({ preventScroll: false });
    } catch {
        editor.focus();
    }
    const caretPos = nextText.length;
    editor.setSelectionRange(caretPos, caretPos);
    updateActiveLine(editor);
    return true;
}

function resolveSublistEntryLineHeight(entry) {
    if (!entry || typeof window === 'undefined') {
        return null;
    }
    const computed = window.getComputedStyle(entry);
    const lineHeight = Number.parseFloat(computed?.lineHeight);
    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : null;
}

function resolveSublistEntryRowHeight(entry) {
    const height = Number(entry?.getBoundingClientRect?.().height);
    return Number.isFinite(height) && height > 0 ? height : null;
}

function measureSublistEntryContentHeight(entry) {
    if (!entry) {
        return 0;
    }
    const previousHeight = entry.style.height;
    const previousMinHeight = entry.style.minHeight;
    const previousMaxHeight = entry.style.maxHeight;
    entry.style.height = '0px';
    entry.style.minHeight = '0px';
    entry.style.maxHeight = 'none';
    const height = Number(entry.scrollHeight) || 0;
    entry.style.height = previousHeight;
    entry.style.minHeight = previousMinHeight;
    entry.style.maxHeight = previousMaxHeight;
    return height;
}

function updateSublistEntryLayout(entry) {
    if (!entry) {
        return;
    }
    entry.classList.remove('is-single-line');
    entry.classList.remove('is-double-line');
    const text = entry.value || '';
    if (!text.trim()) {
        entry.classList.add('is-single-line');
        return;
    }
    const contentHeight = measureSublistEntryContentHeight(entry);
    const lineHeight = resolveSublistEntryLineHeight(entry);
    if (!Number.isFinite(contentHeight) || contentHeight <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0) {
        const endLine = resolveCaretLineIndex(entry, text.length);
        entry.classList.add(endLine >= 1 ? 'is-double-line' : 'is-single-line');
        return;
    }
    const visualLineCount = Math.max(1, Math.min(2, Math.round(contentHeight / lineHeight)));
    entry.classList.add(visualLineCount >= 2 ? 'is-double-line' : 'is-single-line');
}

function clampSublistEntryToTwoLines(entry) {
    if (!entry) {
        return false;
    }
    const value = entry.value || '';
    const cleaned = value.replace(/[\r\n]+/g, ' ');
    if (cleaned !== value) {
        entry.value = cleaned;
    }
    entry.classList.remove('is-single-line');
    entry.classList.remove('is-double-line');
    const rowHeight = resolveSublistEntryRowHeight(entry);
    const lineHeight = resolveSublistEntryLineHeight(entry);
    const maxHeight = Number.isFinite(rowHeight) && rowHeight > 0
        ? rowHeight + 1
        : (Number.isFinite(lineHeight) && lineHeight > 0 ? (lineHeight * 2) + 1 : null);
    if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
        updateSublistEntryLayout(entry);
        return cleaned !== value;
    }
    if (measureSublistEntryContentHeight(entry) <= maxHeight) {
        updateSublistEntryLayout(entry);
        return cleaned !== value;
    }
    const selectionStart = entry.selectionStart ?? cleaned.length;
    const selectionEnd = entry.selectionEnd ?? cleaned.length;
    const original = entry.value || '';
    let low = 0;
    let high = original.length;
    let best = '';
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        entry.value = original.slice(0, mid);
        if (measureSublistEntryContentHeight(entry) <= maxHeight) {
            best = entry.value;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    entry.value = best;
    const nextPos = utils.clamp(Math.min(selectionStart, selectionEnd), 0, best.length);
    entry.setSelectionRange(nextPos, nextPos);
    updateSublistEntryLayout(entry);
    return true;
}

let caretMirrorEl = null;

function ensureCaretMirror() {
    if (caretMirrorEl && caretMirrorEl.isConnected) {
        return caretMirrorEl;
    }
    if (typeof document === 'undefined') {
        return null;
    }
    const mirror = document.createElement('div');
    mirror.style.position = 'absolute';
    mirror.style.left = '-99999px';
    mirror.style.top = '0';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordBreak = 'break-word';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.contain = 'layout style paint';
    document.body.appendChild(mirror);
    caretMirrorEl = mirror;
    return mirror;
}

function resolveCaretLineIndex(entry, caretPos) {
    if (!entry || typeof window === 'undefined') {
        return 0;
    }
    const mirror = ensureCaretMirror();
    if (!mirror) {
        return 0;
    }
    const computed = window.getComputedStyle(entry);
    const lineHeight = Number.parseFloat(computed?.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        return 0;
    }
    const rect = entry.getBoundingClientRect();
    const width = Number.isFinite(rect?.width) ? rect.width : entry.clientWidth;

    mirror.style.boxSizing = computed.boxSizing || 'border-box';
    mirror.style.width = `${Math.max(width, 1)}px`;
    mirror.style.fontFamily = computed.fontFamily;
    mirror.style.fontSize = computed.fontSize;
    mirror.style.fontWeight = computed.fontWeight;
    mirror.style.fontStyle = computed.fontStyle;
    mirror.style.letterSpacing = computed.letterSpacing;
    mirror.style.textTransform = computed.textTransform;
    mirror.style.lineHeight = computed.lineHeight;
    mirror.style.padding = computed.padding;
    mirror.style.border = computed.border;

    const text = entry.value || '';
    const pos = utils.clamp(Number(caretPos) || 0, 0, text.length);
    mirror.textContent = text.slice(0, pos);
    const caret = document.createElement('span');
    caret.textContent = '\u200b';
    caret.style.display = 'inline-block';
    caret.style.width = '0px';
    mirror.appendChild(caret);

    const mirrorRect = mirror.getBoundingClientRect();
    const caretRect = caret.getBoundingClientRect();
    const y = caretRect.top - mirrorRect.top;
    const lineIndex = Math.round(y / lineHeight);
    return utils.clamp(lineIndex, 0, 1);
}

function resolveTotalVisualLines(entry) {
    if (!entry) {
        return 1;
    }
    if (entry.classList.contains('is-single-line')) {
        return 1;
    }
    if (!entry.classList.contains('is-double-line')) {
        return 1;
    }
    const endLine = resolveCaretLineIndex(entry, (entry.value || '').length);
    return utils.clamp(endLine + 1, 1, 2);
}

function shouldNavigateBetweenSublistEntries(entry, direction) {
    if (!entry) {
        return false;
    }
    const selectionStart = entry.selectionStart ?? 0;
    const selectionEnd = entry.selectionEnd ?? 0;
    if (selectionStart !== selectionEnd) {
        return false;
    }
    const text = entry.value || '';
    if (entry.classList.contains('is-single-line')) {
        return true;
    }
    const totalLines = resolveTotalVisualLines(entry);
    const caretLine = resolveCaretLineIndex(entry, selectionStart);
    if (direction === 'up') {
        return caretLine <= 0;
    }
    if (direction === 'down') {
        return caretLine >= totalLines - 1;
    }
    return false;
}

function focusNeighborSublistCard(card, direction, options = {}) {
    const columns = dom.sublistsColumns;
    if (!columns || !card) {
        return false;
    }
    const normalizedDirection = direction === 'left' ? -1 : (direction === 'right' ? 1 : 0);
    if (!normalizedDirection) {
        return false;
    }
    const cards = Array.from(columns.querySelectorAll('.sublist-card'));
    if (cards.length === 0) {
        return false;
    }
    const currentIndex = cards.indexOf(card);
    if (currentIndex < 0) {
        return false;
    }
    const neighborCard = cards[currentIndex + normalizedDirection];
    if (!neighborCard) {
        return false;
    }
    const neighborEditor = neighborCard.querySelector('.sublist-editor');
    if (!neighborEditor) {
        return false;
    }
    const mode = (neighborEditor.getAttribute('data-mode') || '').toLowerCase();
    if (mode === 'rows') {
        const entries = neighborEditor.querySelectorAll('.sublist-entry');
        if (!entries || entries.length === 0) {
            return false;
        }
        const rowIndex = Number.isFinite(options.rowIndex) ? utils.clamp(options.rowIndex, 0, entries.length - 1) : 0;
        const entry = entries[rowIndex];
        if (!entry) {
            return false;
        }
        const caretPos = Number.isFinite(options.caretPos) ? options.caretPos : (entry.value || '').length;
        try {
            entry.focus({ preventScroll: false });
        } catch {
            entry.focus();
        }
        const nextPos = utils.clamp(caretPos, 0, (entry.value || '').length);
        entry.setSelectionRange(nextPos, nextPos);
        updateActiveSublistEntry(neighborEditor, entry);
        return true;
    }
    if (neighborEditor.tagName && neighborEditor.tagName.toLowerCase() === 'textarea') {
        try {
            neighborEditor.focus({ preventScroll: false });
        } catch {
            neighborEditor.focus();
        }
        return true;
    }
    return false;
}

function resolveLineStartByIndex(lines, lineIndex) {
    let offset = 0;
    for (let i = 0; i < lineIndex; i += 1) {
        offset += (lines[i] || '').length + 1;
    }
    return offset;
}

function moveSublistEntryToNeighbor(list, card, direction, options = {}) {
    const context = resolveSublistsContext();
    if (!context.ownerBoard || !Array.isArray(context.ownerBoard.sublists)) {
        return false;
    }
    const lists = context.ownerBoard.sublists;
    const currentIndex = lists.findIndex((item) => item?.id === list?.id);
    if (currentIndex < 0) {
        return false;
    }
    const offset = direction === 'left' ? -1 : (direction === 'right' ? 1 : 0);
    if (!offset) {
        return false;
    }
    const targetIndex = currentIndex + offset;
    const targetList = lists[targetIndex];
    if (!targetList) {
        return false;
    }
    const sourceLines = ensureListLines(list).slice();
    const targetLines = ensureListLines(targetList).slice();
    const rowIndex = Number.isFinite(options.rowIndex) ? utils.clamp(options.rowIndex, 0, Math.max(sourceLines.length - 1, 0)) : 0;
    const value = sourceLines[rowIndex] ?? '';
    const nextSource = sourceLines.slice();
    if (nextSource.length > 1) {
        nextSource.splice(rowIndex, 1);
    } else {
        nextSource[0] = '';
    }
    const insertIndex = utils.clamp(rowIndex, 0, targetLines.length);
    if (targetLines.length === 1 && targetLines[0] === '') {
        targetLines[0] = value;
    } else if (targetLines[insertIndex] === '') {
        targetLines[insertIndex] = value;
    } else {
        targetLines.splice(insertIndex, 0, value);
    }
    const history = env.history;
    if (history && typeof history.record === 'function') {
        history.record('sublists-before-move-entry');
    }
    commitListLines(list, nextSource);
    commitListLines(targetList, targetLines);
    if (history && typeof history.record === 'function') {
        history.record('sublists-move-entry');
    }
    markSublistsStructureHistoryAction('move-entry');
    const columns = dom.sublistsColumns;
    const sourceCard = card || columns?.querySelector?.(`.sublist-card[data-id="${list.id}"]`);
    const targetCard = columns?.querySelector?.(`.sublist-card[data-id="${targetList.id}"]`);
    const sourceEditor = sourceCard?.querySelector?.('.sublist-editor');
    const targetEditor = targetCard?.querySelector?.('.sublist-editor');
    const fallbackFocusIndex = utils.clamp(rowIndex, 0, Math.max(nextSource.length - 1, 0));
    if (sourceEditor?.classList?.contains('sublist-editor--rows') && sourceCard) {
        rebuildWrappedEditorRows(list, sourceEditor, sourceCard, { focusIndex: fallbackFocusIndex });
    } else if (sourceEditor) {
        sourceEditor.value = nextSource.join('\n');
        autoSizeEditor(sourceEditor);
        updateEditorSurface(sourceEditor, sourceEditor.value || '');
        updateActiveLine(sourceEditor);
    }
    if (targetEditor?.classList?.contains('sublist-editor--rows') && targetCard) {
        const focusPos = Number.isFinite(options.focusPos) ? Math.max(options.focusPos, 0) : null;
        rebuildWrappedEditorRows(targetList, targetEditor, targetCard, { focusIndex: insertIndex, focusPos });
        return true;
    }
    if (targetEditor) {
        targetEditor.value = targetLines.join('\n');
        autoSizeEditor(targetEditor);
        updateEditorSurface(targetEditor, targetEditor.value || '');
        updateActiveLine(targetEditor);
        const focusPos = Number.isFinite(options.focusPos) ? Math.max(options.focusPos, 0) : 0;
        const lineStart = resolveLineStartByIndex(targetLines, insertIndex);
        const nextPos = utils.clamp(lineStart + focusPos, 0, targetEditor.value.length);
        targetEditor.setSelectionRange(nextPos, nextPos);
        try {
            targetEditor.focus({ preventScroll: false });
        } catch {
            targetEditor.focus();
        }
        return true;
    }
    return false;
}

function markSublistsStructureHistoryAction(type) {
    state.sublists = state.sublists || {};
    state.sublists.lastStructureHistoryTs = Date.now();
    state.sublists.lastStructureHistoryType = type || 'structure';
}

function shouldUseHistoryUndoForSublists() {
    const lastTs = Number(state.sublists?.lastStructureHistoryTs) || 0;
    if (!Number.isFinite(lastTs) || lastTs <= 0) {
        return false;
    }
    return (Date.now() - lastTs) <= 6000;
}

function updateActiveSublistEntry(editor, entry) {
    if (!editor) {
        return;
    }
    if (editor.classList.contains('sublist-editor--rows')) {
        const previous = editor.querySelector('.sublist-entry.is-active-row');
        if (previous && previous !== entry) {
            previous.classList.remove('is-active-row');
        }
        if (entry && entry.classList) {
            entry.classList.add('is-active-row');
        }
    }
    const rowIndex = Number(entry?.dataset?.rowIndex);
    const lineHeight = resolveEditorLineHeight(editor);
    if (!Number.isFinite(rowIndex) || rowIndex < 0 || !lineHeight) {
        editor.style.setProperty('--sublist-active-line-start', '0px');
        return;
    }
    editor.style.setProperty('--sublist-active-line-start', `${(rowIndex * lineHeight).toFixed(2)}px`);
}

function rebuildWrappedEditorRows(list, editor, card, options = {}) {
    if (!list || !editor) {
        return;
    }
    const rawLines = ensureListLines(list);
    const lines = rawLines.slice();

    const focusIndex = Number.isFinite(options.focusIndex) ? utils.clamp(options.focusIndex, 0, Math.max(lines.length - 1, 0)) : null;
    const focusPos = Number.isFinite(options.focusPos) ? Math.max(options.focusPos, 0) : null;

    editor.innerHTML = '';
    editor.classList.add('sublist-editor--rows');
    editor.setAttribute('data-mode', 'rows');

    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
        const entry = document.createElement('textarea');
        entry.classList.add('sublist-entry');
        entry.dataset.rowIndex = String(index);
        entry.setAttribute('rows', '1');
        entry.setAttribute('wrap', 'soft');
        entry.setAttribute('spellcheck', 'false');
        entry.value = typeof line === 'string' ? line : '';
        entry.addEventListener('pointerdown', (event) => {
            queueWrappedEntryDrag(list, entry, event);
        });
        entry.addEventListener('focus', () => {
            setEditorActive(editor);
            updateActiveSublistEntry(editor, entry);
        });
        entry.addEventListener('input', () => {
            clampSublistEntryToTwoLines(entry);
            const nextLines = ensureListLines(list).slice();
            nextLines[index] = entry.value || '';
            commitListLines(list, nextLines);
            if (state.sublists) {
                state.sublists.lastStructureHistoryTs = 0;
                state.sublists.lastStructureHistoryType = '';
            }
            updateEditorSurface(editor, nextLines.join('\n'));
            updateActiveSublistEntry(editor, entry);
        });
        entry.addEventListener('keydown', (event) => {
            const controlKey = event.ctrlKey || event.metaKey;
            const keyLower = typeof event.key === 'string' ? event.key.toLowerCase() : '';
            if (controlKey && keyLower === 'z' && !event.shiftKey) {
                if (shouldUseHistoryUndoForSublists() && env.history && typeof env.history.undo === 'function') {
                    event.preventDefault();
                    event.stopPropagation();
                    env.history.undo();
                    markSublistsStructureHistoryAction('undo');
                    return;
                }
            }
            if (controlKey && (keyLower === 'y' || (keyLower === 'z' && event.shiftKey))) {
                if (shouldUseHistoryUndoForSublists() && env.history && typeof env.history.redo === 'function') {
                    event.preventDefault();
                    event.stopPropagation();
                    env.history.redo();
                    markSublistsStructureHistoryAction('redo');
                    return;
                }
            }
            if (event.key === 'Escape') {
                const trimmed = (entry.value || '').trim();
                const current = ensureListLines(list).slice();
                const isLastEntry = index === current.length - 1;
                if (!trimmed && isLastEntry && current.length > 1) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (env.history && typeof env.history.record === 'function') {
                        env.history.record('sublists-before-escape-remove-empty');
                    }
                    try {
                        entry.blur();
                    } catch {}
                    current.pop();
                    commitListLines(list, current);
                    if (env.history && typeof env.history.record === 'function') {
                        env.history.record('sublists-escape-remove-empty');
                    }
                    markSublistsStructureHistoryAction('escape-remove-empty');
                    rebuildWrappedEditorRows(list, editor, card);
                    clearEditorActive(editor);
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                entry.blur();
                return;
            }
            if (event.shiftKey && !event.altKey && !controlKey) {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.stopPropagation();
                    const direction = event.key === 'ArrowUp' ? -1 : 1;
                    const current = ensureListLines(list).slice();
                    const nextIndex = index + direction;
                    if (direction === 1 && nextIndex >= current.length) {
                        if (env.history && typeof env.history.record === 'function') {
                            env.history.record('sublists-before-shift-arrow-add-entry');
                        }
                        current.push('');
                        commitListLines(list, current);
                        if (env.history && typeof env.history.record === 'function') {
                            env.history.record('sublists-shift-arrow-add-entry');
                        }
                        markSublistsStructureHistoryAction('shift-arrow-add-entry');
                        rebuildWrappedEditorRows(list, editor, card, { focusIndex: current.length - 1, focusPos: 0 });
                        return;
                    }
                    const entries = editor.querySelectorAll('.sublist-entry');
                    const neighbor = entries?.[nextIndex];
                    if (!neighbor) {
                        return;
                    }
                    try {
                        neighbor.focus({ preventScroll: false });
                    } catch {
                        neighbor.focus();
                    }
                    const endPos = (neighbor.value || '').length;
                    neighbor.setSelectionRange(endPos, endPos);
                    updateActiveSublistEntry(editor, neighbor);
                    return;
                }
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    event.stopPropagation();
                    const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
                    focusNeighborSublistCard(card, direction, { rowIndex: index, caretPos: Number.MAX_SAFE_INTEGER });
                    return;
                }
            }
            if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    const direction = event.key === 'ArrowUp' ? -1 : 1;
                    const nextIndex = index + direction;
                    const entries = editor.querySelectorAll('.sublist-entry');
                    const neighbor = entries?.[nextIndex];
                    if (neighbor && shouldNavigateBetweenSublistEntries(entry, direction === -1 ? 'up' : 'down')) {
                        event.preventDefault();
                        event.stopPropagation();
                        const caretPos = entry.selectionStart ?? 0;
                        try {
                            neighbor.focus({ preventScroll: false });
                        } catch {
                            neighbor.focus();
                        }
                        const nextPos = utils.clamp(caretPos, 0, (neighbor.value || '').length);
                        neighbor.setSelectionRange(nextPos, nextPos);
                        updateActiveSublistEntry(editor, neighbor);
                        return;
                    }
                }
                if (event.key === 'Delete') {
                    if ((entry.selectionStart ?? 0) !== (entry.selectionEnd ?? 0)) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    const current = ensureListLines(list).slice();
                    const caretPos = entry.selectionStart ?? 0;
                    if (env.history && typeof env.history.record === 'function') {
                        env.history.record('sublists-before-delete-entry');
                    }
                    if (current.length > 1) {
                        current.splice(index, 1);
                    } else {
                        current[0] = '';
                    }
                    commitListLines(list, current);
                    if (env.history && typeof env.history.record === 'function') {
                        env.history.record('sublists-delete-entry');
                    }
                    markSublistsStructureHistoryAction('delete-entry');
                    const focusIndex = utils.clamp(index, 0, Math.max(current.length - 1, 0));
                    rebuildWrappedEditorRows(list, editor, card, { focusIndex, focusPos: caretPos });
                    return;
                }
            }
            if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    event.stopPropagation();
                    const caretPos = entry.selectionStart ?? 0;
                    const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
                    const moved = moveSublistEntryToNeighbor(list, card, direction, { rowIndex: index, focusPos: caretPos });
                    if (moved) {
                        return;
                    }
                    const focused = focusNeighborSublistCard(card, direction, { rowIndex: index, caretPos });
                    if (focused) {
                        return;
                    }
                }
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.stopPropagation();
                    const direction = event.key === 'ArrowUp' ? -1 : 1;
                    const current = ensureListLines(list).slice();
                    const swapWith = index + direction;
                    if (swapWith >= 0 && swapWith < current.length) {
                        if (env.history && typeof env.history.record === 'function') {
                            env.history.record('sublists-before-reorder');
                        }
                        const tmp = current[index];
                        current[index] = current[swapWith];
                        current[swapWith] = tmp;
                        commitListLines(list, current);
                        if (env.history && typeof env.history.record === 'function') {
                            env.history.record('sublists-reorder');
                        }
                        markSublistsStructureHistoryAction('reorder');
                        rebuildWrappedEditorRows(list, editor, card, { focusIndex: swapWith });
                    }
                }
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                if (env.history && typeof env.history.record === 'function') {
                    env.history.record('sublists-before-insert-entry');
                }
                const current = ensureListLines(list).slice();
                const insertAt = index + 1;
                current.splice(insertAt, 0, '');
                commitListLines(list, current);
                if (env.history && typeof env.history.record === 'function') {
                    env.history.record('sublists-insert-entry');
                }
                markSublistsStructureHistoryAction('insert-entry');
                rebuildWrappedEditorRows(list, editor, card, { focusIndex: Math.min(insertAt, current.length - 1) });
                return;
            }
            if (event.key === 'Backspace') {
                if ((entry.selectionStart ?? 0) === 0 && (entry.selectionEnd ?? 0) === 0 && (entry.value || '') === '') {
                    const current = ensureListLines(list).slice();
                    if (current.length > 1) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (env.history && typeof env.history.record === 'function') {
                            env.history.record('sublists-before-backspace-delete-entry');
                        }
                        current.splice(index, 1);
                        commitListLines(list, current);
                        if (env.history && typeof env.history.record === 'function') {
                            env.history.record('sublists-backspace-delete-entry');
                        }
                        markSublistsStructureHistoryAction('backspace-delete-entry');
                        rebuildWrappedEditorRows(list, editor, card, { focusIndex: Math.max(index - 1, 0) });
                    }
                }
            }
        });
        entry.addEventListener('paste', (event) => {
            const clipboardText = event.clipboardData?.getData('text');
            if (!clipboardText || !/[\r\n]/.test(clipboardText)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const parts = clipboardText.split(/\r\n|\r|\n/);
            const before = (entry.value || '').slice(0, entry.selectionStart ?? 0);
            const after = (entry.value || '').slice(entry.selectionEnd ?? 0);
            const current = ensureListLines(list).slice();
            const insert = parts.map((part) => part.replace(/[\r\n]+/g, ' '));
            const first = `${before}${insert[0] ?? ''}`;
            const tail = `${insert[insert.length - 1] ?? ''}${after}`;
            const middle = insert.slice(1, Math.max(insert.length - 1, 1));
            const replacement = insert.length === 1 ? [first + after] : [first, ...middle, tail];
            current.splice(index, 1, ...replacement);
            commitListLines(list, current);
            rebuildWrappedEditorRows(list, editor, card, { focusIndex: utils.clamp(index + replacement.length - 1, 0, current.length - 1) });
        });
        fragment.appendChild(entry);
    });
    editor.appendChild(fragment);

    updateEditorSurface(editor, lines.join('\n'));
    if (editor.isConnected) {
        scheduleWrappedEditorsReflow();
    }

    autoSizeEditor(editor);

    if (focusIndex !== null) {
        const entries = editor.querySelectorAll('.sublist-entry');
        const entry = entries[focusIndex];
        if (entry) {
            entry.focus({ preventScroll: true });
            if (Number.isFinite(focusPos)) {
                const pos = utils.clamp(focusPos, 0, entry.value.length);
                entry.setSelectionRange(pos, pos);
            }
        }
    }
}

function buildWrappedEditor(list, card) {
    const editor = document.createElement('div');
    editor.classList.add('sublist-editor', 'sublist-editor--rows');
    editor.addEventListener('pointerdown', (event) => {
        if (!event || event.button !== 0) {
            return;
        }
        const target = event.target;
        if (target?.classList?.contains('sublist-entry')) {
            return;
        }
        const entries = editor.querySelectorAll('.sublist-entry');
        if (!entries || entries.length === 0) {
            return;
        }
        const lastEntry = entries[entries.length - 1];
        const lastEntryRect = lastEntry?.getBoundingClientRect?.();
        if (lastEntry && Number.isFinite(lastEntryRect?.bottom) && event.clientY >= (lastEntryRect.bottom - 1)) {
            const entry = resolveLastMeaningfulEntry(entries);
            if (!entry) {
                return;
            }
            entry.focus({ preventScroll: true });
            const end = entry.value.length;
            entry.setSelectionRange(end, end);
            updateActiveSublistEntry(editor, entry);
            return;
        }
        const rect = editor.getBoundingClientRect();
        const rowHeight = resolveEditorLineHeight(editor) || resolveSublistEntryRowHeight(entries[0]) || 0;
        const relativeY = (event.clientY - rect.top) + (editor.scrollTop || 0);
        const rawIndex = Number.isFinite(rowHeight) && rowHeight > 0
            ? Math.floor(relativeY / rowHeight)
            : (entries.length - 1);
        const index = utils.clamp(rawIndex, 0, entries.length - 1);
        const entry = Number.isFinite(rawIndex) && rawIndex >= entries.length
            ? resolveLastMeaningfulEntry(entries)
            : entries[index];
        if (!entry) {
            return;
        }
        entry.focus({ preventScroll: true });
        const end = entry.value.length;
        entry.setSelectionRange(end, end);
        updateActiveSublistEntry(editor, entry);
    });
    editor.addEventListener('focusin', (event) => {
        const target = event.target;
        if (target?.classList?.contains('sublist-entry')) {
            setEditorActive(editor);
            updateActiveSublistEntry(editor, target);
        }
    });
    editor.addEventListener('focusout', () => {
        if (typeof document === 'undefined') {
            return;
        }
        if (!editor.contains(document.activeElement)) {
            clearEditorActive(editor);
        }
    });
    rebuildWrappedEditorRows(list, editor, card);
    return editor;
}

function resolveCardForClientX(columns, clientX) {
    if (!columns || !Number.isFinite(clientX)) {
        return null;
    }
    const cards = columns.querySelectorAll('.sublist-card');
    if (!cards || cards.length === 0) {
        return null;
    }
    let bestCard = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card) => {
        if (!card) {
            return;
        }
        const rect = card.getBoundingClientRect();
        if (!Number.isFinite(rect?.width) || rect.width <= 0) {
            return;
        }
        if (clientX >= rect.left && clientX <= rect.right) {
            bestCard = card;
            bestDistance = -1;
            return;
        }
        if (bestDistance === -1) {
            return;
        }
        const mid = rect.left + (rect.width / 2);
        const distance = Math.abs(clientX - mid);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestCard = card;
        }
    });

    return bestCard;
}

function focusCardLastEntry(card) {
    const editor = card?.querySelector?.('.sublist-editor.sublist-editor--rows');
    if (!editor) {
        return;
    }
    const entries = editor.querySelectorAll('.sublist-entry');
    if (!entries || entries.length === 0) {
        return;
    }
    const entry = entries[entries.length - 1];
    if (!entry) {
        return;
    }
    try {
        entry.focus({ preventScroll: true });
    } catch {
        entry.focus();
    }
    const end = entry.value.length;
    entry.setSelectionRange(end, end);
    updateActiveSublistEntry(editor, entry);
}

function handleWrappedCardPointerDown(event) {
    if (!isWordWrapEnabled() || !event || event.button !== 0) {
        return;
    }
    const target = event.target;
    if (!target?.closest) {
        return;
    }
    if (target.closest('.sublist-entry') || target.closest('.sublist-topbar') || target.closest('.sublist-title')) {
        return;
    }
    const card = target.closest('.sublist-card');
    if (!card) {
        return;
    }
    const editor = card.querySelector?.('.sublist-editor.sublist-editor--rows');
    if (editor) {
        const entries = editor.querySelectorAll('.sublist-entry');
        const lastEntry = entries?.[entries.length - 1];
        const lastEntryRect = lastEntry?.getBoundingClientRect?.();
        if (lastEntry && Number.isFinite(lastEntryRect?.bottom) && event.clientY >= (lastEntryRect.bottom - 1)) {
            focusCardLastEntry(card);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    }
    focusCardLastEntry(card);
}

function handleWrappedEditorBackgroundPointerDown(event) {
    if (!isWordWrapEnabled() || !event || event.button !== 0) {
        return;
    }
    const target = event.target;
    if (!target?.closest) {
        return;
    }
    if (target.closest('.sublist-entry') || target.closest('.sublist-topbar') || target.closest('.sublist-title')) {
        return;
    }
    if (target.closest('.sublist-editor')) {
        return;
    }
    const card = target.closest('.sublist-card');
    if (card) {
        focusCardLastEntry(card);
        return;
    }
    const columns = dom.sublistsColumns;
    const fallbackCard = resolveCardForClientX(columns, event.clientX);
    if (fallbackCard) {
        focusCardLastEntry(fallbackCard);
    }
}

function refreshWrappedEditors() {
    const context = resolveSublistsContext();
    const columns = dom.sublistsColumns;
    if (!context.ownerBoard || !columns) {
        return;
    }
    const lists = context.lists;
    lists.forEach((list) => {
        const card = columns.querySelector(`.sublist-card[data-id="${list.id}"]`);
        const editor = card?.querySelector('.sublist-editor.sublist-editor--rows');
        if (!editor) {
            return;
        }
        const entries = editor.querySelectorAll('.sublist-entry');
        const nextLines = [];
        let changed = false;
        entries.forEach((entry) => {
            if (clampSublistEntryToTwoLines(entry)) {
                changed = true;
            }
            nextLines.push(entry.value || '');
        });
        if (changed) {
            commitListLines(list, nextLines);
        }
        updateEditorSurface(editor, nextLines.join('\n'));
        const focused = editor.querySelector('.sublist-entry:focus');
        if (focused) {
            updateActiveSublistEntry(editor, focused);
        }
    });
}

function reflowWrappedEditors() {
    const columns = dom.sublistsColumns;
    if (!columns) {
        return;
    }
    const editors = columns.querySelectorAll('.sublist-editor.sublist-editor--rows');
    editors.forEach((editor) => {
        const entries = editor.querySelectorAll('.sublist-entry');
        entries.forEach((entry) => {
            updateSublistEntryLayout(entry);
        });
        const nextText = Array.from(entries, (entry) => entry.value || '').join('\n');
        updateEditorSurface(editor, nextText);
        const focused = editor.querySelector('.sublist-entry:focus');
        if (focused) {
            updateActiveSublistEntry(editor, focused);
        }
    });
}

function scheduleWrappedEditorsReflow() {
    if (!isWordWrapEnabled() || typeof requestAnimationFrame !== 'function') {
        return;
    }
    if (state.sublists && state.sublists.wrapReflowRaf) {
        return;
    }
    if (state.sublists) {
        state.sublists.wrapReflowRaf = requestAnimationFrame(() => {
            state.sublists.wrapReflowRaf = null;
            reflowWrappedEditors();
        });
    }
}

function scheduleWrappedEditorsSettleReflow() {
    if (!state.sublists?.isVisible || state.sublists.activeView !== 'lists' || !isWordWrapEnabled()) {
        return;
    }
    scheduleWrappedEditorsReflow();
    if (state.sublists.wrapReflowTimer) {
        clearTimeout(state.sublists.wrapReflowTimer);
    }
    state.sublists.wrapReflowTimer = setTimeout(() => {
        state.sublists.wrapReflowTimer = null;
        scheduleWrappedEditorsReflow();
    }, SUBLIST_WRAP_REFLOW_SETTLE_MS);
}

function closeActiveMenu() {
    const menu = state.sublists.activeMenuEl;
    if (menu) {
        menu.classList.remove('is-open');
        menu.hidden = true;
    }
    state.sublists.activeMenuEl = null;
}

function createLocalSublistsForActiveBoard() {
    const activeBoard = getActiveBoard();
    if (!activeBoard || activeBoard.id === 'root') {
        return;
    }
    const context = resolveSublistsContext(activeBoard);
    const snapshot = cloneSublists(context.lists);
    activeBoard.sublists = snapshot;
    activeBoard.useLocalSublists = true;
    activeBoard.updatedAt = new Date().toISOString();
    if (data.queueSave) {
        data.queueSave('sublists-edit');
    }
    renderSublists(activeBoard);
}

function returnToGlobalSublistsForActiveBoard() {
    const activeBoard = getActiveBoard();
    if (!activeBoard || activeBoard.id === 'root' || activeBoard.useLocalSublists !== true) {
        return;
    }
    activeBoard.useLocalSublists = false;
    activeBoard.updatedAt = new Date().toISOString();
    if (data.queueSave) {
        data.queueSave('sublists-edit');
    }
    renderSublists(activeBoard);
}

function buildSidebarMenu() {
    if (!dom.sublistsPanel) {
        return;
    }
    if (state.sublists.sidebarMenu?.menu) {
        return;
    }
    const menu = document.createElement('div');
    menu.classList.add('sublists-sidebar-menu');
    menu.hidden = true;

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.classList.add('sublists-sidebar-menu-item');
    addButton.textContent = 'Add list to right';
    addButton.addEventListener('click', () => {
        closeActiveMenu();
        addSublist();
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.classList.add('sublists-sidebar-menu-item', 'danger');
    deleteButton.textContent = 'Delete rightmost list';
    deleteButton.addEventListener('click', () => {
        closeActiveMenu();
        deleteRightmostSublist();
    });

    const localButton = document.createElement('button');
    localButton.type = 'button';
    localButton.classList.add('sublists-sidebar-menu-item');
    localButton.textContent = 'Create local sublists';
    localButton.addEventListener('click', () => {
        closeActiveMenu();
        createLocalSublistsForActiveBoard();
    });

    const globalButton = document.createElement('button');
    globalButton.type = 'button';
    globalButton.classList.add('sublists-sidebar-menu-item');
    globalButton.textContent = 'Return to global sublists';
    globalButton.addEventListener('click', () => {
        closeActiveMenu();
        returnToGlobalSublistsForActiveBoard();
    });

    menu.appendChild(addButton);
    menu.appendChild(deleteButton);
    menu.appendChild(localButton);
    menu.appendChild(globalButton);
    dom.sublistsPanel.appendChild(menu);
    state.sublists.sidebarMenu = {
        menu,
        addButton,
        deleteButton,
        localButton,
        globalButton
    };
}

function openSidebarMenu(event) {
    if (!state.sublists.sidebarMenu?.menu) {
        buildSidebarMenu();
    }
    const menu = state.sublists.sidebarMenu?.menu;
    if (!menu) {
        return;
    }
    const context = resolveSublistsContext();
    const count = context.lists.length;
    if (state.sublists.sidebarMenu?.deleteButton) {
        state.sublists.sidebarMenu.deleteButton.disabled = count <= 1;
    }
    const canToggleLocal = !!context.activeBoard && context.activeBoard.id !== 'root';
    if (state.sublists.sidebarMenu?.localButton) {
        state.sublists.sidebarMenu.localButton.hidden = !canToggleLocal || context.isLocal;
        state.sublists.sidebarMenu.localButton.disabled = !canToggleLocal || context.isLocal;
    }
    if (state.sublists.sidebarMenu?.globalButton) {
        state.sublists.sidebarMenu.globalButton.hidden = !canToggleLocal || !context.isLocal;
        state.sublists.sidebarMenu.globalButton.disabled = !canToggleLocal || !context.isLocal;
    }
    closeActiveMenu();
    menu.style.left = `${Math.round(event.clientX)}px`;
    menu.style.top = `${Math.round(event.clientY)}px`;
    menu.hidden = false;
    menu.classList.add('is-open');
    state.sublists.activeMenuEl = menu;
}

function clampLineLengths(text, selectionStart, selectionEnd, limit) {
    const lines = text.split('\n');
    const lineLengths = lines.map((line) => line.length);
    const trimmed = lines.map((line) => (line.length > limit ? line.slice(0, limit) : line));
    const trimmedLengths = trimmed.map((line) => line.length);
    const modified = trimmed.some((line, index) => line.length !== lineLengths[index]);
    if (!modified) {
        return {
            text,
            selectionStart,
            selectionEnd,
            modified: false
        };
    }
    const mapIndex = (index) => {
        let oldPos = 0;
        let newPos = 0;
        for (let i = 0; i < lines.length; i += 1) {
            const lineLen = lineLengths[i];
            const trimmedLen = trimmedLengths[i];
            const lineEnd = oldPos + lineLen;
            if (index <= lineEnd) {
                const offset = Math.max(index - oldPos, 0);
                return newPos + Math.min(offset, trimmedLen);
            }
            oldPos = lineEnd + 1;
            newPos = newPos + trimmedLen + 1;
        }
        return newPos;
    };
    const nextText = trimmed.join('\n');
    const nextStart = utils.clamp(mapIndex(selectionStart), 0, nextText.length);
    const nextEnd = utils.clamp(mapIndex(selectionEnd), 0, nextText.length);
    return {
        text: nextText,
        selectionStart: nextStart,
        selectionEnd: nextEnd,
        modified: true
    };
}

function commitListText(list, text) {
    if (!list) {
        return;
    }
    const normalized = typeof text === 'string' ? text : '';
    list.lines = normalized.split('\n');
    list.updatedAt = new Date().toISOString();
    touchSublistsOwnerUpdatedAt(list.updatedAt);
    if (data.queueSave) {
        data.queueSave('sublists-edit');
    }
}

function updateListFromEditor(list, editor, card) {
    if (!list || !editor) {
        return;
    }
    const wrapEnabled = isWordWrapEnabled();
    if (!wrapEnabled) {
        const limit = resolveLineLimit(card);
        let limited = clampLineLengths(editor.value || '', editor.selectionStart || 0, editor.selectionEnd || 0, limit);
        const maxLines = resolveMaxVisibleLines(editor);
        if (Number.isFinite(maxLines)) {
            const lineLimited = clampLineCount(limited.text, limited.selectionStart, limited.selectionEnd, maxLines);
            if (lineLimited.modified) {
                limited = { ...lineLimited, modified: true };
            }
        }
        if (limited.modified) {
            editor.value = limited.text;
            editor.setSelectionRange(limited.selectionStart, limited.selectionEnd);
        }
    }
    commitListText(list, editor.value || '');
    autoSizeEditor(editor);
    updateEditorSurface(editor, editor.value || '');
    updateActiveLine(editor);
}

function getLineStart(text, index) {
    const safeIndex = Math.max(index, 0);
    const start = text.lastIndexOf('\n', Math.max(safeIndex - 1, 0));
    return start === -1 ? 0 : start + 1;
}

function getLineEnd(text, index) {
    const safeIndex = Math.max(index, 0);
    const end = text.indexOf('\n', safeIndex);
    return end === -1 ? text.length : end;
}

function writeToClipboard(text) {
    if (!text) {
        return;
    }
    if (clipboard && typeof clipboard.writeText === 'function') {
        clipboard.writeText(text);
        return;
    }
    const nav = window.navigator;
    if (nav?.clipboard?.writeText) {
        nav.clipboard.writeText(text).catch(() => {});
        return;
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    try {
        document.execCommand('copy');
    } finally {
        document.body.removeChild(helper);
    }
}

function cutLines(editor) {
    const text = editor.value || '';
    if (!text) {
        return false;
    }
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? 0;
    let rangeStart = getLineStart(text, Math.min(start, end));
    const rangeEndBase = getLineEnd(text, Math.max(end - 1, start));
    let rangeEnd = rangeEndBase;
    if (rangeEnd < text.length && text[rangeEnd] === '\n') {
        rangeEnd += 1;
    }
    if (rangeEnd >= text.length && rangeStart > 0 && text[rangeStart - 1] === '\n') {
        rangeStart -= 1;
    }
    const removed = text.slice(rangeStart, rangeEnd);
    if (!removed) {
        return false;
    }
    writeToClipboard(removed);
    const nextText = `${text.slice(0, rangeStart)}${text.slice(rangeEnd)}`;
    editor.value = nextText;
    const caret = utils.clamp(rangeStart, 0, nextText.length);
    editor.setSelectionRange(caret, caret);
    return true;
}

function resolveLineIndex(lineStarts, lineLengths, index) {
    for (let i = 0; i < lineStarts.length; i += 1) {
        const start = lineStarts[i];
        const end = start + lineLengths[i];
        if (index <= end) {
            return i;
        }
    }
    return lineStarts.length - 1;
}

function moveLines(editor, direction) {
    const text = editor.value || '';
    const lines = text.split('\n');
    if (lines.length <= 1) {
        return false;
    }
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? 0;
    const lineStarts = [];
    const lineLengths = lines.map((line) => line.length);
    let offset = 0;
    for (let i = 0; i < lines.length; i += 1) {
        lineStarts.push(offset);
        offset += lineLengths[i] + 1;
    }
    const startLine = resolveLineIndex(lineStarts, lineLengths, Math.min(start, end));
    const endLine = resolveLineIndex(lineStarts, lineLengths, Math.max(end - 1, start));
    if (direction === 'up' && startLine === 0) {
        return false;
    }
    if (direction === 'down' && endLine === lines.length - 1) {
        return false;
    }
    const block = lines.slice(startLine, endLine + 1);
    lines.splice(startLine, endLine - startLine + 1);
    const insertAt = direction === 'up' ? startLine - 1 : startLine + 1;
    lines.splice(insertAt, 0, ...block);
    const nextText = lines.join('\n');
    const blockStart = lineStarts[startLine];
    const blockEnd = blockStart + block.join('\n').length;
    const offsetStart = Math.max(start - blockStart, 0);
    const offsetEnd = Math.max(Math.min(end, blockEnd) - blockStart, 0);
    const nextLineStarts = [];
    let nextOffset = 0;
    for (let i = 0; i < lines.length; i += 1) {
        nextLineStarts.push(nextOffset);
        nextOffset += lines[i].length + 1;
    }
    const nextBlockStart = nextLineStarts[insertAt];
    const nextSelectionStart = utils.clamp(nextBlockStart + offsetStart, 0, nextText.length);
    const nextSelectionEnd = utils.clamp(nextBlockStart + offsetEnd, 0, nextText.length);
    editor.value = nextText;
    editor.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    return true;
}

function handleEditorKeydown(event, list, editor) {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        editor.blur();
        return;
    }
    if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const card = editor.closest('.sublist-card');
            const text = editor.value || '';
            const lines = text.split('\n');
            const start = editor.selectionStart ?? 0;
            const end = editor.selectionEnd ?? 0;
            const lineStarts = [];
            let offset = 0;
            for (let i = 0; i < lines.length; i += 1) {
                lineStarts.push(offset);
                offset += lines[i].length + 1;
            }
            const lineIndex = resolveLineIndex(lineStarts, lines.map((line) => line.length), Math.min(start, end));
            const lineStart = lineStarts[lineIndex] ?? 0;
            const focusPos = Math.max((editor.selectionStart ?? 0) - lineStart, 0);
            const moved = moveSublistEntryToNeighbor(list, card, event.key === 'ArrowLeft' ? 'left' : 'right', { rowIndex: lineIndex, focusPos });
            if (moved) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            const moved = moveLines(editor, event.key === 'ArrowUp' ? 'up' : 'down');
            if (moved) {
                event.preventDefault();
                event.stopPropagation();
                commitListText(list, editor.value || '');
                autoSizeEditor(editor);
                updateEditorSurface(editor, editor.value || '');
                updateActiveLine(editor);
            }
        }
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        const cut = cutLines(editor);
        if (cut) {
            event.preventDefault();
            event.stopPropagation();
            commitListText(list, editor.value || '');
            autoSizeEditor(editor);
            updateEditorSurface(editor, editor.value || '');
            updateActiveLine(editor);
        }
    }
}

function commitListTitle(list, titleEl, tabLabel) {
    if (!list || !titleEl) {
        return;
    }
    const raw = titleEl.textContent || '';
    const cleaned = raw.trim() || 'List';
    titleEl.textContent = cleaned;
    if (tabLabel) {
        tabLabel.textContent = cleaned;
    }
    if (list.title !== cleaned) {
        list.title = cleaned;
        list.updatedAt = new Date().toISOString();
        touchSublistsOwnerUpdatedAt(list.updatedAt);
        if (data.queueSave) {
            data.queueSave('sublists-edit');
        }
    }
}

function beginPanelResize(event) {
    const divider = dom.sublistsDivider;
    const panel = dom.sublistsPanel;
    if (!divider || !panel || !state.sublists.isVisible) {
        return;
    }
    const panelRect = panel.getBoundingClientRect();
    const startWidth = Number.isFinite(panelRect?.width) && panelRect.width > 0
        ? panelRect.width
        : (state.sublists.panelWidth || SUBLIST_PANEL_DEFAULT_WIDTH);
    state.sublists.panelResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: utils.clamp(startWidth, SUBLIST_PANEL_MIN_WIDTH, SUBLIST_PANEL_MAX_WIDTH)
    };
    divider.classList.add('is-dragging');
    panel.classList.add('is-resizing');
    try {
        divider.setPointerCapture(event.pointerId);
    } catch {}
}

function handlePanelResizeMove(event) {
    const resizeState = state.sublists.panelResizeState;
    if (!resizeState || event.pointerId !== resizeState.pointerId) {
        return;
    }
    const delta = event.clientX - resizeState.startX;
    const nextWidth = utils.clamp(resizeState.startWidth + delta, SUBLIST_PANEL_MIN_WIDTH, SUBLIST_PANEL_MAX_WIDTH);
    applyPanelWidth(nextWidth);
    scheduleWrappedEditorsReflow();
}

function handlePanelResizeEnd(event) {
    const resizeState = state.sublists.panelResizeState;
    if (!resizeState || (event && event.pointerId !== resizeState.pointerId)) {
        return;
    }
    const divider = dom.sublistsDivider;
    if (divider) {
        divider.classList.remove('is-dragging');
        try {
            divider.releasePointerCapture(resizeState.pointerId);
        } catch {}
    }
    const panel = dom.sublistsPanel;
    if (panel) {
        panel.classList.remove('is-resizing');
    }
    if (Number.isFinite(state.sublists.panelWidth)) {
        persistPanelWidth(state.sublists.panelWidth);
    }
    if (isWordWrapEnabled()) {
        refreshWrappedEditors();
    }
    const context = resolveSublistsContext();
    if (context.ownerBoard) {
        context.ownerBoard.updatedAt = new Date().toISOString();
        if (data.queueSave) {
            data.queueSave('sublists-edit');
        }
    }
    state.sublists.panelResizeState = null;
}

function deleteRightmostSublist() {
    const context = resolveSublistsContext();
    const board = context.ownerBoard;
    if (!board || !Array.isArray(board.sublists)) {
        return;
    }
    if (board.sublists.length <= 1) {
        return;
    }
    closeActiveMenu();
    board.sublists.pop();
    board.updatedAt = new Date().toISOString();
    if (data.queueSave) {
        data.queueSave('sublists-edit');
    }
    renderSublists(context.activeBoard || board);
}

function buildSublistCard(list) {
    const card = document.createElement('div');
    card.classList.add('sublist-card');
    card.dataset.id = list.id;

    const body = document.createElement('div');
    body.classList.add('sublist-body');

    const topbar = document.createElement('div');
    topbar.classList.add('sublist-topbar');

    const title = document.createElement('div');
    title.classList.add('sublist-title');
    title.textContent = list.title || 'List';
    title.setAttribute('contenteditable', 'true');
    title.setAttribute('spellcheck', 'false');
    title.setAttribute('role', 'textbox');
    title.addEventListener('focus', () => {
        title.dataset.originalTitle = list.title || '';
    });
    title.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            title.blur();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            title.textContent = title.dataset.originalTitle || list.title || 'List';
            title.blur();
        }
    });
    title.addEventListener('blur', () => commitListTitle(list, title, null));

    const wrapEnabled = isWordWrapEnabled();
    const editor = wrapEnabled ? buildWrappedEditor(list, card) : document.createElement('textarea');
    if (!wrapEnabled) {
        editor.classList.add('sublist-editor');
        editor.setAttribute('wrap', 'off');
        editor.setAttribute('spellcheck', 'false');
        editor.value = Array.isArray(list.lines) ? list.lines.join('\n') : '';
        editor.addEventListener('pointerdown', (event) => queuePlainEditorLineDrag(list, editor, event));
        editor.addEventListener('input', () => updateListFromEditor(list, editor, card));
        editor.addEventListener('keydown', (event) => handleEditorKeydown(event, list, editor));
        editor.addEventListener('focus', () => {
            setEditorActive(editor);
            updateEditorSurface(editor, editor.value || '');
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => updateActiveLine(editor));
            } else {
                updateActiveLine(editor);
            }
        });
        editor.addEventListener('blur', () => clearEditorActive(editor));
        editor.addEventListener('mouseup', () => updateActiveLine(editor));
        editor.addEventListener('keyup', () => updateActiveLine(editor));
    } else {
        card.addEventListener('pointerdown', handleWrappedCardPointerDown, { capture: true });
        card.addEventListener('mousedown', handleWrappedCardPointerDown, { capture: true });
    }

    topbar.appendChild(title);
    body.appendChild(topbar);
    body.appendChild(editor);
    card.appendChild(body);

    autoSizeEditor(editor);
    updateEditorSurface(editor, editor.value || '');
    return card;
}

function renderSublists(board) {
    const columns = dom.sublistsColumns;
    const context = resolveSublistsContext(board);
    if (!columns || !context.activeBoard || !context.ownerBoard) {
        updatePanelVisibility();
        return;
    }
    clearDropIndicator();
    clearEntryDragState();
    closeActiveMenu();
    const lists = context.lists;
    state.sublists.lastListCount = lists.length;
    columns.innerHTML = '';
    columns.classList.remove('is-editing');
    lists.forEach((list) => {
        const card = buildSublistCard(list);
        columns.appendChild(card);
    });
    lists.forEach((list) => {
        const card = columns.querySelector(`.sublist-card[data-id="${list.id}"]`);
        const editor = card?.querySelector('.sublist-editor');
        if (!editor) {
            return;
        }
        const isRows = editor.classList.contains('sublist-editor--rows');
        if (!isRows) {
            autoSizeEditor(editor);
            updateEditorSurface(editor, editor.value || '');
            return;
        }
        autoSizeEditor(editor);
        updateEditorSurface(editor, ensureListLines(list).join('\n'));
    });
    scheduleWrappedEditorsSettleReflow();
    try {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(() => scheduleWrappedEditorsSettleReflow()).catch(() => {});
        }
    } catch {}
    updatePanelVisibility();
}

function addSublist() {
    const context = resolveSublistsContext();
    const board = context.ownerBoard;
    if (!board) {
        return;
    }
    ensureBoardSublists(board);
    const list = data.createDefaultSublist ? data.createDefaultSublist() : { id: utils.createId('sublist'), title: 'List', lines: [''], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    board.sublists.push(list);
    board.updatedAt = list.updatedAt;
    if (data.queueSave) {
        data.queueSave('sublists-edit');
    }
    renderSublists(context.activeBoard || board);
    const editor = dom.sublistsColumns?.querySelector(`.sublist-card[data-id="${list.id}"] .sublist-editor`);
    if (editor) {
        if (editor.classList.contains('sublist-editor--rows')) {
            const entry = editor.querySelector('.sublist-entry');
            if (entry) {
                entry.focus({ preventScroll: true });
            }
            return;
        }
        editor.focus({ preventScroll: true });
    }
}

function initialize() {
    if (!dom.sublistsPanel) {
        return;
    }
    const listsButton = dom.sublistsPanel.querySelector('.sublists-nav-button[data-sublists-view="lists"]');
    if (listsButton) {
        listsButton.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openSidebarMenu(event);
        });
    }
    if (dom.sublistsDivider) {
        dom.sublistsDivider.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            beginPanelResize(event);
        });
    }
    if (dom.sublistsPanel) {
        dom.sublistsPanel.addEventListener('transitionend', (event) => {
            if (event.propertyName !== 'width') {
                return;
            }
            scheduleWrappedEditorsSettleReflow();
        });
    }
    if (dom.sublistsScroll && !state.sublists.wrapBackgroundHandlerAttached) {
        dom.sublistsScroll.addEventListener('pointerdown', handleWrappedEditorBackgroundPointerDown);
        state.sublists.wrapBackgroundHandlerAttached = true;
    }
    buildSidebarMenu();
    document.addEventListener('pointerdown', (event) => {
        const target = event.target;
        if (!state.sublists.activeMenuEl) {
            return;
        }
        if (state.sublists.activeMenuEl.contains(target)) {
            return;
        }
        if (target?.closest?.('.sublists-nav-button')) {
            return;
        }
        closeActiveMenu();
    });
    window.addEventListener('pointermove', (event) => {
        handlePanelResizeMove(event);
        handleEntryDragMove(event);
    });
    window.addEventListener('pointerup', (event) => {
        handlePanelResizeEnd(event);
        handleEntryDragEnd(event);
    });
    window.addEventListener('pointercancel', (event) => {
        handlePanelResizeEnd(event);
        handleEntryDragEnd(event);
    });
    window.addEventListener('resize', () => {
        scheduleWrappedEditorsReflow();
        if (isWordWrapEnabled()) {
            refreshWrappedEditors();
        }
    }, { passive: true });
    const storedWidth = readStoredPanelWidth();
    const baseWidth = Number.isFinite(storedWidth)
        ? storedWidth
        : (dom.sublistsPanel.getBoundingClientRect().width || SUBLIST_PANEL_DEFAULT_WIDTH);
    applyPanelWidth(baseWidth);
    syncWorkspacePanels();
    updatePanelVisibility();
}

function syncForBoard(board, options = {}) {
    if (!board) {
        updatePanelVisibility();
        return;
    }
    const context = resolveSublistsContext(board);
    const ownerBoard = context.ownerBoard;
    const ownerBoardId = ownerBoard?.id || '';
    const refChanged = state.sublists.activeBoardRef !== ownerBoard;
    const idChanged = state.sublists.activeBoardId !== ownerBoardId;
    const modeChanged = state.sublists.activeContextBoardId !== board.id || state.sublists.activeContextIsLocal !== context.isLocal;
    const needsRender = options.force || idChanged || refChanged;
    state.sublists.activeBoardId = ownerBoardId;
    state.sublists.activeBoardRef = ownerBoard;
    state.sublists.activeContextBoardId = board.id;
    state.sublists.activeContextIsLocal = context.isLocal;
    if (modeChanged) {
        closeActiveMenu();
    }
    if (needsRender) {
        renderSublists(board);
        return;
    }
    updatePanelVisibility();
}

function applySettings() {
    const root = document.documentElement;
    const wrapEnabled = isWordWrapEnabled();
    if (root) {
        root.classList.toggle('workboard-sublists-wrap', wrapEnabled);
    }
    if (state.sublists) {
        const previous = state.sublists.wrapEnabled;
        state.sublists.wrapEnabled = wrapEnabled;
        if (previous !== undefined && previous !== wrapEnabled) {
            const board = getActiveBoard();
            if (board) {
                renderSublists(board);
            }
            return;
        }
    }
    const columns = dom.sublistsColumns;
    if (!columns) {
        return;
    }
    const editors = columns.querySelectorAll('.sublist-editor');
    editors.forEach((editor) => {
        if (editor.classList.contains('sublist-editor--rows')) {
            return;
        }
        editor.setAttribute('wrap', wrapEnabled ? 'soft' : 'off');
        updateEditorSurface(editor, editor.value || '');
        updateActiveLine(editor);
    });
    if (wrapEnabled) {
        refreshWrappedEditors();
    }
}

function refreshVisibleLayout() {
    if (!state.sublists?.isVisible || state.sublists.activeView !== 'lists') {
        return;
    }
    scheduleWrappedEditorsSettleReflow();
}

env.sublists = env.sublists || {};
env.sublists.initialize = initialize;
env.sublists.render = renderSublists;
env.sublists.syncForBoard = syncForBoard;
env.sublists.toggleVisibility = toggleVisibility;
env.sublists.setVisibility = setVisibility;
env.sublists.addSublist = addSublist;
env.sublists.addEntryToList = addEntryToList;
env.sublists.blurActiveEditor = blurActiveEditor;
env.sublists.applySettings = applySettings;
env.sublists.refreshVisibleLayout = refreshVisibleLayout;
env.sublists.resolveBlockDropTarget = resolveBlockDropTarget;
env.sublists.dropBlocksIntoList = dropBlocksIntoList;
env.sublists.clearDropTargetIndicator = clearDropTargetIndicator;

initialize();

module.exports = env.sublists;
