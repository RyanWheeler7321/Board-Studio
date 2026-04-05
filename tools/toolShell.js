'use strict';

const env = require('../core/state');

const { dom, state } = env;
const TOOL_SHELL_VIEW_STORAGE_KEY = 'workboard.sublists.activeView';

const TOOL_DEFINITIONS = {
    'tool-2d': {
        id: 'tool-2d',
        title: '2D Art',
        subtitle: 'Project library for 2D assets and artwork. Open a project here, then do authoring inside Paint Studio.',
        status: 'active'
    }
};

function normalizeView(view) {
    if (view === 'lists') {
        return 'lists';
    }
    return TOOL_DEFINITIONS[view] ? view : 'tool-2d';
}

function readStoredActiveView() {
    try {
        return normalizeView(window.localStorage.getItem(TOOL_SHELL_VIEW_STORAGE_KEY));
    } catch {
        return normalizeView(state.sublists?.activeView);
    }
}

function persistActiveView(view) {
    try {
        window.localStorage.setItem(TOOL_SHELL_VIEW_STORAGE_KEY, normalizeView(view));
    } catch {}
}

function renderPlaceholder(definition) {
    const root = dom.toolShellView;
    if (!root || !definition) {
        return;
    }
    root.dataset.toolView = definition.id;
    root.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'tool-shell tool-shell--placeholder';
    const card = document.createElement('section');
    card.className = 'tool-placeholder-card';
    const title = document.createElement('h2');
    title.className = 'tool-placeholder-title';
    title.textContent = definition.title;
    const body = document.createElement('p');
    body.className = 'tool-placeholder-body';
    body.textContent = definition.subtitle;
    card.append(title, body);
    if (Array.isArray(definition.recommended) && definition.recommended.length) {
        const recTitle = document.createElement('p');
        recTitle.className = 'tool-placeholder-body';
        recTitle.textContent = 'Recommended options:';
        const list = document.createElement('ul');
        list.className = 'tool-placeholder-list';
        definition.recommended.forEach((item) => {
            const entry = document.createElement('li');
            entry.textContent = item;
            list.appendChild(entry);
        });
        card.append(recTitle, list);
    }
    shell.appendChild(card);
    root.appendChild(shell);
}

function renderActiveTool() {
    const root = dom.toolShellView;
    if (!root) {
        return;
    }
    const view = normalizeView(state.sublists.activeView);
    if (view === 'lists') {
        delete root.dataset.toolView;
        root.innerHTML = '';
        return;
    }
    root.dataset.toolView = view;
    if (view === 'tool-2d') {
        env.twoDTools?.render?.(root);
        return;
    }
    renderPlaceholder(TOOL_DEFINITIONS[view]);
}

function updateViewState() {
    if (!dom.sublistsPanel) {
        return;
    }
    const activeView = normalizeView(state.sublists.activeView);
    dom.sublistsPanel.querySelectorAll('.sublists-nav-button').forEach((button) => {
        const buttonView = String(button?.dataset?.sublistsView || '');
        const isActive = buttonView === activeView;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (dom.sublistsScroll) {
        dom.sublistsScroll.hidden = activeView !== 'lists';
    }
    if (dom.toolShellView) {
        dom.toolShellView.hidden = activeView === 'lists';
    }
}

function setActiveView(view, options = {}) {
    state.sublists.activeView = normalizeView(view);
    persistActiveView(state.sublists.activeView);
    renderActiveTool();
    updateViewState();
    if (state.sublists.activeView === 'lists') {
        env.sublists?.refreshVisibleLayout?.();
    }
    if (!options.skipShow) {
        env.sublists?.setVisibility?.(true);
    }
}

function blurActiveSidebarInput() {
    const active = document.activeElement;
    if (!active || !dom.sublistsPanel?.contains(active)) {
        return;
    }
    const isEditable = active.isContentEditable
        || active.matches?.('input, textarea, select')
        || active.getAttribute?.('role') === 'textbox';
    if (!isEditable || typeof active.blur !== 'function') {
        return;
    }
    active.blur();
}

function initialize() {
    if (!dom.sublistsPanel) {
        return;
    }
    state.sublists.activeView = readStoredActiveView();
    const buttons = dom.sublistsPanel.querySelectorAll('.sublists-nav-button[data-sublists-view]');
    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            const nextView = normalizeView(button.dataset.sublistsView);
            if (state.sublists.activeView === nextView) {
                env.sublists?.toggleVisibility?.();
                return;
            }
            setActiveView(nextView);
        });
    });
    updateViewState();
    renderActiveTool();
}

env.toolShell.setActiveView = setActiveView;
env.toolShell.renderActiveTool = renderActiveTool;
env.toolShell.updateViewState = updateViewState;
env.toolShell.blurActiveSidebarInput = blurActiveSidebarInput;
env.toolShell.getDefinition = (view) => TOOL_DEFINITIONS[normalizeView(view)] || null;

initialize();

module.exports = env.toolShell;
