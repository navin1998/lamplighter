'use strict';

var grid = require('../js/grid.js');
var solver = require('../js/solver.js');
var hints = require('../js/hints.js');
var catalogue = require('../js/catalogue.js');

// The walk positions every town is hinted from: the empty board, then the
// first quarter, half and three quarters of the true walk.
var STAGES = [0, 0.25, 0.5, 0.75];

function gridOf(town) {
  return grid.create({ width: town.width, height: town.height, wallEdges: town.walls, lamps: town.lamps });
}

function label(town, stage) {
  return 'chapter ' + town.chapter + ' town ' + town.town + ' at ' + Math.round(stage * 100) + '%';
}

module.exports = function (t) {
  var towns = catalogue.towns.map(function (town) {
    var g = gridOf(town);
    return { town: town, grid: g, solution: solver.verify(g).solution };
  });

  t.test('every catalogue town has all four hint levels at every stage of its walk', function () {
    towns.forEach(function (entry) {
      STAGES.forEach(function (stage) {
        var walk = entry.solution.slice(0, Math.floor(entry.solution.length * stage));
        var hint = hints.forWalk(entry.grid, walk, entry.solution);
        t.assert(hint.levels, label(entry.town, stage) + ' has no hint: ' + JSON.stringify(hint));
        t.deepEq(hint.levels.map(function (l) { return l.kind; }), ['region', 'technique', 'shape', 'move'], label(entry.town, stage));
      });
    });
  });

  t.test('every hint level is truthful about the deduction it stands for', function () {
    towns.forEach(function (entry) {
      var used = Object.create(null);
      for (var i = 0; i + 1 < entry.solution.length; i += 1) used[entry.grid.edgeId(entry.solution[i], entry.solution[i + 1])] = true;

      STAGES.forEach(function (stage) {
        var where = label(entry.town, stage);
        var walk = entry.solution.slice(0, Math.floor(entry.solution.length * stage));
        var levels = hints.forWalk(entry.grid, walk, entry.solution).levels;
        var region = levels[0];
        var technique = levels[1];
        var shape = levels[2];
        var move = levels[3];

        var touched = [];
        move.edges.forEach(function (id) { touched.push(entry.grid.edges[id].a, entry.grid.edges[id].b); });
        t.assert(touched.some(function (cell) { return region.cells.indexOf(cell) !== -1; }), where + ': the region does not contain the move');
        t.assert(region.cells.every(function (cell) { return hints.ZONE_NAMES[hints.zoneOf(entry.grid, cell)] === region.zone; }), where + ': region cells are all in the named zone');

        t.assert(hints.TECHNIQUE_NAMES[technique.technique] === technique.name, where + ': technique name');
        t.eq(shape.technique, technique.technique, where + ': shape names the same technique');
        t.eq(move.technique, technique.technique, where + ': move names the same technique');
        t.deepEq(shape.edges, move.edges, where + ': shape shows exactly the move\'s edges');
        t.assert(shape.cells.length > 0 && shape.text.length > 1, where + ': shape points at cells and says why');

        move.edges.forEach(function (id) {
          t.eq(move.claim === 'USED', Boolean(used[id]), where + ': move claim about edge ' + id);
        });

        var onWalk = Object.create(null);
        for (var w = 0; w + 1 < walk.length; w += 1) onWalk[walk[w]] = true;
        t.assert(move.edges.some(function (id) { return !onWalk[entry.grid.edges[id].a] && !onWalk[entry.grid.edges[id].b]; }), where + ': the move tells the player something new');
      });
    });
  });

  t.test('a walk that strays is told so, with the last point that was still right', function () {
    // The first point along each town's walk where a legal wrong turn is
    // possible (an unvisited, unlit neighbour that is not the next cell).
    function firstWrongTurn(entry) {
      var g = entry.grid;
      for (var keep = 1; keep < entry.solution.length; keep += 1) {
        var prefix = entry.solution.slice(0, keep);
        var wrong = g.neighbours[prefix[keep - 1]].filter(function (cell) {
          return cell !== entry.solution[keep] && prefix.indexOf(cell) === -1 && g.lampAt[cell] === 0;
        });
        if (wrong.length > 0) return { keep: keep, walk: prefix.concat([wrong[0]]) };
      }
      return null;
    }

    towns.forEach(function (entry) {
      var where = 'chapter ' + entry.town.chapter + ' town ' + entry.town.town;
      var turn = firstWrongTurn(entry);
      t.assert(turn !== null, where + ' offers no wrong turn to test');
      var hint = hints.forWalk(entry.grid, turn.walk, entry.solution);
      t.assert(hint.offRoute, where + ': strayed walk not noticed');
      t.eq(hint.rewindTo, turn.keep, where + ': rewind keeps exactly the part that was right');
    });
  });

  t.test('a finished walk needs no hint', function () {
    var entry = towns[0];
    t.deepEq(hints.forWalk(entry.grid, entry.solution, entry.solution), { done: true });
  });

  t.test('hints are the same every time for the same walk', function () {
    var entry = towns[towns.length - 1];
    var walk = entry.solution.slice(0, 10);
    t.deepEq(hints.forWalk(entry.grid, walk, entry.solution), hints.forWalk(entry.grid, walk, entry.solution));
  });
};
