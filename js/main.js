'use strict';

// Wiring: screens, routes and the state that ties the board to saved
// progress. Every screen has an address after the #, so the browser's own
// back button walks back through the town:
//   #/                 the first screen, with the one-sentence rule
//   #/chapters         the ten chapters and their towns
//   #/town/4-7         chapter 4, town 7
//   #/daily            today's town
//   #/endless          the endless menu
//   #/endless/6x6-123  one endless town, by size and seed
//   #/codes            share codes and progress
//   #/play/CODE        a town from a share code
(function (root) {
  'use strict';

  var LAMP = root.LAMP;
  var doc = root.document;
  var SCREENS = ['title', 'chapters', 'town', 'endless', 'codes'];
  var SLICE_MS = 14;
  var OPENING_MS = 2600;

  var progress = LAMP.progress.createProgress(LAMP.progress.browserStorage());
  var current = null;
  var clearConfirmed = false;
  var lastOpeningChapter = 0;
  var openingTimer = 0;
  var endlessSearch = null;
  var endlessCache = {};
  var help = null;

  // What each press of the hint button will give, said on the button
  // before it is pressed, so the player always chooses how much to take.
  var HINT_LABELS = ['Hint: where to look', 'Hint: which idea', 'Hint: exactly where', 'Hint: the move'];

  function byId(id) {
    return doc.getElementById(id);
  }

  function reducedMotion() {
    return Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // --- the shell -----------------------------------------------------------

  function showScreen(name, back) {
    SCREENS.forEach(function (screen) { byId('screen-' + screen).hidden = screen !== name; });
    var backLink = byId('nav-back');
    backLink.hidden = !back;
    if (back) {
      backLink.href = back.href;
      backLink.textContent = back.text;
    }
    root.scrollTo(0, 0);
  }

  function showNotice() {
    var text = progress.takeNotice();
    if (!text) return;
    var notice = byId('notice');
    notice.textContent = text;
    notice.hidden = false;
  }

  // Copies text if the browser allows it here, otherwise selects it so the
  // player can copy it themselves; either way they are told which.
  function copyText(field, tell) {
    field.focus();
    field.select();
    if (!root.navigator.clipboard || !root.navigator.clipboard.writeText) {
      tell('Selected — copy it with Ctrl+C, or Cmd+C on a Mac.');
      return;
    }
    root.navigator.clipboard.writeText(field.value).then(function () {
      tell('Copied.');
    }, function () {
      tell('Selected — copy it with Ctrl+C, or Cmd+C on a Mac.');
    });
  }

  // --- the town screen --------------------------------------------------------

  var status = byId('status');
  var statusActions = byId('status-actions');
  var DRAWING_TEXT = 'Drawing: click again to stop.';

  function say(text) {
    status.textContent = text;
    statusActions.textContent = '';
  }

  function offer(text, choices) {
    status.textContent = text;
    statusActions.textContent = '';
    choices.forEach(function (choice) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'control';
      button.textContent = choice.label;
      button.addEventListener('click', choice.act);
      statusActions.appendChild(button);
    });
    statusActions.firstChild.focus();
  }

  function refreshControls(info) {
    byId('undo').disabled = !info.canUndo;
    byId('redo').disabled = !info.canRedo;
    byId('clear').disabled = info.cells.length === 0;
  }

  function fitBoard() {
    if (!current) return;
    var top = byId('board').getBoundingClientRect().top + root.scrollY;
    var width = Math.min(root.innerWidth, doc.querySelector('.app').clientWidth);
    current.board.resize({ width: width, height: Math.max(300, root.innerHeight - top - 170), large: progress.setting('largeBoard') });
  }

  // --- settings ---------------------------------------------------------------

  var SETTING_NAMES = { highContrast: 'High contrast', largeBoard: 'Large board', sound: 'Sound' };

  // Each toggle says its state in words, not only by how it looks.
  function applySettings() {
    doc.body.classList.toggle('high-contrast', progress.setting('highContrast'));
    LAMP.sound.setEnabled(progress.setting('sound'));
    doc.querySelectorAll('.setting').forEach(function (button) {
      var key = button.getAttribute('data-setting');
      var on = progress.setting(key);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.textContent = SETTING_NAMES[key] + (on ? ': on' : ': off');
    });
    fitBoard();
  }

  function wireSettings() {
    doc.querySelectorAll('.setting').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-setting');
        progress.setSetting(key, !progress.setting(key));
        applySettings();
        showNotice();
      });
    });
    applySettings();
  }

  // On a wide screen the panel takes a column and the board is refitted
  // beside it; on a narrow one the panel rises from the bottom, so the
  // town is brought up to the top of the view where it stays visible.
  function helpToggled(isOpen) {
    fitBoard();
    if (isOpen && current && root.innerWidth < 900) {
      root.scrollTo(0, byId('board').getBoundingClientRect().top + root.scrollY - 8);
    }
  }

  function closeTown() {
    root.clearTimeout(openingTimer);
    byId('opening').classList.remove('playing');
    doc.querySelector('.board-frame').classList.remove('opening-dark');
    if (!current) return;
    current.board.destroy();
    current = null;
    doc.body.classList.remove('town-lit');
  }

  function litLine() {
    say('Every street is walked, and the whole town is lit.');
  }

  function playOpening(text) {
    var opening = byId('opening');
    var frame = doc.querySelector('.board-frame');
    if (reducedMotion()) {
      say(text);
      return;
    }
    opening.textContent = text;
    opening.classList.remove('playing');
    frame.classList.add('opening-dark');
    // Adding the class a frame later restarts the animation from the top.
    root.requestAnimationFrame(function () { opening.classList.add('playing'); });
    openingTimer = root.setTimeout(function () { frame.classList.remove('opening-dark'); }, OPENING_MS);
  }

  // spec: { code, grid, title, subtitle, back, next?, opening?, onOpen?, onLit? }
  function openTown(spec) {
    closeTown();
    showScreen('town', spec.back);
    byId('town-title').textContent = spec.title;
    byId('town-subtitle').textContent = spec.subtitle;
    byId('code-box').hidden = true;
    byId('code-text').value = spec.code;
    var next = byId('next-town');
    next.hidden = !spec.next;
    if (spec.next) {
      next.href = spec.next.href;
      next.textContent = spec.next.text;
    }
    say('');

    var board = LAMP.board.createBoard(byId('board'), spec.grid, {
      initialCells: progress.walkOf(spec.code),
      reducedMotion: reducedMotion(),
      onChange: function (info) {
        progress.saveWalk(spec.code, info.cells);
        refreshControls(info);
        setHintLevel(0);
        if (!info.complete) {
          doc.body.classList.remove('town-lit');
          if (!info.refused && statusActions.childNodes.length === 0) say('');
        }
        showNotice();
      },
      onMessage: function (text, reason) {
        if (reason === LAMP.path.REASONS.MUST_START_AT_LAMP_1) {
          if (current.saidStartRule) return;
          current.saidStartRule = true;
        }
        say(text);
      },
      onComplete: function () {
        progress.markLit(spec.code, board.info().cells);
        byId('show-walk').hidden = false;
        if (spec.onLit) spec.onLit();
        doc.body.classList.add('town-lit');
        if (reducedMotion()) {
          offer('Every street is walked.', [{ label: 'Light the town', act: function () {
            board.stepCompletion();
            litLine();
          } }]);
        } else {
          litLine();
        }
        showNotice();
      },
      onDrawMode: function (on) {
        if (on) say(DRAWING_TEXT);
        else if (status.textContent === DRAWING_TEXT && statusActions.childNodes.length === 0) say('');
      },
      onRequestClear: requestClear,
      onSound: LAMP.sound.play
    });

    current = { spec: spec, board: board, saidStartRule: false, hintLevel: 0, solution: undefined };
    setHintLevel(0);
    fitBoard();
    var info = board.info();
    refreshControls(info);
    byId('show-walk').hidden = !progress.isLit(spec.code);
    if (info.complete) {
      doc.body.classList.add('town-lit');
      litLine();
    } else if (progress.isLit(spec.code)) {
      say('You have lit this town before. It stays lit, whatever you do now.');
    }
    if (spec.opening) playOpening(spec.opening);
    board.announce();
    if (spec.onOpen) spec.onOpen();
  }

  // Clearing asks once per session, inline, and never again after that.
  function requestClear() {
    if (!current || current.board.info().cells.length === 0) return;
    if (clearConfirmed) {
      current.board.clear();
      return;
    }
    offer('Clear the whole walk?', [
      { label: 'Yes', act: function () { clearConfirmed = true; say(''); current.board.clear(); byId('board').focus(); } },
      { label: 'Keep it', act: function () { say(''); byId('board').focus(); } }
    ]);
  }

  // --- hints ----------------------------------------------------------------

  function setHintLevel(level) {
    current.hintLevel = level;
    byId('hint').textContent = HINT_LABELS[Math.min(level, HINT_LABELS.length - 1)];
  }

  // The town's one solution, needed only to notice a walk that has
  // strayed. Finding it can take a moment on a large town, so the first
  // hint says it is thinking and works it out just after.
  function withSolution(then) {
    var town = current;
    if (town.solution !== undefined) {
      then(town.solution);
      return;
    }
    say('Thinking…');
    root.setTimeout(function () {
      if (current !== town) return;
      var verdict = LAMP.solver.verify(town.spec.grid);
      town.solution = verdict.count === 1 ? verdict.solution : null;
      then(town.solution);
    }, 30);
  }

  function overlayFor(levels, level) {
    if (level <= 2) return { kind: 'region', cells: levels[0].cells };
    if (level === 3) return { kind: 'shape', cells: levels[2].cells, edges: levels[2].edges };
    return { kind: 'move', edges: levels[3].edges, claim: levels[3].claim };
  }

  function askForHint() {
    if (!current) return;
    var town = current;
    var board = town.board;
    withSolution(function (solution) {
      if (current !== town) return;
      progress.countHint();
      if (solution === null) {
        say('This town does not have exactly one walk, so there is nothing certain to hint at.');
        return;
      }
      var walk = board.info().cells;
      var result = LAMP.hints.forWalk(town.spec.grid, walk, solution);
      if (result.offRoute) {
        offer(result.text, [
          { label: 'Step back', act: function () { board.rewindTo(walk.slice(0, result.rewindTo)); say(''); byId('board').focus(); } },
          { label: 'Not now', act: function () { say(''); } }
        ]);
        return;
      }
      if (result.done) {
        say('Every square is already walked.');
        return;
      }
      if (result.stuck) {
        say('There is nothing certain to say from here.');
        return;
      }

      var level = Math.min(town.hintLevel + 1, 4);
      var shown = result.levels[level - 1];
      board.showHint(overlayFor(result.levels, level));
      setHintLevel(level);
      if (level >= 2) {
        var technique = result.levels[1];
        offer(shown.text, [{ label: 'Read about ' + technique.name.toLowerCase(), act: function () { help.open('techniques', technique.technique); } }]);
        byId('hint').focus();
      } else {
        say(shown.text);
      }
    });
  }

  function showWalk() {
    if (!current) return;
    var solved = progress.solvedWalkOf(current.spec.code);
    if (!solved) return;
    var board = current.board;
    offer('This is the walk that lit the town.', [{ label: 'Done', act: function () { board.endReplay(); } }]);
    board.replay(solved, function () { say(''); });
  }

  function wireTownControls() {
    byId('undo').addEventListener('click', function () { if (current) current.board.undo(); });
    byId('redo').addEventListener('click', function () { if (current) current.board.redo(); });
    byId('clear').addEventListener('click', requestClear);
    byId('show-walk').addEventListener('click', showWalk);
    byId('hint').addEventListener('click', askForHint);
    byId('copy-code').addEventListener('click', function () {
      byId('code-box').hidden = false;
      copyText(byId('code-text'), say);
    });
    doc.addEventListener('keydown', function (event) {
      if (!current || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (doc.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(doc.activeElement.tagName)) return;
      var key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        current.board.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        current.board.redo();
      }
    });
    root.addEventListener('resize', fitBoard);
  }

  function gridOf(entry) {
    return LAMP.grid.create({ width: entry.width, height: entry.height, wallEdges: entry.walls, lamps: entry.lamps, seed: entry.seed, genVersion: entry.genVersion });
  }

  // --- chapters ----------------------------------------------------------------

  function chapterTown(chapterNumber, townNumber) {
    return LAMP.catalogue.towns.filter(function (t) { return t.chapter === chapterNumber && t.town === townNumber; })[0] || null;
  }

  function firstUnlitTown() {
    var towns = LAMP.catalogue.towns;
    for (var i = 0; i < towns.length; i += 1) if (!progress.isLit(towns[i].code)) return towns[i];
    return towns[0];
  }

  function openChapterTown(chapterNumber, townNumber) {
    var entry = chapterTown(chapterNumber, townNumber);
    if (!entry) {
      root.location.hash = '#/chapters';
      return;
    }
    var chapter = LAMP.chapters.CHAPTERS[chapterNumber - 1];
    var total = LAMP.chapters.TOWNS_PER_CHAPTER;
    var next = null;
    if (townNumber < total) next = { href: '#/town/' + chapterNumber + '-' + (townNumber + 1), text: 'Next town' };
    else if (chapterNumber < LAMP.chapters.CHAPTERS.length) next = { href: '#/town/' + (chapterNumber + 1) + '-1', text: 'Next chapter' };
    var opening = lastOpeningChapter === chapterNumber ? null : chapter.name + '. ' + chapter.hour + '.';
    lastOpeningChapter = chapterNumber;
    openTown({
      code: entry.code,
      grid: gridOf(entry),
      title: LAMP.names.nameForSeed(entry.seed),
      subtitle: chapter.name + ' · town ' + townNumber + ' of ' + total + ' · ' + entry.label,
      back: { href: '#/chapters', text: 'Chapters' },
      next: next,
      opening: opening
    });
  }

  function lampMark(lit) {
    var mark = doc.createElement('span');
    mark.className = lit ? 'lamp-mark lit' : 'lamp-mark';
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }

  function renderChapters() {
    var list = byId('chapter-list');
    list.textContent = '';
    var opened = false;
    LAMP.chapters.CHAPTERS.forEach(function (chapter) {
      var towns = LAMP.catalogue.towns.filter(function (t) { return t.chapter === chapter.number; });
      var litCount = towns.filter(function (t) { return progress.isLit(t.code); }).length;
      var details = doc.createElement('details');
      details.className = 'chapter';
      if (!opened && litCount < towns.length) {
        details.open = true;
        opened = true;
      }
      var summary = doc.createElement('summary');
      summary.className = 'chapter-summary';
      var name = doc.createElement('span');
      name.className = 'chapter-name';
      name.textContent = chapter.number + '. ' + chapter.name;
      var meta = doc.createElement('span');
      meta.className = 'chapter-meta';
      meta.textContent = chapter.hour + ' · ' + litCount + ' of ' + towns.length + ' lit';
      summary.appendChild(name);
      summary.appendChild(meta);
      details.appendChild(summary);

      var grid = doc.createElement('div');
      grid.className = 'town-grid';
      towns.forEach(function (town) {
        var lit = progress.isLit(town.code);
        var link = doc.createElement('a');
        link.className = 'control town-link';
        link.href = '#/town/' + chapter.number + '-' + town.town;
        link.setAttribute('aria-label', 'Town ' + town.town + ', ' + LAMP.names.nameForSeed(town.seed) + (lit ? ', lit' : progress.walkOf(town.code).length > 0 ? ', half walked' : ''));
        link.appendChild(lampMark(lit));
        var number = doc.createElement('span');
        number.textContent = String(town.town);
        link.appendChild(number);
        grid.appendChild(link);
      });
      details.appendChild(grid);
      list.appendChild(details);
    });
  }

  // --- daily ---------------------------------------------------------------------

  function localDate() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function longDate(date) {
    var parts = date.split('-').map(Number);
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return LAMP.daily.WEEKDAY_NAMES[LAMP.daily.weekday(date)] + ' ' + parts[2] + ' ' + months[parts[1] - 1];
  }

  function openDaily() {
    var date = localDate();
    var slot = LAMP.daily.poolIndex(date);
    var entry = LAMP.dailyPool.towns.filter(function (t) { return t.slot === slot; })[0];
    if (!entry) {
      showScreen('title', null);
      byId('notice').textContent = 'Today\'s town is missing from this copy of the game.';
      byId('notice').hidden = false;
      return;
    }
    openTown({
      code: entry.code,
      grid: gridOf(entry),
      title: LAMP.names.nameForSeed(entry.seed),
      subtitle: 'Today\'s town · ' + longDate(date) + ' · ' + entry.label + ' · ' + progress.dailyLitCount() + ' daily towns lit so far',
      back: { href: '#/', text: 'Home' },
      onOpen: function () { progress.recordDaily(date, entry.code, progress.isLit(entry.code)); },
      onLit: function () { progress.recordDaily(date, entry.code, true); }
    });
  }

  // --- endless ------------------------------------------------------------------

  function fillEndlessLabels() {
    var size = LAMP.endless.SIZES[Number(byId('endless-size').value)];
    var labelSelect = byId('endless-label');
    var previous = labelSelect.value;
    labelSelect.textContent = '';
    size.labels.forEach(function (label) {
      var option = doc.createElement('option');
      option.value = label;
      option.textContent = label;
      labelSelect.appendChild(option);
    });
    if (size.labels.indexOf(previous) !== -1) labelSelect.value = previous;
  }

  function randomSeed() {
    if (root.crypto && root.crypto.getRandomValues) return root.crypto.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }

  function stopEndlessSearch() {
    if (!endlessSearch) return;
    root.clearTimeout(endlessSearch.timer);
    endlessSearch = null;
    byId('endless-go').hidden = false;
    byId('endless-stop').hidden = true;
  }

  // Runs generator attempts a few milliseconds at a time between frames,
  // so the page never freezes while a town is laid out. With a label, it
  // keeps moving to the next seed until one lands on that label.
  function searchEndless(size, label, firstSeed, onFound, onTick) {
    stopEndlessSearch();
    var target = label ? LAMP.endless.targetFor(size, label) : LAMP.endless.targetForSeed(size);
    var search = { seed: firstSeed >>> 0, attempts: 0, job: null, timer: 0 };
    endlessSearch = search;

    function slice() {
      if (endlessSearch !== search) return;
      var until = root.performance.now() + SLICE_MS;
      while (root.performance.now() < until) {
        if (!search.job) {
          search.job = LAMP.generator.startJob(search.seed, target);
          search.attempts += 1;
        }
        if (search.job.step()) {
          var result = search.job.result();
          if (result.ok && (!label || result.rating.label === label)) {
            stopEndlessSearch();
            onFound(search.seed, result);
            return;
          }
          if (!label) {
            stopEndlessSearch();
            onFound(search.seed, null);
            return;
          }
          search.job = null;
          search.seed = (search.seed + 1) >>> 0;
        }
      }
      onTick(search.attempts);
      search.timer = root.setTimeout(slice, 0);
    }
    slice();
  }

  function openEndlessResult(size, seed, result) {
    var token = LAMP.endless.tokenFor(size, seed);
    openTown({
      code: result.grid.toShareCode(),
      grid: result.grid,
      title: LAMP.names.nameForSeed(seed),
      subtitle: 'Endless · ' + size.width + 'x' + size.height + ' · ' + result.rating.label + ' · seed ' + token,
      back: { href: '#/endless', text: 'Endless' },
      next: { href: '#/endless', text: 'Another town' }
    });
  }

  function openEndlessToken(text) {
    var parsed = LAMP.endless.parseToken(text);
    if (!parsed) {
      root.location.hash = '#/endless';
      return;
    }
    var token = LAMP.endless.tokenFor(parsed.size, parsed.seed);
    if (endlessCache[token]) {
      openEndlessResult(parsed.size, parsed.seed, endlessCache[token]);
      return;
    }
    showEndlessMenu();
    byId('endless-status').textContent = 'Laying out the town for seed ' + token + '…';
    searchEndless(parsed.size, null, parsed.seed, function (seed, result) {
      if (!result) {
        byId('endless-status').textContent = 'Seed ' + token + ' does not make a town at that size. Try another.';
        return;
      }
      endlessCache[token] = result;
      openEndlessResult(parsed.size, seed, result);
    }, function () {});
  }

  function showEndlessMenu() {
    closeTown();
    showScreen('endless', { href: '#/', text: 'Home' });
  }

  function wireEndless() {
    var sizeSelect = byId('endless-size');
    LAMP.endless.SIZES.forEach(function (size, i) {
      var option = doc.createElement('option');
      option.value = String(i);
      option.textContent = size.width + ' by ' + size.height;
      sizeSelect.appendChild(option);
    });
    sizeSelect.addEventListener('change', fillEndlessLabels);
    fillEndlessLabels();

    byId('endless-go').addEventListener('click', function () {
      var size = LAMP.endless.SIZES[Number(sizeSelect.value)];
      var label = byId('endless-label').value;
      var statusLine = byId('endless-status');
      byId('endless-go').hidden = true;
      byId('endless-stop').hidden = false;
      statusLine.textContent = 'Laying out a new town…';
      searchEndless(size, label, randomSeed(), function (seed, result) {
        var token = LAMP.endless.tokenFor(size, seed);
        endlessCache[token] = result;
        statusLine.textContent = '';
        root.location.hash = '#/endless/' + token;
      }, function (attempts) {
        statusLine.textContent = 'Laying out a new town… (' + attempts + ' tried so far)';
      });
    });
    byId('endless-stop').addEventListener('click', function () {
      stopEndlessSearch();
      byId('endless-status').textContent = 'Stopped.';
    });
    byId('endless-seed-go').addEventListener('click', function () {
      var parsed = LAMP.endless.parseToken(byId('endless-seed').value);
      if (!parsed) {
        byId('endless-status').textContent = 'A seed looks like 6x6-3141592: a size from the list, then a number.';
        return;
      }
      root.location.hash = '#/endless/' + LAMP.endless.tokenFor(parsed.size, parsed.seed);
    });
  }

  // --- share codes and progress ---------------------------------------------

  // A code that does not parse is the player's typo, not a fault in the
  // game, so the screen says so kindly instead of the parser's wording.
  function gridFromCode(code) {
    try {
      return { grid: LAMP.grid.fromShareCode(code) };
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      return { grid: null };
    }
  }

  function openShared(code) {
    var parsed = gridFromCode(code);
    if (!parsed.grid) {
      showCodes();
      byId('share-status').textContent = 'That code does not open a town. Check it was copied whole.';
      return;
    }
    var grid = parsed.grid;
    var canonical = grid.toShareCode();
    // A chapter or daily town reached by its code keeps its own name.
    var known = LAMP.catalogue.towns.concat(LAMP.dailyPool.towns).filter(function (t) { return t.code === canonical; })[0];
    openTown({
      code: canonical,
      grid: grid,
      title: known ? LAMP.names.nameForSeed(known.seed) : LAMP.names.nameForCode(canonical),
      subtitle: 'A shared town · ' + grid.width + ' by ' + grid.height,
      back: { href: '#/codes', text: 'Share codes' }
    });
  }

  function showCodes() {
    closeTown();
    var count = progress.hintsUsed();
    byId('stats-hints').textContent = 'You have asked for ' + count + (count === 1 ? ' hint' : ' hints') + '. Only you can see this, and only here.';
    showScreen('codes', { href: '#/', text: 'Home' });
  }

  function wireCodes() {
    byId('share-go').addEventListener('click', function () {
      var code = byId('share-input').value.trim();
      if (!gridFromCode(code).grid) {
        byId('share-status').textContent = 'That code does not open a town. Check it was copied whole.';
        return;
      }
      byId('share-status').textContent = '';
      root.location.hash = '#/play/' + encodeURIComponent(code);
    });
    byId('export-go').addEventListener('click', function () {
      var field = byId('progress-text');
      field.value = progress.exportString();
      copyText(field, function (text) { byId('progress-status').textContent = text; });
    });
    byId('import-go').addEventListener('click', function () {
      var result = progress.importString(byId('progress-text').value);
      byId('progress-status').textContent = result.ok ? 'Brought in. Everything that was here is still here too.' : result.reason;
      showNotice();
    });
  }

  // --- routes ---------------------------------------------------------------

  function route() {
    var hash = root.location.hash;
    var town = /^#\/town\/(\d+)-(\d+)$/.exec(hash);
    var endlessTown = /^#\/endless\/(.+)$/.exec(hash);
    var shared = /^#\/play\/(.+)$/.exec(hash);
    if (!/^#\/endless/.test(hash)) stopEndlessSearch();

    if (town) {
      openChapterTown(Number(town[1]), Number(town[2]));
    } else if (hash === '#/chapters') {
      closeTown();
      renderChapters();
      showScreen('chapters', { href: '#/', text: 'Home' });
    } else if (hash === '#/daily') {
      openDaily();
    } else if (hash === '#/endless') {
      showEndlessMenu();
    } else if (endlessTown) {
      openEndlessToken(decodeURIComponent(endlessTown[1]));
    } else if (hash === '#/codes') {
      showCodes();
    } else if (shared) {
      openShared(decodeURIComponent(shared[1]));
    } else {
      closeTown();
      var begin = firstUnlitTown();
      byId('begin').href = '#/town/' + begin.chapter + '-' + begin.town;
      byId('begin').textContent = progress.isLit(LAMP.catalogue.towns[0].code) ? 'Carry on' : 'Begin';
      showScreen('title', null);
    }
  }

  function start() {
    help = LAMP.help.createHelp({ toggle: byId('help-toggle'), panel: byId('help-panel'), progress: progress, reducedMotion: reducedMotion(), onToggle: helpToggled });
    wireSettings();
    wireTownControls();
    wireEndless();
    wireCodes();
    root.addEventListener('hashchange', route);
    showNotice();
    route();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
