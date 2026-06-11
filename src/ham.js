/**
 * @fileoverview Hypothetical Amnesia Machine (HAM) algorithm implementation
 * for distributed conflict resolution with Vector Clocks.
 * Compatible with GunDB distributed data structures.
 * @version 0.1.4
 */

// ============================================================================
// Constants & Pre-allocated Results
// ============================================================================

/** Default TTL for deduplication entries (5 minutes in milliseconds). */
const DEFAULT_DUP_TTL_MS = 300000;

/**
 * Pre-allocated result for deferred updates.
 * Used when machine state is after incoming state.
 * @constant {Readonly<object>}
 */
const RESULT_DEFER = Object.freeze({ defer: true });

/**
 * Pre-allocated result for historical (ignored) updates.
 * Used when incoming state is before current state.
 * @constant {Readonly<object>}
 */
const RESULT_HISTORICAL = Object.freeze({ historical: true });

/**
 * Pre-allocated result for converging to incoming value.
 * Used when incoming state is after current state or lexicographically greater.
 * @constant {Readonly<object>}
 */
const RESULT_CONVERGE_INCOMING = Object.freeze({ converge: true, incoming: true });

/**
 * Pre-allocated result for converging to current value.
 * Used during lexicographic tie-breaking when current value is greater.
 * @constant {Readonly<object>}
 */
const RESULT_CONVERGE_CURRENT = Object.freeze({ converge: true, current: true });

/**
 * Pre-allocated result indicating state equality.
 * Used when values are identical with equal vector clocks.
 * @constant {Readonly<object>}
 */
const RESULT_STATE = Object.freeze({ state: true });

// ============================================================================
// Custom Error
// ============================================================================

/**
 * Domain-specific error for HAM operations.
 * Thrown when validation fails or concurrent updates cannot be resolved.
 */
class HAMError extends Error {
    /**
     * @param {string} message - Error description
     */
    constructor(message) {
        super(message);
        this.name = 'HAMError';
    }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates that a value is of the expected type.
 * @param {*} value - The value to validate
 * @param {string} expectedType - The expected JavaScript type (e.g., 'string', 'object')
 * @throws {HAMError} If the value type does not match the expected type
 */
function validateType(value, expectedType) {
    if (typeof value !== expectedType) {
        throw new HAMError(`Expected ${expectedType}, got ${typeof value}`);
    }
}

/**
 * Validates that a value is a VectorClock instance.
 * @param {*} value - The value to validate
 * @throws {HAMError} If the value is not a VectorClock instance
 */
function validateVectorClock(value) {
    if (!(value instanceof VectorClock)) {
        throw new HAMError(`Expected VectorClock, got ${typeof value}`);
    }
}

// ============================================================================
// VectorClock
// ============================================================================

/**
 * Implements vector clock logic for distributed event ordering.
 * Vector clocks track causality between events across distributed systems.
 * @see https://en.wikipedia.org/wiki/Vector_clock
 */
class VectorClock {
    /**
     * Creates a new VectorClock instance.
     * @param {Object.<string, number>} [initialClock] - Optional initial clock state as nodeId->timestamp map
     */
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

    /**
     * Increments the clock timestamp for a given node.
     * @param {string} nodeId - The identifier of the node
     * @returns {void}
     */
    increment(nodeId) {
        this.clock.set(nodeId, (this.clock.get(nodeId) || 0) + 1);
    }

    /**
     * Merges this vector clock with another, taking the maximum timestamp for each node.
     * @param {VectorClock} otherClock - The other vector clock to merge
     * @returns {void}
     */
    merge(otherClock) {
        const otherMap = otherClock.clock;
        for (const [nodeId, timestamp] of otherMap) {
            const current = this.clock.get(nodeId);
            if (current === undefined || timestamp > current) {
                this.clock.set(nodeId, timestamp);
            }
        }
    }

