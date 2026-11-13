'use strict';

// The walk itself. isLegalMove and isComplete are pure functions of a grid
// and a plain cell-index array — the UI, the deductive solver, the verifier
// and the live help demos all call these same two functions, so there is
// exactly one place the rules of the game are written down. Everything else
// here is a thin, undo-tracked wrapper around them for the board to drive.
(function (root) {
  'use strict';

  var REASONS = Object.freeze({
    MUST_START_AT_LAMP_1: 'MUST_START_AT_LAMP_1',
    NOT_ADJACENT: 'NOT_ADJACENT',
    WALL: 'WALL',
    ALREADY_VISITED: 'ALREADY_VISITED',
    LAMP_OUT_OF_ORDER: 'LAMP_OUT_OF_ORDER',
    ALREADY_COMPLETE: 'ALREADY_COMPLETE',
    NOT_EMPTY: 'NOT_EMPTY',
    NOT_ON_PATH: 'NOT_ON_PATH',
    EMPTY: 'EMPTY',
    ILLEGAL_WALK: 'ILLEGAL_WALK'
  });

  function countLampsOn(grid, cells) {
    var count = 0;
    for (var i = 0; i < cells.length; i += 1) {
      if (grid.lampAt[cells[i]] > 0) count += 1;
    }
    return count;
  }

  // cells is the walk so far, in order; cell is the candidate next step.
  function isLegalMove(grid, cells, cell) {
    if (cells.length === grid.size) return { ok: false, reason: REASONS.ALREADY_COMPLETE };

    if (cells.length === 0) {
      if (cell === grid.lampCells[0]) return { ok: true };
      return { ok: false, reason: REASONS.MUST_START_AT_LAMP_1 };
    }

    var head = cells[cells.length - 1];
    if (cell === head) return { ok: false, reason: REASONS.NOT_ADJACENT };
    if (cells.indexOf(cell) !== -1) return { ok: false, reason: REASONS.ALREADY_VISITED };
    if (!grid.areAdjacent(head, cell)) return { ok: false, reason: REASONS.NOT_ADJACENT };
    if (!grid.isOpen(head, cell)) return { ok: false, reason: REASONS.WALL };

    var lampNumber = grid.lampAt[cell];
    if (lampNumber > 0) {
      var nextExpected = countLampsOn(grid, cells) + 1;
      if (lampNumber !== nextExpected) return { ok: false, reason: REASONS.LAMP_OUT_OF_ORDER };
    }

    return { ok: true };
  }

  // A walk is the solution the instant every cell is on it and the lamps
  // were met in order — there is no separate submit step. Rather than trust
  // that whatever array it is handed was assembled through legal steps,
  // this replays it through isLegalMove itself, so a complete walk is
  // always proven, never assumed, however the array reached this point.
  function isComplete(grid, cells) {
    if (cells.length !== grid.size) return false;
    var prefix = [];
    for (var i = 0; i < cells.length; i += 1) {
      var check = isLegalMove(grid, prefix, cells[i]);
      if (!check.ok) return false;
      prefix.push(cells[i]);
    }
    var last = cells[cells.length - 1];
    return grid.lampAt[last] === grid.lampCount;
  }

  // What touching `cell` does to the walk, the one rule the board's press,
  // drag, tap and arrow keys all share: on an empty board only lamp 1
  // starts a walk; a cell already on the walk cuts it back to there (the
  // previous cell is simply the shortest cut); anything else must be a
  // legal next step. Returns { ok, cells } or { ok: false, reason }.
  function touch(grid, cells, cell) {
    if (cells.length === 0) {
      return cell === grid.lampCells[0] ? { ok: true, cells: [cell] } : { ok: false, reason: REASONS.MUST_START_AT_LAMP_1 };
    }
    var at = cells.indexOf(cell);
    if (at !== -1) return { ok: true, cells: cells.slice(0, at + 1) };
    var check = isLegalMove(grid, cells, cell);
    return check.ok ? { ok: true, cells: cells.concat([cell]) } : { ok: false, reason: check.reason };
  }

  // What a player is told when a touch is refused. The board and the help
  // demos both say it in these words, so they can never disagree.
  function describeRefusal(grid, cells, reason, cell) {
    if (reason === REASONS.MUST_START_AT_LAMP_1) return 'Every walk begins at lamp 1, so that is where it starts.';
    if (reason === REASONS.LAMP_OUT_OF_ORDER) {
      return 'Lamp ' + grid.lampAt[cell] + ' has to wait until lamp ' + (countLampsOn(grid, cells) + 1) + ' is lit.';
    }
    if (reason === REASONS.WALL) return 'There is a building in the way.';
    if (reason === REASONS.NOT_ADJACENT) return 'The walk goes one square at a time, from its end.';
    return '';
  }

  // A fast drag crosses several cells between two pointer events. They are
  // taken as one move: either every touch along the way is fine, or none
  // of them happens and the walk stays exactly as it was.
  function touchAll(grid, cells, sequence) {
    var walk = cells;
    for (var i = 0; i < sequence.length; i += 1) {
      var result = touch(grid, walk, sequence[i]);
      if (!result.ok) return { ok: false, reason: result.reason, cell: sequence[i] };
      walk = result.cells;
    }
    return { ok: true, cells: walk };
  }

  function isLegalWalk(grid, cells) {
    var prefix = [];
    for (var i = 0; i < cells.length; i += 1) {
      if (!isLegalMove(grid, prefix, cells[i]).ok) return false;
      prefix.push(cells[i]);
    }
    return true;
  }

  function sameCells(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  // History is a simple array of past cell arrays with a cursor into it —
  // every mutation (extend, truncate, retreat, clear) is just "compute the
  // new walk, commit it", so undo/redo and one-press truncation of a whole
  // wrong branch all fall out of the same mechanism for free.
  function createState(grid, initialCells) {
    var history = [Object.freeze((initialCells || []).slice())];
    var cursor = 0;

    function current() {
      return history[cursor];
    }

    function commit(nextCells) {
      history = history.slice(0, cursor + 1);
      history.push(Object.freeze(nextCells));
      cursor = history.length - 1;
    }

    return {
      cells: function () { return current().slice(); },
      length: function () { return current().length; },
      head: function () { var c = current(); return c.length ? c[c.length - 1] : null; },
      has: function (cell) { return current().indexOf(cell) !== -1; },
      isComplete: function () { return isComplete(grid, current()); },

      canExtend: function (cell) { return isLegalMove(grid, current(), cell); },
      extend: function (cell) {
        var result = isLegalMove(grid, current(), cell);
        if (result.ok) commit(current().concat([cell]));
        return result;
      },

      start: function () {
        if (current().length !== 0) return { ok: false, reason: REASONS.NOT_EMPTY };
        commit([grid.lampCells[0]]);
        return { ok: true };
      },

      truncateTo: function (cell) {
        var cells = current();
        var idx = cells.indexOf(cell);
        if (idx === -1) return { ok: false, reason: REASONS.NOT_ON_PATH };
        if (idx === cells.length - 1) return { ok: true, changed: false };
        commit(cells.slice(0, idx + 1));
        return { ok: true, changed: true };
      },

      retreat: function () {
        var cells = current();
        if (cells.length === 0) return { ok: false, reason: REASONS.EMPTY };
        commit(cells.slice(0, -1));
        return { ok: true };
      },

      clear: function () {
        if (current().length === 0) return { ok: false, reason: REASONS.EMPTY };
        commit([]);
        return { ok: true };
      },

      // A whole gesture lands as one history entry, so one undo takes back
      // one drag however many cells it covered. The new walk is replayed
      // through the rules rather than trusted.
      replace: function (nextCells) {
        if (!isLegalWalk(grid, nextCells)) return { ok: false, reason: REASONS.ILLEGAL_WALK };
        if (sameCells(nextCells, current())) return { ok: true, changed: false };
        commit(nextCells.slice());
        return { ok: true, changed: true };
      },

      canUndo: function () { return cursor > 0; },
      canRedo: function () { return cursor < history.length - 1; },
      undo: function () {
        if (cursor === 0) return false;
        cursor -= 1;
        return true;
      },
      redo: function () {
        if (cursor === history.length - 1) return false;
        cursor += 1;
        return true;
      }
    };
  }

  var api = {
    REASONS: REASONS,
    isLegalMove: isLegalMove,
    isComplete: isComplete,
    isLegalWalk: isLegalWalk,
    describeRefusal: describeRefusal,
    touch: touch,
    touchAll: touchAll,
    createState: createState
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).path = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
