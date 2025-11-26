const { VectorClock, State, Dup, HAM } = require('../src/ham');

describe('VectorClock', () => {
    describe('constructor', () => {
        test('should create empty clock by default', () => {
            const vc = new VectorClock();
            expect(vc.clock.size).toBe(0);
        });

        test('should initialize with provided clock object', () => {
            const vc = new VectorClock({ node1: 5, node2: 3 });
            expect(vc.clock.get('node1')).toBe(5);
            expect(vc.clock.get('node2')).toBe(3);
        });
    });

    describe('increment', () => {
        test('should increment from 0 for new node', () => {
            const vc = new VectorClock();
            vc.increment('node1');
            expect(vc.clock.get('node1')).toBe(1);
        });

        test('should increment existing node value', () => {
            const vc = new VectorClock({ node1: 5 });
            vc.increment('node1');
            expect(vc.clock.get('node1')).toBe(6);
        });

        test('should increment multiple times', () => {
            const vc = new VectorClock();
            vc.increment('node1');
            vc.increment('node1');
            vc.increment('node1');
            expect(vc.clock.get('node1')).toBe(3);
        });

        test('should handle multiple nodes independently', () => {
            const vc = new VectorClock();
            vc.increment('node1');
            vc.increment('node2');
            vc.increment('node1');
            expect(vc.clock.get('node1')).toBe(2);
            expect(vc.clock.get('node2')).toBe(1);
        });
    });

    describe('merge', () => {
        test('should merge empty clocks', () => {
            const vc1 = new VectorClock();
            const vc2 = new VectorClock();
            vc1.merge(vc2);
            expect(vc1.clock.size).toBe(0);
        });

        test('should merge when other clock has new nodes', () => {
            const vc1 = new VectorClock({ node1: 1 });
            const vc2 = new VectorClock({ node2: 2 });
            vc1.merge(vc2);
            expect(vc1.clock.get('node1')).toBe(1);
            expect(vc1.clock.get('node2')).toBe(2);
        });

        test('should take max value for shared nodes', () => {
            const vc1 = new VectorClock({ node1: 3, node2: 1 });
            const vc2 = new VectorClock({ node1: 1, node2: 5 });
            vc1.merge(vc2);
            expect(vc1.clock.get('node1')).toBe(3);
            expect(vc1.clock.get('node2')).toBe(5);
        });

        test('should handle merging into empty clock', () => {
            const vc1 = new VectorClock();
            const vc2 = new VectorClock({ node1: 1, node2: 2 });
            vc1.merge(vc2);
            expect(vc1.clock.get('node1')).toBe(1);
            expect(vc1.clock.get('node2')).toBe(2);
        });
    });

    describe('compare', () => {
        test('should return 0 for equal clocks', () => {
            const vc1 = new VectorClock({ node1: 1, node2: 2 });
            const vc2 = new VectorClock({ node1: 1, node2: 2 });
            expect(vc1.compare(vc2)).toBe(0);
        });

        test('should return 0 for empty clocks', () => {
            const vc1 = new VectorClock();
            const vc2 = new VectorClock();
            expect(vc1.compare(vc2)).toBe(0);
        });

        test('should return 1 when this happens-after other', () => {
            const vc1 = new VectorClock({ node1: 2, node2: 3 });
            const vc2 = new VectorClock({ node1: 1, node2: 2 });
            expect(vc1.compare(vc2)).toBe(1);
        });

        test('should return -1 when this happens-before other', () => {
            const vc1 = new VectorClock({ node1: 1, node2: 2 });
            const vc2 = new VectorClock({ node1: 2, node2: 3 });
            expect(vc1.compare(vc2)).toBe(-1);
        });

        test('should return null for concurrent clocks', () => {
            const vc1 = new VectorClock({ node1: 2, node2: 1 });
            const vc2 = new VectorClock({ node1: 1, node2: 2 });
            expect(vc1.compare(vc2)).toBeNull();
        });

        test('should handle missing nodes (treat as 0)', () => {
            const vc1 = new VectorClock({ node1: 1 });
            const vc2 = new VectorClock({ node1: 1, node2: 1 });
            expect(vc1.compare(vc2)).toBe(-1);
        });

        test('should return 1 when other has missing nodes', () => {
            const vc1 = new VectorClock({ node1: 1, node2: 1 });
            const vc2 = new VectorClock({ node1: 1 });
            expect(vc1.compare(vc2)).toBe(1);
        });
    });

    describe('toString', () => {
        test('should return JSON string representation', () => {
            const vc = new VectorClock({ node1: 1, node2: 2 });
            const str = vc.toString();
            const parsed = JSON.parse(str);
            expect(parsed.node1).toBe(1);
            expect(parsed.node2).toBe(2);
        });

        test('should return empty object for empty clock', () => {
            const vc = new VectorClock();
            expect(vc.toString()).toBe('{}');
        });
    });

    describe('gunStateToVectorClock', () => {
        test('should convert Gun state to VectorClock', () => {
            const gunState = { node1: 1, node2: 2 };
            const vc = VectorClock.gunStateToVectorClock(gunState);
            expect(vc).toBeInstanceOf(VectorClock);
            expect(vc.clock.get('node1')).toBe(1);
            expect(vc.clock.get('node2')).toBe(2);
        });

        test('should handle empty Gun state', () => {
            const gunState = {};
            const vc = VectorClock.gunStateToVectorClock(gunState);
            expect(vc.clock.size).toBe(0);
        });
    });

    describe('vectorClockToGunState', () => {
        test('should convert VectorClock to Gun state', () => {
            const vc = new VectorClock({ node1: 1, node2: 2 });
            const gunState = VectorClock.vectorClockToGunState(vc);
            expect(gunState).toEqual({ node1: 1, node2: 2 });
        });

        test('should handle empty VectorClock', () => {
            const vc = new VectorClock();
            const gunState = VectorClock.vectorClockToGunState(vc);
            expect(gunState).toEqual({});
        });
    });

    describe('round-trip conversion', () => {
        test('should preserve data through Gun state conversion', () => {
            const original = { node1: 5, node2: 10, node3: 15 };
            const vc = VectorClock.gunStateToVectorClock(original);
            const result = VectorClock.vectorClockToGunState(vc);
            expect(result).toEqual(original);
        });
    });
});

