'use strict';

// Difficulty comes from the technique trace and nothing else — not grid
// size, not lamp count, not wall count, not solve time. A six-by-six town
// can be far harder than an eight-by-eight one.
//
// The label rule, in full: the tier picks a base label (3 and below
// Gentle, 4-5 Steady, 6-7 Thoughtful, 8-9 Demanding, 10 Severe). The base
// moves up one label when the solve needed DEPTH_BUMP or more distinct
// techniques above T3, and up one more when the hardest technique once
// settled STALL_BUMP or more edges in a single step. It never goes past
// Severe.
(function (root) {
  'use strict';

  var LABELS = Object.freeze(['Gentle', 'Steady', 'Thoughtful', 'Demanding', 'Severe']);
  var DEPTH_BUMP = 3;
  var STALL_BUMP = 8;

  function tierOf(technique) {
    return Number(technique.slice(1));
  }

  function baseLabelIndex(tier) {
    if (tier <= 3) return 0;
    if (tier <= 5) return 1;
    if (tier <= 7) return 2;
    if (tier <= 9) return 3;
    return 4;
  }

  function rate(trace) {
    var tier = 0;
    var above = Object.create(null);
    trace.forEach(function (step) {
      var t = tierOf(step.technique);
      if (t > tier) tier = t;
      if (t > 3) above[step.technique] = true;
    });

    var longestStall = 0;
    trace.forEach(function (step) {
      if (tierOf(step.technique) === tier && step.edges.length > longestStall) longestStall = step.edges.length;
    });

    var depth = Object.keys(above).length;
    var index = baseLabelIndex(tier);
    if (depth >= DEPTH_BUMP) index += 1;
    if (longestStall >= STALL_BUMP) index += 1;

    return { tier: tier, depth: depth, longestStall: longestStall, label: LABELS[Math.min(index, LABELS.length - 1)] };
  }

  var api = { LABELS: LABELS, DEPTH_BUMP: DEPTH_BUMP, STALL_BUMP: STALL_BUMP, rate: rate };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).rater = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