    /**
     * Compares this vector clock with another using the HAM (Hypothetical Amnesia Machine) ordering.
     * @param {VectorClock} otherClock - The other vector clock to compare
     * @returns {number|null} 1 if this happens after other, -1 if before, 0 if equal, null if concurrent
     */
    compare(otherClock) {
        const thisMap = this.clock;
        const otherMap = otherClock.clock;
        let thisIsGreater = false;
        let otherIsGreater = false;

        // Check all entries in this clock
        for (const [nodeId, thisTime] of thisMap) {
            const otherTime = otherMap.get(nodeId) || 0;
            if (thisTime > otherTime) {
                thisIsGreater = true;
                if (otherIsGreater) return null; // Concurrent early-exit
            } else if (thisTime < otherTime) {
                otherIsGreater = true;
                if (thisIsGreater) return null; // Concurrent early-exit
            }
        }

        // If other clock is already proven greater, return immediately
        if (otherIsGreater) return -1;

        // Check entries in other clock not in this clock
        for (const [nodeId] of otherMap) {
            if (!thisMap.has(nodeId)) {
                if (thisIsGreater) return null; // Concurrent early-exit
                otherIsGreater = true;
                break;
            }
        }

        // Return based on comparison result
        if (thisIsGreater) return 1;       // This clock is strictly after
        if (otherIsGreater) return -1;     // Other clock is strictly after
        return 0;                          // Clocks are equal
    }

    /**
     * Returns a JSON string representation of the vector clock.
     * @returns {string} JSON string representation
     */
    toString() {
        return JSON.stringify(Object.fromEntries(this.clock));
    }

    /**
     * Converts GunDB state format to a VectorClock instance.
     * @param {Object.<string, number>} gunState - GunDB state object
     * @returns {VectorClock} New VectorClock with converted state
     */
    static gunStateToVectorClock(gunState) {
        const vc = new VectorClock();
        const keys = Object.keys(gunState);
        for (let i = 0, len = keys.length; i < len; i++) {
            const key = keys[i];
            vc.clock.set(key, gunState[key]);
        }
        return vc;
    }

    /**
     * Converts a VectorClock instance to GunDB state format.
     * @param {VectorClock} vectorClock - The vector clock to convert
     * @returns {Object.<string, number>} GunDB state object
     */
    static vectorClockToGunState(vectorClock) {
        return Object.fromEntries(vectorClock.clock);
    }
}

/**
 * A read-only representation of a Vector Clock.
 * Uses a protected Map to prevent state mutation.
 * Used for the shared EMPTY_VECTOR_CLOCK to prevent accidental modification.
 * @extends VectorClock
 */
class ReadOnlyVectorClock extends VectorClock {
    /**
     * Creates a new ReadOnlyVectorClock instance.
     * Initializes with an empty protected clock.
     */
    constructor() {
        super();
    }

    /**
     * Override increment to throw - prevents any state modification.
     * @param {string} nodeId - Ignored
     * @throws {HAMError} Always throws
     */
    increment() {
        throw new HAMError('Cannot mutate read-only VectorClock');
    }

    /**
     * Override merge to throw - prevents any state modification.
     * @param {*} otherClock - Ignored
     * @throws {HAMError} Always throws
     */
    merge() {
        throw new HAMError('Cannot mutate read-only VectorClock');
    }
}

/**
 * Shared read-only empty VectorClock for getState fallback.
 * Prevents memory allocations when returning empty states.
 * @constant {ReadOnlyVectorClock}
 */
const EMPTY_VECTOR_CLOCK = new ReadOnlyVectorClock();

// ============================================================================
// State
// ============================================================================

/**
 * Manages node state metadata in GunDB-compatible format.
 * State metadata tracks vector clock information for each key in a node.
 */
class State {
    /**
     * Checks if state exists for a given key on a node.
     * @param {Object} node - The node object with optional '_' metadata
     * @param {string} key - The key to check state for
     * @returns {boolean} True if state exists and is a VectorClock
     * @throws {HAMError} If node or key types are invalid
     */
    static is(node, key) {
        validateType(node, 'object');
        validateType(key, 'string');

        const meta = node && node._;
        if (!meta) return false;
        const stateMap = meta['>'];
        if (!stateMap) return false;
        return stateMap[key] instanceof VectorClock;
    }