describe('State', () => {
    describe('is', () => {
        test('should return true when state exists', () => {
            const node = {
                _: { '>': { key1: new VectorClock({ node1: 1 }) } },
                key1: 'value1'
            };
            expect(State.is(node, 'key1')).toBe(true);
        });

        test('should return false when state does not exist', () => {
            const node = { _: { '>': {} } };
            expect(State.is(node, 'key1')).toBe(false);
        });

        test('should return false when node has no metadata', () => {
            const node = { key1: 'value1' };
            expect(State.is(node, 'key1')).toBeFalsy();
        });

        test('should return false when state is not a VectorClock', () => {
            const node = { _: { '>': { key1: 12345 } } };
            expect(State.is(node, 'key1')).toBe(false);
        });

        test('should throw on invalid node type', () => {
            expect(() => State.is('string', 'key')).toThrow();
        });

        test('should throw on invalid key type', () => {
            expect(() => State.is({}, 123)).toThrow();
        });
    });

    describe('ify', () => {
        test('should set state and value on node', () => {
            const node = { _: { '>': {} } };
            const state = new VectorClock({ node1: 1 });
            State.ify(node, 'key1', state, 'value1');
            expect(node.key1).toBe('value1');
            expect(node._['>'].key1).toBe(state);
        });

        test('should set soul when provided', () => {
            const node = { _: { '>': {} } };
            const state = new VectorClock({ node1: 1 });
            State.ify(node, 'key1', state, 'value1', 'mySoul');
            expect(node._['#']).toBe('mySoul');
        });

        test('should update state when new state happens-after', () => {
            const node = { _: { '>': { key1: new VectorClock({ node1: 1 }) } }, key1: 'old' };
            const newState = new VectorClock({ node1: 2 });
            State.ify(node, 'key1', newState, 'new');
            expect(node.key1).toBe('new');
            expect(node._['>'].key1).toBe(newState);
        });

        test('should not update state when new state happens-before', () => {
            const existingState = new VectorClock({ node1: 5 });
            const node = { _: { '>': { key1: existingState } }, key1: 'old' };
            const newState = new VectorClock({ node1: 1 });
            State.ify(node, 'key1', newState, 'new');
            expect(node.key1).toBe('old');
            expect(node._['>'].key1).toBe(existingState);
        });

        test('should throw on invalid node structure', () => {
            expect(() => State.ify({}, 'key', new VectorClock(), 'val')).toThrow('Invalid node structure');
        });

        test('should throw on non-VectorClock state', () => {
            const node = { _: { '>': {} } };
            expect(() => State.ify(node, 'key', 12345, 'val')).toThrow();
        });

        test('should initialize state object if not present', () => {
            const node = { _: {} };
            const state = new VectorClock({ node1: 1 });
            State.ify(node, 'key1', state, 'value1');
            expect(node._['>']).toBeDefined();
            expect(node._['>'].key1).toBe(state);
        });
    });

    describe('getState', () => {
        test('should return state when it exists', () => {
            const state = new VectorClock({ node1: 1 });
            const node = { _: { '>': { key1: state } } };
            expect(State.getState(node, 'key1')).toBe(state);
        });

        test('should return empty VectorClock when state does not exist', () => {
            const node = { _: { '>': {} } };
            const result = State.getState(node, 'key1');
            expect(result).toBeInstanceOf(VectorClock);
            expect(result.clock.size).toBe(0);
        });

        test('should return empty VectorClock when node has no metadata', () => {
            const node = {};
            const result = State.getState(node, 'key1');
            expect(result).toBeInstanceOf(VectorClock);
            expect(result.clock.size).toBe(0);
        });

        test('should throw on invalid node type', () => {
            expect(() => State.getState('string', 'key')).toThrow();
        });

        test('should throw on invalid key type', () => {
            expect(() => State.getState({}, 123)).toThrow();
        });
    });
});

