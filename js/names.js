'use strict';

// Town names, drawn from two small fixed word lists by the town's own
// seed, so a town is called the same thing on every machine, forever. A
// town reached only by share code has no seed, so its name comes from the
// code itself instead.
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var prngLib = isNode ? require('./prng.js') : root.LAMP.prng;

  var FIRST = Object.freeze([
    'Willow', 'Candle', 'Mill', 'Rook', 'Lantern', 'Ash', 'Bramble', 'Copper',
    'Ember', 'Fern', 'Hollow', 'Juniper', 'Kettle', 'Linden', 'Moth', 'Nettle',
    'Orchard', 'Pewter', 'Quill', 'Rowan', 'Sorrel', 'Thistle', 'Wick', 'Yarrow'
  ]);

  var SECOND = Object.freeze([
    'Row', 'Yard', 'Lane', 'Close', 'Court', 'End', 'Green', 'Hill',
    'Walk', 'Steps', 'Square', 'Gate', 'Mews', 'Rise', 'Corner', 'Wharf'
  ]);

  // Kept apart from the generator's own use of the seed, so naming can
  // never disturb a town's layout.
  var NAME_SALT = 0x5eed1e;

  function nameForSeed(seed) {
    var rng = prngLib.make((seed ^ NAME_SALT) >>> 0);
    return FIRST[rng.int(FIRST.length)] + ' ' + SECOND[rng.int(SECOND.length)];
  }

  // FNV-1a over the code's characters: small, stable and seed-shaped.
  function nameForCode(code) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < code.length; i += 1) {
      hash ^= code.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return nameForSeed(hash);
  }

  var api = { FIRST: FIRST, SECOND: SECOND, nameForSeed: nameForSeed, nameForCode: nameForCode };

  if (isNode) module.exports = api;
  else (root.LAMP = root.LAMP || {}).names = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
