'use strict';

// The player's progress: which towns are lit, the half-walk of every town,
// settings, the last help tab, the daily history and a private hint count.
// It all lives under one versioned key. Storage is handed in, so the game
// works the same — it simply forgets — when storage is missing, blocked or
// full, and so all of this can be tested without a browser.
//
// Towns are keyed by share code, so a town reached two ways (a chapter and
// a pasted code, say) is the same town with the same progress.
//
// Nothing is ever thrown away silently. Unreadable data is set aside under
// its own key before starting fresh; data from a newer version of the game
// is left untouched and this visit is simply not saved; either way the
// player is told once.
(function (root) {
  'use strict';

  var STORAGE_KEY = 'lamplighter';
  var SET_ASIDE_KEY = 'lamplighter.unreadable';
  var VERSION = 1;
  var EXPORT_PREFIX = 'LAMP1.';

  // MIGRATIONS[v] turns version v data into version v + 1. There are none
  // yet; the first change to the stored shape adds one here.
  var MIGRATIONS = {};

  function empty() {
    return {
      version: VERSION,
      towns: {},
      daily: {},
      settings: { highContrast: false, largeBoard: false, sound: false },
      helpTab: 'how',
      stats: { hints: 0 }
    };
  }

  function isCellList(value) {
    return Array.isArray(value) && value.every(function (n) { return typeof n === 'number' && n >= 0 && n % 1 === 0; });
  }

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // Keeps only what has the right shape; anything malformed is dropped
  // town by town rather than costing the whole save.
  function cleaned(raw) {
    var data = empty();
    if (isPlainObject(raw.towns)) {
      Object.keys(raw.towns).forEach(function (code) {
        var town = raw.towns[code];
        if (!isPlainObject(town)) return;
        var entry = { walk: isCellList(town.walk) ? town.walk.slice() : [], lit: town.lit === true };
        if (isCellList(town.solvedWalk)) entry.solvedWalk = town.solvedWalk.slice();
        data.towns[code] = entry;
      });
    }
    if (isPlainObject(raw.daily)) {
      Object.keys(raw.daily).forEach(function (date) {
        var day = raw.daily[date];
        if (isPlainObject(day) && typeof day.code === 'string') data.daily[date] = { code: day.code, lit: day.lit === true };
      });
    }
    if (isPlainObject(raw.settings)) {
      Object.keys(data.settings).forEach(function (key) {
        if (typeof raw.settings[key] === 'boolean') data.settings[key] = raw.settings[key];
      });
    }
    if (typeof raw.helpTab === 'string') data.helpTab = raw.helpTab;
    if (isPlainObject(raw.stats) && typeof raw.stats.hints === 'number') data.stats.hints = raw.stats.hints;
    return data;
  }

  // Parses stored or imported text. Returns { data } or { problem } where
  // problem is 'unreadable' or 'newer'.
  function decode(text) {
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      if (err instanceof SyntaxError) return { problem: 'unreadable' };
      throw err;
    }
    if (!isPlainObject(raw) || typeof raw.version !== 'number') return { problem: 'unreadable' };
    if (raw.version > VERSION) return { problem: 'newer' };
    var version = raw.version;
    while (version < VERSION) {
      if (!MIGRATIONS[version]) return { problem: 'unreadable' };
      raw = MIGRATIONS[version](raw);
      version += 1;
    }
    return { data: cleaned(raw) };
  }

  var NOTICES = {
    unavailable: 'Progress cannot be saved in this browser, so this visit will be forgotten when the page closes.',
    unreadable: 'Your saved progress could not be read, so the town has started fresh. The old data has been kept aside.',
    newer: 'This progress was saved by a newer version of the game, so it is left untouched and this visit will not be saved.',
    full: 'There is no room left to save progress, so this visit will be forgotten when the page closes.'
  };

  // storage: { get(key) -> string or null, set(key, value) }, either of
  // which may throw when the browser refuses.
  function createProgress(storage) {
    var data = empty();
    var writable = true;
    var notice = '';

    var stored = null;
    try {
      stored = storage.get(STORAGE_KEY);
    } catch (err) {
      writable = false;
      notice = NOTICES.unavailable;
    }

    if (stored !== null) {
      var decoded = decode(stored);
      if (decoded.data) {
        data = decoded.data;
      } else if (decoded.problem === 'newer') {
        writable = false;
        notice = NOTICES.newer;
      } else {
        notice = NOTICES.unreadable;
        try {
          storage.set(SET_ASIDE_KEY, stored);
        } catch (err) {
          writable = false;
          notice = NOTICES.unavailable;
        }
      }
    }

    function save() {
      if (!writable) return;
      try {
        storage.set(STORAGE_KEY, JSON.stringify(data));
      } catch (err) {
        writable = false;
        notice = NOTICES.full;
      }
    }

    function town(code) {
      if (!data.towns[code]) data.towns[code] = { walk: [], lit: false };
      return data.towns[code];
    }

    function mergeIn(other) {
      Object.keys(other.towns).forEach(function (code) {
        var theirs = other.towns[code];
        var mine = data.towns[code];
        if (!mine) {
          data.towns[code] = theirs;
          return;
        }
        if (mine.walk.length === 0 && theirs.walk.length > 0) mine.walk = theirs.walk;
        if (theirs.lit && !mine.lit) {
          mine.lit = true;
          if (theirs.solvedWalk) mine.solvedWalk = theirs.solvedWalk;
        }
      });
      Object.keys(other.daily).forEach(function (date) {
        var theirs = other.daily[date];
        var mine = data.daily[date];
        if (!mine) data.daily[date] = theirs;
        else if (theirs.lit) mine.lit = true;
      });
      data.stats.hints = Math.max(data.stats.hints, other.stats.hints);
    }

    return {
      // A message for the player about storage, given out once.
      takeNotice: function () {
        var text = notice;
        notice = '';
        return text;
      },
      isSaving: function () { return writable; },

      walkOf: function (code) { return data.towns[code] ? data.towns[code].walk.slice() : []; },
      isLit: function (code) { return Boolean(data.towns[code] && data.towns[code].lit); },
      solvedWalkOf: function (code) {
        var entry = data.towns[code];
        return entry && entry.solvedWalk ? entry.solvedWalk.slice() : null;
      },
      saveWalk: function (code, cells) {
        town(code).walk = cells.slice();
        save();
      },
      // A lit town stays lit, whatever happens to its walk afterwards.
      markLit: function (code, cells) {
        var entry = town(code);
        entry.lit = true;
        entry.solvedWalk = cells.slice();
        save();
      },

      dailyOn: function (date) { return data.daily[date] ? { code: data.daily[date].code, lit: data.daily[date].lit } : null; },
      recordDaily: function (date, code, lit) {
        var day = data.daily[date] || { code: code, lit: false };
        day.code = code;
        day.lit = day.lit || lit;
        data.daily[date] = day;
        save();
      },
      dailyLitCount: function () {
        return Object.keys(data.daily).filter(function (date) { return data.daily[date].lit; }).length;
      },

      setting: function (key) { return data.settings[key]; },
      setSetting: function (key, value) {
        if (!(key in data.settings)) throw new Error('progress: no such setting: ' + key);
        data.settings[key] = Boolean(value);
        save();
      },
      helpTab: function () { return data.helpTab; },
      setHelpTab: function (tab) {
        data.helpTab = tab;
        save();
      },
      hintsUsed: function () { return data.stats.hints; },
      countHint: function () {
        data.stats.hints += 1;
        save();
      },

      exportString: function () {
        return EXPORT_PREFIX + root.btoa(JSON.stringify(data));
      },
      // Merges, never replaces: see mergeIn. Returns { ok } or
      // { ok: false, reason }.
      importString: function (text) {
        var trimmed = String(text).trim();
        if (trimmed.indexOf(EXPORT_PREFIX) !== 0) return { ok: false, reason: 'That does not look like a progress string from this game.' };
        var json;
        try {
          json = root.atob(trimmed.slice(EXPORT_PREFIX.length));
        } catch (err) {
          if (err.name === 'InvalidCharacterError') return { ok: false, reason: 'That progress string has been damaged somewhere; check it was copied whole.' };
          throw err;
        }
        var decoded = decode(json);
        if (decoded.problem === 'newer') return { ok: false, reason: 'That progress came from a newer version of the game.' };
        if (!decoded.data) return { ok: false, reason: 'That progress string has been damaged somewhere; check it was copied whole.' };
        mergeIn(decoded.data);
        save();
        return { ok: true };
      }
    };
  }

  // The browser's own storage. Simply touching localStorage can throw
  // when the browser blocks it, so even the lookup happens inside the
  // calls createProgress already guards.
  function browserStorage() {
    return {
      get: function (key) { return root.localStorage.getItem(key); },
      set: function (key, value) { root.localStorage.setItem(key, value); }
    };
  }

  var api = { STORAGE_KEY: STORAGE_KEY, SET_ASIDE_KEY: SET_ASIDE_KEY, VERSION: VERSION, createProgress: createProgress, browserStorage: browserStorage };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).progress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
