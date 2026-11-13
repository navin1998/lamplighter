'use strict';

// Date to daily town, as a pure function of the calendar date. There is
// no network and no server: everyone who plays on the same date gets the
// same town because they compute the same day number.
//
// Daily towns come from a frozen pool rather than being generated live,
// so they carry the same uniqueness and irreducibility guarantees as the
// chapters. Day 0 is 2000-01-01; the day number picks a slot in the pool,
// cycling every DAILY_POOL_SIZE days, and each slot has its own base seed
// for the authoring search that fills it. No Date object is used — the
// calendar maths is done by hand so it cannot depend on a time zone.
//
// The week has a rhythm, gentle on Monday and severe by the weekend. The
// pool is a whole number of weeks long, so a slot always falls on the same
// weekday however many times the pool comes round.
(function (root) {
  'use strict';

  var DAILY_POOL_SIZE = 756;
  var DAILY_SEED_BASE = 200000000;
  var SEEDS_PER_SLOT = 100000;

  // Monday first. 2000-01-01, day 0, was a Saturday.
  var DAY_ZERO_WEEKDAY = 5;
  var WEEKDAY_NAMES = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

  // Each day's size and label. interiorLamps matches the chapter of the
  // same size; Gentle days allow long corridors, like the first chapters.
  var WEEK = Object.freeze([
    { width: 5, height: 5, label: 'Gentle', interiorLamps: 4, allowStaircase: true },
    { width: 5, height: 5, label: 'Steady', interiorLamps: 4, allowStaircase: false },
    { width: 6, height: 5, label: 'Thoughtful', interiorLamps: 4, allowStaircase: false },
    { width: 6, height: 6, label: 'Demanding', interiorLamps: 5, allowStaircase: false },
    { width: 7, height: 6, label: 'Demanding', interiorLamps: 6, allowStaircase: false },
    { width: 7, height: 7, label: 'Severe', interiorLamps: 7, allowStaircase: false },
    { width: 8, height: 8, label: 'Severe', interiorLamps: 8, allowStaircase: false }
  ].map(Object.freeze));

  // Days since 1970-01-01 in the proleptic Gregorian calendar, counting
  // years from March so the leap day falls at the end of the year.
  function daysFromCivil(year, month, day) {
    var y = month <= 2 ? year - 1 : year;
    var era = Math.floor(y / 400);
    var yearOfEra = y - era * 400;
    var dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
    var dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146097 + dayOfEra - 719468;
  }

  var DAY_ZERO = daysFromCivil(2000, 1, 1);

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function daysInMonth(year, month) {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return [4, 6, 9, 11].indexOf(month) !== -1 ? 30 : 31;
  }

  // Takes 'YYYY-MM-DD' and throws on anything that is not a real date.
  function dayNumber(date) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new Error('daily: expected a date like 2025-01-01, got ' + JSON.stringify(date));
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new Error('daily: no such date: ' + date);
    return daysFromCivil(year, month, day) - DAY_ZERO;
  }

  function poolIndex(date) {
    var n = dayNumber(date) % DAILY_POOL_SIZE;
    return n < 0 ? n + DAILY_POOL_SIZE : n;
  }

  function seedForSlot(slot) {
    return DAILY_SEED_BASE + slot * SEEDS_PER_SLOT;
  }

  function seedFor(date) {
    return seedForSlot(poolIndex(date));
  }

  // 0 for Monday through 6 for Sunday.
  function weekdayOfSlot(slot) {
    return (slot + DAY_ZERO_WEEKDAY) % 7;
  }

  function weekday(date) {
    return weekdayOfSlot(poolIndex(date));
  }

  function dayPlanForSlot(slot) {
    return WEEK[weekdayOfSlot(slot)];
  }

  var api = {
    DAILY_POOL_SIZE: DAILY_POOL_SIZE,
    DAILY_SEED_BASE: DAILY_SEED_BASE,
    SEEDS_PER_SLOT: SEEDS_PER_SLOT,
    WEEK: WEEK,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    dayNumber: dayNumber,
    poolIndex: poolIndex,
    seedFor: seedFor,
    seedForSlot: seedForSlot,
    weekday: weekday,
    weekdayOfSlot: weekdayOfSlot,
    dayPlanForSlot: dayPlanForSlot
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).daily = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
