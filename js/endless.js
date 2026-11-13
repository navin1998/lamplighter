'use strict';

// Endless mode's menu and its seed tokens. Endless towns are generated in
// the player's browser, so only the size and label pairs that turn up
// often enough to arrive quickly are offered.
//
// The rule, and how the lists were found: a pair is offered when at least
// 1% of attempts at that size land on that label and the expected wait
// (attempt time over acceptance rate) is a minute or less. Measured on
// 60-400 seeded attempts per size, in Node:
//   5x5  16 ms per attempt   Gentle 2.3%  Steady 33%  Thoughtful 1.0%  Demanding 2.8%  Severe 25%
//   6x5  38 ms               Gentle 0     Steady 35%  Thoughtful 4.7%  Demanding 5.7%  Severe 38%
//   6x6  165 ms              Gentle 0.3%  Steady 26%  Thoughtful 3.0%  Demanding 2.7%  Severe 49%
//   7x6  426 ms              Gentle 0     Steady 16%  Thoughtful 2.0%  Demanding 2.0%  Severe 57%
//   7x7  1317 ms             Gentle 0     Steady 9%   Thoughtful 1.7%  Demanding 0.8%  Severe 59%
// 8x8 is not offered at all: its five-second attempts make any label but
// Severe a wait of minutes.
(function (root) {
  'use strict';

  var SIZES = Object.freeze([
    { width: 5, height: 5, interiorLamps: 4, labels: ['Gentle', 'Steady', 'Thoughtful', 'Demanding', 'Severe'] },
    { width: 6, height: 5, interiorLamps: 4, labels: ['Steady', 'Thoughtful', 'Demanding', 'Severe'] },
    { width: 6, height: 6, interiorLamps: 5, labels: ['Steady', 'Thoughtful', 'Demanding', 'Severe'] },
    { width: 7, height: 6, interiorLamps: 6, labels: ['Steady', 'Thoughtful', 'Demanding', 'Severe'] },
    { width: 7, height: 7, interiorLamps: 7, labels: ['Steady', 'Severe'] }
  ].map(function (size) {
    size.labels = Object.freeze(size.labels);
    return Object.freeze(size);
  }));

  function sizeFor(width, height) {
    for (var i = 0; i < SIZES.length; i += 1) {
      if (SIZES[i].width === width && SIZES[i].height === height) return SIZES[i];
    }
    return null;
  }

  // Gentle towns are allowed long corridors, as in the first chapters.
  function targetFor(size, label) {
    return { width: size.width, height: size.height, interiorLamps: size.interiorLamps, allowStaircase: label === 'Gentle' };
  }

  // Reopening a known seed. The corridor rule only ever rejects a town,
  // never changes one, so the permissive target rebuilds any town a
  // search accepted, whatever label it was found under.
  function targetForSeed(size) {
    return { width: size.width, height: size.height, interiorLamps: size.interiorLamps, allowStaircase: true };
  }

  // A token names an endless town completely: its size and its seed, for
  // instance "6x6-3141592". The label is whatever that seed turns out to be.
  function tokenFor(size, seed) {
    return size.width + 'x' + size.height + '-' + seed;
  }

  function parseToken(text) {
    var match = /^\s*(\d+)\s*x\s*(\d+)\s*-\s*(\d+)\s*$/i.exec(String(text));
    if (!match) return null;
    var size = sizeFor(Number(match[1]), Number(match[2]));
    var seed = Number(match[3]);
    if (!size || seed > 4294967295) return null;
    return { size: size, seed: seed };
  }

  var api = { SIZES: SIZES, sizeFor: sizeFor, targetFor: targetFor, targetForSeed: targetForSeed, tokenFor: tokenFor, parseToken: parseToken };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).endless = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
