// version 0.1.4

// ============================================================================
// Constants & Pre-allocated Results (avoid object creation in hot paths)
// ============================================================================

const DEFAULT_DUP_TTL_MS = 300000;

// Pre-allocated result objects for HAM conflict resolution
const RESULT_DEFER = Object.freeze({ defer: true });
const RESULT_HISTORICAL = Object.freeze({ historical: true });
const RESULT_CONVERGE_INCOMING = Object.freeze({ converge: true, incoming: true });
const RESULT_CONVERGE_CURRENT = Object.freeze({ converge: true, current: true });
const RESULT_STATE = Object.freeze({ state: true });

// ============================================================================
// Custom Error
// ============================================================================

class HAMError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HAMError';
    }
}

// ============================================================================
// Validation Helpers (inlined typeof checks for speed)
// ============================================================================

function validateType(value, expectedType) {
    if (typeof value !== expectedType) {
        throw new HAMError(`Expected ${expectedType}, got ${typeof value}`);
    }
}

function validateVectorClock(value) {
    if (!(value instanceof VectorClock)) {
        throw new HAMError(`Expected VectorClock, got ${typeof value}`);
    }
}

// ============================================================================
// VectorClock - Implements vector clock logic for distributed event ordering
// ============================================================================

class VectorClock {
    constructor(initialClock) {
        if (initialClock) {
            const entries = Object.keys(initialClock);
            this.clock = new Map();
            for (let i = 0, len = entries.length; i < len; i++) {
                const key = entries[i];
                this.clock.set(key, initialClock[key]);
            }
        } else {
            this.clock = new Map();
        }
    }

    increment(nodeId) {
        this.clock.set(nodeId, (this.clock.get(nodeId) || 0) + 1);
    }

    merge(otherClock) {
        const otherMap = otherClock.clock;
        for (const entry of otherMap) {
            const nodeId = entry[0];
            const timestamp = entry[1];
            const current = this.clock.get(nodeId);
            if (current === undefined || timestamp > current) {
                this.clock.set(nodeId, timestamp);
            }
        }
    }

    compare(otherClock) {
        const thisMap = this.clock;
        const otherMap = otherClock.clock;
        let thisIsGreater = false;
        let otherIsGreater = false;

        // Check all entries in this clock
        for (const entry of thisMap) {
            const nodeId = entry[0];
            const thisTime = entry[1];
            const otherTime = otherMap.get(nodeId) || 0;
            if (thisTime > otherTime) thisIsGreater = true;
            else if (thisTime < otherTime) otherIsGreater = true;
        }

        // Check entries in other clock not in this clock
        for (const entry of otherMap) {
            const nodeId = entry[0];
            if (!thisMap.has(nodeId)) {
                otherIsGreater = true;
                break;
            }
        }

        if (thisIsGreater && !otherIsGreater) return 1;
        if (otherIsGreater && !thisIsGreater) return -1;
        if (!thisIsGreater && !otherIsGreater) return 0;
        return null;
    }

    toString() {
        return JSON.stringify(Object.fromEntries(this.clock));
    }

    static gunStateToVectorClock(gunState) {
        const vc = new VectorClock();
        const keys = Object.keys(gunState);
        for (let i = 0, len = keys.length; i < len; i++) {
            const key = keys[i];
            vc.clock.set(key, gunState[key]);
        }
        return vc;
    }

    static vectorClockToGunState(vectorClock) {
        return Object.fromEntries(vectorClock.clock);
    }
}

// Shared empty VectorClock instance for getState fallback
const EMPTY_VECTOR_CLOCK = new VectorClock();

// ============================================================================
// State - Manages node state metadata (GunDB compatible)
// ============================================================================

class State {
    static is(node, key) {
        if (typeof node !== 'object') throw new HAMError(`Expected object, got ${typeof node}`);
        if (typeof key !== 'string') throw new HAMError(`Expected string, got ${typeof key}`);

        const meta = node && node._;
        if (!meta) return false;
        const stateMap = meta['>'];
        if (!stateMap) return false;
        return stateMap[key] instanceof VectorClock;
    }

