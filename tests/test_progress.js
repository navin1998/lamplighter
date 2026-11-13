'use strict';

var progressLib = require('../js/progress.js');

function memoryStorage(initial) {
  var store = Object.assign({}, initial || {});
  return {
    store: store,
    get: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    set: function (key, value) { store[key] = String(value); }
  };
}

function blockedStorage() {
  return {
    get: function () { throw new Error('SecurityError: storage is disabled'); },
    set: function () { throw new Error('SecurityError: storage is disabled'); }
  };
}

function fullStorage() {
  var storage = memoryStorage();
  storage.set = function () { throw new Error('QuotaExceededError'); };
  return storage;
}

var KEY = progressLib.STORAGE_KEY;

module.exports = function (t) {
  t.test('a fresh player starts empty and every change is saved under one key', function () {
    var storage = memoryStorage();
    var progress = progressLib.createProgress(storage);
    t.eq(progress.takeNotice(), '');
    progress.saveWalk('CODE-A', [0, 1, 2]);
    t.deepEq(Object.keys(storage.store), [KEY]);
    t.deepEq(progressLib.createProgress(storage).walkOf('CODE-A'), [0, 1, 2], 'survives a reload');
  });

  t.test('every town keeps its own half-walk', function () {
    var progress = progressLib.createProgress(memoryStorage());
    progress.saveWalk('A', [0, 1]);
    progress.saveWalk('B', [5, 6, 7]);
    t.deepEq(progress.walkOf('A'), [0, 1]);
    t.deepEq(progress.walkOf('B'), [5, 6, 7]);
    t.deepEq(progress.walkOf('C'), []);
  });

  t.test('a lit town stays lit even after its walk is cleared', function () {
    var progress = progressLib.createProgress(memoryStorage());
    progress.markLit('A', [0, 1, 3, 2]);
    progress.saveWalk('A', []);
    t.eq(progress.isLit('A'), true);
    t.deepEq(progress.solvedWalkOf('A'), [0, 1, 3, 2]);
  });

  t.test('with storage blocked the game still works and simply forgets, saying so once', function () {
    var progress = progressLib.createProgress(blockedStorage());
    t.assert(progress.takeNotice().length > 0, 'the player is told');
    t.eq(progress.takeNotice(), '', 'only once');
    progress.saveWalk('A', [0, 1]);
    t.deepEq(progress.walkOf('A'), [0, 1], 'remembered for this visit');
    t.eq(progress.isSaving(), false);
  });

  t.test('with storage full the game keeps going and says so once', function () {
    var progress = progressLib.createProgress(fullStorage());
    progress.saveWalk('A', [0]);
    t.assert(progress.takeNotice().length > 0);
    progress.saveWalk('A', [0, 1]);
    t.eq(progress.takeNotice(), '');
    t.deepEq(progress.walkOf('A'), [0, 1]);
  });

  t.test('unreadable data is set aside, never silently thrown away', function () {
    var storage = memoryStorage({ lamplighter: '{not json' });
    var progress = progressLib.createProgress(storage);
    t.assert(progress.takeNotice().length > 0, 'the player is told');
    t.eq(storage.store[progressLib.SET_ASIDE_KEY], '{not json', 'the old data is kept aside');
    progress.saveWalk('A', [0]);
    t.deepEq(JSON.parse(storage.store[KEY]).towns.A.walk, [0]);
  });

  t.test('data from a newer version is left untouched and this visit is not saved', function () {
    var newer = JSON.stringify({ version: progressLib.VERSION + 1, towns: { A: { walk: [9], lit: true } } });
    var storage = memoryStorage({ lamplighter: newer });
    var progress = progressLib.createProgress(storage);
    t.assert(progress.takeNotice().length > 0);
    progress.saveWalk('B', [1]);
    t.eq(storage.store[KEY], newer, 'still exactly what the newer version wrote');
  });

  t.test('malformed towns are dropped one by one, the rest survive', function () {
    var raw = JSON.stringify({ version: 1, towns: { good: { walk: [1, 2], lit: true }, bad: 'nonsense', worse: { walk: ['x'] } } });
    var progress = progressLib.createProgress(memoryStorage({ lamplighter: raw }));
    t.eq(progress.takeNotice(), '');
    t.eq(progress.isLit('good'), true);
    t.deepEq(progress.walkOf('good'), [1, 2]);
    t.deepEq(progress.walkOf('worse'), [], 'a walk of the wrong shape is not trusted');
  });

  t.test('settings, help tab, daily history and the hint count persist', function () {
    var storage = memoryStorage();
    var progress = progressLib.createProgress(storage);
    progress.setSetting('highContrast', true);
    progress.setHelpTab('techniques');
    progress.recordDaily('2026-11-03', 'CODE-D', false);
    progress.recordDaily('2026-11-03', 'CODE-D', true);
    progress.countHint();
    var again = progressLib.createProgress(storage);
    t.eq(again.setting('highContrast'), true);
    t.eq(again.helpTab(), 'techniques');
    t.deepEq(again.dailyOn('2026-11-03'), { code: 'CODE-D', lit: true });
    t.eq(again.dailyLitCount(), 1);
    t.eq(again.hintsUsed(), 1);
    t.throws(function () { again.setSetting('nonsense', true); });
  });

  t.test('export then import on another device carries everything across', function () {
    var first = progressLib.createProgress(memoryStorage());
    first.markLit('A', [0, 1]);
    first.saveWalk('B', [4, 5]);
    first.recordDaily('2026-11-02', 'D', true);
    var second = progressLib.createProgress(memoryStorage());
    t.deepEq(second.importString(first.exportString()), { ok: true });
    t.eq(second.isLit('A'), true);
    t.deepEq(second.walkOf('B'), [4, 5]);
    t.eq(second.dailyLitCount(), 1);
  });

  t.test('import merges and never loses anything already here', function () {
    var here = progressLib.createProgress(memoryStorage());
    here.saveWalk('A', [0, 1, 2]);
    here.setSetting('largeBoard', true);
    var there = progressLib.createProgress(memoryStorage());
    there.saveWalk('A', [0]);
    there.markLit('B', [3, 4]);
    there.saveWalk('C', [7]);
    there.setSetting('largeBoard', false);
    here.importString(there.exportString());
    t.deepEq(here.walkOf('A'), [0, 1, 2], 'a walk already here is kept');
    t.eq(here.isLit('B'), true, 'lit towns arrive');
    t.deepEq(here.walkOf('C'), [7], 'walks for towns not started here arrive');
    t.eq(here.setting('largeBoard'), true, 'settings here are kept');
  });

  t.test('a damaged or foreign import string is refused with a reason and changes nothing', function () {
    var progress = progressLib.createProgress(memoryStorage());
    progress.saveWalk('A', [0]);
    ['hello', 'LAMP1.!!!', 'LAMP1.' + Buffer.from('{"version":1').toString('base64')].forEach(function (bad) {
      var result = progress.importString(bad);
      t.eq(result.ok, false, bad);
      t.assert(result.reason.length > 0, 'a reason is given');
    });
    t.deepEq(progress.walkOf('A'), [0]);
  });
};
