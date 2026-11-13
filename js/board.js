'use strict';

// The main board: rendering and input. The walk itself, and every rule
// about what a touch means, lives in path.js; this file only turns
// pointers and keys into touches and draws what comes back.
//
// Three stacked canvases keep redraws small. The base layer (streets,
// buildings, unlit lamps) is drawn once per resize. The light layer (lit
// squares, the ribbon, lit lamps, the cursor) is redrawn only inside the
// rectangle a change touched. The effects layer carries short-lived
// motion — the next lamp's pulse, a bloom, a refused lamp's shake, the
// completion sweep — and only runs frames while something is moving.
(function (root) {
  'use strict';

  var LAMP = root.LAMP;
  var pathLib = LAMP.path;
  var REASONS = pathLib.REASONS;
  var LOCKED_TEXT = 'This town is lit. Clear the walk to walk it again.';

  var MIN_CELL = 44;
  var MAX_CELL = 88;
  var LARGE_MAX_CELL = 140;
  var PAD = 4;
  var BLOOM_MS = 900;
  var SHAKE_MS = 500;
  var SWEEP_MS_PER_CELL = 45;
  var PULSE_PERIOD_MS = 2400;
  var REPLAY_MS_PER_CELL = 140;

  function readColours(element) {
    var style = root.getComputedStyle(element);
    function prop(name) { return style.getPropertyValue(name).trim(); }
    return {
      street: prop('--street'),
      streetLit: prop('--street-lit'),
      building: prop('--building'),
      buildingEdge: prop('--building-edge'),
      lampUnlit: prop('--lamp-unlit'),
      lampLit: prop('--lamp-lit'),
      numberUnlit: prop('--lamp-number-unlit'),
      numberLit: prop('--lamp-number-lit'),
      ribbonStart: prop('--ribbon-start'),
      ribbonHead: prop('--ribbon-head'),
      cursor: prop('--cursor'),
      refused: prop('--refused'),
      font: prop('--font')
    };
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    var out = ca.map(function (v, i) { return Math.round(v + (cb[i] - v) * t); });
    return 'rgb(' + out.join(',') + ')';
  }

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // ctx.roundRect is too new to rely on for older laptops.
  function roundedRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function makeLayer(container) {
    var canvas = root.document.createElement('canvas');
    container.appendChild(canvas);
    return { canvas: canvas, ctx: canvas.getContext('2d') };
  }

  // options: initialCells, reducedMotion, onChange(info), onMessage(text, reason),
  //          onComplete(), onRequestClear(), onSound(kind) — kind is 'step',
  //          'lamp' or 'complete', as the player's own walk grows
  //
  // A saved walk that no longer replays legally on this town is not
  // trusted; the board starts empty instead. A town that opens already
  // walked opens lit and quiet — the sweep belongs to the moment of
  // finishing, not to every visit afterwards.
  function createBoard(container, grid, options) {
    var initial = options.initialCells && pathLib.isLegalWalk(grid, options.initialCells) ? options.initialCells : [];
    var state = pathLib.createState(grid, initial);
    var working = state.cells();
    var drawn = [];
    var reducedMotion = Boolean(options.reducedMotion);
    var completed = pathLib.isComplete(grid, working);
    var sweepShown = completed;
    var replay = null;

    var base = makeLayer(container);
    var light = makeLayer(container);
    var hintLayer = makeLayer(container);
    var fx = makeLayer(container);
    var colours = readColours(container);
    var hint = null;

    var live = root.document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    container.appendChild(live);

    container.tabIndex = 0;
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', 'Town board. Arrow keys walk, Backspace steps back, Escape clears, Control Z undoes. With a mouse, click the walk\'s end to draw by moving, and click again to stop.');

    var cs = MIN_CELL;
    var dpr = 1;
    var effects = [];
    var painted = [];
    var frame = 0;
    var drag = null;
    // Click-to-draw: with a mouse or trackpad, a click on the walk's end
    // lets the walk follow the cursor until the next click.
    var draw = null;
    var lastRefusedCell = -1;
    var refusedThisGesture = false;

    // --- geometry --------------------------------------------------------

    function centre(cell) {
      return { x: PAD + (grid.colOf(cell) + 0.5) * cs, y: PAD + (grid.rowOf(cell) + 0.5) * cs };
    }

    function cellRect(cell) {
      return { x: PAD + grid.colOf(cell) * cs, y: PAD + grid.rowOf(cell) * cs, w: cs, h: cs };
    }

    function cellAt(x, y) {
      var col = Math.floor((x - PAD) / cs);
      var row = Math.floor((y - PAD) / cs);
      if (row < 0 || row >= grid.height || col < 0 || col >= grid.width) return null;
      return grid.indexOf(row, col);
    }

    // available: { width, height, large }. A large board fills the width
    // and lets the page scroll rather than fitting the screen's height.
    function resize(available) {
      var byWidth = (available.width - 2 * PAD) / grid.width;
      var byHeight = (available.height - 2 * PAD) / grid.height;
      var limit = available.large ? Math.min(LARGE_MAX_CELL, byWidth) : Math.min(MAX_CELL, byWidth, byHeight);
      cs = Math.floor(Math.max(MIN_CELL, limit));
      dpr = root.devicePixelRatio || 1;
      var w = grid.width * cs + 2 * PAD;
      var h = grid.height * cs + 2 * PAD;
      container.style.width = w + 'px';
      container.style.height = h + 'px';
      [base, light, hintLayer, fx].forEach(function (layer) {
        layer.canvas.width = Math.round(w * dpr);
        layer.canvas.height = Math.round(h * dpr);
        layer.canvas.style.width = w + 'px';
        layer.canvas.style.height = h + 'px';
        layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      });
      colours = readColours(container);
      drawBase();
      drawLight(null);
      drawHint();
      wakeEffects();
    }

    // --- hint layer -------------------------------------------------------

    // A hint is drawn over the town in the cool cursor colour, never as
    // part of the walk: a zone outlined, then the squares and steps the
    // deduction is about marked, then the step itself — a dashed line for
    // a step the walk takes, a cross for one it never takes. It redraws
    // whole, since it only changes when the player asks for it.
    function edgeMidpoint(id) {
      var a = centre(grid.edges[id].a);
      var b = centre(grid.edges[id].b);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function drawHint() {
      var ctx = hintLayer.ctx;
      ctx.clearRect(0, 0, grid.width * cs + 2 * PAD, grid.height * cs + 2 * PAD);
      if (!hint) return;
      ctx.lineWidth = Math.max(2, cs * 0.05);
      ctx.strokeStyle = colours.cursor;

      if (hint.kind === 'region' || hint.kind === 'shape') {
        ctx.fillStyle = hint.kind === 'region' ? 'rgba(127, 214, 255, 0.12)' : 'rgba(127, 214, 255, 0.24)';
        hint.cells.forEach(function (cell) {
          var r = cellRect(cell);
          roundedRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, cs * 0.12);
          ctx.fill();
        });
      }
      if (hint.kind === 'region') {
        var minX = Infinity;
        var minY = Infinity;
        var maxX = -Infinity;
        var maxY = -Infinity;
        hint.cells.forEach(function (cell) {
          var r = cellRect(cell);
          minX = Math.min(minX, r.x);
          minY = Math.min(minY, r.y);
          maxX = Math.max(maxX, r.x + r.w);
          maxY = Math.max(maxY, r.y + r.h);
        });
        ctx.setLineDash([cs * 0.18, cs * 0.12]);
        roundedRect(ctx, minX + 3, minY + 3, maxX - minX - 6, maxY - minY - 6, cs * 0.2);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      hint.edges.forEach(function (id) {
        var m = edgeMidpoint(id);
        if (hint.kind === 'shape') {
          ctx.beginPath();
          ctx.arc(m.x, m.y, cs * 0.16, 0, Math.PI * 2);
          ctx.stroke();
        } else if (hint.claim === 'USED') {
          var a = centre(grid.edges[id].a);
          var b = centre(grid.edges[id].b);
          ctx.setLineDash([cs * 0.12, cs * 0.1]);
          ctx.lineWidth = cs * 0.14;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = Math.max(2, cs * 0.05);
        } else {
          var k = cs * 0.13;
          ctx.beginPath();
          ctx.moveTo(m.x - k, m.y - k);
          ctx.lineTo(m.x + k, m.y + k);
          ctx.moveTo(m.x - k, m.y + k);
          ctx.lineTo(m.x + k, m.y - k);
          ctx.lineWidth = Math.max(3, cs * 0.07);
          ctx.stroke();
          ctx.lineWidth = Math.max(2, cs * 0.05);
        }
      });
    }

    // --- base layer ------------------------------------------------------

    function lampRadius() {
      return cs * 0.3;
    }

    function drawLampNumber(ctx, cell, colour) {
      var c = centre(cell);
      ctx.fillStyle = colour;
      ctx.font = '600 ' + Math.round(cs * 0.34) + 'px ' + colours.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(grid.lampAt[cell]), c.x, c.y + cs * 0.02);
    }

    // An unlit lamp is a hollow ring; a lit one is a filled disc. They
    // differ in shape, not only in colour.
    function drawUnlitLamp(ctx, cell, dx) {
      var c = centre(cell);
      ctx.beginPath();
      ctx.arc(c.x + dx, c.y, lampRadius(), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.strokeStyle = colours.lampUnlit;
      ctx.stroke();
      ctx.save();
      ctx.translate(dx, 0);
      drawLampNumber(ctx, cell, colours.numberUnlit);
      ctx.restore();
    }

    function drawBuilding(ctx, x, y, w, h) {
      roundedRect(ctx, x, y, w, h, Math.min(w, h) / 2);
      ctx.fillStyle = colours.building;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = colours.buildingEdge;
      ctx.stroke();
    }

    function drawBase() {
      var ctx = base.ctx;
      var w = grid.width * cs + 2 * PAD;
      var h = grid.height * cs + 2 * PAD;
      ctx.clearRect(0, 0, w, h);

      for (var cell = 0; cell < grid.size; cell += 1) {
        var r = cellRect(cell);
        ctx.fillStyle = colours.street;
        roundedRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, cs * 0.12);
        ctx.fill();
      }

      var t = Math.max(5, Math.round(cs * 0.16));
      drawBuilding(ctx, PAD - t / 2, PAD - t / 2, grid.width * cs + t, t);
      drawBuilding(ctx, PAD - t / 2, PAD + grid.height * cs - t / 2, grid.width * cs + t, t);
      drawBuilding(ctx, PAD - t / 2, PAD - t / 2, t, grid.height * cs + t);
      drawBuilding(ctx, PAD + grid.width * cs - t / 2, PAD - t / 2, t, grid.height * cs + t);

      grid.wallEdgeIds().forEach(function (id) {
        var e = grid.edges[id];
        var ra = cellRect(e.a);
        if (grid.rowOf(e.a) === grid.rowOf(e.b)) {
          drawBuilding(ctx, ra.x + cs - t / 2, ra.y - t / 2, t, cs + t);
        } else {
          drawBuilding(ctx, ra.x - t / 2, ra.y + cs - t / 2, cs + t, t);
        }
      });

      grid.lampCells.forEach(function (cell) { drawUnlitLamp(ctx, cell, 0); });
    }

    // --- light layer -----------------------------------------------------

    // Colour along the ribbon depends on how far into the town a step is,
    // not on how long the walk happens to be, so extending the walk never
    // recolours what is already drawn.
    function ribbonColour(index) {
      return mix(colours.ribbonStart, colours.ribbonHead, grid.size > 1 ? index / (grid.size - 1) : 1);
    }

    function lampsLitOn(cells) {
      var count = 0;
      cells.forEach(function (cell) { if (grid.lampAt[cell] > 0) count += 1; });
      return count;
    }

    function drawLitLamp(ctx, cell) {
      var c = centre(cell);
      var glow = ctx.createRadialGradient(c.x, c.y, lampRadius() * 0.6, c.x, c.y, cs * 0.8);
      glow.addColorStop(0, 'rgba(255, 196, 110, 0.55)');
      glow.addColorStop(1, 'rgba(255, 196, 110, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(c.x - cs, c.y - cs, cs * 2, cs * 2);
      ctx.beginPath();
      ctx.arc(c.x, c.y, lampRadius(), 0, Math.PI * 2);
      ctx.fillStyle = colours.lampLit;
      ctx.fill();
      drawLampNumber(ctx, cell, colours.numberLit);
    }

    function drawRibbon(ctx, cells, brightness) {
      if (cells.length === 0) return;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (cells.length === 1) {
        var only = centre(cells[0]);
        ctx.beginPath();
        ctx.arc(only.x, only.y, cs * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = ribbonColour(0);
        ctx.fill();
        return;
      }
      // The glow is one continuous stroke so its overlaps never double up
      // at the turns; the ribbon itself goes segment by segment, each in
      // its own colour along the way.
      ctx.beginPath();
      cells.forEach(function (cell, i) {
        var p = centre(cell);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.globalAlpha = Math.min(1, 0.22 * brightness);
      ctx.lineWidth = cs * 0.58;
      ctx.strokeStyle = colours.ribbonHead;
      ctx.stroke();
      ctx.globalAlpha = 1;

      for (var i = 0; i + 1 < cells.length; i += 1) {
        var a = centre(cells[i]);
        var b = centre(cells[i + 1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = cs * (0.3 + 0.06 * i / Math.max(1, grid.size - 1));
        ctx.strokeStyle = brightness > 1 ? colours.ribbonHead : ribbonColour(i + 1);
        ctx.stroke();
      }
    }

    function drawCursor(ctx, cell) {
      var c = centre(cell);
      ctx.beginPath();
      ctx.arc(c.x, c.y, cs * 0.42, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, cs * 0.05);
      ctx.strokeStyle = colours.cursor;
      ctx.stroke();
    }

    function drawLight(rect) {
      var ctx = light.ctx;
      ctx.save();
      if (rect) {
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      } else {
        ctx.clearRect(0, 0, grid.width * cs + 2 * PAD, grid.height * cs + 2 * PAD);
      }

      working.forEach(function (cell) {
        var r = cellRect(cell);
        ctx.fillStyle = colours.streetLit;
        roundedRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, cs * 0.12);
        ctx.fill();
      });
      drawRibbon(ctx, working, completed && sweepShown ? 1.6 : 1);
      working.forEach(function (cell) { if (grid.lampAt[cell] > 0) drawLitLamp(ctx, cell); });
      if (working.length > 0 && !completed) drawCursor(ctx, working[working.length - 1]);
      ctx.restore();
      drawn = working.slice();
    }

    // The smallest rectangle covering every square whose drawing differs
    // between the last frame and now, grown by a cell for glows and caps.
    function changedRect(before, after) {
      var k = 0;
      while (k < before.length && k < after.length && before[k] === after[k]) k += 1;
      var touched = before.slice(Math.max(0, k - 1)).concat(after.slice(Math.max(0, k - 1)));
      if (touched.length === 0) return null;
      var minX = Infinity;
      var minY = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      touched.forEach(function (cell) {
        var r = cellRect(cell);
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      });
      return { x: minX - cs, y: minY - cs, w: maxX - minX + 2 * cs, h: maxY - minY + 2 * cs };
    }

    // --- effects layer ---------------------------------------------------

    function nextLampDue() {
      var lit = lampsLitOn(working);
      return lit < grid.lampCount ? grid.lampCells[lit] : -1;
    }

    function wakeEffects() {
      if (frame === 0) frame = root.requestAnimationFrame(tick);
    }

    function aroundCell(cell, reach) {
      var c = centre(cell);
      return { x: c.x - cs * reach, y: c.y - cs * reach, w: cs * reach * 2, h: cs * reach * 2 };
    }

    function wholeBoard() {
      return { x: 0, y: 0, w: grid.width * cs + 2 * PAD, h: grid.height * cs + 2 * PAD };
    }

    function drawPulse(ctx, now) {
      var cell = nextLampDue();
      if (cell === -1 || completed) return false;
      painted.push(aroundCell(cell, 0.5));
      var c = centre(cell);
      var phase = reducedMotion ? 0.5 : (Math.sin(now / PULSE_PERIOD_MS * Math.PI * 2) + 1) / 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, lampRadius() + cs * (0.06 + 0.05 * phase), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, cs * 0.035);
      ctx.strokeStyle = colours.lampLit;
      ctx.globalAlpha = 0.35 + 0.45 * phase;
      ctx.stroke();
      ctx.globalAlpha = 1;
      return !reducedMotion;
    }

    function drawEffect(ctx, effect, now) {
      var t = Math.min(1, (now - effect.start) / effect.duration);
      var c;
      painted.push(effect.kind === 'sweep' ? wholeBoard() : aroundCell(effect.cell, 1.3));
      if (effect.kind === 'bloom') {
        c = centre(effect.cell);
        var radius = cs * (0.35 + 0.9 * easeOut(t));
        var bloom = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
        bloom.addColorStop(0, 'rgba(255, 210, 130, ' + (0.5 * (1 - t)) + ')');
        bloom.addColorStop(1, 'rgba(255, 210, 130, 0)');
        ctx.fillStyle = bloom;
        ctx.fillRect(c.x - radius, c.y - radius, radius * 2, radius * 2);
      } else if (effect.kind === 'shake') {
        c = centre(effect.cell);
        ctx.beginPath();
        ctx.arc(c.x, c.y, lampRadius() + cs * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = colours.street;
        ctx.fill();
        var dx = reducedMotion ? 0 : Math.sin(t * Math.PI * 6) * cs * 0.06 * (1 - t);
        drawUnlitLamp(ctx, effect.cell, dx);
        ctx.beginPath();
        ctx.arc(c.x + dx, c.y, lampRadius() + cs * 0.06, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, cs * 0.04);
        ctx.strokeStyle = colours.refused;
        ctx.stroke();
      } else if (effect.kind === 'sweep') {
        var reach = Math.floor(t * working.length);
        var lit = working.slice(0, Math.max(1, reach));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        drawRibbon(ctx, lit, 0.8);
        ctx.restore();
        if (t >= 1) {
          sweepShown = true;
          drawLight(null);
        }
      }
      return t < 1;
    }

    // Each frame wipes only what the last frame painted.
    function tick(now) {
      frame = 0;
      var ctx = fx.ctx;
      painted.forEach(function (rect) { ctx.clearRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4); });
      painted = [];
      var moving = drawPulse(ctx, now);
      var hadEffects = effects.length > 0;
      effects = effects.filter(function (effect) {
        var running = drawEffect(ctx, effect, now);
        if (running) moving = true;
        return running;
      });
      // One more frame after the last effect ends, to wipe its final paint.
      if (moving || hadEffects) frame = root.requestAnimationFrame(tick);
    }

    function addEffect(kind, cell, duration) {
      effects.push({ kind: kind, cell: cell, start: root.performance.now(), duration: duration });
      wakeEffects();
    }

    // --- reacting to a new walk -------------------------------------------

    function describe(cells) {
      var lit = lampsLitOn(cells);
      if (cells.length === 0) return 'The walk is empty. It begins at lamp 1.';
      var head = cells[cells.length - 1];
      var where = 'Row ' + (grid.rowOf(head) + 1) + ', column ' + (grid.colOf(head) + 1) + '.';
      var lamps = ' Lamps lit: ' + lit + ' of ' + grid.lampCount + '.';
      var next = lit < grid.lampCount ? ' Next: lamp ' + (lit + 1) + '.' : '';
      var left = grid.size - cells.length;
      return where + lamps + next + ' ' + left + (left === 1 ? ' square' : ' squares') + ' left.';
    }

    function paint(next) {
      var before = drawn;
      var litBefore = lampsLitOn(before);
      working = next;
      var rect = changedRect(before, working);
      if (rect) drawLight(rect);

      var litNow = lampsLitOn(working);
      if (litNow > litBefore && !reducedMotion) {
        for (var k = litBefore; k < litNow; k += 1) addEffect('bloom', grid.lampCells[k], BLOOM_MS);
      }
      wakeEffects();
    }

    function sound(kind) {
      if (options.onSound) options.onSound(kind);
    }

    function show(next) {
      var grew = next.length > drawn.length;
      var litBefore = lampsLitOn(drawn);
      paint(next);
      if (!completed && pathLib.isComplete(grid, working)) {
        completed = true;
        sound('complete');
        endDrag(true);
        endDraw(true);
        if (reducedMotion) {
          drawLight(null);
        } else {
          addEffect('sweep', -1, Math.max(1200, working.length * SWEEP_MS_PER_CELL));
        }
        if (options.onComplete) options.onComplete();
        return;
      }
      if (lampsLitOn(working) > litBefore) sound('lamp');
      else if (grew) sound('step');
      if (completed && !pathLib.isComplete(grid, working)) {
        completed = false;
        sweepShown = false;
        drawLight(null);
      }
    }

    function commit() {
      var result = state.replace(working);
      if (result.ok && result.changed) changed();
    }

    // Any change to the walk takes a hint's marks away; the next hint is
    // worked out from wherever the walk now stands.
    function changed() {
      if (hint) {
        hint = null;
        drawHint();
      }
      show(state.cells());
      live.textContent = describe(working);
      if (options.onChange) options.onChange(info());
    }

    function info() {
      return {
        cells: state.cells(),
        complete: pathLib.isComplete(grid, state.cells()),
        canUndo: state.canUndo() && !locked(),
        locked: locked(),
        canRedo: state.canRedo(),
        lampsLit: lampsLitOn(state.cells()),
        lampCount: grid.lampCount,
        refused: refusedThisGesture,
        drawing: draw !== null
      };
    }

    // A lit town stays exactly as it was walked until the player clears it;
    // no touch, key or undo on the board can change it before then.
    function locked() {
      return pathLib.isComplete(grid, state.cells());
    }

    function sayLocked() {
      if (options.onMessage) options.onMessage(LOCKED_TEXT, 'locked');
    }

    function refuse(reason, cell) {
      refusedThisGesture = true;
      if (reason === REASONS.LAMP_OUT_OF_ORDER) {
        if (cell !== lastRefusedCell) addEffect('shake', cell, reducedMotion ? 1200 : SHAKE_MS);
        lastRefusedCell = cell;
      }
      if (options.onMessage) options.onMessage(pathLib.describeRefusal(grid, working, reason, cell), reason);
    }

    // --- pointer input ----------------------------------------------------

    function pointerPoint(event) {
      var box = fx.canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    }

    // The squares a straight line from the centre of `fromCell` to `point`
    // passes through, in order, sampled finely enough that no square is
    // skipped. A corner crossing comes out as a diagonal jump and is dealt
    // with by the caller.
    function cellsAlong(fromCell, point) {
      var start = centre(fromCell);
      var dx = point.x - start.x;
      var dy = point.y - start.y;
      var steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cs / 6)));
      var out = [];
      var last = fromCell;
      for (var i = 1; i <= steps; i += 1) {
        var cell = cellAt(start.x + dx * i / steps, start.y + dy * i / steps);
        if (cell === null) break;
        if (cell !== last) {
          out.push(cell);
          last = cell;
        }
      }
      return out;
    }

    // Applies a dragged run of squares as one move. A diagonal jump means
    // the pointer clipped a corner, so whichever of the two squares beside
    // it keeps the move legal is walked through first.
    function dragThrough(walk, fromCell, cells) {
      var current = walk;
      var prev = fromCell;
      for (var i = 0; i < cells.length; i += 1) {
        var cell = cells[i];
        if (!grid.areAdjacent(prev, cell)) {
          var corners = [grid.indexOf(grid.rowOf(prev), grid.colOf(cell)), grid.indexOf(grid.rowOf(cell), grid.colOf(prev))];
          var bridged = null;
          for (var j = 0; j < corners.length && !bridged; j += 1) {
            var tried = pathLib.touchAll(grid, current, [corners[j], cell]);
            if (tried.ok) bridged = tried;
          }
          if (!bridged) return pathLib.touchAll(grid, current, [corners[0], cell]);
          current = bridged.cells;
        } else {
          var step = pathLib.touch(grid, current, cell);
          if (!step.ok) return { ok: false, reason: step.reason, cell: cell };
          current = step.cells;
        }
        prev = cell;
      }
      return { ok: true, cells: current };
    }

    // Capture only keeps a drag alive when the finger slides off the board.
    // A browser that refuses it for a pointer it no longer considers down
    // costs nothing but that, so the drag goes ahead regardless.
    function capture(pointerId) {
      try {
        fx.canvas.setPointerCapture(pointerId);
      } catch (err) {
        if (err.name !== 'InvalidStateError' && err.name !== 'NotFoundError') throw err;
      }
    }

    function endDrag(keep) {
      if (!drag) return;
      if (fx.canvas.hasPointerCapture(drag.pointerId)) fx.canvas.releasePointerCapture(drag.pointerId);
      drag = null;
      if (keep) commit();
    }

    // --- click-to-draw ------------------------------------------------------

    // The whole run between the two clicks is one gesture, so it lands as a
    // single undo step when the mode ends, however it ends.
    function startDraw() {
      draw = { lastCell: working[working.length - 1], paused: false, refused: false };
      refusedThisGesture = false;
      fx.canvas.classList.add('drawing');
      root.document.addEventListener('pointerdown', onPagePointerDown, true);
      container.addEventListener('focusout', onDrawFocusOut);
      root.addEventListener('pagehide', onDrawPageHide);
      if (options.onDrawMode) options.onDrawMode(true);
    }

    function endDraw(keep) {
      if (!draw) return;
      draw = null;
      fx.canvas.classList.remove('drawing');
      root.document.removeEventListener('pointerdown', onPagePointerDown, true);
      container.removeEventListener('focusout', onDrawFocusOut);
      root.removeEventListener('pagehide', onDrawPageHide);
      if (keep) commit();
      if (options.onDrawMode) options.onDrawMode(false);
    }

    // A click anywhere else on the page is the second click too, and it
    // lands before buttons such as Undo or Hint read the walk. Clicks on the
    // board itself are left to onPointerDown.
    function onPagePointerDown(event) {
      if (event.target !== fx.canvas) endDraw(true);
    }

    function onDrawFocusOut() {
      endDraw(true);
    }

    function onDrawPageHide() {
      endDraw(true);
    }

    function onDrawLeave() {
      if (draw) draw.paused = true;
    }

    // After the cursor has been off the board, drawing only picks up again
    // once it is back on the walk's end or a square beside it.
    function drawTo(point) {
      var cell = cellAt(point.x, point.y);
      if (cell === null) return;
      var head = working[working.length - 1];
      if (draw.paused) {
        if (cell !== head && !grid.areAdjacent(head, cell)) return;
        draw.paused = false;
        draw.lastCell = head;
      }
      if (cell === draw.lastCell) return;
      var result = dragThrough(working, draw.lastCell, cellsAlong(draw.lastCell, point));
      if (!result.ok) {
        draw.refused = true;
        refuse(result.reason, result.cell);
        return;
      }
      lastRefusedCell = -1;
      draw.lastCell = cell;
      var hadRefused = draw.refused;
      draw.refused = false;
      show(result.cells);
      if (hadRefused && draw && options.onDrawMode) options.onDrawMode(true);
    }

    // --- showing a solved walk again ----------------------------------------

    // Draws `cells` one square at a time over the player's own walk, which
    // is left exactly as it was underneath and comes back when the replay
    // ends — on endReplay(), or the next touch or key on the board. Under
    // reduced motion the whole walk appears at once.
    function startReplay(cells, onEnd) {
      endReplay();
      endDrag(false);
      endDraw(true);
      replay = { cells: cells.slice(), shown: reducedMotion ? cells.length : 0, timer: 0, onEnd: onEnd };
      paint([]);
      advanceReplay();
    }

    function advanceReplay() {
      if (!replay) return;
      if (replay.shown < replay.cells.length && !reducedMotion) replay.shown += 1;
      paint(replay.cells.slice(0, replay.shown));
      if (replay.shown < replay.cells.length) replay.timer = root.setTimeout(advanceReplay, REPLAY_MS_PER_CELL);
    }

    function endReplay() {
      if (!replay) return false;
      root.clearTimeout(replay.timer);
      var onEnd = replay.onEnd;
      replay = null;
      paint(state.cells());
      if (onEnd) onEnd();
      return true;
    }

    function onPointerDown(event) {
      if (endReplay()) return;
      if (draw) {
        event.preventDefault();
        endDraw(true);
        return;
      }
      if (drag || event.button > 0) return;
      container.focus({ preventScroll: true });
      var point = pointerPoint(event);
      var cell = cellAt(point.x, point.y);
      if (cell === null) return;
      if (locked()) {
        sayLocked();
        return;
      }
      lastRefusedCell = -1;
      refusedThisGesture = false;

      var walk = state.cells();
      if (walk.length === 0 && cell !== grid.lampCells[0]) {
        refuse(REASONS.MUST_START_AT_LAMP_1, cell);
        working = [grid.lampCells[0]];
        commit();
        return;
      }

      var result = pathLib.touch(grid, walk, cell);
      if (!result.ok) {
        refuse(result.reason, cell);
        return;
      }
      event.preventDefault();
      capture(event.pointerId);
      // Only a press on the walk's own end can become a click that starts
      // drawing; a press anywhere else is tap-to-extend as before.
      var onEnd = walk.length === 0 ? cell === grid.lampCells[0] : cell === walk[walk.length - 1];
      drag = { pointerId: event.pointerId, lastCell: cell, clickable: event.pointerType === 'mouse' && onEnd, moved: false };
      show(result.cells);
    }

    function onPointerMove(event) {
      if (draw && !drag && event.pointerType === 'mouse') {
        drawTo(pointerPoint(event));
        return;
      }
      if (!drag || event.pointerId !== drag.pointerId) return;
      var point = pointerPoint(event);
      var cell = cellAt(point.x, point.y);
      if (cell === null || cell === drag.lastCell) return;
      drag.moved = true;
      var result = dragThrough(working, drag.lastCell, cellsAlong(drag.lastCell, point));
      if (!result.ok) {
        refuse(result.reason, result.cell);
        return;
      }
      lastRefusedCell = -1;
      drag.lastCell = cell;
      show(result.cells);
    }

    function onPointerUp(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      var startsDrawing = event.type === 'pointerup' && drag.clickable && !drag.moved && !completed;
      endDrag(true);
      if (startsDrawing) startDraw();
    }

    // --- keyboard ---------------------------------------------------------

    var ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    function onKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'Tab' && endReplay()) {
        event.preventDefault();
        return;
      }
      var arrow = ARROWS[event.key];
      // Escape only ends drawing; it never also asks to clear the walk.
      if (draw && (arrow || event.key === 'Backspace' || event.key === 'Escape')) {
        endDraw(true);
        if (event.key === 'Escape') {
          event.preventDefault();
          return;
        }
      }
      refusedThisGesture = false;
      if (arrow) {
        event.preventDefault();
        if (locked()) {
          sayLocked();
          return;
        }
        var walk = state.cells();
        if (walk.length === 0) {
          working = [grid.lampCells[0]];
          commit();
          return;
        }
        var head = walk[walk.length - 1];
        var row = grid.rowOf(head) + arrow[0];
        var col = grid.colOf(head) + arrow[1];
        if (!grid.inBounds(row, col)) return;
        var target = grid.indexOf(row, col);
        var result = pathLib.touch(grid, walk, target);
        if (!result.ok) {
          lastRefusedCell = -1;
          refuse(result.reason, target);
          return;
        }
        working = result.cells;
        commit();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        api.retreat();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (options.onRequestClear) options.onRequestClear();
      }
    }

    fx.canvas.addEventListener('pointerdown', onPointerDown);
    fx.canvas.addEventListener('pointermove', onPointerMove);
    fx.canvas.addEventListener('pointerup', onPointerUp);
    fx.canvas.addEventListener('pointercancel', onPointerUp);
    fx.canvas.addEventListener('pointerleave', onDrawLeave);
    container.addEventListener('keydown', onKeyDown);

    var api = {
      resize: resize,
      info: info,
      undo: function () {
        endReplay();
        endDraw(true);
        if (locked()) {
          sayLocked();
          return;
        }
        refusedThisGesture = false;
        if (state.undo()) changed();
      },
      // Redo is left open on a lit walk: the only thing it can redo there
      // is a Clear the player undid.
      redo: function () { endReplay(); endDraw(true); refusedThisGesture = false; if (state.redo()) changed(); },
      retreat: function () {
        endReplay();
        endDraw(true);
        if (locked()) {
          sayLocked();
          return;
        }
        if (state.retreat().ok) changed();
      },
      clear: function () { endReplay(); endDraw(true); refusedThisGesture = false; if (state.clear().ok) changed(); },
      replay: startReplay,
      endReplay: endReplay,
      // overlay: { kind: 'region' | 'shape' | 'move', cells, edges, claim }
      showHint: function (overlay) {
        hint = overlay;
        drawHint();
      },
      clearHint: function () {
        hint = null;
        drawHint();
      },
      // Takes the walk back to `cells` as one undoable gesture — the
      // player's own choice after a hint offers it, never done for them.
      rewindTo: function (cells) {
        endReplay();
        endDraw(true);
        refusedThisGesture = false;
        var result = state.replace(cells);
        if (result.ok && result.changed) changed();
      },
      destroy: function () {
        endReplay();
        endDrag(false);
        endDraw(true);
        if (frame !== 0) root.cancelAnimationFrame(frame);
        frame = 0;
        fx.canvas.removeEventListener('pointerleave', onDrawLeave);
        container.removeEventListener('keydown', onKeyDown);
        container.textContent = '';
      },
      // Under reduced motion the completion is shown as a before and an
      // after, and this is the manual step between them.
      stepCompletion: function () {
        if (!completed) return;
        sweepShown = true;
        drawLight(null);
      },
      announce: function () { live.textContent = describe(working); }
    };

    show(working);
    return api;
  }

  (root.LAMP = root.LAMP || {}).board = { createBoard: createBoard, MIN_CELL: MIN_CELL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
