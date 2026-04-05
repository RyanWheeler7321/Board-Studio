'use strict';

const env = require('../core/state');

const { dom, state, data, utils } = env;

// MARK: Data Setup Overlay
function updateMessage(text) {
    if (!dom.dataSetupMessage) {
        return;
    }
    dom.dataSetupMessage.textContent = text || '';
}

function show() {
    initialize();
    if (!dom.dataSetupOverlay) {
        return;
    }
    updateMessage('');
    dom.dataSetupOverlay.hidden = false;
    dom.dataSetupOverlay.classList.add('is-visible');
}

function hide() {
    if (!dom.dataSetupOverlay) {
        return;
    }
    dom.dataSetupOverlay.classList.remove('is-visible');
    dom.dataSetupOverlay.hidden = true;
    updateMessage('');
}

// MARK: Folder Selection Flow
async function handleSelectExisting() {
    if (!env.electron?.ipcRenderer?.invoke) {
        updateMessage('Folder selection is unavailable.');
        return;
    }
    try {
        updateMessage('Pick a folder to continue…');
        const response = await env.electron.ipcRenderer.invoke('workboard:choose-data-path');
        if (!response || response.canceled) {
            updateMessage('');
            return;
        }
        const selectedPath = typeof response.path === 'string' ? response.path : Array.isArray(response.paths) ? response.paths[0] : '';
        if (!selectedPath) {
            updateMessage('No folder selected.');
            return;
        }
        await applyDataDirectory(selectedPath);
    } catch (error) {
        console.error('Failed to select workboard data folder', error);
        updateMessage('Unable to select that folder.');
    }
}

async function handleCreateNew() {
    if (!env.electron?.ipcRenderer?.invoke) {
        updateMessage('Folder creation is unavailable.');
        return;
    }
    try {
        updateMessage('Choose where to create the new folder…');
        const response = await env.electron.ipcRenderer.invoke('workboard:create-data-folder');
        if (!response || response.canceled) {
            updateMessage('');
            return;
        }
        if (!response.success || !response.path) {
            updateMessage(response?.error || 'Could not create a data folder.');
            return;
        }
        await applyDataDirectory(response.path);
    } catch (error) {
        console.error('Failed to create workboard data folder', error);
        updateMessage('Unable to create a data folder.');
    }
}

// MARK: Data Directory Application
async function applyDataDirectory(targetPath) {
    const trimmed = typeof targetPath === 'string' ? targetPath.trim() : '';
    if (!trimmed) {
        updateMessage('Provide a valid folder path.');
        return false;
    }
    updateMessage('Configuring data folder…');
    let resolvedPath = trimmed;
    let metadata = null;
    if (env.electron?.ipcRenderer?.invoke) {
        try {
            const result = await env.electron.ipcRenderer.invoke('workboard:set-data-path', trimmed);
            metadata = result || null;
            if (typeof result?.path === 'string' && result.path.trim()) {
                resolvedPath = result.path.trim();
            }
            if (result?.success === false && result?.error) {
                console.warn('Data folder persistence failed', result.error);
            }
        } catch (error) {
            console.error('Failed to persist workboard data folder via IPC', error);
        }
    }
    try {
        env.paths.configureDataDirectory(resolvedPath);
        state.dataDirectoryPath = resolvedPath;
        state.dataDirectoryNeedsSetup = false;
        state.dataDirectoryReady = true;
        state.dataDirectoryMeta = metadata || { path: resolvedPath };
        data.ensureDataDirectories();
        if (env.management && typeof env.management.refreshDataSettingsUi === 'function') {
            env.management.refreshDataSettingsUi();
        }
        hide();
        state.boardData = null;
        state.currentBoardId = 'root';
        setTimeout(() => {
            try {
                env.management.initializeBoard();
            } catch (error) {
                console.error('Failed to restart board after data folder selection', error);
                updateMessage('Something went wrong while loading the board.');
                show();
            }
        }, 0);
        if (!metadata || metadata?.success === false) {
            utils?.showToast?.('Data folder applied locally');
        }
        return true;
    } catch (error) {
        console.error('Failed to apply workboard data folder', error);
        updateMessage('Unable to use that folder.');
        return false;
    }
}

// MARK: Bootstrap
function initialize() {
    if (state.dataSetupInitialized) {
        return;
    }
    state.dataSetupInitialized = true;
    if (dom.dataSetupSelectButton) {
        dom.dataSetupSelectButton.addEventListener('click', handleSelectExisting);
    }
    if (dom.dataSetupCreateButton) {
        dom.dataSetupCreateButton.addEventListener('click', handleCreateNew);
    }
}

initialize();

env.dataSetup = env.dataSetup || {};
env.dataSetup.show = show;
env.dataSetup.hide = hide;
env.dataSetup.applyDataDirectory = applyDataDirectory;

env.dataSetup.updateMessage = updateMessage;

module.exports = env;
