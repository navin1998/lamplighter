'use strict';

var grid = require('../js/grid.js');
var solver = require('../js/solver.js');
var rater = require('../js/rater.js');
var generator = require('../js/generator.js');
var daily = require('../js/daily.js');
var pool = require('../js/dailypool.js');
var authoring = require('../tools/gen_daily.js');

function gridOf(town) {
  return grid.create({ width: town.width, height: town.height, wallEdges: town.walls, lamps: town.lamps });
}

function label(town) {
  return 'daily slot ' + town.slot;
}

// Solving all 756 towns again takes about eight minutes, nearly all of it
// on the 8x8 Sundays, so by default the expensive checks run on one slot
// per week — shifted a day each week, since the pool is a whole number of
// weeks and a plain every-seventh slot would always be the same weekday.
// LAMP_FULL=1 node tests/run.js checks every town.
var FULL = process.env.LAMP_FULL === '1';

function spread(towns) {
  if (FULL) return towns;
  var picked = [];
  for (var week = 0; week * 7 < towns.length; week += 1) picked.push(towns[week * 7 + week % 7]);
  return picked;
}

module.exports = function (t) {
  var towns = pool.towns;
  var checked = spread(towns);
  t.log('solving and irreducibility checked on ' + checked.length + ' of ' + towns.length + ' daily towns' + (FULL ? '' : ' (LAMP_FULL=1 for all)'));

  t.test('one town for every slot of the pool, in order', function () {
    t.eq(towns.length, daily.DAILY_POOL_SIZE);
    towns.forEach(function (town, i) { t.eq(town.slot, i, 'entry ' + i); });
  });

  t.test('every slot has its weekday\'s size and label, and the seed its search used', function () {
    towns.forEach(function (town) {
      var plan = daily.dayPlanForSlot(town.slot);
      t.eq(town.width, plan.width, label(town));
      t.eq(town.height, plan.height, label(town));
      t.eq(town.label, plan.label, label(town));
      t.eq(town.seed, daily.seedForSlot(town.slot) + town.attempts - 1, label(town));
      t.eq(town.genVersion, generator.GEN_VERSION, label(town));
    });
  });

  t.test('every share code parses back to exactly that town', function () {
    towns.forEach(function (town) {
      t.eq(gridOf(town).toShareCode(), town.code, label(town));
      t.deepEq(grid.fromShareCode(town.code).wallEdgeIds(), town.walls, label(town));
    });
  });

  t.test('the sample covers every weekday', function () {
    var days = new Set(checked.map(function (town) { return daily.weekdayOfSlot(town.slot); }));
    t.eq(days.size, 7);
  });

  t.test('every checked daily town has exactly one solution and the deductive solver finds it', function () {
    checked.forEach(function (town) {
      var g = gridOf(town);
      var verdict = solver.verify(g);
      t.eq(verdict.count, 1, label(town));
      var outcome = solver.solveDeductive(g);
      t.assert(outcome.solved, label(town) + ' stalls');
      t.deepEq(outcome.state.solutionPath(), verdict.solution, label(town));
      t.deepEq({ tier: town.tier, depth: town.depth, longestStall: town.longestStall, label: town.label }, rater.rate(outcome.trace), label(town));
    });
  });

  t.test('every checked daily town is irreducible: removing any wall or interior lamp breaks uniqueness', function () {
    checked.forEach(function (town) {
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

  // Rebuilding all 756 from their seeds takes several minutes, so one
  // slot in every 27 is rebuilt — 28 slots, and since 27 is not a multiple
  // of 7 they cover every weekday.
  t.test('a spread of daily towns rebuilds from its seeds exactly', function () {
    for (var slot = 0; slot < towns.length; slot += 27) {
      var rebuilt = authoring.regenerate(slot, towns[slot].attempts - 1);
      t.deepEq(rebuilt, Object.assign({}, towns[slot]), label(towns[slot]));
    }
  });
};
