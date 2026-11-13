'use strict';

var grid = require('../js/grid.js');
var pathLib = require('../js/path.js');

// A hand-built 3x2 town, cells laid out as:
//   0 1 2
//   3 4 5
// with the 2-5 edge walled off, and lamp1@0, lamp2@4, lamp3@5.
function wallTownGrid() {
  var width = 3;
  var height = 2;
  var wall = grid.edgeId(width, height, 2, 5);
  return grid.create({ width: width, height: height, wallEdges: [wall], lamps: [0, 4, 5] });
}

// A hand-built 3x3 town with no walls, lamp1@0, lamp2@8, lamp3@2 — lamp3
// sits where it is reachable straight from cell1 without passing lamp2,
// which is exactly what the out-of-order rule needs to be tested against.
function orderTownGrid() {
  return grid.create({ width: 3, height: 3, wallEdges: [], lamps: [0, 8, 2] });
}

// A 2x2 town with a genuine, fully legal solution: 0 -> 1 -> 3 -> 2.
function tinyTownGrid() {
  return grid.create({ width: 2, height: 2, wallEdges: [], lamps: [0, 2] });
}

module.exports = function (t) {
  t.test('the walk must begin on lamp 1', function () {
    var g = wallTownGrid();
    var refused = pathLib.isLegalMove(g, [], 1);
    t.eq(refused.ok, false);
    t.eq(refused.reason, pathLib.REASONS.MUST_START_AT_LAMP_1);
    var allowed = pathLib.isLegalMove(g, [], 0);
    t.eq(allowed.ok, true);
  });

  t.test('a step must be orthogonally adjacent to the head', function () {
    var g = wallTownGrid();
    var farAway = pathLib.isLegalMove(g, [0], 2);
    t.eq(farAway.ok, false);
    t.eq(farAway.reason, pathLib.REASONS.NOT_ADJACENT);
    var ontoSelf = pathLib.isLegalMove(g, [0, 1], 1);
    t.eq(ontoSelf.ok, false);
    t.eq(ontoSelf.reason, pathLib.REASONS.NOT_ADJACENT);
  });

  t.test('a wall blocks a step even between geometrically adjacent cells', function () {
    var g = wallTownGrid();
    var blocked = pathLib.isLegalMove(g, [0, 1, 2], 5);
    t.eq(blocked.ok, false);
    t.eq(blocked.reason, pathLib.REASONS.WALL);
  });

  t.test('a cell already on the walk cannot be stepped onto again', function () {
    var g = wallTownGrid();
    var revisit = pathLib.isLegalMove(g, [0, 1], 0);
    t.eq(revisit.ok, false);
    t.eq(revisit.reason, pathLib.REASONS.ALREADY_VISITED);
  });

  t.test('reaching a lamp before its predecessors is refused at the moment it is attempted', function () {
    var g = orderTownGrid();
    var skip = pathLib.isLegalMove(g, [0, 1], 2);
    t.eq(skip.ok, false, 'lamp 3 cannot be reached before lamp 2');
    t.eq(skip.reason, pathLib.REASONS.LAMP_OUT_OF_ORDER);
  });

  t.test('a completed walk refuses any further step', function () {
    var g = orderTownGrid();
    var full = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    var extra = pathLib.isLegalMove(g, full, 0);
    t.eq(extra.ok, false);
    t.eq(extra.reason, pathLib.REASONS.ALREADY_COMPLETE);
  });

  t.test('a full, correctly ordered walk is complete', function () {
    var g = tinyTownGrid();
    t.eq(pathLib.isComplete(g, [0, 1, 3, 2]), true);
  });

  t.test('a walk missing a cell is not complete', function () {
    var g = tinyTownGrid();
    t.eq(pathLib.isComplete(g, [0, 1, 3]), false);
  });

  t.test('a walk that visits every cell in legal order but does not end on the final lamp is not complete', function () {
    var g = orderTownGrid();
    // every step here is individually legal and lamp2 (cell 8) is met
    // before lamp3 (cell 2), but the walk keeps going after lamp3 instead
    // of stopping there, so it must not read as solved.
    var wrongEnd = [0, 3, 6, 7, 8, 5, 2, 1, 4];
    t.eq(pathLib.isComplete(g, wrongEnd), false);
  });

  t.test('isComplete re-verifies the walk itself rather than trusting the caller', function () {
    var g = tinyTownGrid();
    // covers all 4 cells and starts at lamp 1, but 0 -> 3 is not an open
    // edge in this town (it is the diagonal), so this must not be accepted
    // as a real solution just because the right cells are all present.
    t.eq(pathLib.isComplete(g, [0, 3, 1, 2]), false);
  });

  t.test('diagonal movement never exists', function () {
    var g = grid.create({ width: 3, height: 3, wallEdges: [], lamps: [0, 8] });
    var diagonal = pathLib.isLegalMove(g, [0], 4);
    t.eq(diagonal.ok, false);
    t.eq(diagonal.reason, pathLib.REASONS.NOT_ADJACENT);
  });

  t.test('pressing elsewhere while empty can be recovered with start()', function () {
    var g = wallTownGrid();
    var state = pathLib.createState(g, []);
    var badTry = state.extend(1);
    t.eq(badTry.ok, false);
    t.eq(badTry.reason, pathLib.REASONS.MUST_START_AT_LAMP_1);
    var started = state.start();
    t.eq(started.ok, true);
    t.eq(state.head(), 0);
  });

  t.test('extend grows the walk and undo/redo move across that one step', function () {
    var g = tinyTownGrid();
    var state = pathLib.createState(g, []);
    state.start();
    state.extend(1);
    t.deepEq(state.cells(), [0, 1]);
    t.eq(state.canUndo(), true);
    state.undo();
    t.deepEq(state.cells(), [0]);
    t.eq(state.canRedo(), true);
    state.redo();
    t.deepEq(state.cells(), [0, 1]);
  });

  t.test('touching a cell already on the walk truncates to that cell in one step', function () {
    var g = orderTownGrid();
    var state = pathLib.createState(g, []);
    state.start();
    state.extend(1);
    state.extend(4);
    state.extend(5);
    t.deepEq(state.cells(), [0, 1, 4, 5]);
    var result = state.truncateTo(1);
    t.eq(result.ok, true);
    t.eq(result.changed, true);
    t.deepEq(state.cells(), [0, 1]);
  });

  t.test('truncating back onto the current head is a no-op', function () {
    var g = tinyTownGrid();
    var state = pathLib.createState(g, []);
    state.start();
    state.extend(1);
    var result = state.truncateTo(1);
    t.eq(result.ok, true);
    t.eq(result.changed, false);
    t.deepEq(state.cells(), [0, 1]);
  });

  t.test('a single undo restores a whole truncated tail at once', function () {
    var g = orderTownGrid();
    var state = pathLib.createState(g, []);
    state.start();
    state.extend(1);
    state.extend(4);
    state.extend(5);
    state.truncateTo(0);
    t.deepEq(state.cells(), [0]);
    state.undo();
    t.deepEq(state.cells(), [0, 1, 4, 5], 'the whole discarded tail comes back in one press');
  });

  t.test('retreat removes exactly the head, clear empties the whole walk', function () {
    var g = tinyTownGrid();
    var state = pathLib.createState(g, []);
    state.start();
    state.extend(1);
    state.retreat();
    t.deepEq(state.cells(), [0]);
    state.clear();
    t.deepEq(state.cells(), []);
  });

  t.test('a new action after undo discards the old redo branch', function () {
    var g = tinyTownGrid();
    var state = pathLib.createState(g, []);
    state.start();
    state.extend(1);
    state.undo();
    state.extend(2);
    t.eq(state.canRedo(), false, 'the branch through cell 1 is gone once a new step is taken');
    t.deepEq(state.cells(), [0, 2]);
  });

  t.test('there is no failure state: an emptied walk can always be restarted', function () {
    var g = tinyTownGrid();
    var state = pathLib.createState(g, []);
    state.start();
    state.extend(1);
    state.extend(3);
    state.extend(2);
    t.eq(state.isComplete(), true);
    state.clear();
    t.eq(state.isComplete(), false);
    state.start();
    t.eq(state.head(), 0);
  });

  t.test('touch: on an empty board only lamp 1 starts the walk', function () {
    var g = orderTownGrid();
    t.deepEq(pathLib.touch(g, [], 0), { ok: true, cells: [0] });
    t.deepEq(pathLib.touch(g, [], 4), { ok: false, reason: pathLib.REASONS.MUST_START_AT_LAMP_1 });
  });

  t.test('touch: a legal neighbour extends, the previous cell retracts, an earlier cell truncates', function () {
    var g = orderTownGrid();
    t.deepEq(pathLib.touch(g, [0, 1], 4).cells, [0, 1, 4]);
    t.deepEq(pathLib.touch(g, [0, 1, 4], 1).cells, [0, 1], 'previous cell takes one step back');
    t.deepEq(pathLib.touch(g, [0, 1, 4, 3], 0).cells, [0], 'any earlier cell cuts back to it');
    t.deepEq(pathLib.touch(g, [0, 1, 4], 4).cells, [0, 1, 4], 'the head itself changes nothing');
  });

  t.test('touch: illegal steps are refused with their reason', function () {
    var g = orderTownGrid();
    t.eq(pathLib.touch(g, [0, 1], 2).reason, pathLib.REASONS.LAMP_OUT_OF_ORDER);
    t.eq(pathLib.touch(g, [0, 1], 8).reason, pathLib.REASONS.NOT_ADJACENT);
    t.eq(pathLib.touch(wallTownGrid(), [0, 1, 2], 5).reason, pathLib.REASONS.WALL);
  });

  t.test('touch: a finished walk can still be cut back, never extended', function () {
    var g = tinyTownGrid();
    t.deepEq(pathLib.touch(g, [0, 1, 3, 2], 1).cells, [0, 1]);
  });

  t.test('touchAll: a fast drag lands whole, or not at all', function () {
    var g = orderTownGrid();
    t.deepEq(pathLib.touchAll(g, [0], [1, 4, 3]), { ok: true, cells: [0, 1, 4, 3] });
    var refused = pathLib.touchAll(g, [0], [1, 2, 5]);
    t.eq(refused.ok, false);
    t.eq(refused.reason, pathLib.REASONS.LAMP_OUT_OF_ORDER);
    t.eq(refused.cell, 2, 'names the cell that broke the move');
    t.deepEq(pathLib.touchAll(g, [0, 1, 4], [1, 2]).ok, false, 'a drag back then into lamp 3 early is still refused');
    t.deepEq(pathLib.touchAll(g, [0, 1, 4, 5], [4, 1, 0]).cells, [0], 'dragging back unwinds one cell at a time');
  });

  t.test('replace: a whole gesture is one undo step', function () {
    var g = orderTownGrid();
    var state = pathLib.createState(g, []);
    state.replace([0, 1, 4, 3, 6]);
    t.deepEq(state.cells(), [0, 1, 4, 3, 6]);
    state.undo();
    t.deepEq(state.cells(), [], 'one undo takes back the whole drag');
    state.redo();
    t.deepEq(state.cells(), [0, 1, 4, 3, 6]);
  });

  t.test('replace: an illegal walk is refused and changes nothing', function () {
    var g = orderTownGrid();
    var state = pathLib.createState(g, [0, 1]);
    t.eq(state.replace([0, 1, 2]).reason, pathLib.REASONS.ILLEGAL_WALK, 'lamp 3 before lamp 2');
    t.eq(state.replace([0, 4]).ok, false, 'not adjacent');
    t.eq(state.replace([1, 0]).ok, false, 'does not start on lamp 1');
    t.deepEq(state.cells(), [0, 1]);
    t.eq(state.canUndo(), false, 'no history entry for a refused walk');
  });

  t.test('replace: the same walk again adds no history', function () {
    var g = orderTownGrid();
    var state = pathLib.createState(g, []);
    state.replace([0, 1]);
    t.deepEq(state.replace([0, 1]), { ok: true, changed: false });
    state.undo();
    t.deepEq(state.cells(), []);
  });
};