    static ify(node, key, state, value, soul) {
        if (typeof node !== 'object') throw new HAMError(`Expected object, got ${typeof node}`);
        if (typeof key !== 'string') throw new HAMError(`Expected string, got ${typeof key}`);
        if (!(state instanceof VectorClock)) throw new HAMError(`Expected VectorClock, got ${typeof state}`);

        const meta = node && node._;
        if (!meta) throw new HAMError('Invalid node structure');

        let stateMap = meta['>'];
        if (!stateMap) {
            stateMap = meta['>'] = {};
        }

        const existingState = stateMap[key];
        if (!existingState || state.compare(existingState) === 1) {
            stateMap[key] = state;
            if (value !== undefined) {
                node[key] = value;
                if (soul) meta['#'] = soul;
            }
        }

        return node;
    }

    static getState(node, key) {
        if (typeof node !== 'object') throw new HAMError(`Expected object, got ${typeof node}`);
        if (typeof key !== 'string') throw new HAMError(`Expected string, got ${typeof key}`);

        const meta = node && node._;
        if (!meta) return new VectorClock();
        const stateMap = meta['>'];
        if (!stateMap) return new VectorClock();
        return stateMap[key] || new VectorClock();
    }
}

// ============================================================================
// Dup - Deduplication tracking with TTL
// ============================================================================

class Dup {
    constructor(options) {
        this.entries = new Map();
        this.ttl = (options && options.ttl) || DEFAULT_DUP_TTL_MS;
    }

    get s() {
        return this.entries;
    }

    track(id) {
        if (typeof id !== 'string') throw new HAMError(`Expected string, got ${typeof id}`);
        if (!id) return undefined;

        let entry = this.entries.get(id);
        if (!entry) {
            entry = { ts: Date.now(), clock: new VectorClock() };
            this.entries.set(id, entry);
        }
        return entry;
    }

    check(id) {
        if (typeof id !== 'string') throw new HAMError(`Expected string, got ${typeof id}`);
        if (!id) return undefined;
        return this.entries.get(id);
    }

    free() {
        const now = Date.now();
        const ttl = this.ttl;
        const entries = this.entries;

        for (const entry of entries) {
            const id = entry[0];
            const data = entry[1];
            if (data.ts && (now - data.ts) > ttl) {
                entries.delete(id);
            }
        }
    }
}

// ============================================================================
// HAM - Hypothetical Amnesia Machine (conflict resolution engine)
// ============================================================================

