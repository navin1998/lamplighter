'use strict';

// Contrast is checked, not assumed: these tests read the colour tokens
// straight out of css/style.css, for the normal theme and for high
// contrast, and hold every pair of text or meaningful mark against its
// background to WCAG's 4.5:1. The warm tint on walked squares is blended
// over the street, since marks sit on that too.

var fs = require('fs');
var nodePath = require('path');

var CSS = fs.readFileSync(nodePath.join(__dirname, '..', 'css', 'style.css'), 'utf8');
var MINIMUM = 4.5;

function tokensIn(selector) {
  var start = CSS.indexOf(selector + ' {');
  if (start === -1) throw new Error('no ' + selector + ' block in style.css');
  var block = CSS.slice(start, CSS.indexOf('}', start));
  var tokens = {};
  block.replace(/--([a-z-]+):\s*([^;]+);/g, function (match, name, value) {
    tokens[name] = value.trim();
    return match;
  });
  return tokens;
}

function parse(colour) {
  var hex = /^#([0-9a-f]{6})$/i.exec(colour);
  if (hex) {
    var n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  var rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(colour);
  if (rgba) return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4]) };
  throw new Error('cannot read colour ' + colour);
}

function over(top, bottom) {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1
  };
}

function luminance(c) {
  var channel = function (v) {
    var s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function ratio(a, b) {
  var la = luminance(a);
  var lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [foreground token, background token or 'lit' for a walked square]
var PAIRS = [
  ['text', 'night'], ['text-muted', 'night'], ['text', 'night-warm'], ['text-muted', 'night-warm'], ['text', 'control'],
  ['building', 'street'], ['lamp-unlit', 'street'], ['lamp-number-unlit', 'street'], ['lamp-number-lit', 'lamp-lit'],
  ['lamp-lit', 'street'], ['ribbon-start', 'street'], ['ribbon-head', 'street'], ['cursor', 'street'], ['refused', 'street'],
  ['text-muted', 'street'],
  ['ribbon-start', 'lit'], ['ribbon-head', 'lit'], ['cursor', 'lit'], ['lamp-lit', 'lit'], ['building', 'lit'], ['lamp-number-lit', 'lamp-lit']
];

function check(t, theme, tokens) {
  PAIRS.forEach(function (pair) {
    var fg = parse(tokens[pair[0]]);
    var bg = pair[1] === 'lit' ? over(parse(tokens['street-lit']), parse(tokens.street)) : parse(tokens[pair[1]]);
    var r = ratio(fg, bg);
    t.assert(r >= MINIMUM, theme + ': ' + pair[0] + ' on ' + pair[1] + ' is ' + r.toFixed(2) + ':1');
  });
}

module.exports = function (t) {
  var normal = tokensIn(':root');

  t.test('every text and meaningful mark meets 4.5:1 in the normal theme', function () {
    check(t, 'normal', normal);
  });

  t.test('every text and meaningful mark meets 4.5:1 in high contrast', function () {
    var high = Object.assign({}, normal, tokensIn('body.high-contrast'));
    check(t, 'high contrast', high);
  });

  t.test('high contrast is actually higher for the marks on the board', function () {
    var high = Object.assign({}, normal, tokensIn('body.high-contrast'));
    ['building', 'lamp-unlit', 'ribbon-start'].forEach(function (token) {
      t.assert(ratio(parse(high[token]), parse(high.street)) > ratio(parse(normal[token]), parse(normal.street)), token);
    });
  });
};