describe('Dup', () => {
    describe('constructor', () => {
        test('should create with default TTL', () => {
            const dup = new Dup();
            expect(dup.ttl).toBe(300000);
            expect(dup.s.size).toBe(0);
        });

        test('should accept custom TTL', () => {
            const dup = new Dup({ ttl: 60000 });
            expect(dup.ttl).toBe(60000);
        });
    });

    describe('track', () => {
        test('should track new ID', () => {
            const dup = new Dup();
            const result = dup.track('id1');
            expect(result).toBeDefined();
            expect(result.ts).toBeDefined();
            expect(result.clock).toBeInstanceOf(VectorClock);
        });

        test('should return existing entry for already tracked ID', () => {
            const dup = new Dup();
            const first = dup.track('id1');
            const second = dup.track('id1');
            expect(first).toBe(second);
        });

        test('should return undefined for empty string', () => {
            const dup = new Dup();
            expect(dup.track('')).toBeUndefined();
        });

        test('should throw on non-string ID', () => {
            const dup = new Dup();
            expect(() => dup.track(123)).toThrow();
        });

        test('should track multiple IDs independently', () => {
            const dup = new Dup();
            const r1 = dup.track('id1');
            const r2 = dup.track('id2');
            expect(r1).not.toBe(r2);
            expect(dup.s.size).toBe(2);
        });
    });

    describe('check', () => {
        test('should return entry for tracked ID', () => {
            const dup = new Dup();
            dup.track('id1');
            const result = dup.check('id1');
            expect(result).toBeDefined();
            expect(result.ts).toBeDefined();
        });

        test('should return undefined for untracked ID', () => {
            const dup = new Dup();
            expect(dup.check('unknown')).toBeUndefined();
        });

        test('should return undefined for empty string', () => {
            const dup = new Dup();
            expect(dup.check('')).toBeUndefined();
        });

        test('should throw on non-string ID', () => {
            const dup = new Dup();
            expect(() => dup.check(123)).toThrow();
        });
    });

    describe('free', () => {
        test('should remove expired entries', () => {
            const dup = new Dup({ ttl: 100 });
            dup.track('id1');
            dup.s.get('id1').ts = Date.now() - 200;
            dup.free();
            expect(dup.s.size).toBe(0);
        });

        test('should keep non-expired entries', () => {
            const dup = new Dup({ ttl: 100000 });
            dup.track('id1');
            dup.free();
            expect(dup.s.size).toBe(1);
        });

        test('should handle mix of expired and non-expired', () => {
            const dup = new Dup({ ttl: 100 });
            dup.track('expired');
            dup.track('fresh');
            dup.s.get('expired').ts = Date.now() - 200;
            dup.free();
            expect(dup.s.has('expired')).toBe(false);
            expect(dup.s.has('fresh')).toBe(true);
        });

        test('should handle empty map', () => {
            const dup = new Dup();
            expect(() => dup.free()).not.toThrow();
        });
    });
});

