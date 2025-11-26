// version 0.1.4

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DUP_TTL_MS = 300000; // 5 minutes

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
// Validation Helpers
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
    constructor(initialClock = {}) {
        this.clock = new Map(Object.entries(initialClock));
    }

    increment(nodeId) {
        const currentValue = this.clock.get(nodeId) || 0;
        this.clock.set(nodeId, currentValue + 1);
    }

    merge(otherClock) {
        for (const [nodeId, timestamp] of otherClock.clock) {
            const currentTimestamp = this.clock.get(nodeId) || 0;
            if (timestamp > currentTimestamp) {
                this.clock.set(nodeId, timestamp);
            }
        }
    }

    compare(otherClock) {
        let thisIsGreater = false;
        let otherIsGreater = false;

        const allNodeIds = new Set([
            ...this.clock.keys(),
            ...otherClock.clock.keys()
        ]);

        for (const nodeId of allNodeIds) {
            const thisTimestamp = this.clock.get(nodeId) || 0;
            const otherTimestamp = otherClock.clock.get(nodeId) || 0;

            if (thisTimestamp > otherTimestamp) thisIsGreater = true;
            if (thisTimestamp < otherTimestamp) otherIsGreater = true;
        }

        if (thisIsGreater && !otherIsGreater) return 1;   // this happens-after other
        if (otherIsGreater && !thisIsGreater) return -1;  // this happens-before other
        if (!thisIsGreater && !otherIsGreater) return 0;  // equal
        return null; // concurrent (both are greater in different dimensions)
    }

    toString() {
        return JSON.stringify(Object.fromEntries(this.clock));
    }

    static gunStateToVectorClock(gunState) {
        const vectorClock = new VectorClock();
        for (const [nodeId, timestamp] of Object.entries(gunState)) {
            vectorClock.clock.set(nodeId, timestamp);
        }
        return vectorClock;
    }

    static vectorClockToGunState(vectorClock) {
        return Object.fromEntries(vectorClock.clock);
    }
}

// ============================================================================
// State - Manages node state metadata (GunDB compatible)
// ============================================================================

class State {
    static is(node, key) {
        validateType(node, 'object');
        validateType(key, 'string');

        const stateMap = node?.['_']?.['>'];
        return stateMap?.[key] instanceof VectorClock;
    }

    static ify(node, key, state, value, soul) {
        validateType(node, 'object');
        validateType(key, 'string');
        validateVectorClock(state);

        if (!node?.['_']) {
            throw new HAMError('Invalid node structure');
        }

        const stateMap = node['_']['>'] = node['_']['>'] || {};
        const existingState = stateMap[key];
        const shouldUpdate = !existingState || state.compare(existingState) === 1;

        if (shouldUpdate) {
            stateMap[key] = state;
            if (value !== undefined) {
                node[key] = value;
                if (soul) {
                    node['_']['#'] = soul;
                }
            }
        }

        return node;
    }

    static getState(node, key) {
        validateType(node, 'object');
        validateType(key, 'string');

        const stateValue = node?.['_']?.['>']?.[key];
        return stateValue || new VectorClock();
    }
}

// ============================================================================
// Dup - Deduplication tracking with TTL
// ============================================================================

class Dup {
    constructor(options = {}) {
        this.entries = new Map();
        this.ttl = options.ttl || DEFAULT_DUP_TTL_MS;
    }

    get s() {
        return this.entries;
    }

    track(id) {
        validateType(id, 'string');

        if (!id) return undefined;

        if (!this.entries.has(id)) {
            this.entries.set(id, {
                ts: Date.now(),
                clock: new VectorClock()
            });
        }

        return this.entries.get(id);
    }

    check(id) {
        validateType(id, 'string');

        if (!id) return undefined;

        return this.entries.get(id);
    }

    free() {
        const now = Date.now();

        for (const [id, data] of this.entries) {
            const isExpired = data.ts && (now - data.ts) > this.ttl;
            if (isExpired) {
                this.entries.delete(id);
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
        validateVectorClock(machineState);
        validateVectorClock(incomingState);
        validateVectorClock(currentState);

        // If machine state is ahead of incoming, defer the update
        if (machineState.compare(incomingState) === 1) {
            return { defer: true };
        }

        const comparison = incomingState.compare(currentState);

        // Incoming is older than current - treat as historical
        if (comparison === -1) {
            return { historical: true };
        }

        // Incoming is newer than current - accept incoming
        if (comparison === 1) {
            return { converge: true, incoming: true };
        }

        // States are equal (comparison === 0) - use lexicographic comparison
        if (comparison === 0) {
            const unwrappedIncoming = this.unwrap(incomingValue);
            const unwrappedCurrent = this.unwrap(currentValue);

            if (unwrappedIncoming === unwrappedCurrent) {
                return { state: true };
            }

            const incomingStr = String(unwrappedIncoming);
            const currentStr = String(unwrappedCurrent);

            if (incomingStr < currentStr) {
                return { converge: true, current: true };
            }
            if (currentStr < incomingStr) {
                return { converge: true, incoming: true };
            }
        }

        // Concurrent updates that couldn't be resolved
        return {
            err: new HAMError(
                `Concurrent updates detected: ${incomingValue} and ${currentValue}`
            )
        };
    }

    unwrap(value) {
        const isWrapped = value && value['#'] && value['.'] && value['>'];
        return isWrapped ? value[':'] : value;
    }

    union(vertex, node) {
        validateType(vertex, 'object');
        validateType(node, 'object');

        if (!vertex) return node;
        if (!node) return vertex;

        const machineState = this.machineState();

        // Copy soul from incoming node if present
        if (node['_']?.['#']) {
            vertex['_'] = vertex['_'] || {};
            vertex['_']['#'] = node['_']['#'];
        }

        for (const key in node) {
            if (key === '_') continue;

            const incomingState = State.getState(node, key);
            const currentState = State.getState(vertex, key);
            const incomingValue = node[key];
            const currentValue = vertex[key];

            const result = this.ham(
                machineState,
                incomingState,
                currentState,
                incomingValue,
                currentValue
            );

            if (result.err) {
                this.log('error', result.err.message);
                continue;
            }

            // Skip if no update needed
            if (result.state || result.historical || result.current) {
                continue;
            }

            // Apply update for defer or incoming
            if (result.defer || result.incoming) {
                State.ify(vertex, key, incomingState, incomingValue);
            }
        }

        return vertex;
    }

    machineState() {
        const state = new VectorClock();
        state.increment(this.nodeId);
        return state;
    }

    graph(graph, soul, key, value, state) {
        validateType(graph, 'object');
        validateType(soul, 'string');
        validateType(key, 'string');
        validateVectorClock(state);

        graph[soul] = State.ify(graph[soul], key, state, value, soul);
        return graph;
    }

    graphOperation(graph, soul, key, value, state) {
        validateType(graph, 'object');
        validateType(soul, 'string');
        validateType(key, 'string');
        validateVectorClock(state);

        if (!graph[soul]) {
            graph[soul] = {
                '_': {
                    '#': soul,
                    '>': {}
                }
            };
        }

        return this.graph(graph, soul, key, value, state);
    }

    mergeGraphs(localGraph, incomingGraph) {
        validateType(localGraph, 'object');
        validateType(incomingGraph, 'object');

        const mergedGraph = { ...localGraph };

        for (const soul in incomingGraph) {
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