class HAM {
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.debugMode = false;
    }

    ham(machineState, incomingState, currentState, incomingValue, currentValue) {
        if (!(machineState instanceof VectorClock)) throw new HAMError(`Expected VectorClock, got ${typeof machineState}`);
        if (!(incomingState instanceof VectorClock)) throw new HAMError(`Expected VectorClock, got ${typeof incomingState}`);
        if (!(currentState instanceof VectorClock)) throw new HAMError(`Expected VectorClock, got ${typeof currentState}`);

        if (machineState.compare(incomingState) === 1) {
            return RESULT_DEFER;
        }

        const comparison = incomingState.compare(currentState);

        if (comparison === -1) return RESULT_HISTORICAL;
        if (comparison === 1) return RESULT_CONVERGE_INCOMING;

        if (comparison === 0) {
            const unwrappedIncoming = this.unwrap(incomingValue);
            const unwrappedCurrent = this.unwrap(currentValue);

            if (unwrappedIncoming === unwrappedCurrent) {
                return RESULT_STATE;
            }

            const incomingStr = String(unwrappedIncoming);
            const currentStr = String(unwrappedCurrent);

            if (incomingStr < currentStr) return RESULT_CONVERGE_CURRENT;
            if (currentStr < incomingStr) return RESULT_CONVERGE_INCOMING;
        }

        return {
            err: new HAMError(`Concurrent updates detected: ${incomingValue} and ${currentValue}`)
        };
    }

    unwrap(value) {
        if (value && value['#'] && value['.'] && value['>']) {
            return value[':'];
        }
        return value;
    }

    union(vertex, node) {
        if (typeof vertex !== 'object') throw new HAMError(`Expected object, got ${typeof vertex}`);
        if (typeof node !== 'object') throw new HAMError(`Expected object, got ${typeof node}`);

        if (!vertex) return node;
        if (!node) return vertex;

        const machineState = this.machineState();
        const nodeMeta = node._;

        if (nodeMeta && nodeMeta['#']) {
            if (!vertex._) vertex._ = {};
            vertex._['#'] = nodeMeta['#'];
        }

        const keys = Object.keys(node);
        for (let i = 0, len = keys.length; i < len; i++) {
            const key = keys[i];
            if (key === '_') continue;

            const incomingState = State.getState(node, key);
            const currentState = State.getState(vertex, key);
            const incomingValue = node[key];
            const currentValue = vertex[key];

            const result = this.ham(machineState, incomingState, currentState, incomingValue, currentValue);

            if (result.err) {
                if (this.debugMode) {
                    console.log(`[HAM ERROR] ${result.err.message}`);
                }
                continue;
            }

            if (result.state || result.historical || result.current) continue;

            if (result.defer || result.incoming) {
                State.ify(vertex, key, incomingState, incomingValue);
            }
        }

        return vertex;
    }

    machineState() {
        const state = new VectorClock();
        state.clock.set(this.nodeId, 1);
        return state;
    }

    graph(graph, soul, key, value, state) {
        if (typeof graph !== 'object') throw new HAMError(`Expected object, got ${typeof graph}`);
        if (typeof soul !== 'string') throw new HAMError(`Expected string, got ${typeof soul}`);
        if (typeof key !== 'string') throw new HAMError(`Expected string, got ${typeof key}`);
        if (!(state instanceof VectorClock)) throw new HAMError(`Expected VectorClock, got ${typeof state}`);

        graph[soul] = State.ify(graph[soul], key, state, value, soul);
        return graph;
    }

    graphOperation(graph, soul, key, value, state) {
        if (typeof graph !== 'object') throw new HAMError(`Expected object, got ${typeof graph}`);
        if (typeof soul !== 'string') throw new HAMError(`Expected string, got ${typeof soul}`);
        if (typeof key !== 'string') throw new HAMError(`Expected string, got ${typeof key}`);
        if (!(state instanceof VectorClock)) throw new HAMError(`Expected VectorClock, got ${typeof state}`);

        if (!graph[soul]) {
            graph[soul] = { _: { '#': soul, '>': {} } };
        }

        return this.graph(graph, soul, key, value, state);
    }

    mergeGraphs(localGraph, incomingGraph) {
        if (typeof localGraph !== 'object') throw new HAMError(`Expected object, got ${typeof localGraph}`);
        if (typeof incomingGraph !== 'object') throw new HAMError(`Expected object, got ${typeof incomingGraph}`);

        const mergedGraph = Object.assign({}, localGraph);
        const souls = Object.keys(incomingGraph);

        for (let i = 0, len = souls.length; i < len; i++) {
            const soul = souls[i];
            if (soul === '_') continue;

            if (!mergedGraph[soul]) {
                mergedGraph[soul] = incomingGraph[soul];
            } else {
                mergedGraph[soul] = this.union(mergedGraph[soul], incomingGraph[soul]);
            }
        }

        return mergedGraph;
    }

    log(level, message) {
        if (this.debugMode) {
            console.log(`[HAM ${level.toUpperCase()}] ${message}`);
        }
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
    }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    VectorClock,
    State,
    Dup,
    HAM
};
