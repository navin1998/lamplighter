'use strict';

var fs = require('fs');
var nodePath = require('path');

var grid = require('../js/grid.js');
var path = require('../js/path.js');
var prng = require('../js/prng.js');
var solver = require('../js/solver.js');
var generator = require('../js/generator.js');
var chapters = require('../js/chapters.js');

var JS_DIR = nodePath.join(__dirname, '..', 'js');

// Every file in js/ must be listed here as core or UI, so a new file can
// never slip past the core checks by simply not being mentioned.
var CORE_FILES = ['prng.js', 'grid.js', 'path.js', 'techniques.js', 'solver.js', 'rater.js', 'generator.js', 'chapters.js', 'catalogue.js', 'daily.js', 'hints.js', 'names.js', 'endless.js', 'dailypool.js', 'helpcontent.js'];
var UI_FILES = ['board.js', 'main.js', 'progress.js', 'demo.js', 'help.js', 'sound.js'];

var SMALL_TARGET = { width: 5, height: 5, interiorLamps: 4, allowStaircase: true };

function firstGood(seedBase, target, count) {
  var found = [];
  for (var seed = seedBase; found.length < count; seed += 1) {
    var result = generator.generate(seed, target);
    if (result.ok) found.push({ seed: seed, result: result });
  }
  return found;
}

