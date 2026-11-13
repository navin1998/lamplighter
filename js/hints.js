'use strict';

// Escalating hints, built from the deductive solver's trace and never from
// the answer key. The one thing the unique solution is used for is noticing
// that the player's walk has already strayed from it — then the only
// honest hint is to say so and offer a way back.
//
// Every hint is for the next single deduction from where the player
// stands, in four levels the UI reveals one press at a time: where to
// look, which idea applies, exactly which cells and why, and finally the
// move itself. Nothing here is shown until the player asks.
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var solver = isNode ? require('./solver.js') : root.LAMP.solver;
  var techniques = isNode ? require('./techniques.js') : root.LAMP.techniques;

  var TECHNIQUE_NAMES = techniques.NAMES;

  var ZONE_NAMES = Object.freeze([
    'top-left corner', 'top edge', 'top-right corner',
    'left side', 'middle', 'right side',
    'bottom-left corner', 'bottom edge', 'bottom-right corner'
  ]);

  // The board cut into thirds each way; small boards just get small zones.
  function zoneOf(grid, cell) {
    return Math.floor(grid.rowOf(cell) * 3 / grid.height) * 3 + Math.floor(grid.colOf(cell) * 3 / grid.width);
  }

  function cellsInZone(grid, zone) {
    var cells = [];
    for (var cell = 0; cell < grid.size; cell += 1) if (zoneOf(grid, cell) === zone) cells.push(cell);
    return cells;
  }

  function edgeCells(grid, edgeIds) {
    var cells = [];
    edgeIds.forEach(function (id) { cells.push(grid.edges[id].a, grid.edges[id].b); });
    return cells;
  }

  // The zone holding most of the cells the deduction touches; ties go to
  // the earlier zone so the choice never wobbles.
  function busiestZone(grid, cells) {
    var counts = new Array(ZONE_NAMES.length).fill(0);
    cells.forEach(function (cell) { counts[zoneOf(grid, cell)] += 1; });
    var best = 0;
    for (var zone = 1; zone < counts.length; zone += 1) if (counts[zone] > counts[best]) best = zone;
    return best;
  }

  function matchingPrefix(walk, solution) {
    var n = 0;
    while (n < walk.length && walk[n] === solution[n]) n += 1;
    return n;
  }

  // Cells the walk has passed through and left. The player can never step
  // into them again, so a deduction that only touches their edges tells
  // them nothing new.
  function leftBehind(walk) {
    var cells = Object.create(null);
    for (var i = 0; i + 1 < walk.length; i += 1) cells[walk[i]] = true;
    return cells;
  }

  function isNews(grid, step, behind) {
    return step.edges.some(function (id) { return !behind[grid.edges[id].a] && !behind[grid.edges[id].b]; });
  }

  function knowledgeFrom(grid, walk) {
    var edgeState = grid.edgeOpen.map(function (open) { return open ? solver.UNKNOWN : solver.UNUSABLE; });
    for (var i = 0; i + 1 < walk.length; i += 1) edgeState[grid.edgeId(walk[i], walk[i + 1])] = solver.USED;
    return edgeState;
  }

  function levelsFor(grid, step) {
    var zone = busiestZone(grid, edgeCells(grid, step.edges));
    var name = TECHNIQUE_NAMES[step.technique];
    var many = step.edges.length > 1;
    return [
      { level: 1, kind: 'region', zone: ZONE_NAMES[zone], cells: cellsInZone(grid, zone),
        text: 'There is something to work out in the ' + ZONE_NAMES[zone] + '.' },
      { level: 2, kind: 'technique', technique: step.technique, name: name,
        text: 'The idea that helps here is ' + name.toLowerCase() + '.' },
      { level: 3, kind: 'shape', technique: step.technique, cells: step.cells.slice(), edges: step.edges.slice(),
        text: step.reason.charAt(0).toUpperCase() + step.reason.slice(1) + '.' },
      { level: 4, kind: 'move', technique: step.technique, edges: step.edges.slice(), claim: step.claim,
        text: step.claim === 'USED'
          ? (many ? 'The walk takes these steps.' : 'The walk takes this step.')
          : (many ? 'The walk never takes these steps.' : 'The walk never takes this step.') }
    ];
  }

  // The hint for a player standing on `walk` (cells from lamp 1, possibly
  // empty) in a town whose unique solution is `solution`. Returns one of:
  //   { offRoute: true, rewindTo, text }  the walk has strayed; keeping the
  //                                       first `rewindTo` cells is still right
  //   { done: true }                      the town is already walked
  //   { stuck: true }                     nothing to say (never, for a shipped town)
  //   { levels: [region, technique, shape, move] }
  function forWalk(grid, walk, solution) {
    var onRoute = matchingPrefix(walk, solution);
    if (onRoute < walk.length) {
      return { offRoute: true, rewindTo: onRoute,
        text: 'Your walk has wandered somewhere this town\'s walk never goes. Would you like to step back to where it was still on course?' };
    }
    if (walk.length === grid.size) return { done: true };

    // Only the next piece of news is wanted, so the solve stops there
    // instead of finishing the town.
    var job = solver.startSolve(grid, knowledgeFrom(grid, walk));
    var trace = job.result().trace;
    var behind = leftBehind(walk);
    var seen = 0;
    var finished = false;
    while (!finished) {
      finished = job.step();
      for (; seen < trace.length; seen += 1) {
        if (isNews(grid, trace[seen], behind)) return { levels: levelsFor(grid, trace[seen]) };
      }
    }
    return { stuck: true };
  }

  var api = { TECHNIQUE_NAMES: TECHNIQUE_NAMES, ZONE_NAMES: ZONE_NAMES, zoneOf: zoneOf, forWalk: forWalk };

  if (isNode) module.exports = api;
  else (root.LAMP = root.LAMP || {}).hints = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
