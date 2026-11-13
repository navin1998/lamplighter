'use strict';

// Authoring only: mints js/catalogue.js. The game never loads this file
// and nothing runs it at page load.
//
//   node tools/gen_catalogue.js              all ten chapters
//   node tools/gen_catalogue.js 1 2 3        just these chapters
//   node tools/gen_catalogue.js 9:10 9:11    just these towns
//
// Whatever is found is merged into the existing catalogue, replacing only
// the towns that were searched; towns not found are listed and the exit
// code is 1, so a partial catalogue never passes for a finished one.
//
// Every town is searched on its own: attempt k of town t in chapter c uses
// seed seedFor(c, t, k), and the first attempt that fits is kept. Each
// attempt is a pure function of its seed, so running towns in parallel
// worker processes cannot change what comes out.

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var generator = require('../js/generator.js');
var chapters = require('../js/chapters.js');

var CATALOGUE_PATH = path.join(__dirname, '..', 'js', 'catalogue.js');

// A town that has not turned up in this many attempts is reported rather
// than ground at; it means its band or town rule accepts well under one
// attempt in two hundred.
var MAX_ATTEMPTS_PER_TOWN = 1000;

function seedFor(chapterNumber, townIndex, attempt) {
  return chapterNumber * 10000000 + townIndex * 100000 + attempt;
}

function chapterByNumber(number) {
  return chapters.CHAPTERS[number - 1];
}