    /**
     * Sets state and optional value on a node if the new state happens after existing state.
     * @param {Object} node - The node object
     * @param {string} key - The key to set state for
     * @param {VectorClock} state - The vector clock state
     * @param {*} [value] - Optional value to set on the node
     * @param {string} [soul] - Optional soul identifier for the node
     * @returns {Object} The modified node
     * @throws {HAMError} If types are invalid or node structure is invalid
     */
    static ify(node, key, state, value, soul) {
        validateType(node, 'object');
        validateType(key, 'string');
        validateVectorClock(state);

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

    /**
     * Gets the state for a given key on a node.
     * @param {Object} node - The node object
     * @param {string} key - The key to get state for
     * @returns {VectorClock} The state VectorClock or EMPTY_VECTOR_CLOCK
     * @throws {HAMError} If node or key types are invalid
     */
    static getState(node, key) {
        validateType(node, 'object');
        validateType(key, 'string');

        const meta = node && node._;
        if (!meta) return EMPTY_VECTOR_CLOCK;
        const stateMap = meta['>'];
        if (!stateMap) return EMPTY_VECTOR_CLOCK;
        return stateMap[key] || EMPTY_VECTOR_CLOCK;
    }
}

// ============================================================================
// Dup
// ============================================================================

/**
 * Deduplication tracker with TTL-based expiration.
 * Used to prevent processing duplicate operations in distributed systems.
 */
class Dup {
    /**
     * Creates a new Dup instance.
     * @param {Object} [options] - Configuration options
     * @param {number} [options.ttl] - Time-to-live for entries in milliseconds
     */
    constructor(options) {
        this.entries = new Map();
        this.ttl = (options && options.ttl) || DEFAULT_DUP_TTL_MS;
    }

    /**
     * Gets the entries Map (for testing access).
     * @returns {Map} The entries Map
     */
    get s() {
        return this.entries;
    }

    /**
     * Tracks a new ID or returns existing entry.
     * @param {string} id - The unique identifier to track
     * @returns {Object|undefined} Entry object with ts and clock, or undefined if id is empty
     * @throws {HAMError} If id is not a string
     */
    track(id) {
        validateType(id, 'string');
        if (!id) return undefined;

        let entry = this.entries.get(id);
        if (!entry) {
            entry = { ts: Date.now(), clock: new VectorClock() };
            this.entries.set(id, entry);
        }
        return entry;
    }

    /**
     * Checks if an ID is being tracked.
     * @param {string} id - The unique identifier to check
     * @returns {Object|undefined} Entry object if tracked, undefined otherwise
     * @throws {HAMError} If id is not a string
     */
    check(id) {
        validateType(id, 'string');
        if (!id) return undefined;
        return this.entries.get(id);
    }

    /**
     * Removes expired entries based on TTL.
     * @returns {void}
     */
    free() {
        const now = Date.now();
        const ttl = this.ttl;
        const entries = this.entries;

        for (const [id, data] of entries) {
            if (data.ts && (now - data.ts) > ttl) {
                entries.delete(id);
            }
        }
    }
}

// ============================================================================
// HAM
// ============================================================================

/**
 * Hypothetical Amnesia Machine conflict resolution engine.
 * Resolves concurrent updates in distributed systems using vector clocks.
 * @see https://en.wikipedia.org/wiki/Hypothetical_Amnesia_Machine
 */
class HAM {
    /**
     * Creates a new HAM instance.
     * @param {string} nodeId - Unique identifier for this node
     */
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.debugMode = false;
    }

