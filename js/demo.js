'use strict';

// LAMPLIGHTER LANE: the miniature board the help panel teaches with. It
// draws frames that helpcontent.scriptFor() made by running the real
// engine, so nothing here decides what happens next; this file only
// animates what the solver or path.js already did. For a thinking step,
// the squares under consideration glow, a step the walk takes draws itself
// in, and a step ruled out flashes once and settles into a blocked mark.
//
// It loops gently while on screen, pausing on the step it teaches and at
// the end. Step and Replay are always there; under reduced motion nothing
// moves on its own and every change is a clean jump from one frame to the
// next.
(function (root) {
  'use strict';

  var LAMP = root.LAMP;
  var doc = root.document;

  var MAX_CELL = 34;
  var PAD = 4;
  var ANIMATE_MS = 900;
  var STEP_MS = 1900;
  var FEATURE_MS = 3400;
  var WALK_STEP_MS = 650;
  var REFUSED_MS = 2600;
  var END_MS = 3600;
  var START_MS = 1400;

  function readColours(element) {
    var style = root.getComputedStyle(element);
    function prop(name) { return style.getPropertyValue(name).trim(); }
    return {
      street: prop('--street'),
      building: prop('--building'),
      lampUnlit: prop('--lamp-unlit'),
      lampLit: prop('--lamp-lit'),
      numberUnlit: prop('--lamp-number-unlit'),
      numberLit: prop('--lamp-number-lit'),
      ribbon: prop('--ribbon-head'),
      cursor: prop('--cursor'),
      refused: prop('--refused'),
      blocked: prop('--text-muted'),
      font: prop('--font')
    };
  }

  function button(label) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'control';
    b.textContent = label;
    return b;
  }

  // demo: an entry from helpContent (HOW_TO_PLAY.demos or a technique's demo).
  function createLane(container, demo, options) {
    var script = LAMP.helpContent.scriptFor(demo);
    var grid = script.grid;
    var frames = script.frames;
    var reducedMotion = Boolean(options.reducedMotion);

    var lane = doc.createElement('figure');
    lane.className = 'lane';
    var canvas = doc.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A small town showing: ' + demo.title);
    var caption = doc.createElement('figcaption');
    caption.className = 'lane-caption';
    caption.setAttribute('aria-live', 'polite');
    var controls = doc.createElement('div');
    controls.className = 'lane-controls';
    var stepButton = button('Step');
    var replayButton = button('Replay');
    controls.appendChild(stepButton);
    controls.appendChild(replayButton);
    lane.appendChild(canvas);
    lane.appendChild(caption);
    lane.appendChild(controls);
    container.appendChild(lane);

    var ctx = canvas.getContext('2d');
    var colours = readColours(lane);
    var cs = MAX_CELL;
    var index = 0;
    var playing = !reducedMotion;
    var onScreen = true;
    var timer = 0;
    var frameRequest = 0;
    var animationStart = 0;
    var observer = null;

    function size() {
      var available = Math.max(160, Math.min(container.clientWidth || 300, 320));
      cs = Math.floor(Math.min(MAX_CELL, (available - 2 * PAD) / grid.width));
      var w = grid.width * cs + 2 * PAD;
      var h = grid.height * cs + 2 * PAD;
      var dpr = root.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function centre(cell) {
      return { x: PAD + (grid.colOf(cell) + 0.5) * cs, y: PAD + (grid.rowOf(cell) + 0.5) * cs };
    }

    function edgeMid(id) {
      var a = centre(grid.edges[id].a);
      var b = centre(grid.edges[id].b);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal: grid.rowOf(grid.edges[id].a) === grid.rowOf(grid.edges[id].b) };
    }

    function line(a, b, width, colour) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    function drawTown() {
      ctx.clearRect(0, 0, grid.width * cs + 2 * PAD, grid.height * cs + 2 * PAD);
      for (var cell = 0; cell < grid.size; cell += 1) {
        ctx.fillStyle = colours.street;
        ctx.fillRect(PAD + grid.colOf(cell) * cs + 1, PAD + grid.rowOf(cell) * cs + 1, cs - 2, cs - 2);
      }
      var t = Math.max(3, Math.round(cs * 0.16));
      ctx.fillStyle = colours.building;
      ctx.fillRect(PAD - t / 2, PAD - t / 2, grid.width * cs + t, t);
      ctx.fillRect(PAD - t / 2, PAD + grid.height * cs - t / 2, grid.width * cs + t, t);
      ctx.fillRect(PAD - t / 2, PAD - t / 2, t, grid.height * cs + t);
      ctx.fillRect(PAD + grid.width * cs - t / 2, PAD - t / 2, t, grid.height * cs + t);
      grid.wallEdgeIds().forEach(function (id) {
        var m = edgeMid(id);
        if (m.horizontal) ctx.fillRect(m.x - t / 2, m.y - cs / 2 - t / 2, t, cs + t);
        else ctx.fillRect(m.x - cs / 2 - t / 2, m.y - t / 2, cs + t, t);
      });
    }

    function drawLamp(cell, lit, dx) {
      var c = centre(cell);
      var r = cs * 0.3;
      ctx.beginPath();
      ctx.arc(c.x + dx, c.y, r, 0, Math.PI * 2);
      if (lit) {
        ctx.fillStyle = colours.lampLit;
        ctx.fill();
      } else {
        ctx.fillStyle = colours.street;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, cs * 0.06);
        ctx.strokeStyle = colours.lampUnlit;
        ctx.stroke();
      }
      ctx.fillStyle = lit ? colours.numberLit : colours.numberUnlit;
      ctx.font = '600 ' + Math.round(cs * 0.34) + 'px ' + colours.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(grid.lampAt[cell]), c.x + dx, c.y + cs * 0.02);
    }

    // A ruled-out step is drawn as a small cross on the street between the
    // two squares, so it never depends on colour alone.
    function drawBlocked(id, alpha) {
      var m = edgeMid(id);
      var k = cs * 0.11;
      ctx.globalAlpha = alpha;
      line({ x: m.x - k, y: m.y - k }, { x: m.x + k, y: m.y + k }, Math.max(1.5, cs * 0.06), colours.blocked);
      line({ x: m.x - k, y: m.y + k }, { x: m.x + k, y: m.y - k }, Math.max(1.5, cs * 0.06), colours.blocked);
      ctx.globalAlpha = 1;
    }

    function drawDeduce(frame, progress) {
      var step = frame.step;
      var animating = step ? Object.create(null) : null;
      if (step) step.edges.forEach(function (id) { animating[id] = true; });

      if (step) {
        ctx.fillStyle = 'rgba(127, 214, 255, ' + (0.2 * Math.min(1, progress * 3)) + ')';
        step.cells.forEach(function (cell) {
          ctx.fillRect(PAD + grid.colOf(cell) * cs + 1, PAD + grid.rowOf(cell) * cs + 1, cs - 2, cs - 2);
        });
      }

      for (var id = 0; id < grid.numEdges; id += 1) {
        if (animating && animating[id]) continue;
        if (frame.edgeState[id] === LAMP.solver.USED) line(centre(grid.edges[id].a), centre(grid.edges[id].b), cs * 0.26, colours.ribbon);
        else if (frame.edgeState[id] === LAMP.solver.UNUSABLE && grid.edgeOpen[id]) drawBlocked(id, 1);
      }

      if (step) {
        step.edges.forEach(function (eid) {
          var a = centre(grid.edges[eid].a);
          var b = centre(grid.edges[eid].b);
          if (step.claim === 'USED') {
            line(a, { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress }, cs * 0.26, colours.ribbon);
          } else {
            // One soft flash in the first third, then the mark settles in.
            var flash = progress < 0.33 ? Math.sin(progress / 0.33 * Math.PI) : 0;
            if (flash > 0) {
              var m = edgeMid(eid);
              ctx.beginPath();
              ctx.arc(m.x, m.y, cs * 0.22, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255, 154, 122, ' + (0.55 * flash) + ')';
              ctx.fill();
            }
            drawBlocked(eid, Math.max(0, (progress - 0.2) / 0.8));
          }
        });
      }
      grid.lampCells.forEach(function (cell) { drawLamp(cell, false, 0); });
    }

    function drawWalk(frame, progress) {
      var walk = frame.walk;
      for (var i = 0; i + 1 < walk.length; i += 1) {
        var a = centre(walk[i]);
        var b = centre(walk[i + 1]);
        var last = i + 2 === walk.length && frame.touched === walk[walk.length - 1];
        var reach = last ? progress : 1;
        line(a, { x: a.x + (b.x - a.x) * reach, y: a.y + (b.y - a.y) * reach }, cs * 0.3, colours.ribbon);
      }
      if (walk.length === 1) {
        var only = centre(walk[0]);
        ctx.beginPath();
        ctx.arc(only.x, only.y, cs * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = colours.ribbon;
        ctx.fill();
      }
      grid.lampCells.forEach(function (cell) {
        var dx = 0;
        if (frame.refused && cell === frame.touched) dx = Math.sin(progress * Math.PI * 4) * cs * 0.06 * (1 - progress);
        drawLamp(cell, walk.indexOf(cell) !== -1, dx);
        if (frame.refused && cell === frame.touched) {
          var c = centre(cell);
          ctx.beginPath();
          ctx.arc(c.x + dx, c.y, cs * 0.38, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(1.5, cs * 0.05);
          ctx.strokeStyle = colours.refused;
          ctx.stroke();
        }
      });
      if (walk.length > 0 && !LAMP.path.isComplete(grid, walk)) {
        var head = centre(walk[walk.length - 1]);
        ctx.beginPath();
        ctx.arc(head.x, head.y, cs * 0.42, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1.5, cs * 0.05);
        ctx.strokeStyle = colours.cursor;
        ctx.stroke();
      }
    }

    function draw(progress) {
      drawTown();
      if (demo.kind === 'walk') drawWalk(frames[index], progress);
      else drawDeduce(frames[index], progress);
    }

    function animate(now) {
      frameRequest = 0;
      var progress = reducedMotion ? 1 : Math.min(1, (now - animationStart) / ANIMATE_MS);
      draw(progress);
      if (progress < 1) frameRequest = root.requestAnimationFrame(animate);
    }

    function holdFor(i) {
      if (i === 0) return START_MS;
      if (i === frames.length - 1) return END_MS;
      if (demo.kind === 'walk') return frames[i].refused ? REFUSED_MS : WALK_STEP_MS;
      return i === demo.focus + 1 ? FEATURE_MS : STEP_MS;
    }

    function show(i) {
      index = i;
      caption.textContent = frames[i].caption || (i === 0 ? 'The town as it stands.' : ' ');
      if (frameRequest !== 0) root.cancelAnimationFrame(frameRequest);
      animationStart = root.performance.now();
      if (reducedMotion) {
        draw(1);
      } else {
        frameRequest = root.requestAnimationFrame(animate);
      }
    }

    function schedule() {
      root.clearTimeout(timer);
      if (!playing || !onScreen) return;
      timer = root.setTimeout(function () {
        show(index === frames.length - 1 ? 0 : index + 1);
        schedule();
      }, holdFor(index));
    }

    stepButton.addEventListener('click', function () {
      playing = false;
      root.clearTimeout(timer);
      show(index === frames.length - 1 ? 0 : index + 1);
    });
    replayButton.addEventListener('click', function () {
      playing = !reducedMotion;
      show(0);
      schedule();
    });

    // Only a demo the player can see keeps playing.
    if (root.IntersectionObserver) {
      observer = new root.IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        schedule();
      }, { threshold: 0.5 });
      observer.observe(canvas);
    }

    size();
    show(0);
    schedule();

    return {
      destroy: function () {
        root.clearTimeout(timer);
        if (frameRequest !== 0) root.cancelAnimationFrame(frameRequest);
        if (observer) observer.disconnect();
        container.removeChild(lane);
      }
    };
  }

  (root.LAMP = root.LAMP || {}).lane = { createLane: createLane };
})(typeof globalThis !== 'undefined' ? globalThis : this);
