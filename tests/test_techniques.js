'use strict';

var grid = require('../js/grid.js');
var solver = require('../js/solver.js');
var techniques = require('../js/techniques.js');

var IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];

// One partly solved board per technique, on which that technique is the
// only one of the ten that can make progress (for T10: T1-T9 are stuck).
// Finding such a state by hand for the region and parity techniques is
// impractical, so these were found by walking the deductive solver step by
// step over seeded random boards with exactly one solution and keeping the
// first state where exactly one technique fired. They are frozen here as
// data; the tests below re-prove every property they were picked for.
var FIXTURES = {
  T1: { code: 'V1-5X4-2.9.D.H.B.5-1G00020-1GZJ', used: [0, 3, 8, 12, 13, 14, 15, 16, 17, 20, 22, 26, 30], unusable: [1, 9, 21, 27, 29] },
  T2: { code: 'V1-5X5-C.I.F.O.3.6-0G40A800-39QE', used: [0, 1, 2, 3, 4, 6, 8, 16, 19, 20, 24, 27, 30, 35, 39], unusable: [22, 25] },
  T3: { code: 'V1-6X5-2.O.M-0M0201650M-D72J', used: [0, 3, 4, 6, 10, 11, 12, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 40, 43, 48], unusable: [1, 2, 38, 44, 46] },
  T4: { code: 'V1-6X6-9.H.3.I.Y.P.K-008800C080E0-QQ53', used: [0, 1, 2, 3, 4, 9, 14, 18, 19, 22, 23, 24, 25, 27, 28, 29, 30, 35, 47, 54, 59], unusable: [33, 34, 46, 57, 58] },
  T5: { code: 'V1-6X5-0.P.T.5.K.1-022G280000-E3X1', used: [1, 4, 20, 22, 24, 25, 30, 37, 42, 43, 46, 47, 48], unusable: [0, 19] },
  T6: { code: 'V1-6X6-K.V.H.0.A.E-0H09M0E30006-F3J7', used: [0, 1, 2, 3, 4, 6, 7, 8, 12, 23, 25, 27, 28, 29, 30, 35, 36, 37, 40, 41, 45, 46, 47, 48, 50, 51, 52, 53, 54, 59], unusable: [11, 13, 14, 17, 18, 24, 34, 44] },
  T7: { code: 'V1-5X4-5.6.F.I.D.4.C-0000040-289T', used: [0, 2, 3, 8, 12, 13, 15, 16, 17, 18, 20, 22, 26, 30], unusable: [1, 4, 5, 9, 19, 21] },
  T8: { code: 'V1-6X6-Q.T.K.I.F.5.6-0N0GG0F01804-XMTM', used: [0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 17, 19, 23, 25, 27, 28, 29, 30, 35, 37, 38, 39, 40, 41, 42, 48, 49, 51, 52, 53, 54, 59], unusable: [11, 13, 18, 22, 24, 36, 43, 45, 47, 50, 58] },
  T9: { code: 'V1-5X5-C.A.O.2.8-018G8002-TPXX', used: [0, 1, 2, 3, 14, 16, 18, 19, 20, 24, 29, 33, 34, 35, 39], unusable: [7, 22, 23] },
  T10: { code: 'V1-5X4-2.9.D.H.B.5-1G00020-1GZJ', used: [0, 3, 8, 10, 12, 13, 14, 15, 16, 17, 20, 22, 23, 26, 30], unusable: [1, 9, 21, 27, 29] }
};

function load(fixture) {
  var g = grid.fromShareCode(fixture.code);
  var edgeState = g.edgeOpen.map(function (open) { return open ? solver.UNKNOWN : solver.UNUSABLE; });
  fixture.used.forEach(function (id) { edgeState[id] = solver.USED; });
  fixture.unusable.forEach(function (id) { edgeState[id] = solver.UNUSABLE; });
  return { grid: g, state: solver.createState(g, edgeState) };
}

function solutionEdges(g) {
  var result = solver.verify(g);
  var used = Object.create(null);
  for (var i = 0; i + 1 < result.solution.length; i += 1) used[g.edgeId(result.solution[i], result.solution[i + 1])] = true;
  return { count: result.count, used: used };
}

function firesOn(id, loaded) {
  return techniques[id](loaded.grid, loaded.state.clone()) > 0;
}

