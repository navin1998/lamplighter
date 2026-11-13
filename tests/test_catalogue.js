'use strict';

var fs = require('fs');
var nodePath = require('path');

var grid = require('../js/grid.js');
var solver = require('../js/solver.js');
var rater = require('../js/rater.js');
var generator = require('../js/generator.js');
var chapters = require('../js/chapters.js');
var catalogue = require('../js/catalogue.js');
var authoring = require('../tools/gen_catalogue.js');

var CATALOGUE_PATH = nodePath.join(__dirname, '..', 'js', 'catalogue.js');

function gridOf(town) {
  return grid.create({ width: town.width, height: town.height, wallEdges: town.walls, lamps: town.lamps });
}

function label(town) {
  return 'chapter ' + town.chapter + ' town ' + town.town;
}

module.exports = function (t) {
  var towns = catalogue.towns;

  t.test('ten chapters of twelve towns, in order', function () {
    t.eq(towns.length, chapters.CHAPTERS.length * chapters.TOWNS_PER_CHAPTER);
    towns.forEach(function (town, i) {
      t.eq(town.chapter, Math.floor(i / chapters.TOWNS_PER_CHAPTER) + 1, 'entry ' + i);
      t.eq(town.town, i % chapters.TOWNS_PER_CHAPTER + 1, 'entry ' + i);
      var chapter = chapters.CHAPTERS[town.chapter - 1];
      t.eq(town.width, chapter.width, label(town));
      t.eq(town.height, chapter.height, label(town));
    });
  });

  t.test('every share code is unique and parses back to exactly that town', function () {
    var seen = Object.create(null);
    towns.forEach(function (town) {
      t.assert(!seen[town.code], label(town) + ' repeats another town');
      seen[town.code] = true;
      var parsed = grid.fromShareCode(town.code);
      t.eq(parsed.width, town.width, label(town));
      t.eq(parsed.height, town.height, label(town));
      t.deepEq(parsed.wallEdgeIds(), town.walls, label(town));
      t.deepEq(parsed.lampCells.slice(), town.lamps, label(town));
      t.eq(gridOf(town).toShareCode(), town.code, label(town));
    });
  });

  t.test('every wall is symmetric across every edge of every town', function () {
    towns.forEach(function (town) {
      var g = gridOf(town);
      for (var cell = 0; cell < g.size; cell += 1) {
        g.neighbours[cell].forEach(function (other) {
          t.assert(g.neighbours[other].indexOf(cell) !== -1, label(town) + ' edge ' + cell + '-' + other);
        });
      }
    });
  });

  t.test('the verifier finds exactly one solution for every town', function () {
    var rows = [['chapter', 'town', 'size', 'lamps', 'walls', 'tier', 'label', 'solutions', 'attempts']];
    towns.forEach(function (town) {
      var count = solver.verify(gridOf(town)).count;
      rows.push([town.chapter, town.town, town.width + 'x' + town.height, town.lamps.length, town.walls.length, town.tier, town.label, count, town.attempts]);
      t.eq(count, 1, label(town));
    });
    var widths = rows[0].map(function (heading, col) {
      return Math.max.apply(null, rows.map(function (row) { return String(row[col]).length; }));
    });
    rows.forEach(function (row) {
      t.log(row.map(function (value, col) { return String(value).padEnd(widths[col]); }).join('  '));
    });
  });

  t.test('the deductive solver reaches the verifier\'s solution on every town', function () {
    towns.forEach(function (town) {
      var g = gridOf(town);
      var outcome = solver.solveDeductive(g);
      t.assert(outcome.solved, label(town) + ' stalls');
      t.deepEq(outcome.state.solutionPath(), solver.verify(g).solution, label(town));
    });
  });

  t.test('every town is irreducible: removing any wall or interior lamp breaks uniqueness', function () {
    towns.forEach(function (town) {
      town.walls.forEach(function (id) {
        var fewer = grid.create({ width: town.width, height: town.height, wallEdges: town.walls.filter(function (w) { return w !== id; }), lamps: town.lamps });
        t.eq(solver.verify(fewer).count, 2, label(town) + ' without wall ' + id);
      });
      for (var k = 1; k < town.lamps.length - 1; k += 1) {
        var lamps = town.lamps.filter(function (cell, i) { return i !== k; });
        t.eq(solver.verify(grid.create({ width: town.width, height: town.height, wallEdges: town.walls, lamps: lamps })).count, 2, label(town) + ' without lamp ' + (k + 1));
      }
    });
  });

  t.test('stored ratings match a fresh solve, and every town fits its chapter and place', function () {
    towns.forEach(function (town) {
      var g = gridOf(town);
      var trace = solver.solveDeductive(g).trace;
      var rating = rater.rate(trace);
      t.deepEq({ tier: town.tier, depth: town.depth, longestStall: town.longestStall, label: town.label }, rating, label(town));
      t.eq(chapters.misfit(chapters.CHAPTERS[town.chapter - 1], town.town - 1, g, trace, rating), '', label(town));
    });
  });

  t.test('every town obeys the end-lamp and staircase rules', function () {
    towns.forEach(function (town) {
      var g = gridOf(town);
      t.assert(!generator.endsTooClose(town.width, town.height, town.lamps[0], town.lamps[town.lamps.length - 1]), label(town));
      if (town.chapter > 3) {
        t.assert(generator.longestForcedRun(g, solver.verify(g).solution) <= generator.STAIRCASE_LIMIT, label(town) + ' has a staircase tail');
      }
    });
  });

  t.test('every town records the seed its search used and the current generator version', function () {
    towns.forEach(function (town) {
      t.eq(town.seed, authoring.seedFor(town.chapter, town.town - 1, town.attempts - 1), label(town));
      t.eq(town.genVersion, generator.GEN_VERSION, label(town));
    });
    t.eq(catalogue.GEN_VERSION, generator.GEN_VERSION);
  });

  t.test('regenerating every town from its seed reproduces js/catalogue.js byte for byte', function () {
    var rebuilt = towns.map(function (town) { return authoring.regenerate(town.chapter, town.town - 1, town.attempts - 1); });
    rebuilt.forEach(function (entry, i) { t.assert(entry !== null, label(towns[i]) + ' no longer generates'); });
    t.eq(authoring.formatCatalogue(rebuilt), fs.readFileSync(CATALOGUE_PATH, 'utf8'));
  });
};
