'use strict';

// The grid is a rectangular lattice of cells, indexed 0..N-1 in row-major
// order. Passability lives on EDGES, not on cells: there is exactly one
// boolean per edge, so a wall is structurally incapable of being open from
// one side and blocked from the other. Everything else — neighbour lists,
// lamp lookups — is derived once at construction and frozen, so nothing
// downstream can drift out of sync with the edge set it was built from.
(function (root) {
  'use strict';

  // Edges are split into two contiguous ranges: horizontal edges (between a
  // cell and the one to its right) followed by vertical edges (between a
  // cell and the one below it). Every edge has exactly one id.
  function horizontalEdgeCount(width, height) {
    return (width - 1) * height;
  }

  function verticalEdgeCount(width, height) {
    return width * (height - 1);
  }

  function edgeCount(width, height) {
    return horizontalEdgeCount(width, height) + verticalEdgeCount(width, height);
  }

  function rowOf(width, cell) {
    return Math.floor(cell / width);
  }

  function colOf(width, cell) {
    return cell % width;
  }

  function indexOf(width, row, col) {
    return row * width + col;
  }

  function inBounds(width, height, row, col) {
    return row >= 0 && row < height && col >= 0 && col < width;
  }

  // Canonical edge id between two cells that must be orthogonally adjacent.
  // Order of a and b never matters — the same pair always yields the same id.
  function edgeId(width, height, a, b) {
    var ra = rowOf(width, a);
    var ca = colOf(width, a);
    var rb = rowOf(width, b);
    var cb = colOf(width, b);
    if (ra === rb && Math.abs(ca - cb) === 1) {
      return ra * (width - 1) + Math.min(ca, cb);
    }
    if (ca === cb && Math.abs(ra - rb) === 1) {
      return horizontalEdgeCount(width, height) + Math.min(ra, rb) * width + ca;
    }
    throw new Error('edgeId: cells ' + a + ' and ' + b + ' are not orthogonally adjacent');
  }

  function areAdjacent(width, height, a, b) {
    var ra = rowOf(width, a);
    var ca = colOf(width, a);
    var rb = rowOf(width, b);
    var cb = colOf(width, b);
    return (ra === rb && Math.abs(ca - cb) === 1) || (ca === cb && Math.abs(ra - rb) === 1);
  }

  // The four orthogonal neighbours of a cell, in bounds or not; callers
  // filter for bounds themselves since this is also used to build edge ids.
  function rawNeighbours(width, height, cell) {
    var row = rowOf(width, cell);
    var col = colOf(width, cell);
    var out = [];
    if (inBounds(width, height, row - 1, col)) out.push(indexOf(width, row - 1, col));
    if (inBounds(width, height, row + 1, col)) out.push(indexOf(width, row + 1, col));
    if (inBounds(width, height, row, col - 1)) out.push(indexOf(width, row, col - 1));
    if (inBounds(width, height, row, col + 1)) out.push(indexOf(width, row, col + 1));
    return out;
  }

  function buildOpenSet(width, height, wallEdges) {
    var open = new Array(edgeCount(width, height)).fill(true);
    for (var i = 0; i < wallEdges.length; i += 1) {
      var id = wallEdges[i];
      if (id < 0 || id >= open.length) throw new Error('create: wall edge id out of range: ' + id);
      open[id] = false;
    }
    return open;
  }

  function buildNeighbours(width, height, open) {
    var size = width * height;
    var neighbours = new Array(size);
    for (var cell = 0; cell < size; cell += 1) {
      var raw = rawNeighbours(width, height, cell);
      var passable = [];
      for (var i = 0; i < raw.length; i += 1) {
        var other = raw[i];
        if (open[edgeId(width, height, cell, other)]) passable.push(other);
      }
      neighbours[cell] = Object.freeze(passable);
    }
    return Object.freeze(neighbours);
  }

  // The full edge list, in canonical id order, each entry naming its two
  // cells — the deductive solver reasons over edges directly and needs to
  // walk all of them, or look up a cell's own edges, without recomputing
  // edgeId from scratch at every step.
  function buildEdgeList(width, height) {
    var list = new Array(edgeCount(width, height));
    var idx = 0;
    var row;
    var col;
    for (row = 0; row < height; row += 1) {
      for (col = 0; col < width - 1; col += 1) {
        list[idx] = Object.freeze({ id: idx, a: indexOf(width, row, col), b: indexOf(width, row, col + 1) });
        idx += 1;
      }
    }
    for (row = 0; row < height - 1; row += 1) {
      for (col = 0; col < width; col += 1) {
        list[idx] = Object.freeze({ id: idx, a: indexOf(width, row, col), b: indexOf(width, row + 1, col) });
        idx += 1;
      }
    }
    return Object.freeze(list);
  }

  // For each cell, the edge id reaching each of its OPEN neighbours — the
  // same cells as `neighbours[cell]`, paired with the id techniques.js
  // needs to flip. Walled-off neighbours never appear in either list.
  function buildCellEdges(width, height, neighbours) {
    var size = width * height;
    var out = new Array(size);
    for (var cell = 0; cell < size; cell += 1) {
      var list = neighbours[cell].map(function (neighbour) {
        return Object.freeze({ neighbour: neighbour, edgeId: edgeId(width, height, cell, neighbour) });
      });
      out[cell] = Object.freeze(list);
    }
    return Object.freeze(out);
  }

  function buildLampLookup(size, lamps) {
    var seen = Object.create(null);
    for (var i = 0; i < lamps.length; i += 1) {
      var cell = lamps[i];
      if (cell < 0 || cell >= size) throw new Error('create: lamp cell out of range: ' + cell);
      if (seen[cell]) throw new Error('create: duplicate lamp cell: ' + cell);
      seen[cell] = true;
    }
    var lampAt = new Array(size).fill(0);
    for (var n = 0; n < lamps.length; n += 1) {
      lampAt[lamps[n]] = n + 1;
    }
    return { lampAt: Object.freeze(lampAt), lampCells: Object.freeze(lamps.slice()) };
  }

  function create(spec) {
    var width = spec.width;
    var height = spec.height;
    if (!(width >= 2 && height >= 2)) throw new Error('create: width and height must each be at least 2');
    var wallEdges = spec.wallEdges || [];
    var lamps = spec.lamps || [];
    if (lamps.length < 2) throw new Error('create: at least lamp 1 and lamp L are required');

    var open = buildOpenSet(width, height, wallEdges);
    var neighbours = buildNeighbours(width, height, open);
    var lookup = buildLampLookup(width * height, lamps);

    var grid = {
      width: width,
      height: height,
      size: width * height,
      edgeOpen: Object.freeze(open),
      numEdges: open.length,
      edges: buildEdgeList(width, height),
      neighbours: neighbours,
      cellEdges: buildCellEdges(width, height, neighbours),
      lampAt: lookup.lampAt,
      lampCells: lookup.lampCells,
      lampCount: lookup.lampCells.length,
      seed: typeof spec.seed === 'number' ? spec.seed : null,
      genVersion: typeof spec.genVersion === 'number' ? spec.genVersion : null,
      rowOf: function (cell) { return rowOf(width, cell); },
      colOf: function (cell) { return colOf(width, cell); },
      indexOf: function (row, col) { return indexOf(width, row, col); },
      inBounds: function (row, col) { return inBounds(width, height, row, col); },
      edgeId: function (a, b) { return edgeId(width, height, a, b); },
      areAdjacent: function (a, b) { return areAdjacent(width, height, a, b); },
      isOpen: function (a, b) { return open[edgeId(width, height, a, b)]; },
      isWallEdge: function (id) { return !open[id]; },
      wallEdgeIds: function () {
        var out = [];
        for (var i = 0; i < open.length; i += 1) if (!open[i]) out.push(i);
        return out;
      },
      toShareCode: function () { return toShareCode(grid); }
    };
    return Object.freeze(grid);
  }

  // --- share codes -----------------------------------------------------
  //
  // A share code is plain text: a version tag, the board size, the lamp
  // cells and the wall set, followed by a checksum. The version tag is
  // about the CODE FORMAT itself, not about which generator or seed made
  // the board — a code encodes the finished structure, so it stays valid
  // no matter how the generator that produced it later changes. Bumping
  // SHARE_CODE_VERSION is only for when the format itself changes; a code
  // written under an unrecognised version is refused rather than misread.

  var SHARE_CODE_VERSION = 1;
  var BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford-style, no I/L/O/U

  function toBase36(n) {
    return n.toString(36).toUpperCase();
  }

  function fromBase36(s) {
    var n = parseInt(s, 36);
    if (!(n >= 0)) throw new Error('fromBase36: invalid digits: ' + s);
    return n;
  }

  function bitsToBase32(bits) {
    var out = '';
    for (var i = 0; i < bits.length; i += 5) {
      var value = 0;
      for (var j = 0; j < 5; j += 1) {
        value = (value << 1) | (bits[i + j] ? 1 : 0);
      }
      out += BASE32_ALPHABET.charAt(value);
    }
    return out;
  }

  function base32ToBits(str, bitCount) {
    var bits = [];
    for (var i = 0; i < str.length; i += 1) {
      var value = BASE32_ALPHABET.indexOf(str.charAt(i));
      if (value < 0) throw new Error('base32ToBits: invalid character: ' + str.charAt(i));
      for (var j = 4; j >= 0; j -= 1) bits.push((value >> j) & 1);
    }
    return bits.slice(0, bitCount);
  }

  // FNV-1a over the code's payload, folded down to a 20-bit value so the
  // printed checksum stays a short four base32 characters.
  function checksumOf(payload) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < payload.length; i += 1) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    var folded = (hash ^ (hash >>> 16)) & 0xfffff;
    var bits = [];
    for (var b = 19; b >= 0; b -= 1) bits.push((folded >> b) & 1);
    return bitsToBase32(bits);
  }

  function toShareCode(grid) {
    var lampPart = grid.lampCells.map(toBase36).join('.');
    var bits = [];
    for (var i = 0; i < grid.numEdges; i += 1) bits.push(grid.isWallEdge(i) ? 1 : 0);
    while (bits.length % 5 !== 0) bits.push(0);
    var wallPart = bitsToBase32(bits);
    var payload = 'V' + SHARE_CODE_VERSION + '-' + toBase36(grid.width) + 'X' + toBase36(grid.height) +
      '-' + lampPart + '-' + wallPart;
    return payload + '-' + checksumOf(payload);
  }

  function fromShareCode(code) {
    var parts = String(code).trim().toUpperCase().split('-');
    if (parts.length !== 5) throw new Error('fromShareCode: malformed code');
    var versionPart = parts[0];
    var sizePart = parts[1];
    var lampPart = parts[2];
    var wallPart = parts[3];
    var checksumPart = parts[4];

    if (versionPart.charAt(0) !== 'V') throw new Error('fromShareCode: malformed version tag');
    var version = parseInt(versionPart.slice(1), 10);
    if (version !== SHARE_CODE_VERSION) {
      throw new Error('fromShareCode: unsupported share code version ' + version);
    }

    var payload = parts.slice(0, 4).join('-');
    if (checksumOf(payload) !== checksumPart) throw new Error('fromShareCode: checksum mismatch');

    var sizeBits = sizePart.split('X');
    if (sizeBits.length !== 2) throw new Error('fromShareCode: malformed size');
    var width = fromBase36(sizeBits[0]);
    var height = fromBase36(sizeBits[1]);

    var lamps = lampPart.length === 0 ? [] : lampPart.split('.').map(fromBase36);

    var neededEdgeBits = edgeCount(width, height);
    var wallBits = base32ToBits(wallPart, Math.ceil(neededEdgeBits / 5) * 5);
    var wallEdges = [];
    for (var i = 0; i < neededEdgeBits; i += 1) if (wallBits[i]) wallEdges.push(i);

    return create({ width: width, height: height, wallEdges: wallEdges, lamps: lamps });
  }

  var api = {
    create: create,
    fromShareCode: fromShareCode,
    edgeId: edgeId,
    areAdjacent: areAdjacent,
    rowOf: rowOf,
    colOf: colOf,
    indexOf: indexOf,
    edgeCount: edgeCount,
    horizontalEdgeCount: horizontalEdgeCount,
    verticalEdgeCount: verticalEdgeCount
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).grid = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
