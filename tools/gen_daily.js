'use strict';

// Authoring only: mints js/dailypool.js, one town per pool slot. The game
// never loads this file.
//
//   node tools/gen_daily.js            every slot
//   node tools/gen_daily.js 0-99       just these slots, merged in
//
// Slot k searches seeds seedForSlot(k) + attempt until a town of that
// weekday's size and label turns up. Each attempt is a pure function of
// its seed, so the worker count cannot change what comes out. It runs on
// four workers by default so the machine stays usable meanwhile.

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var generator = require('../js/generator.js');
var daily = require('../js/daily.js');

var POOL_PATH = path.join(__dirname, '..', 'js', 'dailypool.js');
var WORKERS = 4;

// A slot that has not turned up in this many attempts is reported, not
// ground at.
var MAX_ATTEMPTS_PER_SLOT = 3000;

function targetFor(plan) {
  return { width: plan.width, height: plan.height, interiorLamps: plan.interiorLamps, allowStaircase: plan.allowStaircase };
}

function entryFor(slot, attempt, result) {
  var grid = result.grid;
  return {
    slot: slot,
    seed: daily.seedForSlot(slot) + attempt,
    attempts: attempt + 1,
    genVersion: generator.GEN_VERSION,
    width: grid.width,
    height: grid.height,
    walls: grid.wallEdgeIds(),
    lamps: grid.lampCells.slice(),
    code: grid.toShareCode(),
    tier: result.rating.tier,
    depth: result.rating.depth,
    longestStall: result.rating.longestStall,
    label: result.rating.label
  };
}

function regenerate(slot, attempt) {
  var result = generator.generate(daily.seedForSlot(slot) + attempt, targetFor(daily.dayPlanForSlot(slot)));
  return result.ok ? entryFor(slot, attempt, result) : null;
}

function searchSlot(slot) {
  var plan = daily.dayPlanForSlot(slot);
  var target = targetFor(plan);
  for (var attempt = 0; attempt < MAX_ATTEMPTS_PER_SLOT; attempt += 1) {
    var result = generator.generate(daily.seedForSlot(slot) + attempt, target);
    if (result.ok && result.rating.label === plan.label) return { entry: entryFor(slot, attempt, result), attempts: attempt + 1 };
  }
  return { entry: null, attempts: MAX_ATTEMPTS_PER_SLOT };
}

function formatEntry(entry) {
  var fields = Object.keys(entry).map(function (key) {
    var value = entry[key];
    return key + ': ' + (Array.isArray(value) ? '[' + value.join(', ') + ']' : JSON.stringify(value).replace(/"/g, '\''));
  });
  return '    { ' + fields.join(', ') + ' }';
}

function formatPool(entries) {
  return [
    '\'use strict\';',
    '',
    '// The frozen daily pool, one town per slot, written by tools/gen_daily.js.',
    '// Data only — regenerate it rather than editing it.',
    '(function (root) {',
    '  \'use strict\';',
    '',
    '  var GEN_VERSION = ' + generator.GEN_VERSION + ';',
    '',
    '  var TOWNS = Object.freeze([',
    entries.map(formatEntry).join(',\n'),
    '  ].map(Object.freeze));',
    '',
    '  var api = { GEN_VERSION: GEN_VERSION, towns: TOWNS };',
    '',
    '  if (typeof module !== \'undefined\' && module.exports) module.exports = api;',
    '  else (root.LAMP = root.LAMP || {}).dailyPool = api;',
    '})(typeof globalThis !== \'undefined\' ? globalThis : this);',
    ''
  ].join('\n');
}

function existingEntries() {
  if (!fs.existsSync(POOL_PATH)) return [];
  return require(POOL_PATH).towns.map(function (town) { return Object.assign({}, town); });
}

function slotsFrom(args) {
  if (args.length === 0) {
    var all = [];
    for (var s = 0; s < daily.DAILY_POOL_SIZE; s += 1) all.push(s);
    return all;
  }
  var slots = [];
  args.forEach(function (arg) {
    var range = arg.split('-').map(Number);
    var from = range[0];
    var to = range.length > 1 ? range[1] : range[0];
    if (!(from >= 0 && to < daily.DAILY_POOL_SIZE && from <= to)) throw new Error('no such slot range: ' + arg);
    for (var k = from; k <= to; k += 1) slots.push(k);
  });
  return slots;
}

function runMain(slots) {
  var results = {};
  var next = 0;
  var done = 0;
  var workerCount = Math.min(WORKERS, slots.length);

  function finish() {
    var found = slots.filter(function (slot) { return results[slot].entry; });
    var attempts = slots.reduce(function (sum, slot) { return sum + results[slot].attempts; }, 0);
    var searched = Object.create(null);
    slots.forEach(function (slot) { searched[slot] = true; });
    var keep = existingEntries().filter(function (entry) { return !searched[entry.slot]; });
    var all = keep.concat(found.map(function (slot) { return results[slot].entry; })).sort(function (a, b) { return a.slot - b.slot; });
    fs.writeFileSync(POOL_PATH, formatPool(all));

    console.log('');
    daily.WEEK.forEach(function (plan, day) {
      var mine = slots.filter(function (slot) { return daily.weekdayOfSlot(slot) === day; });
      var tries = mine.reduce(function (sum, slot) { return sum + results[slot].attempts; }, 0);
      var got = mine.filter(function (slot) { return results[slot].entry; }).length;
      console.log(daily.WEEKDAY_NAMES[day].padEnd(10) + (plan.width + 'x' + plan.height + ' ' + plan.label).padEnd(18) +
        String(got).padStart(4) + ' found in ' + String(tries).padStart(6) + ' attempts');
    });
    console.log('Wrote ' + all.length + ' towns (' + found.length + ' of ' + slots.length + ' searched, ' + attempts + ' attempts)');
    var missing = slots.filter(function (slot) { return !results[slot].entry; });
    if (missing.length > 0) {
      console.log('Not found within ' + MAX_ATTEMPTS_PER_SLOT + ' attempts: slots ' + missing.join(', '));
      process.exitCode = 1;
    }
  }

  function feed(worker) {
    if (next >= slots.length) {
      worker.kill();
      return;
    }
    var slot = slots[next];
    next += 1;
    worker.once('message', function (result) {
      results[slot] = result;
      done += 1;
      if (done % 25 === 0 || done === slots.length) console.log('[' + done + '/' + slots.length + ']');
      if (done === slots.length) finish();
      feed(worker);
    });
    worker.send(slot);
  }

  function startWorker() {
    var worker = childProcess.fork(__filename, ['--worker']);
    worker.on('error', function (err) {
      console.error('worker failed: ' + err.message);
      process.exit(1);
    });
    worker.on('exit', function (code) {
      if (code !== 0 && code !== null) {
        console.error('worker exited with code ' + code + ' before finishing its slot');
        process.exit(1);
      }
    });
    feed(worker);
  }

  console.log('Searching ' + slots.length + ' slots on ' + workerCount + ' workers');
  for (var w = 0; w < workerCount; w += 1) startWorker();
}

if (require.main === module) {
  if (process.argv[2] === '--worker') {
    process.on('message', function (slot) { process.send(searchSlot(slot)); });
  } else {
    runMain(slotsFrom(process.argv.slice(2)));
  }
}

module.exports = { regenerate: regenerate, formatPool: formatPool, targetFor: targetFor };
