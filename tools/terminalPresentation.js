'use strict';

function integer(value) {
    const parsed = Math.round(Number(value) || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function blinkingCursorStyle(params = []) {
    const raw = Array.isArray(params) ? params[0] : 0;
    const value = Array.isArray(raw) ? integer(raw[0]) : integer(raw);
    if (value === 3 || value === 4) {
        return 'underline';
    }
    if (value === 5 || value === 6) {
        return 'bar';
    }
    return 'block';
}

module.exports = {
    blinkingCursorStyle
};
