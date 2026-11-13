'use strict';

var daily = require('../js/daily.js');

// Day numbers worked out by hand: 2000 to 2024 is 24 years with six leap
// days (2000, 2004 ... 2020), so 2024-01-01 is 24 * 365 + 6 = 8766, and
// 2024 itself is a leap year of 366 days. Slots are day mod 756; weekdays
// count Monday as 0. Every value was also checked against Python's
// datetime module, which shares no code with this project.
var FIXED = [
  { date: '2000-01-01', day: 0, index: 0, seed: 200000000, weekday: 5 },
  { date: '2000-02-29', day: 59, index: 59, seed: 205900000, weekday: 1 },
  { date: '2000-03-01', day: 60, index: 60, seed: 206000000, weekday: 2 },
  { date: '2024-01-01', day: 8766, index: 450, seed: 245000000, weekday: 0 },
  { date: '2024-02-29', day: 8825, index: 509, seed: 250900000, weekday: 3 },
  { date: '2024-03-01', day: 8826, index: 510, seed: 251000000, weekday: 4 },
  { date: '2024-12-31', day: 9131, index: 59, seed: 205900000, weekday: 1 },
  { date: '2025-01-01', day: 9132, index: 60, seed: 206000000, weekday: 2 },
  { date: '1999-12-31', day: -1, index: 755, seed: 275500000, weekday: 4 },
  { date: '2026-11-03', day: 9803, index: 731, seed: 273100000, weekday: 1 }
];

module.exports = function (t) {
  t.test('fixed dates map to fixed day numbers, pool slots and seeds', function () {
    FIXED.forEach(function (fixed) {
      t.eq(daily.dayNumber(fixed.date), fixed.day, fixed.date + ' day');
      t.eq(daily.poolIndex(fixed.date), fixed.index, fixed.date + ' slot');
      t.eq(daily.seedFor(fixed.date), fixed.seed, fixed.date + ' seed');
      t.eq(daily.weekday(fixed.date), fixed.weekday, fixed.date + ' weekday');
    });
  });

  t.test('a pool slot keeps its weekday every time the pool comes round', function () {
    t.eq(daily.DAILY_POOL_SIZE % 7, 0, 'the pool is a whole number of weeks');
    t.eq(daily.weekday('2024-02-29'), daily.weekday('2026-03-26'), 'same slot, 756 days apart');
    t.eq(daily.poolIndex('2024-02-29'), daily.poolIndex('2026-03-26'));
  });

  t.test('the week rises from a gentle Monday to a severe Sunday', function () {
    t.eq(daily.WEEK.length, 7);
    t.eq(daily.WEEK[0].label, 'Gentle');
    t.eq(daily.WEEK[6].label, 'Severe');
    t.eq(daily.dayPlanForSlot(daily.poolIndex('2024-01-01')), daily.WEEK[0], 'a Monday gets the Monday plan');
  });

  t.test('a leap day sits between the last of February and the first of March', function () {
    t.eq(daily.dayNumber('2024-02-29') - daily.dayNumber('2024-02-28'), 1);
    t.eq(daily.dayNumber('2024-03-01') - daily.dayNumber('2024-02-29'), 1);
    t.eq(daily.dayNumber('2023-03-01') - daily.dayNumber('2023-02-28'), 1, 'no leap day in 2023');
  });

  t.test('year boundaries are consecutive days', function () {
    ['1999', '2023', '2024', '2099', '2399'].forEach(function (year) {
      t.eq(daily.dayNumber((Number(year) + 1) + '-01-01') - daily.dayNumber(year + '-12-31'), 1, year);
    });
  });

  t.test('century rules: 2100 is not a leap year, 2400 is', function () {
    t.throws(function () { daily.dayNumber('2100-02-29'); }, '2100-02-29 does not exist');
    t.eq(daily.dayNumber('2400-03-01') - daily.dayNumber('2400-02-28'), 2, '2400 has a leap day');
  });

  t.test('impossible or malformed dates are refused, not guessed at', function () {
    ['2023-02-29', '2025-13-01', '2025-00-10', '2025-04-31', '2025-1-1', '01/01/2025', '', '2025-01-01T00:00'].forEach(function (bad) {
      t.throws(function () { daily.dayNumber(bad); }, JSON.stringify(bad));
    });
  });

  t.test('consecutive days take consecutive pool slots and wrap after the pool', function () {
    t.eq(daily.poolIndex('2001-01-20') + 1, daily.poolIndex('2001-01-21'));
    var start = daily.dayNumber('2026-11-03');
    t.eq(daily.poolIndex('2026-11-03'), start % daily.DAILY_POOL_SIZE);
  });

  t.test('every slot seed stays inside 32 bits and clear of the chapter seeds', function () {
    var top = daily.DAILY_SEED_BASE + (daily.DAILY_POOL_SIZE - 1) * daily.SEEDS_PER_SLOT + daily.SEEDS_PER_SLOT - 1;
    t.assert(top < 4294967296, 'fits a uint32');
    t.assert(daily.DAILY_SEED_BASE > 10 * 10000000 + 12 * 100000, 'above every chapter seed');
  });
};
