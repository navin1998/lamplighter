'use strict';

// The ten chapters and what each of their twelve towns must teach. The
// generator only builds towns; this decides which built town belongs
// where, and the catalogue tests hold every shipped town to the same rule.
//
// Every chapter's band tops out at the technique it introduces. Chapters
// 1-3 all sit at tier 3, because T1-T3 together are the degree layer every
// real board needs, so each is told apart by which of the three does the
// visible work. From chapter 4 on, towns 1-3 need the new technique
// exactly once, towns 4-9 sit anywhere in the band (some are review), and
// towns 10-12 need it `lateUses` times. That is three or four where the
// technique can repeat; T6, T7 and T9 never once needed more than two
// steps in about 9,000 trial towns, so their late towns need it at least
// once.
(function (root) {
  'use strict';

  var TOWNS_PER_CHAPTER = 12;

  // `interiorLamps` is how many lamps besides 1 and L the generator starts
  // from before minimising. In trial runs of 40-200 seeds per size,
  // minimisation left two to four lamps in all from these starts, and
  // every band was reachable.
  var CHAPTERS = Object.freeze([
    { number: 1, name: 'The First Street', hour: 'A quarter past six', width: 5, height: 5, band: [3, 3], technique: 'T1', interiorLamps: 4 },
    { number: 2, name: 'Dead Ends', hour: 'Seven o\'clock', width: 5, height: 5, band: [3, 3], technique: 'T2', interiorLamps: 4 },
    { number: 3, name: 'Crossroads', hour: 'Half past seven', width: 6, height: 5, band: [3, 3], technique: 'T3', interiorLamps: 4 },
    { number: 4, name: 'The Knot', hour: 'Eight o\'clock', width: 6, height: 6, band: [3, 4], technique: 'T4', interiorLamps: 5, lateUses: [3, 4] },
    { number: 5, name: 'Courtyards', hour: 'Nine o\'clock', width: 6, height: 6, band: [4, 5], technique: 'T5', interiorLamps: 5, lateUses: [3, 4] },
    { number: 6, name: 'The Cut', hour: 'Ten o\'clock', width: 7, height: 6, band: [5, 6], technique: 'T6', interiorLamps: 6, lateUses: [1, Infinity] },
    { number: 7, name: 'Black and White', hour: 'Eleven o\'clock', width: 7, height: 6, band: [6, 7], technique: 'T7', interiorLamps: 6, lateUses: [1, Infinity] },
    { number: 8, name: 'Counting Paces', hour: 'Midnight', width: 7, height: 7, band: [7, 8], technique: 'T8', interiorLamps: 7, lateUses: [3, 4] },
    { number: 9, name: 'The Old Quarter', hour: 'Two in the morning', width: 8, height: 7, band: [8, 9], technique: 'T9', interiorLamps: 8, lateUses: [1, Infinity] },
    { number: 10, name: 'The Long Night', hour: 'A quarter to five', width: 8, height: 8, band: [9, 10], technique: 'T10', interiorLamps: 8, lateUses: [3, 4] }
  ].map(Object.freeze));

  function countSteps(trace, technique) {
    var count = 0;
    for (var i = 0; i < trace.length; i += 1) if (trace[i].technique === technique) count += 1;
    return count;
  }

  // Long forced runs are allowed only in the corridor chapters, where
  // walking a corridor is the lesson.
  function allowsStaircase(chapter) {
    return chapter.number <= 3;
  }

  function target(chapter) {
    return { width: chapter.width, height: chapter.height, interiorLamps: chapter.interiorLamps, allowStaircase: allowsStaircase(chapter) };
  }

  function inDeadEnd(grid, cell) {
    return grid.neighbours[cell].length === 1;
  }

  // Whether a solved town (its grid, deductive trace and rating) fits town
  // `townIndex` (0-11) of `chapter`. Returns the reason it does not, or ''.
  function misfit(chapter, townIndex, grid, trace, rating) {
    if (rating.tier < chapter.band[0] || rating.tier > chapter.band[1]) return 'tier ' + rating.tier + ' is outside the band';

    if (chapter.number === 1) {
      return countSteps(trace, 'T1') * 2 > trace.length ? '' : 'corridors do not do most of the work';
    }
    if (chapter.number === 2) {
      var endInDeadEnd = inDeadEnd(grid, grid.lampCells[0]) || inDeadEnd(grid, grid.lampCells[grid.lampCount - 1]);
      if (!endInDeadEnd) return 'neither end lamp sits in a dead end';
      return countSteps(trace, 'T2') > 0 ? '' : 'endpoint degree never fires';
    }
    // Saturation only ever follows a corridor, so it can never outnumber
    // T1; across 62 tier-3 6x5 trial boards the best ratio was 0.75. Half
    // is a strong showing for it.
    if (chapter.number === 3) {
      return countSteps(trace, 'T3') * 2 >= countSteps(trace, 'T1') ? '' : 'saturation does less than half as much as corridors';
    }

    var uses = countSteps(trace, chapter.technique);
    if (townIndex < 3 && uses !== 1) return chapter.technique + ' is used ' + uses + ' times, not once';
    var late = chapter.lateUses;
    if (townIndex >= TOWNS_PER_CHAPTER - 3 && (uses < late[0] || uses > late[1])) {
      return chapter.technique + ' is used ' + uses + ' times, not ' + late[0] + (late[1] === Infinity ? ' or more' : '-' + late[1]);
    }
    return '';
  }

  var api = {
    TOWNS_PER_CHAPTER: TOWNS_PER_CHAPTER,
    CHAPTERS: CHAPTERS,
    countSteps: countSteps,
    target: target,
    misfit: misfit
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.LAMP = root.LAMP || {}).chapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
