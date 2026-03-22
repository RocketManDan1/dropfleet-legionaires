import { BATLOC_PRESETS, resolveBatlocConfig } from './batloc.js';
const MIN_MAP_SIZE = 128;
const MAX_MAP_SIZE = 768;
const ALLOWED_TOP_LEVEL = new Set(['type', 'width', 'height', 'seed', 'batloc', 'params', 'requestId']);
const ALLOWED_PARAM_KEYS = new Set([
    'name', 'id',
    'hillDensity', 'maxHillHeight', 'hillBaseSize',
    'streamsMarsh', 'lakesSize', 'marshSize',
    'riverTrees', 'riverMarsh', 'riverMud', 'riverRough',
    'treeLevel', 'orchardLevel', 'grassLevel', 'roughLevel',
    'fieldLevel', 'mudLevel',
    'urbanisation', 'roadCode', 'terrainMod',
    'season', 'arid', 'savannah',
    'coastalEdge', 'wideRiver',
]);
function asObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return value;
}
function parseMapSize(value, fallback, field) {
    if (value === undefined)
        return { ok: true, value: fallback };
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        return {
            ok: false,
            error: {
                ok: false,
                code: 'INVALID_FIELD_TYPE',
                message: `${field} must be an integer`,
                details: [{ field, reason: 'must be an integer', expected: 'integer', actual: value }],
            },
        };
    }
    if (value < MIN_MAP_SIZE || value > MAX_MAP_SIZE) {
        return {
            ok: false,
            error: {
                ok: false,
                code: 'INVALID_FIELD_RANGE',
                message: `${field} must be between ${MIN_MAP_SIZE} and ${MAX_MAP_SIZE}`,
                details: [{ field, reason: 'out of allowed range', expected: `${MIN_MAP_SIZE}..${MAX_MAP_SIZE}`, actual: value }],
            },
        };
    }
    return { ok: true, value };
}
export function parseGenerateRequest(msg, fallbackWidth, fallbackHeight) {
    const obj = asObject(msg);
    if (!obj) {
        return { ok: false, code: 'INVALID_FIELD_TYPE', message: 'message must be an object' };
    }
    for (const key of Object.keys(obj)) {
        if (!ALLOWED_TOP_LEVEL.has(key)) {
            return {
                ok: false,
                code: 'UNKNOWN_FIELD',
                message: `unknown field: ${key}`,
                details: [{ field: key, reason: 'unknown top-level field' }],
            };
        }
    }
    if (obj.type !== 'generate') {
        return {
            ok: false,
            code: 'INVALID_MESSAGE_TYPE',
            message: 'message type must be generate',
            details: [{ field: 'type', reason: 'wrong message type', expected: 'generate', actual: obj.type }],
        };
    }
    const widthResult = parseMapSize(obj.width, fallbackWidth, 'width');
    if (!widthResult.ok)
        return widthResult.error;
    const heightResult = parseMapSize(obj.height, fallbackHeight, 'height');
    if (!heightResult.ok)
        return heightResult.error;
    let seed;
    if (obj.seed !== undefined) {
        if (typeof obj.seed !== 'number' || !Number.isFinite(obj.seed)) {
            return {
                ok: false,
                code: 'INVALID_FIELD_TYPE',
                message: 'seed must be a finite number',
                details: [{ field: 'seed', reason: 'must be a finite number', expected: 'number', actual: obj.seed }],
            };
        }
        seed = obj.seed;
    }
    let batlocName;
    if (obj.batloc !== undefined) {
        if (typeof obj.batloc !== 'string') {
            return {
                ok: false,
                code: 'INVALID_FIELD_TYPE',
                message: 'batloc must be a string preset key',
                details: [{ field: 'batloc', reason: 'must be a string', expected: 'string', actual: obj.batloc }],
            };
        }
        if (!BATLOC_PRESETS[obj.batloc]) {
            return {
                ok: false,
                code: 'UNKNOWN_BATLOC',
                message: `unknown batloc preset: ${obj.batloc}`,
                details: [{ field: 'batloc', reason: 'preset not found', actual: obj.batloc }],
            };
        }
        batlocName = obj.batloc;
    }
    let overrides;
    if (obj.params !== undefined) {
        const paramsObj = asObject(obj.params);
        if (!paramsObj) {
            return {
                ok: false,
                code: 'INVALID_FIELD_TYPE',
                message: 'params must be an object',
                details: [{ field: 'params', reason: 'must be an object', expected: 'object', actual: obj.params }],
            };
        }
        for (const key of Object.keys(paramsObj)) {
            if (!ALLOWED_PARAM_KEYS.has(key)) {
                return {
                    ok: false,
                    code: 'INVALID_PARAMS_KEY',
                    message: `unknown params key: ${key}`,
                    details: [{ field: `params.${key}`, reason: 'unknown params key' }],
                };
            }
        }
        overrides = paramsObj;
    }
    const resolved = resolveBatlocConfig(batlocName, overrides);
    if (resolved.errors.length > 0) {
        return {
            ok: false,
            code: resolved.errors.some((e) => e.reason.includes('enum')) ? 'INVALID_ENUM_VALUE' : 'INVALID_FIELD_RANGE',
            message: 'invalid batloc params',
            details: resolved.errors.map((e) => ({ field: e.field, expected: e.expected, actual: e.actual, reason: e.reason })),
            requestId: typeof obj.requestId === 'string' ? obj.requestId : undefined,
        };
    }
    return {
        ok: true,
        width: widthResult.value,
        height: heightResult.value,
        seed,
        batloc: resolved.batloc,
        requestId: typeof obj.requestId === 'string' ? obj.requestId : undefined,
    };
}