function entryFor(chapter, townIndex, attempt, result) {
  var grid = result.grid;
  return {
    chapter: chapter.number,
    town: townIndex + 1,
    seed: seedFor(chapter.number, townIndex, attempt),
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

// Rebuilds the entry for a town whose seed is already known — the same
// path the determinism test takes.
function regenerate(chapterNumber, townIndex, attempt) {
  var chapter = chapterByNumber(chapterNumber);
  var result = generator.generate(seedFor(chapterNumber, townIndex, attempt), chapters.target(chapter));
  if (!result.ok) return null;
  return entryFor(chapter, townIndex, attempt, result);
}

function searchTown(chapterNumber, townIndex) {
  var chapter = chapterByNumber(chapterNumber);
  var target = chapters.target(chapter);
  var reasons = {};
  for (var attempt = 0; attempt < MAX_ATTEMPTS_PER_TOWN; attempt += 1) {
    var result = generator.generate(seedFor(chapterNumber, townIndex, attempt), target);
    var why = result.ok ? chapters.misfit(chapter, townIndex, result.grid, result.trace, result.rating) : result.reason;
    if (why === '') return { entry: entryFor(chapter, townIndex, attempt, result), attempts: attempt + 1, reasons: reasons };
    reasons[why] = (reasons[why] || 0) + 1;
  }
  return { entry: null, attempts: MAX_ATTEMPTS_PER_TOWN, reasons: reasons };
}

function formatEntry(entry) {
  var fields = Object.keys(entry).map(function (key) {
    var value = entry[key];
    return key + ': ' + (Array.isArray(value) ? '[' + value.join(', ') + ']' : JSON.stringify(value).replace(/"/g, '\''));
  });
  return '    { ' + fields.join(', ') + ' }';
}

function formatCatalogue(entries) {
  return [
    '\'use strict\';',
    '',
    '// The frozen chapter catalogue, written by tools/gen_catalogue.js. Data',
    '// only — regenerate it rather than editing it; the tests rebuild every',
    '// town from its seed and expect this file back byte for byte.',
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
    '  else (root.LAMP = root.LAMP || {}).catalogue = api;',
    '})(typeof globalThis !== \'undefined\' ? globalThis : this);',
    ''
  ].join('\n');
}

function existingEntries() {
  if (!fs.existsSync(CATALOGUE_PATH)) return [];
  return require(CATALOGUE_PATH).towns.map(function (town) { return Object.assign({}, town); });
}

function runWorker() {
  process.on('message', function (job) {
    process.send(searchTown(job.chapter, job.town));
  });
}

function keyOf(job) {
  return job.chapter + ':' + job.town;
}

function runMain(jobs) {
  var chapterNumbers = [];
  jobs.forEach(function (job) { if (chapterNumbers.indexOf(job.chapter) === -1) chapterNumbers.push(job.chapter); });
  var results = {};
  var next = 0;
  var done = 0;
  var workerCount = Math.max(1, Math.min(os.cpus().length - 1, jobs.length));

  function report() {
    console.log('');
    console.log('chapter  found  attempts  accepted per 200');
    chapterNumbers.forEach(function (c) {
      var found = 0;
      var attempts = 0;
      jobs.forEach(function (job) {
        if (job.chapter !== c) return;
        attempts += results[keyOf(job)].attempts;
        if (results[keyOf(job)].entry) found += 1;
      });
      var perTwoHundred = found * 200 / attempts;
      console.log(String(c).padStart(7) + String(found).padStart(7) + String(attempts).padStart(10) + perTwoHundred.toFixed(2).padStart(18) + (perTwoHundred < 1 ? '   BELOW 1 IN 200' : ''));
    });

    var searched = Object.create(null);
    jobs.forEach(function (job) { searched[keyOf(job)] = true; });
    var keep = existingEntries().filter(function (entry) { return !searched[entry.chapter + ':' + (entry.town - 1)]; });
    var fresh = jobs.map(function (job) { return results[keyOf(job)].entry; }).filter(Boolean);
    var all = keep.concat(fresh).sort(function (a, b) { return a.chapter - b.chapter || a.town - b.town; });
    fs.writeFileSync(CATALOGUE_PATH, formatCatalogue(all));
    console.log('');
    console.log('Wrote ' + all.length + ' towns to ' + path.relative(process.cwd(), CATALOGUE_PATH));

    var missing = jobs.filter(function (job) { return !results[keyOf(job)].entry; });
    if (missing.length > 0) {
      console.log('');
      console.log('Not found within ' + MAX_ATTEMPTS_PER_TOWN + ' attempts:');
      missing.forEach(function (job) {
        console.log('  chapter ' + job.chapter + ' town ' + (job.town + 1) + ': ' + JSON.stringify(results[keyOf(job)].reasons));
      });
      process.exitCode = 1;
    }
  }

  function feed(worker) {
    if (next >= jobs.length) {
      worker.kill();
      return;
    }
    var job = jobs[next];
    next += 1;
    worker.once('message', function (result) {
      results[keyOf(job)] = result;
      done += 1;
      console.log('[' + done + '/' + jobs.length + '] chapter ' + job.chapter + ' town ' + (job.town + 1) + ': ' +
        (result.entry ? 'tier ' + result.entry.tier + ' ' + result.entry.label + ' after ' + result.attempts + ' attempts' : 'NOT FOUND'));
      if (done === jobs.length) report();
      feed(worker);
    });
    worker.send(job);
  }

  function startWorker() {
    var worker = childProcess.fork(__filename, ['--worker']);
    worker.on('error', function (err) {
      console.error('worker failed: ' + err.message);
      process.exit(1);
    });
    worker.on('exit', function (code) {
      if (code !== 0 && code !== null) {
        console.error('worker exited with code ' + code + ' before finishing its town');
        process.exit(1);
      }
    });
    feed(worker);
  }

  console.log('Searching ' + jobs.length + ' towns on ' + workerCount + ' workers');
  for (var w = 0; w < workerCount; w += 1) startWorker();
}

if (require.main === module) {
  if (process.argv[2] === '--worker') {
    runWorker();
  } else {
    runMain(jobsFrom(process.argv.slice(2)));
  }
}

// "9" means every town of chapter 9; "9:10" means just its tenth town.
function jobsFrom(args) {
  var specs = args.length > 0 ? args : chapters.CHAPTERS.map(function (c) { return String(c.number); });
  var jobs = [];
  specs.forEach(function (spec) {
    var parts = spec.split(':').map(Number);
    if (!chapterByNumber(parts[0])) throw new Error('no such chapter: ' + spec);
    if (parts.length === 1) {
      for (var t = 0; t < chapters.TOWNS_PER_CHAPTER; t += 1) jobs.push({ chapter: parts[0], town: t });
    } else {
      if (!(parts[1] >= 1 && parts[1] <= chapters.TOWNS_PER_CHAPTER)) throw new Error('no such town: ' + spec);
      jobs.push({ chapter: parts[0], town: parts[1] - 1 });
    }
  });
  return jobs;
}

module.exports = { seedFor: seedFor, regenerate: regenerate, formatCatalogue: formatCatalogue, MAX_ATTEMPTS_PER_TOWN: MAX_ATTEMPTS_PER_TOWN };
