'use strict';

// Seeded PRNG (mulberry32). Every random choice made anywhere in the core —
// generation, minimisation, town naming — flows through an instance of this,
// so a seed reproduces a byte-identical result on any machine, forever.
(function (root) {
  'use strict';

  function mulberry32(seed) {
    var state = seed >>> 0;
    return function next() {
      state = (state + 0x6D2B79F5) | 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function make(seed) {
    var next = mulberry32(seed);

    // Integer in [0, max), max > 0.
    function int(max) {
      return Math.floor(next() * max);
    }

    // Integer in [min, max], inclusive both ends.
    function range(min, max) {
      return min + int(max - min + 1);
    }

    function pick(list) {
      return list[int(list.length)];
    }

    // Fisher-Yates, in place, returns the same array for convenience.
    function shuffle(list) {
      for (var i = list.length - 1; i > 0; i -= 1) {
        var j = int(i + 1);
        var tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
      }
      return list;
    }

    return { next: next, int: int, range: range, pick: pick, shuffle: shuffle };
  }

  var api = { make: make };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).prng = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
