'use strict';

var help = require('../js/helpcontent.js');
var pathLib = require('../js/path.js');
var techniques = require('../js/techniques.js');

var IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];

function sentences(text) {
  return text.split(/(?<=[.?!])\s+/).filter(Boolean).length;
}

module.exports = function (t) {
  t.test('the help has the four tabs, in order', function () {
    t.deepEq(help.TABS.map(function (tab) { return tab.label; }), ['How to Play', 'Techniques', 'Modes', 'About']);
  });

  t.test('How to Play is four short paragraphs and three demos', function () {
    t.eq(help.HOW_TO_PLAY.paragraphs.length, 4);
    t.eq(help.HOW_TO_PLAY.demos.length, 3);
  });

  t.test('there is one technique entry per T1-T10, each with its name and two sentences', function () {
    t.deepEq(help.TECHNIQUES.map(function (entry) { return entry.id; }), IDS);
    help.TECHNIQUES.forEach(function (entry) {
      t.eq(entry.name, techniques.NAMES[entry.id], entry.id);
      t.eq(sentences(entry.text.join(' ')), 2, entry.id + ' explanation');
      t.eq(entry.demo.technique, entry.id, entry.id + ' demo teaches its own technique');
    });
  });

  // The test that keeps the teaching honest: every thinking demo, run
  // through the real solver from its own starting position, must make the
  // step its entry claims at the position it highlights.
  t.test('every thinking demo makes the step it claims to teach, where it says', function () {
    help.allDemos().filter(function (demo) { return demo.kind === 'deduce'; }).forEach(function (demo) {
      var frames = help.scriptFor(demo).frames;
      var featured = frames[demo.focus + 1];
      t.assert(featured && featured.step, demo.id + ' has no step at its highlighted position');
      t.eq(featured.step.technique, demo.technique, demo.id + ' highlights ' + featured.step.technique);
      t.assert(frames.length <= demo.steps + 1, demo.id + ' shows no more steps than it promises');
    });
  });

  t.test('no technique demo ever shows an idea harder than the one it teaches', function () {
    help.TECHNIQUES.forEach(function (entry) {
      help.scriptFor(entry.demo).frames.slice(1).forEach(function (frame) {
        t.assert(Number(frame.step.technique.slice(1)) <= Number(entry.id.slice(1)), entry.id + ' demo shows ' + frame.step.technique);
      });
    });
  });

  t.test('every demo caption is the engine\'s own words', function () {
    help.allDemos().forEach(function (demo) {
      var script = help.scriptFor(demo);
      script.frames.forEach(function (frame, i) {
        if (demo.kind === 'deduce' && frame.step) {
          t.assert(frame.caption.indexOf(techniques.NAMES[frame.step.technique]) === 0, demo.id + ' frame ' + i + ' names its technique');
          t.assert(frame.caption.toLowerCase().indexOf(frame.step.reason.toLowerCase()) !== -1, demo.id + ' frame ' + i + ' uses the solver\'s reason');
          t.assert(!/\bcell \d/.test(frame.caption), demo.id + ' frame ' + i + ' never talks in cell numbers');
        }
        if (demo.kind === 'walk' && frame.refused) {
          t.eq(frame.caption, pathLib.describeRefusal(script.grid, frame.walk, frame.refused, frame.touched), demo.id + ' frame ' + i);
        }
      });
    });
  });

  t.test('the walking demos do what their captions claim', function () {
    help.HOW_TO_PLAY.demos.filter(function (demo) { return demo.kind === 'walk'; }).forEach(function (demo) {
      var script = help.scriptFor(demo);
      var frames = script.frames;
      if (demo.claim.complete) t.assert(pathLib.isComplete(script.grid, frames[frames.length - 1].walk), demo.id + ' ends with a finished walk');
      if (demo.claim.refusedAt !== undefined) {
        var frame = frames[demo.claim.refusedAt + 1];
        t.eq(frame.refused, pathLib.REASONS[demo.claim.reason], demo.id + ' is refused where it says');
        frames.slice(1, demo.claim.refusedAt + 1).forEach(function (f, i) { t.eq(f.refused, null, demo.id + ' touch ' + i + ' goes through'); });
      }
    });
  });

  t.test('demo scripts are the same every time', function () {
    help.allDemos().forEach(function (demo) {
      t.eq(JSON.stringify(help.scriptFor(demo).frames), JSON.stringify(help.scriptFor(demo).frames), demo.id);
    });
  });
};