describe('HAM', () => {
    describe('constructor', () => {
        test('should initialize with nodeId', () => {
            const ham = new HAM('node1');
            expect(ham.nodeId).toBe('node1');
        });

        test('should start with debug mode disabled', () => {
            const ham = new HAM('node1');
            expect(ham.debugMode).toBe(false);
        });
    });

    describe('setDebugMode', () => {
        test('should enable debug mode', () => {
            const ham = new HAM('node1');
            ham.setDebugMode(true);
            expect(ham.debugMode).toBe(true);
        });

        test('should disable debug mode', () => {
            const ham = new HAM('node1');
            ham.setDebugMode(true);
            ham.setDebugMode(false);
            expect(ham.debugMode).toBe(false);
        });
    });

    describe('log', () => {
        test('should log when debug mode is enabled', () => {
            const ham = new HAM('node1');
            ham.setDebugMode(true);
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            ham.log('info', 'test message');
            expect(consoleSpy).toHaveBeenCalledWith('[HAM INFO] test message');
            consoleSpy.mockRestore();
        });

        test('should not log when debug mode is disabled', () => {
            const ham = new HAM('node1');
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            ham.log('info', 'test message');
            expect(consoleSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('machineState', () => {
        test('should return VectorClock with nodeId incremented', () => {
            const ham = new HAM('node1');
            const state = ham.machineState();
            expect(state).toBeInstanceOf(VectorClock);
            expect(state.clock.get('node1')).toBe(1);
        });
    });

    describe('unwrap', () => {
        test('should unwrap wrapped Gun value', () => {
            const ham = new HAM('node1');
            const wrapped = { '#': 'soul', '.': 'key', '>': 123, ':': 'actualValue' };
            expect(ham.unwrap(wrapped)).toBe('actualValue');
        });

        test('should return value as-is if not wrapped', () => {
            const ham = new HAM('node1');
            expect(ham.unwrap('plainValue')).toBe('plainValue');
            expect(ham.unwrap(123)).toBe(123);
            expect(ham.unwrap(null)).toBe(null);
        });

        test('should return value if missing required wrapper fields', () => {
            const ham = new HAM('node1');
            expect(ham.unwrap({ '#': 'soul' })).toEqual({ '#': 'soul' });
            expect(ham.unwrap({ '#': 'soul', '.': 'key' })).toEqual({ '#': 'soul', '.': 'key' });
        });
    });

    describe('ham (conflict resolution)', () => {
        let ham;

        beforeEach(() => {
            ham = new HAM('node1');
        });

        test('should defer when machine state is after incoming state', () => {
            const machineState = new VectorClock({ node1: 5 });
            const incomingState = new VectorClock({ node1: 1 });
            const currentState = new VectorClock({ node1: 1 });
            const result = ham.ham(machineState, incomingState, currentState, 'incoming', 'current');
            expect(result).toEqual({ defer: true });
        });

        test('should mark historical when incoming is before current', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 1 });
            const currentState = new VectorClock({ node1: 5 });
            const result = ham.ham(machineState, incomingState, currentState, 'incoming', 'current');
            expect(result).toEqual({ historical: true });
        });

        test('should converge to incoming when incoming is after current', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 5 });
            const currentState = new VectorClock({ node1: 1 });
            const result = ham.ham(machineState, incomingState, currentState, 'incoming', 'current');
            expect(result).toEqual({ converge: true, incoming: true });
        });

        test('should return state true when values are equal (same state)', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 1 });
            const currentState = new VectorClock({ node1: 1 });
            const result = ham.ham(machineState, incomingState, currentState, 'same', 'same');
            expect(result).toEqual({ state: true });
        });

        test('should converge to current when current is lexicographically greater (equal states)', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 1 });
            const currentState = new VectorClock({ node1: 1 });
            const result = ham.ham(machineState, incomingState, currentState, 'aaa', 'zzz');
            expect(result).toEqual({ converge: true, current: true });
        });

        test('should converge to incoming when incoming is lexicographically greater (equal states)', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 1 });
            const currentState = new VectorClock({ node1: 1 });
            const result = ham.ham(machineState, incomingState, currentState, 'zzz', 'aaa');
            expect(result).toEqual({ converge: true, incoming: true });
        });

        test('should return error for concurrent updates with different values', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 2, node2: 1 });
            const currentState = new VectorClock({ node1: 1, node2: 2 });
            const result = ham.ham(machineState, incomingState, currentState, 'val1', 'val2');
            expect(result.err).toBeDefined();
            expect(result.err.name).toBe('HAMError');
        });

        test('should handle numeric values in lexicographic comparison', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 1 });
            const currentState = new VectorClock({ node1: 1 });
            const result = ham.ham(machineState, incomingState, currentState, 100, 99);
            expect(result).toEqual({ converge: true, current: true });
        });

        test('should throw on non-VectorClock states', () => {
            expect(() => ham.ham({}, new VectorClock(), new VectorClock(), 'a', 'b')).toThrow();
            expect(() => ham.ham(new VectorClock(), {}, new VectorClock(), 'a', 'b')).toThrow();
            expect(() => ham.ham(new VectorClock(), new VectorClock(), {}, 'a', 'b')).toThrow();
        });

        test('should unwrap wrapped values before comparison', () => {
            const machineState = new VectorClock({ node1: 1 });
            const incomingState = new VectorClock({ node1: 1 });
            const currentState = new VectorClock({ node1: 1 });
            const wrappedIncoming = { '#': 's', '.': 'k', '>': 1, ':': 'same' };
            const wrappedCurrent = { '#': 's', '.': 'k', '>': 1, ':': 'same' };
            const result = ham.ham(machineState, incomingState, currentState, wrappedIncoming, wrappedCurrent);
            expect(result).toEqual({ state: true });
        });
    });

    describe('union', () => {
        let ham;

        beforeEach(() => {
            ham = new HAM('node1');
        });

        test('should return node when vertex is null', () => {
            const node = { _: { '#': 'soul', '>': {} }, key: 'value' };
            expect(ham.union(null, node)).toBe(node);
        });

        test('should return vertex when node is null', () => {
            const vertex = { _: { '#': 'soul', '>': {} }, key: 'value' };
            expect(ham.union(vertex, null)).toBe(vertex);
        });

        test('should merge node into vertex', () => {
            const state = new VectorClock({ node1: 1 });
            const vertex = { _: { '#': 'soul1', '>': {} } };
            const node = { _: { '#': 'soul2', '>': { key: state } }, key: 'value' };
            const result = ham.union(vertex, node);
            expect(result.key).toBe('value');
            expect(result._['#']).toBe('soul2');
        });

        test('should skip underscore key during iteration', () => {
            const vertex = { _: { '>': {} } };
            const node = { _: { '#': 'soul', '>': {} } };
            const result = ham.union(vertex, node);
            expect(result._['#']).toBe('soul');
        });

        test('should handle errors gracefully (log and continue)', () => {
            ham.setDebugMode(true);
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            const vertex = { _: { '>': {} } };
            const concurrentState1 = new VectorClock({ node1: 2, node2: 1 });
            const concurrentState2 = new VectorClock({ node1: 1, node2: 2 });
            vertex._['>'].key = concurrentState2;
            vertex.key = 'current';
            const node = { _: { '>': { key: concurrentState1 } }, key: 'incoming' };
            ham.union(vertex, node);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        test('should not update when result is historical', () => {
            const oldState = new VectorClock({ node1: 1 });
            const newState = new VectorClock({ node1: 5 });
            const vertex = { _: { '>': { key: newState } }, key: 'current' };
            const node = { _: { '>': { key: oldState } }, key: 'old' };
            ham.union(vertex, node);
            expect(vertex.key).toBe('current');
        });

        test('should throw on invalid vertex type', () => {
            expect(() => ham.union('string', {})).toThrow();
        });

        test('should throw on invalid node type', () => {
            expect(() => ham.union({}, 'string')).toThrow();
        });
    });

    describe('graph', () => {
        let ham;

        beforeEach(() => {
            ham = new HAM('node1');
        });

        test('should add node to graph', () => {
            const graph = { existingSoul: { _: { '#': 'existingSoul', '>': {} } } };
            const state = new VectorClock({ node1: 1 });
            ham.graph(graph, 'existingSoul', 'newKey', 'newValue', state);
            expect(graph.existingSoul.newKey).toBe('newValue');
        });

        test('should throw on invalid graph type', () => {
            expect(() => ham.graph('string', 'soul', 'key', 'val', new VectorClock())).toThrow();
        });

        test('should throw on invalid soul type', () => {
            expect(() => ham.graph({}, 123, 'key', 'val', new VectorClock())).toThrow();
        });

        test('should throw on invalid key type', () => {
            expect(() => ham.graph({}, 'soul', 123, 'val', new VectorClock())).toThrow();
        });

        test('should throw on invalid state type', () => {
            expect(() => ham.graph({}, 'soul', 'key', 'val', {})).toThrow();
        });
    });

    describe('graphOperation', () => {
        let ham;

        beforeEach(() => {
            ham = new HAM('node1');
        });

        test('should create new node in graph if not exists', () => {
            const graph = {};
            const state = new VectorClock({ node1: 1 });
            ham.graphOperation(graph, 'newSoul', 'key', 'value', state);
            expect(graph.newSoul).toBeDefined();
            expect(graph.newSoul._['#']).toBe('newSoul');
            expect(graph.newSoul.key).toBe('value');
        });

        test('should update existing node in graph', () => {
            const state1 = new VectorClock({ node1: 1 });
            const state2 = new VectorClock({ node1: 2 });
            const graph = { soul: { _: { '#': 'soul', '>': { key1: state1 } }, key1: 'val1' } };
            ham.graphOperation(graph, 'soul', 'key2', 'val2', state2);
            expect(graph.soul.key1).toBe('val1');
            expect(graph.soul.key2).toBe('val2');
        });

        test('should throw on invalid parameters', () => {
            expect(() => ham.graphOperation('string', 'soul', 'key', 'val', new VectorClock())).toThrow();
        });
    });

    describe('mergeGraphs', () => {
        let ham;

        beforeEach(() => {
            ham = new HAM('node1');
        });

        test('should merge non-overlapping graphs', () => {
            const state1 = new VectorClock({ node1: 1 });
            const state2 = new VectorClock({ node1: 1 });
            const localGraph = {
                soul1: { _: { '#': 'soul1', '>': { key: state1 } }, key: 'val1' }
            };
            const incomingGraph = {
                soul2: { _: { '#': 'soul2', '>': { key: state2 } }, key: 'val2' }
            };
            const result = ham.mergeGraphs(localGraph, incomingGraph);
            expect(result.soul1).toBeDefined();
            expect(result.soul2).toBeDefined();
        });

        test('should merge overlapping graphs using union', () => {
            const oldState = new VectorClock({ node1: 1 });
            const newState = new VectorClock({ node1: 2 });
            const localGraph = {
                soul: { _: { '#': 'soul', '>': { key: oldState } }, key: 'old' }
            };
            const incomingGraph = {
                soul: { _: { '#': 'soul', '>': { key: newState } }, key: 'new' }
            };
            const result = ham.mergeGraphs(localGraph, incomingGraph);
            expect(result.soul.key).toBe('new');
        });

        test('should skip underscore key in incoming graph', () => {
            const localGraph = {};
            const incomingGraph = { _: { metadata: 'data' } };
            const result = ham.mergeGraphs(localGraph, incomingGraph);
            expect(result._).toBeUndefined();
        });

        test('should not mutate original local graph', () => {
            const state = new VectorClock({ node1: 1 });
            const localGraph = { soul1: { _: { '#': 'soul1', '>': {} } } };
            const incomingGraph = { soul2: { _: { '#': 'soul2', '>': { key: state } }, key: 'val' } };
            const result = ham.mergeGraphs(localGraph, incomingGraph);
            expect(localGraph.soul2).toBeUndefined();
            expect(result.soul2).toBeDefined();
        });

        test('should throw on invalid local graph type', () => {
            expect(() => ham.mergeGraphs('string', {})).toThrow();
        });

        test('should throw on invalid incoming graph type', () => {
            expect(() => ham.mergeGraphs({}, 'string')).toThrow();
        });
    });
});

