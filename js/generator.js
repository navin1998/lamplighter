'use strict';

// Seeded puzzle generation, forward rather than backward: build a walk
// first, then hide it. One seed is one attempt — it either yields a town
// or says why it was thrown away — so a seed reproduces a byte-identical
// town on any machine, forever. Nothing here reads a clock or any
// unseeded randomness; every limit is a declared constant.
//
//   1. A random Hamiltonian path: a boustrophedon snake, then many random
//      backbite moves.
//   2. Every edge the walk does not use becomes a wall. That board is a
//      single corridor, so it has exactly one solution.
//   3. Lamp 1 on the walk's first cell, lamp L on its last, interior lamps
//      roughly evenly spaced along it with a little seeded jitter.
//   4. One pass over every wall and interior lamp in seeded order, keeping
//      each removal the verifier says still leaves exactly one solution.
//      A single pass is enough: taking clues away only ever adds
//      solutions, so a removal that failed once would fail again later.
//      The result is irreducible.
//   5. Reject on the §9 rules, then solve deductively and rate.
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var prngLib = isNode ? require('./prng.js') : root.LAMP.prng;
  var gridLib = isNode ? require('./grid.js') : root.LAMP.grid;
  var solver = isNode ? require('./solver.js') : root.LAMP.solver;
  var rater = isNode ? require('./rater.js') : root.LAMP.rater;

  // Bumped whenever a change here alters what any seed produces; the
  // catalogue is then regenerated.
  var GEN_VERSION = 1;

  // The walk only has to be a fixed function of the seed, not a perfectly
  // uniform sample, so this is generous rather than tuned.
  var BACKBITE_MOVES_PER_CELL = 30;

  // Lamp 1 and lamp L closer than this (Manhattan) read as a joke puzzle.
  var MIN_END_DISTANCE = 3;

  // More forced corridor steps in a row than this, and the walk bores.
  var STAIRCASE_LIMIT = 8;

  function rowOf(width, cell) {
    return Math.floor(cell / width);
  }

  function colOf(width, cell) {
    return cell % width;
  }

  function gridNeighbours(width, height, cell) {
    var row = rowOf(width, cell);
    var col = colOf(width, cell);
    var out = [];
    if (row > 0) out.push(cell - width);
    if (row < height - 1) out.push(cell + width);
    if (col > 0) out.push(cell - 1);
    if (col < width - 1) out.push(cell + 1);
    return out;
  }

  function snake(width, height) {
    var walk = [];
    for (var row = 0; row < height; row += 1) {
      for (var i = 0; i < width; i += 1) walk.push(row * width + (row % 2 === 0 ? i : width - 1 - i));
    }
    return walk;
  }

  // Pick an end, step it onto a random neighbour already on the walk, and
  // reverse the stretch after that neighbour so the walk stays one piece.
  function backbite(walk, width, height, rng) {
    if (rng.int(2) === 1) walk.reverse();
    var head = walk[walk.length - 1];
    var at = walk.indexOf(rng.pick(gridNeighbours(width, height, head)));
    if (at === walk.length - 2) return;
    var lo = at + 1;
    var hi = walk.length - 1;
    while (lo < hi) {
      var tmp = walk[lo];
      walk[lo] = walk[hi];
      walk[hi] = tmp;
      lo += 1;
      hi -= 1;
    }
  }

  function randomWalk(width, height, rng) {
    var walk = snake(width, height);
    var moves = width * height * BACKBITE_MOVES_PER_CELL;
    for (var i = 0; i < moves; i += 1) backbite(walk, width, height, rng);
    return walk;
  }

  // Each corner block is ceil(w/3) by ceil(h/3); this names the block a
  // cell sits in, or -1 when it is in none of the four.
  function cornerBlockOf(width, height, cell) {
    var bw = Math.ceil(width / 3);
    var bh = Math.ceil(height / 3);
    var row = rowOf(width, cell);
    var col = colOf(width, cell);
    var top = row < bh;
    var bottom = row >= height - bh;
    var left = col < bw;
    var right = col >= width - bw;
    if (top && left) return 0;
    if (top && right) return 1;
    if (bottom && left) return 2;
    if (bottom && right) return 3;
    return -1;
  }

  function endsTooClose(width, height, first, last) {
    var distance = Math.abs(rowOf(width, first) - rowOf(width, last)) + Math.abs(colOf(width, first) - colOf(width, last));
    if (distance < MIN_END_DISTANCE) return true;
    var block = cornerBlockOf(width, height, first);
    return block !== -1 && block === cornerBlockOf(width, height, last);
  }

  // The longest run of consecutive cells along the walk that each have two
  // or fewer open edges — a stretch T1 alone walks without thinking.
  function longestForcedRun(grid, walk) {
    var best = 0;
    var run = 0;
    for (var i = 0; i < walk.length; i += 1) {
      run = grid.neighbours[walk[i]].length <= 2 ? run + 1 : 0;
      if (run > best) best = run;
    }
    return best;
  }

  // Interior lamps sit near even spacing along the walk; the jitter stays
  // under a third of the gap so positions can never collide or cross.
  function lampPositions(walkLength, interiorLamps, rng) {
    var positions = [0];
    var gap = (walkLength - 1) / (interiorLamps + 1);
    var jitter = Math.floor(gap / 3);
    for (var q = 1; q <= interiorLamps; q += 1) {
      positions.push(Math.round(q * gap) + (jitter > 0 ? rng.range(-jitter, jitter) : 0));
    }
    positions.push(walkLength - 1);
    return positions;
  }

  function buildGrid(target, seed, walk, wallFlags, lampFlags) {
    var wallEdges = [];
    for (var id = 0; id < wallFlags.length; id += 1) if (wallFlags[id]) wallEdges.push(id);
    var lamps = [];
    for (var p = 0; p < lampFlags.length; p += 1) if (lampFlags[p]) lamps.push(walk[p]);
    return gridLib.create({ width: target.width, height: target.height, wallEdges: wallEdges, lamps: lamps, seed: seed, genVersion: GEN_VERSION });
  }

  function removalCandidates(wallFlags, lampFlags, rng) {
    var candidates = [];
    for (var id = 0; id < wallFlags.length; id += 1) if (wallFlags[id]) candidates.push({ wall: true, index: id });
    for (var p = 1; p < lampFlags.length - 1; p += 1) if (lampFlags[p]) candidates.push({ wall: false, index: p });
    return rng.shuffle(candidates);
  }

  // One attempt as a job that can be run a step at a time, so a page can
  // build a town between frames without freezing. Each step() does one
  // unit of work — one tried removal, or the final solve — and returns
  // true once the attempt is finished; result() then holds
  // { ok: true, grid, walk, trace, rating } or { ok: false, reason }.
  // `target` is { width, height, interiorLamps, allowStaircase }.
  function startJob(seed, target) {
    var width = target.width;
    var height = target.height;
    var rng = prngLib.make(seed);
    var walk = randomWalk(width, height, rng);
    var result = null;
    var candidates = [];
    var next = 0;
    var wallFlags = new Array(gridLib.edgeCount(width, height)).fill(true);
    var lampFlags = new Array(walk.length).fill(false);

    if (endsTooClose(width, height, walk[0], walk[walk.length - 1])) {
      result = { ok: false, reason: 'ends' };
    } else {
      for (var i = 0; i + 1 < walk.length; i += 1) wallFlags[gridLib.edgeId(width, height, walk[i], walk[i + 1])] = false;
      lampPositions(walk.length, target.interiorLamps, rng).forEach(function (p) { lampFlags[p] = true; });
      candidates = removalCandidates(wallFlags, lampFlags, rng);
    }

    var finalGrid = null;
    var solveJob = null;

    // The rating solve is the slowest part of an attempt on a big town, so
    // it too runs a piece at a time.
    function stepFinish() {
      if (!finalGrid) {
        finalGrid = buildGrid(target, seed, walk, wallFlags, lampFlags);
        if (!target.allowStaircase && longestForcedRun(finalGrid, walk) > STAIRCASE_LIMIT) {
          result = { ok: false, reason: 'staircase' };
          return true;
        }
        solveJob = solver.startSolve(finalGrid);
        return false;
      }
      if (!solveJob.step()) return false;
      var solved = solveJob.result();
      result = solved.solved
        ? { ok: true, grid: finalGrid, walk: walk, trace: solved.trace, rating: rater.rate(solved.trace) }
        : { ok: false, reason: 'stall' };
      return true;
    }

    return {
      step: function () {
        if (result) return true;
        if (next < candidates.length) {
          var candidate = candidates[next];
          var flags = candidate.wall ? wallFlags : lampFlags;
          flags[candidate.index] = false;
          if (solver.verify(buildGrid(target, seed, walk, wallFlags, lampFlags)).count !== 1) flags[candidate.index] = true;
          next += 1;
          return false;
        }
        return stepFinish();
      },
      result: function () { return result; },
      progress: function () { return candidates.length > 0 ? next / candidates.length : 1; }
    };
  }

  function generate(seed, target) {
    var job = startJob(seed, target);
    var done = false;
    while (!done) done = job.step();
    return job.result();
  }

  var api = {
    GEN_VERSION: GEN_VERSION,
    MIN_END_DISTANCE: MIN_END_DISTANCE,
    STAIRCASE_LIMIT: STAIRCASE_LIMIT,
    randomWalk: randomWalk,
    endsTooClose: endsTooClose,
    longestForcedRun: longestForcedRun,
    startJob: startJob,
    generate: generate
  };

  if (isNode) module.exports = api;
  else (root.LAMP = root.LAMP || {}).generator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
