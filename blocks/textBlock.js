'use strict';

// MARK: TEXT BLOCK RENDERER
const env = require('../core/state');
const { state, movement } = env;
const BULLET_PREFIX = '•   ';

function renderTextBlock(block, element, options = {}) {
	element.classList.add('text-block');
	if (options.isTitle) {
		element.classList.add('title-block');
	}
	const display = document.createElement('div');
	display.classList.add('text-block-display');
	display.textContent = block.content || '';
	const editor = document.createElement('textarea');
	editor.classList.add('text-block-editor');
	editor.value = block.content || '';
	editor.setAttribute('spellcheck', 'false');
	if (options.isTitle) {
		editor.setAttribute('placeholder', 'Title');
	}
	editor.addEventListener('input', () => {
		env.textEditing.syncTextBlockContent(block.id, editor.value, { trigger: 'input' });
	});
	editor.addEventListener('blur', () => {
		env.textEditing.finishTextEditing(block.id, editor.value);
	});
	editor.addEventListener('keydown', (event) => {
		const key = event.key;
		const selectionStart = editor.selectionStart;
		const selectionEnd = editor.selectionEnd;
		if (key === ' ' && selectionStart === selectionEnd) {
			const lineStart = editor.value.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1;
			const prefix = editor.value.slice(lineStart, selectionStart);
			if (prefix && prefix.replace(/\s/g, '') === '-') {
				event.preventDefault();
				const before = editor.value.slice(0, lineStart);
				const after = editor.value.slice(selectionEnd);
				editor.value = `${before}${BULLET_PREFIX}${after}`;
				const caret = lineStart + BULLET_PREFIX.length;
				editor.setSelectionRange(caret, caret);
				env.textEditing.syncTextBlockContent(block.id, editor.value, { trigger: 'input' });
				return;
			}
		}
		if (key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && selectionStart === selectionEnd) {
			const lineStart = editor.value.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1;
			const prefix = editor.value.slice(lineStart, selectionStart);
			if (prefix.startsWith(BULLET_PREFIX)) {
				event.preventDefault();
				const before = editor.value.slice(0, selectionStart);
				const after = editor.value.slice(selectionEnd);
				const insertion = `\n${BULLET_PREFIX}`;
				editor.value = `${before}${insertion}${after}`;
				const caret = selectionStart + insertion.length;
				editor.setSelectionRange(caret, caret);
				env.textEditing.syncTextBlockContent(block.id, editor.value, { trigger: 'input' });
				return;
			}
		}
		if (key === 'Escape') {
			editor.value = block.content || '';
			env.textEditing.finishTextEditing(block.id, editor.value, { cancel: true });
		}
		if ((key === 'Enter' && event.metaKey) || (key === 'Enter' && event.ctrlKey)) {
			event.preventDefault();
			env.textEditing.finishTextEditing(block.id, editor.value);
		}
	});
	display.addEventListener('click', (event) => {
		if (event.button !== 0) {
			return;
		}
		if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (state.dragState || state.pendingDrag) {
			return;
		}
		if (options.isTitle && state.selectedBlockId !== block.id) {
			movement.selectBlock(block.id);
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		const caretOffset = env.textEditing.resolveCaretOffsetFromDisplay(display);
		env.textEditing.beginTextEditing(block.id, { caretOffset });
		event.preventDefault();
		event.stopPropagation();
	});
	element.appendChild(display);
	element.appendChild(editor);
	if (element.isConnected) {
		env.textEditing.autoSizeTextBlock(block, element, block.content || '');
	}
}

const textApi = {
	render(block, element) {
		renderTextBlock(block, element, { isTitle: false });
	},
	renderElement: renderTextBlock
};

env.blocks.text = textApi;

module.exports = textApi;