    /**
     * Resolves conflict between incoming and current state using the HAM algorithm.
     * @param {VectorClock} machineState - Current machine's vector clock
     * @param {VectorClock} incomingState - Incoming update's vector clock
     * @param {VectorClock} currentState - Current state's vector clock
     * @param {*} incomingValue - Incoming value
     * @param {*} currentValue - Current value
     * @returns {Object} Result object with resolution decision
     * @throws {HAMError} If any state parameter is not a VectorClock
     */
    ham(machineState, incomingState, currentState, incomingValue, currentValue) {
        validateVectorClock(machineState);
        validateVectorClock(incomingState);
        validateVectorClock(currentState);

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

    /**
     * Unwraps a GunDB-wrapped value if it has the required fields.
     * @param {*} value - The value to unwrap
     * @returns {*} The unwrapped value or original value
     */
    unwrap(value) {
        if (value && value['#'] && value['.'] && value['>']) {
            return value[':'];
        }
        return value;
    }

    /**
     * Merges a node into a vertex using HAM conflict resolution.
     * @param {Object} vertex - The target vertex (current state)
     * @param {Object} node - The source node (incoming state)
     * @returns {Object} The merged vertex
     * @throws {HAMError} If vertex or node types are invalid
     */
    union(vertex, node) {
        validateType(vertex, 'object');
        validateType(node, 'object');

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

    /**
     * Creates a new machine state with the current node's clock incremented.
     * @returns {VectorClock} New vector clock with nodeId set to 1
     */
    machineState() {
        const state = new VectorClock();
        state.clock.set(this.nodeId, 1);
        return state;
    }

    /**
     * Performs a graph operation to set a value on a node.
     * @param {Object} graph - The graph object
     * @param {string} soul - The soul (unique ID) of the node
     * @param {string} key - The key to set
     * @param {*} value - The value to set
     * @param {VectorClock} state - The vector clock state
     * @returns {Object} The modified graph
     * @throws {HAMError} If any parameter type is invalid
     */
    graph(graph, soul, key, value, state) {
        validateType(graph, 'object');
        validateType(soul, 'string');
        validateType(key, 'string');
        validateVectorClock(state);

        graph[soul] = State.ify(graph[soul], key, state, value, soul);
        return graph;
    }

    /**
     * Performs a graph operation, creating the node if it doesn't exist.
     * @param {Object} graph - The graph object
     * @param {string} soul - The soul (unique ID) of the node
     * @param {string} key - The key to set
     * @param {*} value - The value to set
     * @param {VectorClock} state - The vector clock state
     * @returns {Object} The modified graph
     * @throws {HAMError} If any parameter type is invalid
     */
    graphOperation(graph, soul, key, value, state) {
        validateType(graph, 'object');
        validateType(soul, 'string');
        validateType(key, 'string');
        validateVectorClock(state);

        if (!graph[soul]) {
            graph[soul] = { _: { '#': soul, '>': {} } };
        }

        return this.graph(graph, soul, key, value, state);
    }

    /**
     * Merges two graphs together.
     * @param {Object} localGraph - The local graph
     * @param {Object} incomingGraph - The incoming graph to merge
     * @returns {Object} The merged graph
     * @throws {HAMError} If either graph parameter is not an object
     */
    mergeGraphs(localGraph, incomingGraph) {
        validateType(localGraph, 'object');
        validateType(incomingGraph, 'object');

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

    /**
     * Logs a debug message if debug mode is enabled.
     * @param {string} level - Log level (info, warn, error, etc.)
     * @param {string} message - Message to log
     * @returns {void}
     */
    log(level, message) {
        if (this.debugMode) {
            console.log(`[HAM ${level.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Enables or disables debug mode.
     * @param {boolean} enabled - Whether to enable debug mode
     * @returns {void}
     */
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
    HAM,
    // Internal test helpers (not part of public API)
    _internal: {
        validateType,
        validateVectorClock,
        ReadOnlyVectorClock,
        EMPTY_VECTOR_CLOCK
    }
};
