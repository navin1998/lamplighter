'use strict';

// Everything the help panel says, and every live demonstration in it, as
// plain data. A demo is a small town plus a starting position; scriptFor()
// turns it into frames by running the real engine — path.js for walking
// demos, the deductive solver for thinking demos — so a demo can never
// show something the game itself would not do, and its caption is always
// the engine's own words. tests/test_demos.js holds every entry to the
// technique it claims to teach.
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var gridLib = isNode ? require('./grid.js') : root.LAMP.grid;
  var pathLib = isNode ? require('./path.js') : root.LAMP.path;
  var solver = isNode ? require('./solver.js') : root.LAMP.solver;
  var techniques = isNode ? require('./techniques.js') : root.LAMP.techniques;

  var TABS = Object.freeze([
    { id: 'how', label: 'How to Play' },
    { id: 'techniques', label: 'Techniques' },
    { id: 'modes', label: 'Modes' },
    { id: 'about', label: 'About' }
  ]);

  // A three-by-three town with lamps in the corners and the middle,
  // small enough to read at a glance.
  var LITTLE_TOWN = 'V1-3X3-0.4.8-000-PNFJ';

  var HOW_TO_PLAY = Object.freeze({
    paragraphs: [
      'The town is asleep and every lamp is out. Your walk starts at lamp 1: press it and draw, one square at a time, until every square of the town has been walked. With a mouse or trackpad you can also click the end of your walk, move to draw, and click again to stop.',
      'Visit the lamps in order: 1, then 2, then 3 and on. A lamp you reach too early will not let you in yet, and the walk ends on the highest lamp.',
      'Buildings cannot be crossed, and no square is walked twice. Drag back to take a step back, or press any square of your walk to return to it. Nothing is ever lost.',
      'When every square is walked, the town lights up. There is no clock and no score. If you are stuck, ask for a hint; the Techniques tab shows every idea the towns are built on.'
    ],
    demos: [
      { id: 'walk-whole', kind: 'walk', title: 'A whole walk', code: LITTLE_TOWN, touches: [0, 1, 2, 5, 4, 3, 6, 7, 8], claim: { complete: true } },
      { id: 'walk-order', kind: 'walk', title: 'Lamps wait their turn', code: LITTLE_TOWN, touches: [0, 3, 6, 7, 8], claim: { refusedAt: 4, reason: 'LAMP_OUT_OF_ORDER' } },
      { id: 'think-first', kind: 'deduce', title: 'Working it out', code: 'V1-5X5-E.6-06004080-RPP4', used: [], unusable: [], steps: 8, focus: 0, technique: 'T1' }
    ]
  });

  // Each technique's demo starts from a position where that technique is
  // the only one of T1-T9 that can move (for T10, where T1-T9 are stuck),
  // the same positions tests/test_techniques.js proves that of. The demo
  // shows that step, then whatever easier steps follow straight from it.
  var TECHNIQUES = Object.freeze([
    { id: 'T1', text: [
      'A square with only two ways out left has to use both of them.',
      'Buildings make corridors like this that you can follow without thinking, and every step taken makes more of them.'
    ], demo: { code: 'V1-5X4-2.9.D.H.B.5-1G00020-1GZJ', used: [0, 3, 8, 12, 13, 14, 15, 16, 17, 20, 22, 26, 30], unusable: [1, 9, 21, 27, 29] } },
    { id: 'T2', text: [
      'Lamp 1 and the last lamp are the two ends of the walk, so each takes just one step.',
      'Once an end has its step, nothing else may touch it, which is also why a dead end anywhere else can never happen.'
    ], demo: { code: 'V1-5X5-C.I.F.O.3.6-0G40A800-39QE', used: [0, 1, 2, 3, 4, 6, 8, 16, 19, 20, 24, 27, 30, 35, 39], unusable: [22, 25] } },
    { id: 'T3', text: [
      'Every square along the way has exactly one way in and one way out.',
      'The moment a square has both, every other step from it is closed, and that often leaves a neighbour with a corridor.'
    ], demo: { code: 'V1-6X5-2.O.M-0M0201650M-D72J', used: [0, 3, 4, 6, 10, 11, 12, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 40, 43, 48], unusable: [1, 2, 38, 44, 46] } },
    { id: 'T4', text: [
      'Two squares already joined by the walk must never be joined again by a single step.',
      'That would close a ring, and a ring can never be part of one walk from lamp 1 to the last lamp.'
    ], demo: { code: 'V1-6X6-9.H.3.I.Y.P.K-008800C080E0-QQ53', used: [0, 1, 2, 3, 4, 9, 14, 18, 19, 22, 23, 24, 25, 27, 28, 29, 30, 35, 47, 54, 59], unusable: [33, 34, 46, 57, 58] } },
    { id: 'T5', text: [
      'A patch of town with only two ways in and no end of the walk inside has to be entered by one and left by the other.',
      'A patch holding an end of the walk with a single way out must use it.'
    ], demo: { code: 'V1-6X5-0.P.T.5.K.1-022G280000-E3X1', used: [1, 4, 20, 22, 24, 25, 30, 37, 42, 43, 46, 47, 48], unusable: [0, 19] } },
    { id: 'T6', text: [
      'The pieces of walk already drawn leave loose ends, squares still waiting for a step, and loose ends pair up two at a time.',
      'So when a group of them is linked to the rest by a single undecided step, an odd group must send one across it and an even group never does.'
    ], demo: { code: 'V1-6X6-K.V.H.0.A.E-0H09M0E30006-F3J7', used: [0, 1, 2, 3, 4, 6, 7, 8, 12, 23, 25, 27, 28, 29, 30, 35, 36, 37, 40, 41, 45, 46, 47, 48, 50, 51, 52, 53, 54, 59], unusable: [11, 13, 14, 17, 18, 24, 34, 44] } },
    { id: 'T7', text: [
      'Colour the town like a chessboard: every step changes colour.',
      'So a stretch of walk from a lamp across an even number of squares must leave on the other colour, and across an odd number on the same one.'
    ], demo: { code: 'V1-5X4-5.6.F.I.D.4.C-0000040-289T', used: [0, 2, 3, 8, 12, 13, 15, 16, 17, 18, 20, 22, 26, 30], unusable: [1, 4, 5, 9, 19, 21] } },
    { id: 'T8', text: [
      'The walk splits into legs from each lamp to the next, and together the legs must cover every square.',
      'When no slack is left, every leg has to take a shortest way, and often there is only one.'
    ], demo: { steps: 3, code: 'V1-6X6-Q.T.K.I.F.5.6-0N0GG0F01804-XMTM', used: [0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 17, 19, 23, 25, 27, 28, 29, 30, 35, 37, 38, 39, 40, 41, 42, 48, 49, 51, 52, 53, 54, 59], unusable: [11, 13, 18, 22, 24, 36, 43, 45, 47, 50, 58] } },
    { id: 'T9', text: [
      'A patch with three ways in and no end of the walk inside is crossed once, using two of them.',
      'Counting its light and dark squares decides which two ways can be the pair.'
    ], demo: { code: 'V1-5X5-C.A.O.2.8-018G8002-TPXX', used: [0, 1, 2, 3, 14, 16, 18, 19, 20, 24, 29, 33, 34, 35, 39], unusable: [7, 22, 23] } },
    { id: 'T10', text: [
      'When nothing else helps, try one step each way in your head and follow it through.',
      'If one choice leaves a town that cannot be finished, the other one is right, and no town asks you to look further ahead than that.'
    ], demo: { code: 'V1-5X4-2.9.D.H.B.5-1G00020-1GZJ', used: [0, 3, 8, 10, 12, 13, 14, 15, 16, 17, 20, 22, 23, 26, 30], unusable: [1, 9, 21, 27, 29] } }
  ].map(function (entry) {
    entry.name = techniques.NAMES[entry.id];
    entry.demo = Object.assign({ id: 'technique-' + entry.id, kind: 'deduce', title: entry.name, steps: 4, focus: 0, technique: entry.id }, entry.demo);
    return entry;
  }));

  var MODES = Object.freeze([
    { title: 'Chapters', text: 'Ten chapters of twelve towns. Each one brings in a new idea and keeps all the ones before it. Every chapter is open, so play them in any order you like.' },
    { title: 'Today\'s town', text: 'Everyone who opens the game on the same date gets the same town: gentle on a Monday, demanding by Thursday, severe at the weekend.' },
    { title: 'Endless', text: 'A fresh town of the size and feel you choose, laid out on the spot. Its seed is shown, and the same seed always makes the same town.' },
    { title: 'Share codes', text: 'Every town has a short code. Paste one in to play that exact town. Your progress can be copied out the same way and brought into another browser.' },
    { title: 'How hard is a town?', text: 'A town\'s feel comes from the hardest idea it needs, not from its size. A six-by-six town can be far harder than an eight-by-eight one. Size is texture; technique is difficulty.' }
  ]);

  var ABOUT = Object.freeze([
    'Every town has exactly one walk that lights it, and no building or lamp in it could be taken away without allowing a second.',
    'For the curious: each town is a Hamiltonian path on a grid graph, with its ends fixed at lamp 1 and the last lamp and the lamps between as ordered waypoints. Every town was built from a seed, checked by an exhaustive search that stops at a second solution, and rated by a step-by-step solver that only knows the ten techniques in this panel. The demonstrations here are that same solver at work.',
    'Nothing leaves this browser. There is no account, no network and no tracking; progress is kept here and nowhere else.'
  ]);

  function sentence(text) {
    return text.charAt(0).toUpperCase() + text.slice(1) + (/[.?!]$/.test(text) ? '' : '.');
  }

  function startState(grid, demo) {
    var edgeState = grid.edgeOpen.map(function (open) { return open ? solver.UNKNOWN : solver.UNUSABLE; });
    demo.used.forEach(function (id) { edgeState[id] = solver.USED; });
    demo.unusable.forEach(function (id) { edgeState[id] = solver.UNUSABLE; });
    return edgeState;
  }

  function tierOf(technique) {
    return Number(technique.slice(1));
  }

  // Thinking demos: frame 0 is the starting position; each later frame is
  // one step of the solver's own trace, with the edge states after it. A
  // demo runs for at most demo.steps steps and stops short of any step,
  // after its highlighted one, that needs a harder idea than the one it
  // teaches — those belong to a later lesson.
  function deduceScript(grid, demo) {
    var edgeState = startState(grid, demo);
    var full = solver.solveDeductive(grid, edgeState).trace;
    var trace = [];
    for (var i = 0; i < full.length && trace.length < demo.steps; i += 1) {
      if (i > demo.focus && tierOf(full[i].technique) > tierOf(demo.technique)) break;
      trace.push(full[i]);
    }
    var frames = [{ edgeState: edgeState.slice(), step: null, caption: '' }];
    var current = edgeState.slice();
    trace.forEach(function (step) {
      var value = step.claim === 'USED' ? solver.USED : solver.UNUSABLE;
      step.edges.forEach(function (id) { current[id] = value; });
      frames.push({ edgeState: current.slice(), step: step, caption: techniques.NAMES[step.technique] + ': ' + sentence(step.reason) });
    });
    return frames;
  }

  // Walking demos: each touch goes through path.touch exactly as a
  // player's would, refusals and all.
  function walkScript(grid, demo) {
    var frames = [{ walk: [], touched: null, refused: null, caption: '' }];
    var walk = [];
    demo.touches.forEach(function (cell) {
      var result = pathLib.touch(grid, walk, cell);
      if (!result.ok) {
        frames.push({ walk: walk.slice(), touched: cell, refused: result.reason, caption: pathLib.describeRefusal(grid, walk, result.reason, cell) });
        return;
      }
      var litBefore = walk.filter(function (c) { return grid.lampAt[c] > 0; }).length;
      walk = result.cells;
      var caption = '';
      if (pathLib.isComplete(grid, walk)) caption = 'Every square is walked and every lamp was met in order, so the town is lit.';
      else if (grid.lampAt[cell] > 0 && walk.length > litBefore) caption = 'Lamp ' + grid.lampAt[cell] + ' is lit.';
      frames.push({ walk: walk.slice(), touched: cell, refused: null, caption: caption });
    });
    return frames;
  }

  function scriptFor(demo) {
    var grid = gridLib.fromShareCode(demo.code);
    return { grid: grid, frames: demo.kind === 'walk' ? walkScript(grid, demo) : deduceScript(grid, demo) };
  }

  function allDemos() {
    return HOW_TO_PLAY.demos.concat(TECHNIQUES.map(function (entry) { return entry.demo; }));
  }

  var api = { TABS: TABS, HOW_TO_PLAY: HOW_TO_PLAY, TECHNIQUES: TECHNIQUES, MODES: MODES, ABOUT: ABOUT, scriptFor: scriptFor, allDemos: allDemos };

  if (isNode) module.exports = api;
  else (root.LAMP = root.LAMP || {}).helpContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