module.exports = function (t) {
  t.test('every js/ file is classified as core or UI', function () {
    fs.readdirSync(JS_DIR).filter(function (f) { return /\.js$/.test(f); }).forEach(function (file) {
      t.assert(CORE_FILES.indexOf(file) !== -1 || UI_FILES.indexOf(file) !== -1, file + ' is neither core nor UI');
    });
  });

  t.test('no core file calls Math.random or touches the DOM, timers or storage', function () {
    var forbidden = ['Math.random', 'document', 'window', 'localStorage', 'requestAnimationFrame', 'Date.now', 'new Date', 'performance.now'];
    CORE_FILES.forEach(function (file) {
      var full = nodePath.join(JS_DIR, file);
      if (!fs.existsSync(full)) return;
      var source = fs.readFileSync(full, 'utf8');
      forbidden.forEach(function (word) {
        t.assert(source.indexOf(word) === -1, file + ' mentions ' + word);
      });
    });
  });

  t.test('the same seed produces the same town, every time', function () {
    for (var seed = 1; seed <= 20; seed += 1) {
      var a = generator.generate(seed, SMALL_TARGET);
      var b = generator.generate(seed, SMALL_TARGET);
      t.eq(a.ok, b.ok, 'seed ' + seed);
      if (a.ok) {
        t.eq(a.grid.toShareCode(), b.grid.toShareCode(), 'seed ' + seed);
        t.deepEq(a.rating, b.rating, 'seed ' + seed);
      } else {
        t.eq(a.reason, b.reason, 'seed ' + seed);
      }
    }
  });

  t.test('running an attempt step by step gives exactly what generate gives', function () {
    for (var seed = 1; seed <= 12; seed += 1) {
      var whole = generator.generate(seed, SMALL_TARGET);
      var job = generator.startJob(seed, SMALL_TARGET);
      var steps = 0;
      while (!job.step()) steps += 1;
      var stepped = job.result();
      t.eq(stepped.ok, whole.ok, 'seed ' + seed);
      if (whole.ok) {
        t.eq(stepped.grid.toShareCode(), whole.grid.toShareCode(), 'seed ' + seed);
        t.assert(steps > 0, 'a real attempt takes more than one step');
        t.eq(job.progress(), 1, 'progress reaches the end');
      }
    }
  });

  t.test('the random walk visits every cell exactly once through adjacent cells', function () {
    [[5, 5], [6, 5], [7, 7], [8, 8]].forEach(function (size) {
      var walk = generator.randomWalk(size[0], size[1], prng.make(size[0] * 100 + size[1]));
      t.eq(walk.length, size[0] * size[1]);
      t.eq(new Set(walk).size, walk.length, 'no repeats');
      for (var i = 0; i + 1 < walk.length; i += 1) {
        t.assert(grid.areAdjacent(size[0], size[1], walk[i], walk[i + 1]), 'step ' + i + ' is adjacent');
      }
    });
  });

  t.test('end lamps too close together or in the same corner block are rejected', function () {
    t.assert(generator.endsTooClose(5, 5, 0, 1), 'adjacent');
    t.assert(generator.endsTooClose(5, 5, 0, 2), 'two apart');
    t.assert(generator.endsTooClose(8, 8, 0, 18), 'same 3x3 corner block, four apart');
    t.assert(!generator.endsTooClose(5, 5, 0, 24), 'opposite corners');
    t.assert(!generator.endsTooClose(5, 5, 0, 12), 'corner to centre');
  });

  t.test('a forced run is measured along the walk', function () {
    // Walls under cells 0 and 1 leave a single U-shaped corridor.
    var corridor = grid.create({ width: 3, height: 2, wallEdges: [4, 5], lamps: [0, 3] });
    t.eq(generator.longestForcedRun(corridor, [0, 1, 2, 5, 4, 3]), 6);
    var open = grid.create({ width: 3, height: 3, lamps: [0, 8] });
    t.eq(generator.longestForcedRun(open, [0, 1, 2, 5, 4, 3, 6, 7, 8]), 1, 'on an open board only the corners are forced');
  });

  t.test('generated towns are unique, start and end on their lamps, and solve deductively', function () {
    firstGood(1, SMALL_TARGET, 8).forEach(function (found) {
      var g = found.result.grid;
      var verdict = solver.verify(g);
      t.eq(verdict.count, 1, 'seed ' + found.seed);
      t.deepEq(verdict.solution, found.result.walk, 'the hidden walk is the solution');
      t.assert(path.isComplete(g, found.result.walk), 'and it is a complete walk');
      t.eq(g.seed, found.seed);
      t.eq(g.genVersion, generator.GEN_VERSION);
      t.assert(!generator.endsTooClose(5, 5, g.lampCells[0], g.lampCells[g.lampCount - 1]), 'ends far enough apart');
    });
  });

  t.test('generated towns are irreducible: every wall and interior lamp is load-bearing', function () {
    firstGood(1, SMALL_TARGET, 8).forEach(function (found) {
      var g = found.result.grid;
      g.wallEdgeIds().forEach(function (id) {
        var fewer = grid.create({ width: g.width, height: g.height, wallEdges: g.wallEdgeIds().filter(function (w) { return w !== id; }), lamps: g.lampCells.slice() });
        t.eq(solver.verify(fewer).count, 2, 'seed ' + found.seed + ' without wall ' + id);
      });
      for (var k = 1; k < g.lampCount - 1; k += 1) {
        var lamps = g.lampCells.filter(function (cell, i) { return i !== k; });
        var lessLit = grid.create({ width: g.width, height: g.height, wallEdges: g.wallEdgeIds(), lamps: lamps });
        t.eq(solver.verify(lessLit).count, 2, 'seed ' + found.seed + ' without lamp ' + (k + 1));
      }
    });
  });

  t.test('no wall ever stands on the hidden walk', function () {
    firstGood(1, SMALL_TARGET, 8).forEach(function (found) {
      var walk = found.result.walk;
      for (var i = 0; i + 1 < walk.length; i += 1) t.assert(found.result.grid.isOpen(walk[i], walk[i + 1]), 'step ' + i + ' open');
    });
  });

  t.test('no town from a strict target has a staircase tail', function () {
    var strict = { width: 5, height: 5, interiorLamps: 4, allowStaircase: false };
    for (var seed = 1; seed <= 60; seed += 1) {
      var result = generator.generate(seed, strict);
      if (result.ok) t.assert(generator.longestForcedRun(result.grid, result.walk) <= generator.STAIRCASE_LIMIT, 'seed ' + seed);
    }
  });

  t.test('only the corridor chapters allow long forced runs', function () {
    chapters.CHAPTERS.forEach(function (chapter) {
      t.eq(chapters.target(chapter).allowStaircase, chapter.number <= 3, 'chapter ' + chapter.number);
    });
  });
};
