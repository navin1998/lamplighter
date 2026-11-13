'use strict';

// Three quiet sounds, made on the spot with the Web Audio API: a soft tick
// for a step, a warm chime when a lamp lights, a slow rising chord when
// the town is walked. No audio files. Sound is off until the player turns
// it on, and turning it on is itself the click browsers ask for before a
// page may make a sound.
(function (root) {
  'use strict';

  var context = null;
  var enabled = false;

  function audio() {
    if (!context) {
      var AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) return null;
      context = new AudioContext();
    }
    if (context.state === 'suspended') {
      // A browser that still refuses simply stays quiet; the game never
      // depends on sound.
      context.resume().catch(function () { enabled = false; });
    }
    return context;
  }

  function tone(frequency, start, duration, peak, type) {
    var oscillator = context.createOscillator();
    var gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function play(kind) {
    if (!enabled || !audio()) return;
    var now = context.currentTime;
    if (kind === 'step') {
      tone(740, now, 0.08, 0.02, 'triangle');
    } else if (kind === 'lamp') {
      tone(659.25, now, 1.1, 0.05, 'sine');
      tone(987.77, now + 0.03, 1.1, 0.03, 'sine');
    } else if (kind === 'complete') {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (frequency, i) {
        tone(frequency, now + i * 0.22, 1.8, 0.04, 'sine');
      });
    }
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    if (enabled) audio();
  }

  (root.LAMP = root.LAMP || {}).sound = { play: play, setEnabled: setEnabled };
})(typeof globalThis !== 'undefined' ? globalThis : this);
