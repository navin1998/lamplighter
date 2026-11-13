'use strict';

var names = require('../js/names.js');
var catalogue = require('../js/catalogue.js');

module.exports = function (t) {
  t.test('a seed always gives the same name', function () {
    for (var seed = 0; seed < 200; seed += 1) t.eq(names.nameForSeed(seed), names.nameForSeed(seed), 'seed ' + seed);
  });

  t.test('names are two words from the fixed lists', function () {
    for (var seed = 0; seed < 200; seed += 1) {
      var parts = names.nameForSeed(seed * 7919).split(' ');
      t.eq(parts.length, 2);
      t.assert(names.FIRST.indexOf(parts[0]) !== -1, parts[0]);
      t.assert(names.SECOND.indexOf(parts[1]) !== -1, parts[1]);
    }
  });

  t.test('a share code always gives the same name, and different codes usually differ', function () {
    var codes = catalogue.towns.map(function (town) { return town.code; });
    codes.forEach(function (code) { t.eq(names.nameForCode(code), names.nameForCode(code)); });
    var distinct = new Set(codes.map(names.nameForCode)).size;
    t.assert(distinct > 80, 'names spread across the catalogue (' + distinct + ' of 120)');
  });

  t.test('catalogue towns are named from their seeds with some variety', function () {
    var distinct = new Set(catalogue.towns.map(function (town) { return names.nameForSeed(town.seed); })).size;
    t.assert(distinct > 80, distinct + ' distinct names of 120');
  });
};
