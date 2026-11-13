'use strict';

var grid = require('../js/grid.js');
var prng = require('../js/prng.js');

function randomGrid(rng) {
  var width = rng.range(3, 8);
  var height = rng.range(3, 8);
  var edgeTotal = grid.edgeCount(width, height);

  var wallEdges = [];
  for (var e = 0; e < edgeTotal; e += 1) {
    if (rng.next() < 0.3) wallEdges.push(e);
  }

  var lampCount = rng.range(2, Math.min(5, width * height));
  var pool = [];
  for (var c = 0; c < width * height; c += 1) pool.push(c);
  rng.shuffle(pool);
  var lamps = pool.slice(0, lampCount);

  return grid.create({ width: width, height: height, wallEdges: wallEdges, lamps: lamps });
}

module.exports = function (t) {
  t.test('indexOf/rowOf/colOf round-trip', function () {
    for (var width = 2; width <= 9; width += 1) {
      for (var height = 2; height <= 9; height += 1) {
        for (var row = 0; row < height; row += 1) {
          for (var col = 0; col < width; col += 1) {
            var idx = grid.indexOf(width, row, col);
            t.eq(grid.rowOf(width, idx), row, 'rowOf inverts indexOf');
            t.eq(grid.colOf(width, idx), col, 'colOf inverts indexOf');
          }
        }
      }
    }
  });

  t.test('edgeId is canonical regardless of argument order', function () {
    var width = 5;
    var height = 4;
    for (var row = 0; row < height; row += 1) {
      for (var col = 0; col < width; col += 1) {
        var a = grid.indexOf(width, row, col);
        if (col + 1 < width) {
          var right = grid.indexOf(width, row, col + 1);
          t.eq(grid.edgeId(width, height, a, right), grid.edgeId(width, height, right, a), 'horizontal edge symmetric');
        }
        if (row + 1 < height) {
          var down = grid.indexOf(width, row + 1, col);
          t.eq(grid.edgeId(width, height, a, down), grid.edgeId(width, height, down, a), 'vertical edge symmetric');
        }
      }
    }
  });

  t.test('edgeId rejects non-adjacent cells', function () {
    t.throws(function () { grid.edgeId(5, 5, 0, 12); }, 'far apart cells must throw');
    t.throws(function () { grid.edgeId(5, 5, 0, 6); }, 'diagonal cells must throw');
  });

  t.test('every edge id is used by exactly one edge, and all ids are distinct', function () {
    var width = 6;
    var height = 5;
    var seen = {};
    var count = 0;
    for (var row = 0; row < height; row += 1) {
      for (var col = 0; col < width; col += 1) {
        var a = grid.indexOf(width, row, col);
        if (col + 1 < width) {
          var id = grid.edgeId(width, height, a, grid.indexOf(width, row, col + 1));
          t.assert(!seen[id], 'edge id ' + id + ' reused');
          seen[id] = true;
          count += 1;
        }
        if (row + 1 < height) {
          var id2 = grid.edgeId(width, height, a, grid.indexOf(width, row + 1, col));
          t.assert(!seen[id2], 'edge id ' + id2 + ' reused');
          seen[id2] = true;
          count += 1;
        }
      }
    }
    t.eq(count, grid.edgeCount(width, height), 'edge count matches enumeration');
  });

  t.test('a wall is symmetric: passable from one side iff passable from the other', function () {
    var rng = prng.make(42);
    for (var trial = 0; trial < 50; trial += 1) {
      var g = randomGrid(rng);
      for (var a = 0; a < g.size; a += 1) {
        for (var b = a + 1; b < g.size; b += 1) {
          if (!g.areAdjacent(a, b)) continue;
          var aHasB = g.neighbours[a].indexOf(b) !== -1;
          var bHasA = g.neighbours[b].indexOf(a) !== -1;
          t.eq(aHasB, bHasA, 'edge ' + a + '-' + b + ' must agree from both sides');
          t.eq(aHasB, g.isOpen(a, b), 'neighbour list must agree with isOpen');
        }
      }
    }
  });

  t.test('lamp lookup stays in sync: lampAt and lampCells always agree', function () {
    var g = grid.create({ width: 3, height: 3, wallEdges: [], lamps: [0, 4, 8] });
    t.eq(g.lampAt[0], 1);
    t.eq(g.lampAt[4], 2);
    t.eq(g.lampAt[8], 3);
    t.eq(g.lampAt[1], 0, 'cell without a lamp reads 0');
    t.eq(g.lampCells[0], 0);
    t.eq(g.lampCells[1], 4);
    t.eq(g.lampCells[2], 8);
    t.eq(g.lampCount, 3);
  });

  t.test('create rejects out-of-range or duplicate lamps, and too few lamps', function () {
    t.throws(function () { grid.create({ width: 3, height: 3, wallEdges: [], lamps: [0, 0, 4] }); }, 'duplicate lamp cell');
    t.throws(function () { grid.create({ width: 3, height: 3, wallEdges: [], lamps: [0, 99] }); }, 'out of range lamp cell');
    t.throws(function () { grid.create({ width: 3, height: 3, wallEdges: [], lamps: [0] }); }, 'fewer than two lamps');
  });

  t.test('share code round-trips structurally over 500 seeded random grids', function () {
    var rng = prng.make(7);
    for (var trial = 0; trial < 500; trial += 1) {
      var g = randomGrid(rng);
      var code = g.toShareCode();
      var parsed = grid.fromShareCode(code);
      t.eq(parsed.width, g.width, 'width round-trips');
      t.eq(parsed.height, g.height, 'height round-trips');
      t.deepEq(Array.prototype.slice.call(parsed.edgeOpen), Array.prototype.slice.call(g.edgeOpen), 'wall set round-trips');
      t.deepEq(parsed.lampCells.slice(), g.lampCells.slice(), 'lamp placement round-trips');
    }
  });

  t.test('share code fails loudly on checksum corruption', function () {
    var g = grid.create({ width: 4, height: 4, wallEdges: [0, 1], lamps: [0, 15] });
    var code = g.toShareCode();
    var corrupted = code.slice(0, -1) + (code.slice(-1) === 'A' ? 'B' : 'A');
    t.throws(function () { grid.fromShareCode(corrupted); }, 'corrupted checksum must throw');
  });

  t.test('share code fails loudly on an unsupported version tag', function () {
    var g = grid.create({ width: 4, height: 4, wallEdges: [], lamps: [0, 15] });
    var code = g.toShareCode();
    var bumped = code.replace(/^V1/, 'V9');
    t.throws(function () { grid.fromShareCode(bumped); }, 'unknown version must throw, never silently misparse');
  });

  t.test('the edge list agrees with edgeId, and cellEdges agrees with neighbours', function () {
    var rng = prng.make(99);
    for (var trial = 0; trial < 20; trial += 1) {
      var g = randomGrid(rng);
      t.eq(g.edges.length, g.numEdges, 'one entry per edge id');
      for (var id = 0; id < g.edges.length; id += 1) {
        var e = g.edges[id];
        t.eq(e.id, id);
        t.eq(g.edgeId(e.a, e.b), id, 'edges[id] must invert edgeId');
      }
      for (var cell = 0; cell < g.size; cell += 1) {
        t.eq(g.cellEdges[cell].length, g.neighbours[cell].length, 'cellEdges tracks the same cells as neighbours');
        for (var i = 0; i < g.cellEdges[cell].length; i += 1) {
          var pair = g.cellEdges[cell][i];
          t.eq(g.neighbours[cell].indexOf(pair.neighbour) !== -1, true, 'cellEdges neighbour must be an open neighbour');
          t.eq(g.edgeId(cell, pair.neighbour), pair.edgeId, 'cellEdges edgeId must match edgeId');
        }
      }
    }
  });

  t.test('the outer boundary is never a stored wall — it falls out of grid bounds', function () {
    var g = grid.create({ width: 3, height: 3, wallEdges: [], lamps: [0, 8] });
    t.eq(g.numEdges, grid.edgeCount(3, 3), 'no synthetic boundary edges are stored');
    t.eq(g.neighbours[0].length, 2, 'corner cell has exactly its two in-bounds neighbours');
  });
};