describe('Integration Tests', () => {
    test('full workflow: create, update, merge distributed data', () => {
        const ham1 = new HAM('node1');
        const ham2 = new HAM('node2');

        const graph1 = {};
        const state1 = new VectorClock({ node1: 1 });
        ham1.graphOperation(graph1, 'user1', 'name', 'Alice', state1);

        const graph2 = {};
        const state2 = new VectorClock({ node2: 1 });
        ham2.graphOperation(graph2, 'user2', 'name', 'Bob', state2);

        const mergedFromNode1 = ham1.mergeGraphs(graph1, graph2);
        expect(mergedFromNode1.user1.name).toBe('Alice');
        expect(mergedFromNode1.user2.name).toBe('Bob');

        const mergedFromNode2 = ham2.mergeGraphs(graph2, graph1);
        expect(mergedFromNode2.user1.name).toBe('Alice');
        expect(mergedFromNode2.user2.name).toBe('Bob');
    });

    test('conflict resolution with concurrent updates', () => {
        const ham = new HAM('resolver');

        const state1 = new VectorClock({ node1: 1 });
        const state2 = new VectorClock({ node1: 2 });

        const localGraph = {
            doc: { _: { '#': 'doc', '>': { content: state1 } }, content: 'old content' }
        };
        const incomingGraph = {
            doc: { _: { '#': 'doc', '>': { content: state2 } }, content: 'new content' }
        };

        const merged = ham.mergeGraphs(localGraph, incomingGraph);
        expect(merged.doc.content).toBe('new content');
    });

    test('Gun state conversion round-trip with HAM operations', () => {
        const ham = new HAM('node1');

        const gunState = { node1: 5, node2: 3 };
        const vc = VectorClock.gunStateToVectorClock(gunState);

        const graph = {};
        ham.graphOperation(graph, 'item', 'value', 42, vc);

        expect(graph.item.value).toBe(42);
        expect(graph.item._['>'].value).toBeInstanceOf(VectorClock);

        const retrievedState = State.getState(graph.item, 'value');
        const backToGun = VectorClock.vectorClockToGunState(retrievedState);
        expect(backToGun).toEqual(gunState);
    });
});
