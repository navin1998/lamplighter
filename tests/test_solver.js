'use strict';

var grid = require('../js/grid.js');
var path = require('../js/path.js');
var solver = require('../js/solver.js');

// Boards with exactly one solution, borrowed from the technique fixtures.
// Between them they need every tier from T1 to T10 to solve.
var UNIQUE_BOARDS = [
  'V1-5X4-2.9.D.H.B.5-1G00020-1GZJ',
  'V1-5X5-C.I.F.O.3.6-0G40A800-39QE',
  'V1-6X5-2.O.M-0M0201650M-D72J',
  'V1-6X6-9.H.3.I.Y.P.K-008800C080E0-QQ53',
  'V1-6X5-0.P.T.5.K.1-022G280000-E3X1',
  'V1-6X6-K.V.H.0.A.E-0H09M0E30006-F3J7',
  'V1-5X4-5.6.F.I.D.4.C-0000040-289T',
  'V1-6X6-Q.T.K.I.F.5.6-0N0GG0F01804-XMTM',
  'V1-5X5-C.A.O.2.8-018G8002-TPXX'
];

function contradictionFrom(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

module.exports = function (t) {
  t.test('requiredDegree is one at lamp 1 and lamp L, two everywhere else', function () {
    var g = grid.create({ width: 3, height: 3, lamps: [0, 4, 8] });
    for (var cell = 0; cell < g.size; cell += 1) {
      t.eq(solver.requiredDegree(g, cell), cell === 0 || cell === 8 ? 1 : 2, 'cell ' + cell);
    }
  });

  t.test('verifier finds no solution where colours rule one out', function () {
    t.eq(solver.verify(grid.create({ width: 2, height: 2, lamps: [0, 3] })).count, 0);
  });

  t.test('verifier stops at two on a wide-open board', function () {
    var result = solver.verify(grid.create({ width: 4, height: 4, lamps: [0, 3] }));
    t.eq(result.count, 2);
  });

  t.test('verifier finds exactly one solution on each unique board, and it is a complete walk', function () {
    UNIQUE_BOARDS.forEach(function (code) {
      var g = grid.fromShareCode(code);
      var result = solver.verify(g);
      t.eq(result.count, 1, code);
      t.assert(path.isComplete(g, result.solution), code + ' solution is a complete, legal walk');
    });
  });

  t.test('deductive solver reaches the verifier\'s solution on every unique board', function () {
    UNIQUE_BOARDS.forEach(function (code) {
      var g = grid.fromShareCode(code);
      var outcome = solver.solveDeductive(g);
      t.assert(outcome.solved, code + ' solved deductively');
      t.deepEq(outcome.state.solutionPath(), solver.verify(g).solution, code);
    });
  });

  t.test('every step in every trace agrees with the unique solution', function () {
    UNIQUE_BOARDS.forEach(function (code) {
      var g = grid.fromShareCode(code);
      var walk = solver.verify(g).solution;
      var used = Object.create(null);
      for (var i = 0; i + 1 < walk.length; i += 1) used[g.edgeId(walk[i], walk[i + 1])] = true;
      solver.solveDeductive(g).trace.forEach(function (step) {
        t.assert(['USED', 'UNUSABLE'].indexOf(step.claim) !== -1, 'claim is machine-checkable');
        step.edges.forEach(function (e) {
          t.eq(step.claim === 'USED', Boolean(used[e]), code + ' ' + step.technique + ' on edge ' + e);
        });
      });
    });
  });

  t.test('trace steps carry technique, cells, edges, claim and reason', function () {
    var trace = solver.solveDeductive(grid.fromShareCode(UNIQUE_BOARDS[0])).trace;
    t.assert(trace.length > 0, 'something was deduced');
    trace.forEach(function (step) {
      t.deepEq(Object.keys(step).sort(), ['cells', 'claim', 'edges', 'reason', 'technique']);
      t.assert(/^T([1-9]|10)$/.test(step.technique), 'named technique, never a probe: ' + step.technique);
    });
  });

  t.test('deductive solver gives up quietly on a board with several solutions', function () {
    var outcome = solver.solveDeductive(grid.create({ width: 3, height: 3, lamps: [0, 8] }));
    t.assert(!outcome.solved, 'not solved');
  });

  t.test('a batch that hits a contradiction changes nothing at all', function () {
    var g = grid.create({ width: 3, height: 3, lamps: [0, 8] });
    var state = solver.createState(g);
    state.setUnusable(g.edgeId(4, 5), 'test', 'setup');
    var traceLength = state.trace.length;
    var err = contradictionFrom(function () {
      state.setManyUsed([g.edgeId(3, 4), g.edgeId(4, 5)], 'test', 'should fail');
    });
    t.assert(err && err.contradiction, 'flagged as a contradiction');
    t.assert(state.isUnknown(g.edgeId(3, 4)), 'the first edge of the batch was not applied');
    t.eq(state.usedDegreeOf(3), 0);
    t.eq(state.trace.length, traceLength, 'no trace entry for a failed batch');
  });

  t.test('starving a cell of its last options is refused', function () {
    var g = grid.create({ width: 3, height: 3, lamps: [0, 8] });
    var state = solver.createState(g);
    var corner = g.cellEdges[2].map(function (pair) { return pair.edgeId; });
    var err = contradictionFrom(function () { state.setManyUnusable(corner, 'test', 'should fail'); });
    t.assert(err && err.contradiction, 'flagged as a contradiction');
    corner.forEach(function (id) { t.assert(state.isUnknown(id), 'edge ' + id + ' untouched'); });
  });

  t.test('over-saturating a cell is refused', function () {
    var g = grid.create({ width: 3, height: 3, lamps: [0, 8] });
    var state = solver.createState(g);
    var err = contradictionFrom(function () {
      state.setManyUsed([g.edgeId(4, 1), g.edgeId(4, 3), g.edgeId(4, 5)], 'test', 'should fail');
    });
    t.assert(err && err.contradiction, 'flagged as a contradiction');
    t.eq(state.usedDegreeOf(4), 0);
  });

  t.test('a clone is independent of the state it came from', function () {
    var g = grid.create({ width: 3, height: 3, lamps: [0, 8] });
    var state = solver.createState(g);
    state.setUsed(g.edgeId(0, 1), 'test', 'setup');
    var copy = state.clone();
    copy.setUsed(g.edgeId(1, 2), 'test', 'only on the copy');
    t.assert(state.isUnknown(g.edgeId(1, 2)), 'original unchanged');
    t.assert(copy.isUsed(g.edgeId(0, 1)), 'copy kept what was there');
    t.assert(copy.sameChain(0, 2), 'copy rebuilt its chains');
    t.assert(!state.sameChain(0, 2), 'original chains unchanged');
  });

  t.test('walls start out unusable and never appear as undecided', function () {
    var g = grid.create({ width: 3, height: 2, wallEdges: [0], lamps: [0, 2] });
    var state = solver.createState(g);
    t.assert(state.isUnusable(0), 'wall edge is UNUSABLE from the start');
    t.eq(state.unknownEdgesOf(0).length, 1);
  });
};
