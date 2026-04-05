'use strict';

// MARK: MODULE
module.exports = function createPaintPromptDialogModule() {
    function promptForPaintText(options = {}) {
        return new Promise((resolve) => {
            const multiline = options.multiline === true;
            const maxLength = Number.isFinite(Number(options.maxLength)) ? Math.max(1, Math.round(Number(options.maxLength))) : 0;
            const hintText = String(options.hint || '').trim();
            const inputTag = multiline ? 'textarea' : 'input';
            const overlay = document.createElement('div');
            overlay.classList.add('context-dialog-overlay');
            overlay.style.zIndex = '13000';
            const card = document.createElement('div');
            card.classList.add('context-dialog-card');
            if (multiline) {
                card.classList.add('paint-context-dialog-card');
            }
            const heading = document.createElement('h3');
            heading.textContent = options.title || 'Input';
            const input = document.createElement(inputTag);
            input.classList.add('paint-context-dialog-input');
            if (multiline) {
                input.classList.add('paint-context-dialog-textarea');
                input.rows = Math.max(4, Math.round(Number(options.rows) || 7));
            } else {
                input.type = 'text';
            }
            input.placeholder = options.placeholder || '';
            if (maxLength > 0) {
                input.maxLength = maxLength;
            }
            if (Object.prototype.hasOwnProperty.call(options, 'initialValue')) {
                input.value = String(options.initialValue ?? '');
            }
            const meta = document.createElement('div');
            meta.classList.add('paint-context-dialog-meta');
            const hint = document.createElement('div');
            hint.classList.add('paint-context-dialog-hint');
            hint.textContent = hintText || (multiline ? 'Ctrl+Enter to confirm' : '');
            const counter = document.createElement('div');
            counter.classList.add('paint-context-dialog-counter');
            meta.appendChild(hint);
            meta.appendChild(counter);
            const actions = document.createElement('div');
            actions.classList.add('context-dialog-actions');
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.textContent = 'Cancel';
            const confirmButton = document.createElement('button');
            confirmButton.type = 'button';
            confirmButton.textContent = options.confirmLabel || 'Confirm';
            actions.appendChild(cancelButton);
            actions.appendChild(confirmButton);
            card.appendChild(heading);
            card.appendChild(input);
            card.appendChild(meta);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);

            const syncTextareaHeight = () => {
                if (!multiline) {
                    return;
                }
                input.style.height = 'auto';
                input.style.height = `${Math.max(input.scrollHeight, 150)}px`;
            };

            const syncDialogState = () => {
                const valueLength = String(input.value || '').length;
                counter.textContent = maxLength > 0
                    ? `${valueLength.toLocaleString()} / ${maxLength.toLocaleString()}`
                    : `${valueLength.toLocaleString()}`;
                counter.hidden = valueLength <= 0 && maxLength <= 0;
                hint.hidden = !hint.textContent;
                syncTextareaHeight();
            };

            const cleanup = (value) => {
                overlay.remove();
                resolve(value === null ? null : String(value));
            };

            const submit = () => {
                cleanup(input.value);
            };

            cancelButton.addEventListener('click', () => cleanup(null), { passive: true });
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) {
                    cleanup(null);
                }
            }, { passive: true });
            input.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup(null);
                    return;
                }
                if (!multiline && event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                    return;
                }
                if (multiline && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    submit();
                }
            }, { passive: false });
            input.addEventListener('input', syncDialogState, { passive: true });
            confirmButton.addEventListener('click', submit, { passive: true });
            syncDialogState();
            setTimeout(() => {
                input.focus();
                input.select();
                syncDialogState();
            }, 0);
        });
    }

    function promptForPaintChoice(options = {}) {
        return new Promise((resolve) => {
            const optionList = Array.isArray(options.options)
                ? options.options
                    .map((entry) => ({
                        value: String(entry?.value || '').trim(),
                        label: String(entry?.label || '').trim()
                    }))
                    .filter((entry) => entry.value && entry.label)
                : [];
            if (!optionList.length) {
                resolve(null);
                return;
            }
            const initialValue = String(options.initialValue || '').trim();
            const selectedValue = optionList.some((entry) => entry.value === initialValue)
                ? initialValue
                : optionList[0].value;
            const hintText = String(options.hint || '').trim();
            const detailText = String(options.detail || '').trim();
            const overlay = document.createElement('div');
            overlay.classList.add('context-dialog-overlay');
            overlay.style.zIndex = '13000';
            const card = document.createElement('div');
            card.classList.add('context-dialog-card');
            card.classList.add('paint-context-dialog-card');
            const heading = document.createElement('h3');
            heading.textContent = options.title || 'Choose';
            const detail = document.createElement('div');
            detail.classList.add('paint-context-dialog-hint');
            detail.textContent = detailText;
            detail.hidden = !detailText;
            const select = document.createElement('select');
            select.classList.add('paint-context-dialog-input');
            optionList.forEach((entry) => {
                const option = document.createElement('option');
                option.value = entry.value;
                option.textContent = entry.label;
                if (entry.value === selectedValue) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
            const meta = document.createElement('div');
            meta.classList.add('paint-context-dialog-meta');
            const hint = document.createElement('div');
            hint.classList.add('paint-context-dialog-hint');
            hint.textContent = hintText;
            hint.hidden = !hintText;
            meta.appendChild(hint);
            const actions = document.createElement('div');
            actions.classList.add('context-dialog-actions');
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.textContent = 'Cancel';
            const confirmButton = document.createElement('button');
            confirmButton.type = 'button';
            confirmButton.textContent = options.confirmLabel || 'Confirm';
            actions.appendChild(cancelButton);
            actions.appendChild(confirmButton);
            card.appendChild(heading);
            card.appendChild(detail);
            card.appendChild(select);
            card.appendChild(meta);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);

            const cleanup = (value) => {
                overlay.remove();
                resolve(value === null ? null : String(value));
            };

            const submit = () => {
                cleanup(select.value);
            };

            cancelButton.addEventListener('click', () => cleanup(null), { passive: true });
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) {
                    cleanup(null);
                }
            }, { passive: true });
            select.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup(null);
                    return;
                }
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                }
            }, { passive: false });
            confirmButton.addEventListener('click', submit, { passive: true });
            setTimeout(() => {
                select.focus();
            }, 0);
        });
    }

    return {
        promptForPaintText,
        promptForPaintChoice
    };
};
