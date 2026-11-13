'use strict';

// Plain Node test runner, no framework. Every tests/test_*.js file exports
// a function(t) that registers its cases through t.test(name, fn); this
// file discovers those files itself so adding a new suite never means
// editing this one. Prints a readable report and exits 1 on any failure.

var fs = require('fs');
var path = require('path');

var results = [];

function makeT(suiteName) {
  return {
    test: function (name, fn) {
      var fullName = suiteName + ' > ' + name;
      try {
        fn();
        results.push({ name: fullName, ok: true });
      } catch (err) {
        results.push({ name: fullName, ok: false, error: err });
      }
    },
    assert: function (cond, msg) {
      if (!cond) throw new Error(msg || 'assertion failed');
    },
    eq: function (actual, expected, msg) {
      if (actual !== expected) {
        throw new Error((msg ? msg + ' — ' : '') + 'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
      }
    },
    deepEq: function (actual, expected, msg) {
      var a = JSON.stringify(actual);
      var b = JSON.stringify(expected);
      if (a !== b) {
        throw new Error((msg ? msg + ' — ' : '') + 'expected ' + b + ' but got ' + a);
      }
    },
    throws: function (fn, msg) {
      var threw = false;
      try {
        fn();
      } catch (err) {
        threw = true;
      }
      if (!threw) throw new Error(msg || 'expected function to throw');
    },
    log: function (line) {
      results.push({ name: suiteName + ' > (log)', ok: true, note: line });
    }
  };
}

var testDir = __dirname;
var files = fs.readdirSync(testDir)
  .filter(function (name) { return /^test_.*\.js$/.test(name); })
  .sort();

files.forEach(function (file) {
  var suiteName = file.replace(/\.js$/, '');
  var suite = require(path.join(testDir, file));
  suite(makeT(suiteName));
});

var passed = results.filter(function (r) { return r.ok && !r.note; }).length;
var failed = results.filter(function (r) { return !r.ok; });
var notes = results.filter(function (r) { return r.note; });

console.log('');
console.log('THE LAMPLIGHTER — test report');
console.log('='.repeat(70));
results.forEach(function (r) {
  if (r.note) {
    console.log('      ' + r.note);
    return;
  }
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name);
  if (!r.ok) console.log('      ' + r.error.message);
});
console.log('='.repeat(70));
console.log(passed + '/' + (results.length - notes.length) + ' passed');

if (failed.length > 0) {
  console.log(failed.length + ' FAILED');
  process.exit(1);
}
