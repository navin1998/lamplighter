'use strict';

var endless = require('../js/endless.js');
var generator = require('../js/generator.js');

module.exports = function (t) {
  t.test('the menu offers 5x5 to 7x7 and never 8x8', function () {
    t.deepEq(endless.SIZES.map(function (s) { return s.width + 'x' + s.height; }), ['5x5', '6x5', '6x6', '7x6', '7x7']);
    t.eq(endless.sizeFor(8, 8), null);
  });

  t.test('a token round-trips and is forgiving about spaces and case', function () {
    var size = endless.sizeFor(6, 6);
    var token = endless.tokenFor(size, 3141592);
    t.eq(token, '6x6-3141592');
    var parsed = endless.parseToken(' 6X6 - 3141592 ');
    t.eq(parsed.size, size);
    t.eq(parsed.seed, 3141592);
  });

  t.test('tokens for sizes not on the menu, or seeds past 32 bits, are refused', function () {
    t.eq(endless.parseToken('8x8-12'), null);
    t.eq(endless.parseToken('5x5-4294967296'), null);
    t.eq(endless.parseToken('5x5'), null);
    t.eq(endless.parseToken('hello'), null);
  });

  t.test('only Gentle towns may have long corridors', function () {
    var size = endless.sizeFor(5, 5);
    t.eq(endless.targetFor(size, 'Gentle').allowStaircase, true);
    t.eq(endless.targetFor(size, 'Severe').allowStaircase, false);
  });

  t.test('reopening a seed rebuilds the town a Gentle search accepted', function () {
    var size = endless.sizeFor(5, 5);
    for (var seed = 1; seed <= 40; seed += 1) {
      var found = generator.generate(seed, endless.targetFor(size, 'Gentle'));
      if (!found.ok) continue;
      var again = generator.generate(seed, endless.targetForSeed(size));
      t.assert(again.ok, 'seed ' + seed + ' reopens');
      t.eq(again.grid.toShareCode(), found.grid.toShareCode(), 'seed ' + seed);
    }
  });

  t.test('a token names one town forever', function () {
    var parsed = endless.parseToken('5x5-777');
    var a = generator.generate(parsed.seed, endless.targetFor(parsed.size, 'Steady'));
    var b = generator.generate(parsed.seed, endless.targetFor(parsed.size, 'Steady'));
    t.eq(a.ok, b.ok);
    if (a.ok) t.eq(a.grid.toShareCode(), b.grid.toShareCode());
  });
};
