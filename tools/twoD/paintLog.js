'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', '..', '..', 'logs', 'workboard_paint.log');

function formatTs() {
    const now = new Date();
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

function safeValue(value, seen = new WeakSet()) {
    if (value == null) {
        return value;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => safeValue(entry, seen));
    }
    if (typeof value === 'object') {
        if (seen.has(value)) {
            return '[circular]';
        }
        seen.add(value);
        const output = {};
        Object.keys(value).forEach((key) => {
            output[key] = safeValue(value[key], seen);
        });
        seen.delete(value);
        return output;
    }
    return String(value);
}

function appendPaintLog(scope, payload = {}) {
    try {
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        fs.appendFileSync(LOG_PATH, `[${formatTs()}] ${scope} ${JSON.stringify(safeValue(payload))}\n`, 'utf8');
    } catch {}
}

module.exports = {
    appendPaintLog
};
