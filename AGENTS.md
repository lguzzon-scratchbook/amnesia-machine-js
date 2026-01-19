# AGENTS.md

## Project Overview

**amnesia-machine** is a JavaScript implementation of the Hypothetical Amnesia Machine (HAM) algorithm with Vector Clocks for conflict resolution in distributed systems. Originally designed for compatibility with GunDB.

## Tech Stack

- **Language**: JavaScript (ES6+)
- **Runtime**: Node.js
- **Testing**: Jest
- **License**: Apache-2.0

## Project Structure

```
amnesia-machine-js/
├── src/
│   ├── index.js      # Main entry point, exports all classes
│   └── ham.js        # Core implementation (VectorClock, State, Dup, HAM)
├── __tests__/
│   └── ham.test.js   # Jest test suite
├── package.json
└── README.md
```

## Core Classes

### VectorClock
Implements vector clock logic for distributed event ordering:
- `increment(nodeId)` - Increment clock for a node
- `merge(otherClock)` - Merge with another vector clock
- `compare(otherClock)` - Returns: 1 (after), -1 (before), 0 (equal), null (concurrent)
- Static conversion methods for GunDB compatibility

### State
Manages node state metadata:
- `is(node, key)` - Check if state exists
- `ify(node, key, state, val, soul)` - Set state on node
- `getState(node, key)` - Retrieve state for a key

### Dup
Deduplication tracking with TTL:
- `track(id)` - Track an ID
- `check(id)` - Check if ID exists
- `free()` - Clean expired entries

### HAM
Main conflict resolution engine:
- `ham(machineState, incomingState, currentState, incomingValue, currentValue)` - Core resolution algorithm
- `union(vertex, node)` - Merge two nodes
- `graph(graph, soul, key, val, state)` - Graph operations
- `mergeGraphs(localGraph, incomingGraph)` - Merge distributed graphs

## Development Commands

```bash
npm install    # Install dependencies
npm test       # Run Jest tests
```

## Code Conventions

- Classes use ES6 class syntax
- Validation via `validateType()` and `validateVectorClock()` helper functions
- Custom `HAMError` class for domain-specific errors
- GunDB metadata structure: `node._ = { '#': soul, '>': { [key]: VectorClock } }`

## Key Concepts

1. **Conflict Resolution Strategy**:
   - Future updates (vs machine state) → defer
   - Past updates (vs current state) → historical (ignore)
   - Concurrent updates → lexicographic comparison of string values

2. **GunDB Compatibility**:
   - Soul (`#`) = unique node identifier
   - State (`>`) = vector clock metadata per key
   - Wrapped values may have format: `{ '#': soul, '.': key, '>': state, ':': value }`

## Testing

Tests are in `__tests__/ham.test.js`. Jest enforces 95%+ coverage across all metrics (statements, branches, functions, lines). Use `npm test` to run tests.

## Intent Layer

**All code follows the conventions documented in this AGENTS.md.** No child Intent Layer nodes exist - this is a focused library implementing a single algorithm (HAM) with a flat, cohesive structure.

### Global Invariants

- **Coverage Requirements**: All public APIs must have corresponding tests. Jest enforces 95%+ coverage across statements, branches, functions, and lines.
- **VectorClock Usage**: All state comparisons must use VectorClock instances. Use `VectorClock.gunStateToVectorClock()` for GunDB compatibility and `validateVectorClock()` for type checking.
- **Error Handling**: All domain errors throw `HAMError` instances. Use `validateType()` and `validateVectorClock()` helpers for validation.
- **Performance**: Avoid creating new objects in hot paths. Use pre-allocated result objects (RESULT_DEFER, RESULT_HISTORICAL, etc.) and shared constants.

### Code Ownership

- **src/ham.js**: Core implementation containing VectorClock, State, Dup, and HAM classes. This is the heart of the library.
- **src/index.js**: Re-exports all classes + `_internal` helpers for testing. Minimal entry point.
- **__tests__/ham.test.js**: Comprehensive Jest test suite covering all classes and validation helpers.

### When to Modify

- **Adding features**: Add tests in `__tests__/ham.test.js` using existing Jest patterns. Ensure 95%+ coverage.
- **Optimizing**: Focus on hot paths in VectorClock.compare() and HAM.ham() which are called frequently in union operations.
- **Breaking changes**: Consider GunDB compatibility when modifying metadata structure (`node._ = { '#': soul, '>': { [key]: VectorClock } }`).

### Anti-patterns

- Never bypass VectorClock for state comparisons; use the provided compare() method.
- Avoid throwing generic errors; always use HAMError with descriptive messages.
- Don't modify result objects (RESULT_DEFER, etc.) - they are frozen constants.
- Never export `_internal` helpers as part of public API - they exist only for test coverage.
