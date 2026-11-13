'use strict';

var rater = require('../js/rater.js');

// A hand-written trace step: technique plus how many edges it settled.
function step(technique, edgeCount) {
  var edges = [];
  for (var i = 0; i < edgeCount; i += 1) edges.push(i);
  return { technique: technique, cells: [], edges: edges, claim: 'USED', reason: 'hand-written' };
}

module.exports = function (t) {
  t.test('a corridor-and-saturation solve is tier 3, depth 0, Gentle', function () {
    var rating = rater.rate([step('T1', 2), step('T3', 2), step('T1', 1), step('T3', 1)]);
    t.deepEq(rating, { tier: 3, depth: 0, longestStall: 2, label: 'Gentle' });
  });

  t.test('tier picks the base label', function () {
    t.eq(rater.rate([step('T1', 1), step('T4', 1)]).label, 'Steady');
    t.eq(rater.rate([step('T1', 1), step('T5', 1)]).label, 'Steady');
    t.eq(rater.rate([step('T1', 1), step('T6', 1)]).label, 'Thoughtful');
    t.eq(rater.rate([step('T1', 1), step('T7', 1)]).label, 'Thoughtful');
    t.eq(rater.rate([step('T1', 1), step('T8', 1)]).label, 'Demanding');
    t.eq(rater.rate([step('T1', 1), step('T9', 1)]).label, 'Demanding');
    t.eq(rater.rate([step('T1', 1), step('T10', 1)]).label, 'Severe');
  });

  t.test('depth counts distinct techniques above T3, not steps', function () {
    var rating = rater.rate([step('T4', 1), step('T4', 1), step('T5', 1), step('T2', 1), step('T3', 1)]);
    t.eq(rating.depth, 2);
    t.eq(rating.tier, 5);
  });

  t.test('three or more techniques above T3 move the label up one', function () {
    var rating = rater.rate([step('T4', 1), step('T5', 1), step('T6', 1)]);
    t.deepEq(rating, { tier: 6, depth: 3, longestStall: 1, label: 'Demanding' });
  });

  t.test('longestStall only looks at the top technique', function () {
    var rating = rater.rate([step('T1', 20), step('T8', 2), step('T8', 5)]);
    t.eq(rating.longestStall, 5);
    t.eq(rating.label, 'Demanding');
  });

  t.test('a single top-technique step settling eight edges moves the label up one', function () {
    t.eq(rater.rate([step('T1', 1), step('T8', 8)]).label, 'Severe');
    t.eq(rater.rate([step('T1', 1), step('T8', 7)]).label, 'Demanding');
  });

  t.test('both bumps together never go past Severe', function () {
    var rating = rater.rate([step('T4', 1), step('T5', 1), step('T9', 9)]);
    t.deepEq(rating, { tier: 9, depth: 3, longestStall: 9, label: 'Severe' });
  });

  t.test('bumps stack from the base label', function () {
    var rating = rater.rate([step('T4', 1), step('T5', 1), step('T6', 8)]);
    t.deepEq(rating, { tier: 6, depth: 3, longestStall: 8, label: 'Severe' });
  });

  t.test('rating depends on the trace alone and is repeatable', function () {
    var trace = [step('T1', 3), step('T7', 2), step('T4', 1)];
    t.deepEq(rater.rate(trace), rater.rate(trace.slice()));
  });
};