module.exports = function (t) {
  t.test('every fixture is a genuine partial state of a puzzle with exactly one solution', function () {
    IDS.forEach(function (id) {
      var loaded = load(FIXTURES[id]);
      var truth = solutionEdges(loaded.grid);
      t.eq(truth.count, 1, id + ' fixture board has exactly one solution');
      FIXTURES[id].used.forEach(function (e) { t.assert(truth.used[e], id + ' fixture marks edge ' + e + ' USED but the solution does not use it'); });
      FIXTURES[id].unusable.forEach(function (e) { t.assert(!truth.used[e], id + ' fixture marks edge ' + e + ' UNUSABLE but the solution uses it'); });
    });
  });

  // T10 is left out of the "nothing else fires" check on purpose: anything
  // T1-T9 can prove, T10 can prove too by assuming the opposite and
  // watching that same rule break. It is applicable wherever they are,
  // which is exactly why the solver only reaches for it once they stall.
  IDS.forEach(function (id) {
    t.test(id + ' fires on its own fixture, and no other of T1-T9 does', function () {
      var loaded = load(FIXTURES[id]);
      IDS.forEach(function (other) {
        if (other === 'T10' && id !== 'T10') return;
        t.eq(firesOn(other, loaded), other === id, other + ' on the ' + id + ' fixture');
      });
    });

    t.test(id + ' only ever claims what the unique solution agrees with', function () {
      var loaded = load(FIXTURES[id]);
      var truth = solutionEdges(loaded.grid);
      var before = loaded.state.trace.length;
      techniques[id](loaded.grid, loaded.state);
      var steps = loaded.state.trace.slice(before).filter(function (step) { return step.technique === id; });
      t.assert(steps.length > 0, id + ' left a trace step');
      steps.forEach(function (step) {
        step.edges.forEach(function (e) {
          t.eq(step.claim === 'USED', Boolean(truth.used[e]), id + ' claim about edge ' + e);
        });
        t.assert(typeof step.reason === 'string' && step.reason.length > 0, id + ' gives a reason');
        t.assert(step.cells.length > 0, id + ' points at some cells');
      });
    });
  });

  t.test('T1-T9 each stay silent on the fixtures of every other technique', function () {
    IDS.forEach(function (fixtureId) {
      var loaded = load(FIXTURES[fixtureId]);
      IDS.slice(0, 9).forEach(function (id) {
        if (id !== fixtureId) t.assert(!firesOn(id, loaded), id + ' must not fire on the ' + fixtureId + ' fixture');
      });
    });
  });

  t.test('T10 stays silent on an open board with several solutions, where no single guess breaks', function () {
    var g = grid.create({ width: 3, height: 3, lamps: [0, 8] });
    t.eq(solver.verify(g).count, 2, 'the open 3x3 corner-to-corner board has more than one solution');
    var state = solver.createState(g);
    state.propagate();
    t.assert(!state.isSolved(), 'T1-T9 cannot finish it either');
    t.eq(techniques.T10(g, state), 0);
  });

  t.test('T10 is one guess deep: the propagate its probes run cannot reach T10', function () {
    var loaded = load(FIXTURES.T10);
    var before = loaded.state.trace.length;
    loaded.state.propagate();
    t.eq(loaded.state.trace.length, before, 'propagate made progress where only T10 can, so it must be calling T10');
  });

  t.test('T1-T9 are pure deduction: none of them leaves a probe in the trace', function () {
    IDS.slice(0, 9).forEach(function (id) {
      var loaded = load(FIXTURES[id]);
      techniques[id](loaded.grid, loaded.state);
      loaded.state.trace.forEach(function (step) { t.assert(step.technique === id, id + ' traced as ' + step.technique); });
    });
  });

  t.test('T6 counts loose ends: an odd side forces its only link, an even side forbids it', function () {
    var claims = [];
    var loaded = load(FIXTURES.T6);
    techniques.T6(loaded.grid, loaded.state);
    loaded.state.trace.forEach(function (step) { claims.push(step.claim); });
    t.eq(claims.length, 1, 'one T6 step');
    var looseEnds = Number(/has (\d+) loose ends/.exec(loaded.state.trace[0].reason)[1]);
    t.eq(claims[0] === 'USED', looseEnds % 2 === 1, 'claim follows the parity of the loose-end count');
  });

  t.test('a board whose live streets have fallen apart is reported as a contradiction', function () {
    // Walls between columns 1 and 2 on both rows cut the town in two.
    var g = grid.create({ width: 4, height: 2, wallEdges: [1, 4], lamps: [0, 7] });
    var state = solver.createState(g);
    var err = null;
    try {
      techniques.T5(g, state);
    } catch (e) {
      err = e;
    }
    t.assert(err && err.contradiction, 'T5 flags a split town as a contradiction, not a crash');
  });
};
