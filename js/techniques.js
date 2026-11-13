'use strict';

// The ten named deduction techniques, in ladder order. Every function has
// the same shape — function(grid, state) — reads the knowledge state built
// by solver.js, flips whatever edges it can prove, and returns how many it
// changed. T1-T9 are pure forward deduction; T10 is the one tier allowed
// to guess, and it guesses only one edge deep.
//
// T5-T9 reason about the partly solved board, not the empty one. A region
// is any patch of cells cut off from the rest by a few live edges (its
// doors). The walk crosses that boundary c times, and since every piece of
// walk inside the region has two ends — each either a door crossing or one
// of the walk's own ends (lamp 1, lamp L) — c has the parity of the number
// of walk ends inside. A region with no walk end needs c >= 2; with one,
// c >= 1. Everything in T5, T7 and T9 falls out of that one count.
(function (root) {
  'use strict';

  function colorOf(grid, cell) {
    return (grid.rowOf(cell) + grid.colOf(cell)) % 2;
  }

  function lookupOf(list) {
    var out = Object.create(null);
    for (var i = 0; i < list.length; i += 1) out[list[i]] = true;
    return out;
  }

  // Cells connected to `cell` by an edge that has not been ruled UNUSABLE
  // — the "live graph" every region- and connectivity-based technique
  // reasons over. Walls never appear here: they start UNUSABLE.
  function liveNeighbours(grid, state, cell) {
    var out = [];
    var edges = grid.cellEdges[cell];
    for (var i = 0; i < edges.length; i += 1) {
      if (!state.isUnusable(edges[i].edgeId)) out.push(edges[i]);
    }
    return out;
  }

  // The whole live graph at once, so the cut searches below can run
  // thousands of passes without rebuilding neighbour lists each time.
  function liveAdjacency(grid, state) {
    var adj = new Array(grid.size);
    for (var cell = 0; cell < grid.size; cell += 1) adj[cell] = liveNeighbours(grid, state, cell);
    return adj;
  }

  // T1 — FORCED CORRIDOR
  // A cell with exactly as many live edges left as it still needs must use
  // every one of them. On a fresh board this is literal wall-drawn
  // corridors; once T3 has eliminated other options elsewhere, the same
  // rule fires again on cells that only became corridors just now — that
  // cascade is what makes this technique worth revisiting after every
  // other deduction, not just once at the start.
  function T1(grid, state) {
    var made = 0;
    for (var cell = 0; cell < grid.size; cell += 1) {
      var req = state.requiredDegree(cell);
      var have = state.usedDegreeOf(cell);
      if (have >= req) continue;
      var unknown = state.unknownEdgesOf(cell);
      if (have + unknown.length === req) {
        var ids = unknown.map(function (pair) { return pair.edgeId; });
        made += state.setManyUsed(ids, 'T1',
          'this square has just as many ways in and out left as it needs, so the walk takes all of them', [cell]);
      }
    }
    return made;
  }

  // T2 — ENDPOINT DEGREE
  // Lamp 1 and lamp L only ever need one connection each. The moment
  // either of them gets it, everything else touching that cell is
  // immediately unusable — the endpoint half of saturation, kept apart
  // from T3 because it fires at degree one, not two.
  function T2(grid, state) {
    var made = 0;
    var endpoints = [grid.lampCells[0], grid.lampCells[grid.lampCount - 1]];
    endpoints.forEach(function (cell) {
      if (state.usedDegreeOf(cell) !== 1) return;
      var unknown = state.unknownEdgesOf(cell);
      if (unknown.length === 0) return;
      var ids = unknown.map(function (pair) { return pair.edgeId; });
      made += state.setManyUnusable(ids, 'T2',
        'this lamp is an end of the walk and takes just one step, which it already has, so no other step from it is used', [cell]);
    });
    return made;
  }

  // T3 — SATURATION
  // Any ordinary cell with both its connections already used has nothing
  // left to offer; every other edge touching it is unusable. The cheapest,
  // most productive rule once the walk has any shape at all, because it
  // is what feeds new corridors to T1.
  function T3(grid, state) {
    var made = 0;
    for (var cell = 0; cell < grid.size; cell += 1) {
      if (state.requiredDegree(cell) !== 2) continue;
      if (state.usedDegreeOf(cell) !== 2) continue;
      var unknown = state.unknownEdgesOf(cell);
      if (unknown.length === 0) continue;
      var ids = unknown.map(function (pair) { return pair.edgeId; });
      made += state.setManyUnusable(ids, 'T3',
        'this square already has its way in and its way out, so the walk takes no other step from it', [cell]);
    }
    return made;
  }

  // T4 — NO PREMATURE LOOP
  // Two cells already joined by the walk so far may not also be joined
  // directly: for a single fixed-endpoint path (never a cycle), closing
  // any loop before the whole board is covered is always wrong — and
  // closing one that happened to cover every cell would still be a loop,
  // not the path this game asks for. There is no exception to carve out.
  function T4(grid, state) {
    var made = 0;
    for (var id = 0; id < grid.edges.length; id += 1) {
      if (!state.isUnknown(id)) continue;
      var e = grid.edges[id];
      if (!state.sameChain(e.a, e.b)) continue;
      if (state.setUnusable(id, 'T4',
        'these two squares are already joined by the walk, so a step straight between them would close a loop before the town is walked')) {
        made += 1;
      }
    }
    return made;
  }

  // Tarjan's bridge pass over whichever graph `adj` describes, ignoring any
  // edge named in `removed` — which is how the two- and three-door
  // searches find their cuts: take one or two edges away, then look for
  // bridges in what is left.
  function bridgesOf(grid, adj, removed) {
    var disc = new Array(grid.size).fill(-1);
    var low = new Array(grid.size).fill(-1);
    var bridges = [];
    var timer = 0;

    function visit(u, parentEdgeId) {
      disc[u] = timer;
      low[u] = timer;
      timer += 1;
      var neighbours = adj[u];
      for (var i = 0; i < neighbours.length; i += 1) {
        var v = neighbours[i].neighbour;
        var eid = neighbours[i].edgeId;
        if (eid === parentEdgeId || removed[eid]) continue;
        if (disc[v] === -1) {
          visit(v, eid);
          low[u] = Math.min(low[u], low[v]);
          if (low[v] > disc[u]) bridges.push(eid);
        } else {
          low[u] = Math.min(low[u], disc[v]);
        }
      }
    }

    for (var cell = 0; cell < grid.size; cell += 1) {
      if (disc[cell] === -1) visit(cell, -1);
    }
    return bridges;
  }

  // Every cell reachable from `start` over live edges, never stepping onto
  // `skipCell` or across an edge in `removed`.
  function reachFrom(adj, start, removed, skipCell) {
    var has = Object.create(null);
    var cells = [start];
    has[start] = true;
    for (var head = 0; head < cells.length; head += 1) {
      var list = adj[cells[head]];
      for (var i = 0; i < list.length; i += 1) {
        var nb = list[i].neighbour;
        if (has[nb] || nb === skipCell || removed[list[i].edgeId]) continue;
        has[nb] = true;
        cells.push(nb);
      }
    }
    return { cells: cells, has: has };
  }

  // The two sides of a cut, or null unless the cut is minimal: exactly two
  // sides, every door running from one to the other. A non-minimal cut is
  // always a smaller cut with spare edges attached, and the smaller one is
  // found on its own.
  function splitAlong(grid, adj, doors) {
    var removed = lookupOf(doors);
    var first = grid.edges[doors[0]];
    var sideA = reachFrom(adj, first.a, removed, -1);
    for (var i = 0; i < doors.length; i += 1) {
      var e = grid.edges[doors[i]];
      if (Boolean(sideA.has[e.a]) === Boolean(sideA.has[e.b])) return null;
    }
    var sideB = reachFrom(adj, first.b, removed, -1);
    if (sideA.cells.length + sideB.cells.length !== grid.size) return null;
    return [sideA, sideB];
  }

  // Every region of the live graph with exactly `doorCount` doors, each
  // cut listed once with both of its sides. A live graph that has already
  // fallen apart has no walk at all.
  function regionsWithDoors(grid, state, doorCount) {
    var adj = liveAdjacency(grid, state);
    if (reachFrom(adj, 0, {}, -1).cells.length !== grid.size) {
      state.contradiction('part of the town can no longer be reached at all');
    }

    var liveIds = [];
    for (var id = 0; id < grid.numEdges; id += 1) if (!state.isUnusable(id)) liveIds.push(id);

    var regions = [];
    var seen = Object.create(null);
    function extend(fixed) {
      bridgesOf(grid, adj, lookupOf(fixed)).forEach(function (bridge) {
        var doors = fixed.concat([bridge]).sort(function (x, y) { return x - y; });
        var key = doors.join(',');
        if (seen[key]) return;
        seen[key] = true;
        var sides = splitAlong(grid, adj, doors);
        if (!sides) return;
        sides.forEach(function (side) { regions.push({ doors: doors, cells: side.cells, has: side.has }); });
      });
    }

    if (doorCount === 1) {
      extend([]);
    } else if (doorCount === 2) {
      liveIds.forEach(function (e1) { extend([e1]); });
    } else {
      for (var i = 0; i < liveIds.length; i += 1) {
        for (var j = i + 1; j < liveIds.length; j += 1) extend([liveIds[i], liveIds[j]]);
      }
    }
    return regions;
  }

  function walkEndsIn(grid, region) {
    var count = 0;
    if (region.has[grid.lampCells[0]]) count += 1;
    if (region.has[grid.lampCells[grid.lampCount - 1]]) count += 1;
    return count;
  }

  function insideCellOf(grid, region, doorId) {
    var e = grid.edges[doorId];
    return region.has[e.a] ? e.a : e.b;
  }

  // How a single stretch of walk covering every cell of a region has to
  // look, judged on colour counts alone: `equal` when the region splits
  // evenly (ends on opposite colours), otherwise both ends on `majority`.
  // A region whose counts differ by more than one cannot be one stretch.
  function stretchShape(grid, state, region) {
    var dark = 0;
    region.cells.forEach(function (cell) { dark += colorOf(grid, cell); });
    var light = region.cells.length - dark;
    if (dark === light) return { equal: true };
    if (Math.abs(dark - light) !== 1) {
      state.contradiction('a patch of ' + region.cells.length + ' cells has ' + dark + ' dark and ' + light +
        ' light squares, too lopsided for one stretch of walk to cover');
    }
    return { equal: false, majority: dark > light ? 1 : 0 };
  }

  // Runs `rule` over every region with each of the given door counts and
  // stops at the first one that changes anything, so each trace step is a
  // single region a player could point at.
  function firstRegionThatHelps(grid, state, doorCounts, rule) {
    for (var i = 0; i < doorCounts.length; i += 1) {
      var regions = regionsWithDoors(grid, state, doorCounts[i]);
      for (var r = 0; r < regions.length; r += 1) {
        var made = rule(grid, state, regions[r]);
        if (made > 0) return made;
      }
    }
    return 0;
  }

  // T5 — POCKET ENTRANCE
  // A patch with no end of the walk inside must be entered and left, so
  // two doors and no more means both are used. A patch holding one end of
  // the walk only needs leaving, so a single door is used. Single cells
  // are left to T1, which says the same thing more simply.
  function pocketEntrance(grid, state, region) {
    var ends = walkEndsIn(grid, region);
    if (ends === 0 && region.doors.length === 1) {
      state.contradiction('a patch with no end of the walk inside has only one way in, so it could be entered but never left');
    }
    if (region.cells.length < 2 || ends === 2) return 0;
    if (region.doors.length !== (ends === 0 ? 2 : 1)) return 0;
    var unknown = region.doors.filter(function (id) { return state.isUnknown(id); });
    if (unknown.length === 0) return 0;
    return state.setManyUsed(unknown, 'T5', ends === 0
      ? 'this patch of town has only two ways in and no end of the walk inside, so the walk must come in one and leave by the other'
      : 'this patch of town holds one end of the walk and has only one way out, so the walk must leave through it', region.cells);
  }

  function T5(grid, state) {
    return firstRegionThatHelps(grid, state, [1, 2], pocketEntrance);
  }

  // T6 — REGION SPLIT
  // The committed chains leave loose ends behind: every connection a cell
  // still needs. Loose ends can only be paired off through undecided
  // edges, two at a time. So when a single undecided edge is all that links
  // one group of loose ends to the rest, that edge is used exactly when the
  // group has an odd number of them — an even group pairs off by itself.
  function looseEndsIn(state, cells) {
    var total = 0;
    for (var i = 0; i < cells.length; i += 1) total += state.requiredDegree(cells[i]) - state.usedDegreeOf(cells[i]);
    return total;
  }

  function T6(grid, state) {
    var adj = new Array(grid.size);
    for (var cell = 0; cell < grid.size; cell += 1) adj[cell] = state.unknownEdgesOf(cell);
    var bridges = bridgesOf(grid, adj, {});
    for (var i = 0; i < bridges.length; i += 1) {
      var id = bridges[i];
      var removed = {};
      removed[id] = true;
      var side = reachFrom(adj, grid.edges[id].a, removed, -1);
      var looseEnds = looseEndsIn(state, side.cells);
      var made = looseEnds % 2 === 1
        ? state.setManyUsed([id], 'T6', 'the walk has ' + looseEnds + ' loose ends on this side, an odd number, so one of them has to cross here to pair up', side.cells)
        : state.setManyUnusable([id], 'T6', 'the walk has ' + looseEnds + ' loose ends on this side, which pair up among themselves, so nothing crosses here', side.cells);
      if (made > 0) return made;
    }
    return 0;
  }

  // T7 — PARITY COLOURING
  // A patch holding exactly one end of the walk, with at most two doors,
  // is walked from that lamp to a single exit cell, covering everything
  // inside. Chessboard colours alternate along any walk, so the patch's
  // size fixes the exit's colour: opposite to the lamp when the size is
  // even, the same when it is odd (and then the exit cannot be the lamp
  // itself, or nothing else inside would be covered). Doors whose inside
  // cell is the wrong colour are never the exit.
  function exitColour(grid, state, region) {
    if (region.cells.length < 2 || walkEndsIn(grid, region) !== 1) return 0;
    var lamp1 = grid.lampCells[0];
    var lamp = region.has[lamp1] ? lamp1 : grid.lampCells[grid.lampCount - 1];
    var shape = stretchShape(grid, state, region);
    if (!shape.equal && shape.majority !== colorOf(grid, lamp)) {
      state.contradiction('the patch holding lamp ' + grid.lampAt[lamp] + ' has more squares of the other colour than its own');
    }
    var wrong = region.doors.filter(function (id) {
      if (state.isUnusable(id)) return false;
      var inside = insideCellOf(grid, region, id);
      var sameColor = colorOf(grid, inside) === colorOf(grid, lamp);
      return shape.equal ? sameColor : (!sameColor || inside === lamp);
    });
    if (wrong.length === 0) return 0;
    return state.setManyUnusable(wrong, 'T7',
      'a walk from lamp ' + grid.lampAt[lamp] + ' covering this patch of ' + region.cells.length + ' squares has to leave from a ' +
      (shape.equal ? 'square of the other colour' : 'different square of its own colour') + ', so this way out is never taken', region.cells);
  }

  function T7(grid, state) {
    return firstRegionThatHelps(grid, state, [1, 2], exitColour);
  }

  // Shortest distances from `source` over live edges, never passing
  // through any lamp other than the leg's own two — a leg cannot meet
  // another lamp midway without lighting it out of turn.
  function legDistances(grid, state, source, from, to) {
    var dist = new Array(grid.size).fill(-1);
    dist[source] = 0;
    var queue = [source];
    for (var head = 0; head < queue.length; head += 1) {
      var cell = queue[head];
      var ln = liveNeighbours(grid, state, cell);
      for (var i = 0; i < ln.length; i += 1) {
        var nb = ln[i].neighbour;
        if (dist[nb] !== -1) continue;
        if (grid.lampAt[nb] > 0 && nb !== from && nb !== to) continue;
        dist[nb] = dist[cell] + 1;
        queue.push(nb);
      }
    }
    return dist;
  }

  // T8 — LEG COUNTING
  // The walk splits into legs between consecutive lamps, whose lengths
  // must sum to exactly N-1 steps and each be at least as long as the
  // shortest way between its two lamps. When the whole board's slack has
  // run out, every leg is pinned to a shortest way: an edge on no leg's
  // shortest way is never walked, and a leg whose shortest way is unique
  // walks every edge of it.
  function T8(grid, state) {
    var legs = [];
    for (var k = 0; k < grid.lampCount - 1; k += 1) legs.push([grid.lampCells[k], grid.lampCells[k + 1]]);

    var distFromArr = [];
    var distToArr = [];
    var legDist = [];
    for (var i = 0; i < legs.length; i += 1) {
      var df = legDistances(grid, state, legs[i][0], legs[i][0], legs[i][1]);
      var dt = legDistances(grid, state, legs[i][1], legs[i][0], legs[i][1]);
      distFromArr.push(df);
      distToArr.push(dt);
      legDist.push(df[legs[i][1]]);
    }
    if (legDist.indexOf(-1) !== -1) state.contradiction('some lamp can no longer be reached from the one before it');

    var sumDist = legDist.reduce(function (a, b) { return a + b; }, 0);
    if ((grid.size - 1) - sumDist !== 0) return 0;

    var made = 0;
    var onSomeLeg = new Array(grid.numEdges).fill(false);
    legs.forEach(function (leg, idx) {
      var from = distFromArr[idx];
      var to = distToArr[idx];
      var d = legDist[idx];
      var onPath = [];
      for (var id = 0; id < grid.numEdges; id += 1) {
        if (state.isUnusable(id)) continue;
        var e = grid.edges[id];
        if (from[e.a] === -1 || from[e.b] === -1) continue;
        if (from[e.a] + 1 + to[e.b] === d || from[e.b] + 1 + to[e.a] === d) onPath.push(id);
      }
      onPath.forEach(function (id) { onSomeLeg[id] = true; });
      if (onPath.length === d) {
        var unknownOnes = onPath.filter(function (id) { return state.isUnknown(id); });
        if (unknownOnes.length > 0) {
          made += state.setManyUsed(unknownOnes, 'T8',
            'with no slack left anywhere on the walk, the leg from lamp ' + (idx + 1) + ' to lamp ' + (idx + 2) +
            ' has to be the shortest way there, and that way is the only one');
        }
      }
    });

    var spare = [];
    for (var id = 0; id < grid.numEdges; id += 1) if (state.isUnknown(id) && !onSomeLeg[id]) spare.push(id);
    if (spare.length > 0) {
      made += state.setManyUnusable(spare, 'T8',
        'with no slack left anywhere on the walk, every leg takes a shortest way between its lamps, and these steps lie on none of them');
    }
    return made;
  }

  // T9 — POCKET PARITY
  // A patch with no end of the walk inside and exactly three doors is
  // entered once and left once, so it uses exactly two of them, and the
  // stretch of walk between covers the whole patch. Its colour counts then
  // decide which pairs of door cells can be that stretch's two ends; a
  // door that belongs to no such pair is never used.
  function doorPairs(grid, state, region) {
    if (region.cells.length < 2 || walkEndsIn(grid, region) !== 0) return 0;
    var shape = stretchShape(grid, state, region);
    var usedDoors = region.doors.filter(function (id) { return state.isUsed(id); });

    function fits(x, y) {
      if (state.isUnusable(x) || state.isUnusable(y)) return false;
      if (usedDoors.some(function (u) { return u !== x && u !== y; })) return false;
      var a = insideCellOf(grid, region, x);
      var b = insideCellOf(grid, region, y);
      if (a === b) return false;
      if (shape.equal) return colorOf(grid, a) !== colorOf(grid, b);
      return colorOf(grid, a) === shape.majority && colorOf(grid, b) === shape.majority;
    }

    var possible = region.doors.filter(function (x) {
      return region.doors.some(function (y) { return y !== x && fits(x, y); });
    });
    if (possible.length === 0) state.contradiction('no two doors of this three-door patch can be the two ends of one stretch covering it');
    var wrong = region.doors.filter(function (id) { return !state.isUnusable(id) && possible.indexOf(id) === -1; });
    if (wrong.length === 0) return 0;
    return state.setManyUnusable(wrong, 'T9',
      'this patch of ' + region.cells.length + ' squares is entered once and left once, and counting its light and dark squares leaves no way to pair this door with another', region.cells);
  }

  function T9(grid, state) {
    return firstRegionThatHelps(grid, state, [3], doorPairs);
  }

  // Whether assuming one edge USED (or UNUSABLE) and running T1-T9 on a
  // throw-away copy ends in a contradiction. Anything other than a
  // contradiction is a real bug and is allowed to surface.
  function breaksUnder(state, id, assumeUsed) {
    var probe = state.clone();
    try {
      if (assumeUsed) probe.setUsed(id, 'T10-probe', 'hypothesis');
      else probe.setUnusable(id, 'T10-probe', 'hypothesis');
      probe.propagate();
    } catch (err) {
      if (!err.contradiction) throw err;
      return true;
    }
    return false;
  }

  // T10 — SINGLE BRANCH
  // Assume one UNKNOWN edge one way, push T1-T9 as far as they go on a
  // copy, and if that breaks, the edge must be the other way. Depth one,
  // never nested: the copy's propagate() only ever reaches T1-T9.
  function T10(grid, state) {
    for (var id = 0; id < grid.numEdges; id += 1) {
      if (!state.isUnknown(id)) continue;
      if (breaksUnder(state, id, true)) return concludeBranch(grid, state, id, true);
      if (breaksUnder(state, id, false)) return concludeBranch(grid, state, id, false);
    }
    return 0;
  }

  // Records what T10 learned about one edge: a broken "used" guess rules
  // it out, a broken "unusable" guess commits it. Shared with the solver's
  // step-at-a-time version of T10, so both say exactly the same thing.
  function concludeBranch(grid, state, id, usedBroke) {
    var e = grid.edges[id];
    if (usedBroke) {
      return state.setManyUnusable([id], 'T10',
        'if the walk took this step, the rest of the town could not be finished, so it does not', [e.a, e.b]);
    }
    return state.setManyUsed([id], 'T10',
      'if the walk left this step out, the rest of the town could not be finished, so it must take it', [e.a, e.b]);
  }

  // The names players see, in the help, the hints and the demos.
  var NAMES = Object.freeze({
    T1: 'Forced corridor',
    T2: 'Endpoint degree',
    T3: 'Saturation',
    T4: 'No premature loop',
    T5: 'Pocket entrance',
    T6: 'Region split',
    T7: 'Parity colouring',
    T8: 'Leg counting',
    T9: 'Pocket parity',
    T10: 'Single branch'
  });

  var api = { NAMES: NAMES, T1: T1, T2: T2, T3: T3, T4: T4, T5: T5, T6: T6, T7: T7, T8: T8, T9: T9, T10: T10, concludeBranch: concludeBranch };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).techniques = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
