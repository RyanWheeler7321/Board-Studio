'use strict';

// MARK: MODULE
module.exports = function createPaintShellModule(deps) {
    const {
        dom,
        EDIT_MODE_TRANSFORM,
        EDIT_MODE_PAINT,
        EDIT_MODE_SELECT,
        getSession,
        isColorPopoverOpen,
        hideColorPopover,
        applyTransformMode,
        applySelectionEditsAndClearSelection,
        saveAndExit,
        revertPaintSessionChangesAndExit,
        cancelTransformMode,
        cancelCropMode,
        undo,
        closePaintMode,
        requestCancelPaint,
        copySelectionOrCanvasToClipboard,
        pasteClipboardImageAsTransformSelection,
    } = deps;

    let paintContextMenuClickHandlerAttached = false;

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

    function hidePaintContextMenu() {
        if (!dom.contextMenuEl) {
            return;
        }
        dom.contextMenuEl.classList.remove('is-visible');
        dom.contextMenuEl.hidden = true;
    }

    function isExitMenuOpen() {
        return !!dom.paintExitMenu && dom.paintExitMenu.hidden === false;
    }

    function setExitMenuVisible(visible) {
        if (!dom.paintExitMenu) {
            return;
        }
        const shouldShow = !!visible;
        dom.paintExitMenu.hidden = !shouldShow;
        if (shouldShow) {
            hidePaintContextMenu();
            if (isColorPopoverOpen()) {
                hideColorPopover();
            }
        }
    }

    function keepChangesAction() {
        if (!session) {
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
            applyTransformMode();
            return;
        }
        if (session.editMode === EDIT_MODE_PAINT && session.selectionEdit?.dirty) {
            applySelectionEditsAndClearSelection();
            return;
        }
        saveAndExit().catch((error) => console.error('Paint save failed', error));
    }

    function negateChangesAndExit() {
        if (!session) {
            return;
        }
        revertPaintSessionChangesAndExit().catch((error) => console.error('Paint negate failed', error));
    }

    function ensurePaintContextMenuClickHandler() {
        if (paintContextMenuClickHandlerAttached || !dom.contextMenuEl) {
            return;
        }
        paintContextMenuClickHandlerAttached = true;
        dom.contextMenuEl.addEventListener('click', (event) => {
            const button = event.target?.closest?.('button[data-action]');
            if (!button || !session) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            const action = String(button.dataset.action || '');
            hidePaintContextMenu();
            if (action === 'paint-save-exit') {
                saveAndExit().catch((error) => console.error('Paint save failed', error));
                return;
            }
            if (action === 'paint-cancel') {
                requestCancelPaint();
                return;
            }
            if (action === 'paint-copy') {
                copySelectionOrCanvasToClipboard().catch((error) => console.error('Paint copy failed', error));
                return;
            }
            if (action === 'paint-paste') {
                pasteClipboardImageAsTransformSelection().catch((error) => console.error('Paint paste failed', error));
            }
        }, { passive: false, capture: true });
    }

    function showPaintContextMenuAt(clientX, clientY) {
        if (!dom.contextMenuEl || !session) {
            return;
        }
        ensurePaintContextMenuClickHandler();
        const menu = dom.contextMenuEl;
        try {
            window.getSelection?.()?.removeAllRanges?.();
        } catch {}
        menu.innerHTML = '';

        const addItem = (id, label) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.action = id;
            button.className = 'context-menu-item';
            button.textContent = label;
            menu.appendChild(button);
        };
        const addSeparator = () => {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        };

        addItem('paint-save-exit', 'Save + Exit');
        addItem('paint-cancel', 'Cancel Edits');
        addSeparator();
        addItem('paint-copy', session.selection?.path && !session.selection?.inverted ? 'Copy Selection' : 'Copy Image');
        addItem('paint-paste', 'Paste to New Layer');

        menu.hidden = false;
        menu.classList.add('is-visible');
        menu.style.left = '0px';
        menu.style.top = '0px';
        const rect = menu.getBoundingClientRect();
        const padding = 12;
        const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
        const maxY = Math.max(padding, window.innerHeight - rect.height - padding);
        const left = Math.min(Math.max(Math.round(Number(clientX) || 0), padding), maxX);
        const top = Math.min(Math.max(Math.round(Number(clientY) || 0), padding), maxY);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    return {
        hidePaintContextMenu,
        isExitMenuOpen,
        setExitMenuVisible,
        keepChangesAction,
        negateChangesAndExit,
        ensurePaintContextMenuClickHandler,
        showPaintContextMenuAt
    };
};
