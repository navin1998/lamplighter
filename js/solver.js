'use strict';

// Two solvers live here, deliberately not merged.
//
// The VERIFIER is a plain, pruned, exhaustive depth-first search. It is
// ground truth: slow is fine, but it must never be wrong. It counts
// solutions and stops the instant it finds a second one, because every
// caller only ever needs to know none / exactly one / more than one.
//
// The DEDUCTIVE solver never guesses except at its single top tier (T10,
// depth one). It repeatedly applies the named techniques of techniques.js
// to a knowledge state of USED / UNUSABLE / UNKNOWN edges until nothing
// more can be found, and returns the trace that produced its progress —
// the same trace that drives the rater, the hints and the live help demos.
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var pathLib = isNode ? require('./path.js') : root.LAMP.path;
  var techniques = isNode ? require('./techniques.js') : root.LAMP.techniques;

  var UNKNOWN = 0;
  var USED = 1;
  var UNUSABLE = 2;

  function requiredDegree(grid, cell) {
    return (cell === grid.lampCells[0] || cell === grid.lampCells[grid.lampCount - 1]) ? 1 : 2;
  }

  // Contradictions are expected — T10 provokes them on purpose — so they
  // carry a flag that lets a caller tell them apart from a genuine bug.
  function contradiction(message) {
    var err = new Error('contradiction: ' + message);
    err.contradiction = true;
    throw err;
  }

  // The cells a trace step points at: whatever region the technique was
  // looking at, then the two ends of every edge it flipped, each once.
  function traceCells(grid, focus, edgeIds) {
    var cells = [];
    var seen = Object.create(null);
    function add(cell) {
      if (seen[cell]) return;
      seen[cell] = true;
      cells.push(cell);
    }
    (focus || []).forEach(add);
    edgeIds.forEach(function (id) {
      add(grid.edges[id].a);
      add(grid.edges[id].b);
    });
    return cells;
  }

  function makeUnionFind(size) {
    var parent = new Array(size);
    for (var i = 0; i < size; i += 1) parent[i] = i;
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    return { find: find, union: union };
  }

  // Builds a fresh, fully-wired knowledge state. `fromEdgeState`, when
  // given, seeds it from an existing array (used by clone(), for T10's
  // single hypothetical branch) instead of starting from all-UNKNOWN.
  function buildState(grid, fromEdgeState) {
    // A wall is already fully known from the start — it is never a live
    // candidate, so it starts UNUSABLE rather than UNKNOWN. This lets every
    // technique iterate grid.edges directly without special-casing walls.
    var edgeState = fromEdgeState ? fromEdgeState.slice() : grid.edgeOpen.map(function (open) {
      return open ? UNKNOWN : UNUSABLE;
    });
    var usedDegree = new Array(grid.size).fill(0);
    var uf = makeUnionFind(grid.size);
    var trace = [];

    for (var id = 0; id < edgeState.length; id += 1) {
      if (edgeState[id] === USED) {
        var e0 = grid.edges[id];
        usedDegree[e0.a] += 1;
        usedDegree[e0.b] += 1;
        uf.union(e0.a, e0.b);
      }
    }

    function remainingOptions(cell) {
      var count = usedDegree[cell];
      for (var i = 0; i < grid.cellEdges[cell].length; i += 1) {
        if (edgeState[grid.cellEdges[cell][i].edgeId] === UNKNOWN) count += 1;
      }
      return count;
    }

    var state = {
      grid: grid,
      UNKNOWN: UNKNOWN,
      USED: USED,
      UNUSABLE: UNUSABLE,
      trace: trace,
      requiredDegree: function (cell) { return requiredDegree(grid, cell); },
      stateOf: function (id) { return edgeState[id]; },
      isUnknown: function (id) { return edgeState[id] === UNKNOWN; },
      isUsed: function (id) { return edgeState[id] === USED; },
      isUnusable: function (id) { return edgeState[id] === UNUSABLE; },
      usedDegreeOf: function (cell) { return usedDegree[cell]; },
      sameChain: function (a, b) { return uf.find(a) === uf.find(b); },
      chainRoot: function (cell) { return uf.find(cell); },
      unknownEdgesOf: function (cell) {
        return grid.cellEdges[cell].filter(function (pair) { return edgeState[pair.edgeId] === UNKNOWN; });
      },
      usedEdgesOf: function (cell) {
        return grid.cellEdges[cell].filter(function (pair) { return edgeState[pair.edgeId] === USED; });
      },

      // A cell whose USED edges plus UNKNOWN candidates can no longer reach
      // its required degree is a contradiction — the single mechanism that
      // makes T10's branch-and-check work, and a useful sanity guard
      // everywhere else too. Every mutator here validates ALL of its edges
      // first and only then touches the state, so a thrown contradiction
      // never leaves a batch half-applied.
      contradiction: contradiction,
      setUsed: function (id, technique, reason) {
        return this.setManyUsed([id], technique, reason) > 0;
      },
      setUnusable: function (id, technique, reason) {
        return this.setManyUnusable([id], technique, reason) > 0;
      },

      // One combined trace entry covering several edges at once, for a
      // technique that forces more than one edge in the same insight.
      // `focus`, when given, is the region the technique was reasoning
      // about, so hints and demos can light up more than the edges alone.
      setManyUsed: function (ids, technique, reason, focus) {
        var changed = [];
        for (var i = 0; i < ids.length; i += 1) if (edgeState[ids[i]] !== USED) changed.push(ids[i]);
        if (changed.length === 0) return 0;

        var pendingDegree = Object.create(null);
        for (var j = 0; j < changed.length; j += 1) {
          var id = changed[j];
          if (edgeState[id] === UNUSABLE) contradiction('edge ' + id + ' was already ruled UNUSABLE');
          var e = grid.edges[id];
          pendingDegree[e.a] = (pendingDegree[e.a] || usedDegree[e.a]) + 1;
          pendingDegree[e.b] = (pendingDegree[e.b] || usedDegree[e.b]) + 1;
          if (pendingDegree[e.a] > requiredDegree(grid, e.a)) contradiction('cell ' + e.a + ' would be over-saturated');
          if (pendingDegree[e.b] > requiredDegree(grid, e.b)) contradiction('cell ' + e.b + ' would be over-saturated');
        }

        changed.forEach(function (id) {
          var e = grid.edges[id];
          edgeState[id] = USED;
          usedDegree[e.a] += 1;
          usedDegree[e.b] += 1;
          uf.union(e.a, e.b);
        });
        trace.push({ technique: technique, cells: traceCells(grid, focus, changed), edges: changed, claim: 'USED', reason: reason });
        return changed.length;
      },
      setManyUnusable: function (ids, technique, reason, focus) {
        var changed = [];
        for (var i = 0; i < ids.length; i += 1) if (edgeState[ids[i]] !== UNUSABLE) changed.push(ids[i]);
        if (changed.length === 0) return 0;

        var pendingLoss = Object.create(null);
        for (var j = 0; j < changed.length; j += 1) {
          var id = changed[j];
          if (edgeState[id] === USED) contradiction('edge ' + id + ' was already marked USED');
          var e = grid.edges[id];
          pendingLoss[e.a] = (pendingLoss[e.a] || 0) + 1;
          pendingLoss[e.b] = (pendingLoss[e.b] || 0) + 1;
          if (remainingOptions(e.a) - pendingLoss[e.a] < requiredDegree(grid, e.a)) contradiction('cell ' + e.a + ' has run out of options');
          if (remainingOptions(e.b) - pendingLoss[e.b] < requiredDegree(grid, e.b)) contradiction('cell ' + e.b + ' has run out of options');
        }

        changed.forEach(function (id) { edgeState[id] = UNUSABLE; });
        trace.push({ technique: technique, cells: traceCells(grid, focus, changed), edges: changed, claim: 'UNUSABLE', reason: reason });
        return changed.length;
      },

      isSolved: function () {
        for (var cell = 0; cell < grid.size; cell += 1) {
          if (usedDegree[cell] !== requiredDegree(grid, cell)) return false;
        }
        return true;
      },

      // Reconstructs the single walk the USED edges describe, once solved.
      solutionPath: function () {
        var start = grid.lampCells[0];
        var path = [start];
        var prevCell = -1;
        var cell = start;
        for (var step = 0; step < grid.size - 1; step += 1) {
          var next = -1;
          var used = state.usedEdgesOf(cell);
          for (var i = 0; i < used.length; i += 1) {
            if (used[i].neighbour !== prevCell) { next = used[i].neighbour; break; }
          }
          if (next === -1) return null;
          path.push(next);
          prevCell = cell;
          cell = next;
        }
        return path;
      },

      // T1-T9 to exhaustion on this state. Living on the state itself is
      // what lets T10 in techniques.js run it on a copy without requiring
      // solver.js back.
      propagate: function () { propagate(grid, state); },

      clone: function () { return buildState(grid, edgeState); }
    };
    return state;
  }

  // Cheapest-first, restart after every change — a technique that fires
  // gets the chance to fire again immediately, before moving on to a more
  // expensive one, so the trace reads like a person working through the
  // easy stuff before reaching for anything harder.
  var ORDERED_TECHNIQUES = [
    { id: 'T1', run: techniques.T1 },
    { id: 'T2', run: techniques.T2 },
    { id: 'T3', run: techniques.T3 },
    { id: 'T4', run: techniques.T4 },
    { id: 'T5', run: techniques.T5 },
    { id: 'T6', run: techniques.T6 },
    { id: 'T7', run: techniques.T7 },
    { id: 'T8', run: techniques.T8 },
    { id: 'T9', run: techniques.T9 }
  ];

  function propagate(grid, state) {
    var progressed = true;
    while (progressed) {
      progressed = false;
      for (var i = 0; i < ORDERED_TECHNIQUES.length; i += 1) {
        var made = ORDERED_TECHNIQUES[i].run(grid, state);
        if (made > 0) { progressed = true; break; }
      }
    }
  }

  // The cheapest of T1-T9 that makes progress, applied once. Returns
  // whether anything moved. A contradiction escapes to the caller.
  function applyOnce(grid, state) {
    for (var i = 0; i < ORDERED_TECHNIQUES.length; i += 1) {
      if (ORDERED_TECHNIQUES[i].run(grid, state) > 0) return true;
    }
    return false;
  }

  // One T10 guess played out a step at a time on its own copy.
  function startProbe(state, id, assumeUsed) {
    var probe = { id: id, assumeUsed: assumeUsed, copy: state.clone(), broken: false, finished: false };
    try {
      if (assumeUsed) probe.copy.setUsed(id, 'T10-probe', 'hypothesis');
      else probe.copy.setUnusable(id, 'T10-probe', 'hypothesis');
    } catch (err) {
      if (!err.contradiction) throw err;
      probe.broken = true;
      probe.finished = true;
    }
    return probe;
  }

  function advanceProbe(grid, probe) {
    try {
      if (!applyOnce(grid, probe.copy)) probe.finished = true;
    } catch (err) {
      if (!err.contradiction) throw err;
      probe.broken = true;
      probe.finished = true;
    }
  }

  // The full deductive process as a job that does one small piece of work
  // per step() — one technique application, or one move of a T10 guess —
  // so a page can solve a large town between frames. It is exactly
  // solveDeductive's process: T1-T9 to exhaustion, then T10 trying each
  // undecided edge in order (used first, then unusable), and back to T1-T9
  // the moment a guess breaks. step() returns true when finished; result()
  // then holds { solved, state, trace }.
  function startSolve(grid, fromEdgeState) {
    var state = buildState(grid, fromEdgeState);
    var branching = false;
    var nextEdge = 0;
    var probe = null;
    var done = false;

    function step() {
      if (done) return true;
      if (!branching) {
        if (applyOnce(grid, state)) return false;
        if (state.isSolved()) {
          done = true;
          return true;
        }
        branching = true;
        nextEdge = 0;
        probe = null;
        return false;
      }

      if (!probe) {
        while (nextEdge < grid.numEdges && !state.isUnknown(nextEdge)) nextEdge += 1;
        if (nextEdge >= grid.numEdges) {
          done = true;
          return true;
        }
        probe = startProbe(state, nextEdge, true);
        return false;
      }

      if (!probe.finished) {
        advanceProbe(grid, probe);
        return false;
      }

      if (probe.broken) {
        techniques.concludeBranch(grid, state, probe.id, probe.assumeUsed);
        probe = null;
        branching = false;
        return false;
      }
      if (probe.assumeUsed) {
        probe = startProbe(state, probe.id, false);
        return false;
      }
      probe = null;
      nextEdge += 1;
      return false;
    }

    return {
      step: step,
      result: function () { return { solved: state.isSolved(), state: state, trace: state.trace }; }
    };
  }

  // Runs the whole deductive process in one go. `fromEdgeState`, when
  // given, starts from what is already known — the hints start from the
  // player's own walk. Every T10 step settles at least one edge, so it
  // cannot outlast the edge count.
  function solveDeductive(grid, fromEdgeState) {
    var job = startSolve(grid, fromEdgeState);
    var finished = false;
    while (!finished) finished = job.step();
    return job.result();
  }

  // --- the verifier -----------------------------------------------------

  function cellDegreeAmong(grid, visited, head, cell) {
    var count = 0;
    var neighbours = grid.neighbours[cell];
    for (var i = 0; i < neighbours.length; i += 1) {
      var n = neighbours[i];
      if (n === head || !visited[n]) count += 1;
    }
    return count;
  }

  // A single BFS answers both the connectivity and the remaining-count
  // prune at once: the reachable set (through unvisited cells, starting
  // from head) must be exactly every unvisited cell, no fewer.
  function allUnvisitedReachable(grid, visited, head, unvisitedCount) {
    if (unvisitedCount === 0) return true;
    var queue = [];
    var seen = Object.create(null);
    var neighbours = grid.neighbours[head];
    for (var i = 0; i < neighbours.length; i += 1) {
      var n = neighbours[i];
      if (!visited[n] && !seen[n]) { seen[n] = true; queue.push(n); }
    }
    var found = 0;
    while (queue.length > 0) {
      var cell = queue.pop();
      found += 1;
      var cn = grid.neighbours[cell];
      for (var j = 0; j < cn.length; j += 1) {
        var m = cn[j];
        if (!visited[m] && !seen[m]) { seen[m] = true; queue.push(m); }
      }
    }
    return found === unvisitedCount;
  }

  // A Hamiltonian path always alternates checkerboard colour with every
  // step, so its two ends are fixed by the board's own colour counts —
  // opposite colours when the cell count is even, the majority colour
  // (twice) when it is odd. A board that violates this has zero solutions
  // full stop, and checking that costs nothing next to searching for one.
  function parityAllows(grid) {
    var start = grid.lampCells[0];
    var end = grid.lampCells[grid.lampCount - 1];
    var startColor = (grid.rowOf(start) + grid.colOf(start)) % 2;
    var endColor = (grid.rowOf(end) + grid.colOf(end)) % 2;
    if (grid.size % 2 === 0) return startColor !== endColor;
    // size is odd only when both width and height are odd, in which case
    // colour 0 — the corners' colour — is always the majority by one cell.
    return startColor === 0 && endColor === 0;
  }

  function countSolutions(grid, limit) {
    if (!parityAllows(grid)) return [];
    var visited = new Array(grid.size).fill(false);
    var cells = [];
    var found = [];
    var finalCell = grid.lampCells[grid.lampCount - 1];

    function degreeOk(head) {
      for (var cell = 0; cell < grid.size; cell += 1) {
        if (visited[cell] || cell === head) continue;
        var need = cell === finalCell ? 1 : 2;
        if (cellDegreeAmong(grid, visited, head, cell) < need) return false;
      }
      return true;
    }

    // Warnsdorff ordering: always try the most constrained candidate next.
    // Left to raw neighbour order, DFS on a loosely-walled board wanders
    // for a very long time before either finishing or getting stuck;
    // funnelling into the tightest options first finds a solution almost
    // immediately and hits dead ends almost immediately too.
    function openChoicesAfter(next, head) {
      var count = 0;
      var neighbours = grid.neighbours[next];
      for (var i = 0; i < neighbours.length; i += 1) {
        var n = neighbours[i];
        if (n !== head && !visited[n]) count += 1;
      }
      return count;
    }

    function dfs(head) {
      cells.push(head);
      visited[head] = true;

      if (cells.length === grid.size) {
        if (pathLib.isComplete(grid, cells)) found.push(cells.slice());
      } else {
        var unvisitedCount = grid.size - cells.length;
        if (allUnvisitedReachable(grid, visited, head, unvisitedCount) && degreeOk(head)) {
          var neighbours = grid.neighbours[head];
          var candidates = [];
          for (var i = 0; i < neighbours.length; i += 1) {
            var next = neighbours[i];
            if (visited[next]) continue;
            if (pathLib.isLegalMove(grid, cells, next).ok) {
              candidates.push({ cell: next, rank: openChoicesAfter(next, head) });
            }
          }
          candidates.sort(function (a, b) { return a.rank - b.rank; });
          for (var j = 0; j < candidates.length && found.length < limit; j += 1) {
            dfs(candidates[j].cell);
          }
        }
      }

      visited[head] = false;
      cells.pop();
    }

    dfs(grid.lampCells[0]);
    return found;
  }

  // Performance note for callers, especially generator.js: this search is
  // fast on a heavily-walled board (close to one forced corridor) and can
  // be catastrophically slow on a loosely-walled one, because pruning by
  // connectivity and degree alone does not catch every dead end early on
  // an open grid. The generator must only ever call this on boards it
  // built outward from an already-complete Hamiltonian path — never on an
  // arbitrary, mostly-open one.
  function verify(grid) {
    var solutions = countSolutions(grid, 2);
    return { count: solutions.length, solution: solutions.length > 0 ? solutions[0] : null };
  }

  var api = {
    UNKNOWN: UNKNOWN,
    USED: USED,
    UNUSABLE: UNUSABLE,
    requiredDegree: requiredDegree,
    createState: buildState,
    propagate: propagate,
    startSolve: startSolve,
    solveDeductive: solveDeductive,
    verify: verify
  };

  if (isNode) module.exports = api;
  else (root.LAMP = root.LAMP || {}).solver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
