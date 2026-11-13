'use strict';

// The help panel: a "?" that is always in the same place, opening a panel
// of four tabs. It is not a modal — on a wide screen it sits beside the
// town and on a narrow one it rises from the bottom, so the town stays in
// view while reading about it. Escape closes it, and it remembers the last
// tab across visits. Live demos only exist while their tab is open.
(function (root) {
  'use strict';

  var LAMP = root.LAMP;
  var doc = root.document;

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // options: { toggle, panel, progress, reducedMotion, onToggle }
  // onToggle(isOpen) runs as the panel opens or closes, so the page can
  // make room for it.
  function createHelp(options) {
    var content = LAMP.helpContent;
    var toggle = options.toggle;
    var panel = options.panel;
    var progress = options.progress;
    var lanes = [];
    var tabButtons = {};
    var pages = {};
    var activeTab = null;

    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'help-heading');

    var header = el('div', 'help-header');
    var heading = el('h2', 'help-heading', 'Help');
    heading.id = 'help-heading';
    var close = el('button', 'control', 'Close');
    close.type = 'button';
    header.appendChild(heading);
    header.appendChild(close);
    panel.appendChild(header);

    var tablist = el('div', 'help-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Help topics');
    panel.appendChild(tablist);

    content.TABS.forEach(function (tab) {
      var tabButton = el('button', 'control help-tab', tab.label);
      tabButton.type = 'button';
      tabButton.id = 'help-tab-' + tab.id;
      tabButton.setAttribute('role', 'tab');
      tabButton.setAttribute('aria-controls', 'help-page-' + tab.id);
      tabButton.addEventListener('click', function () { selectTab(tab.id, true); });
      tablist.appendChild(tabButton);
      tabButtons[tab.id] = tabButton;

      var page = el('div', 'help-page');
      page.id = 'help-page-' + tab.id;
      page.setAttribute('role', 'tabpanel');
      page.setAttribute('aria-labelledby', tabButton.id);
      page.tabIndex = 0;
      page.hidden = true;
      panel.appendChild(page);
      pages[tab.id] = page;
    });

    function paragraph(parent, text) {
      parent.appendChild(el('p', '', text));
    }

    function demoSlot(parent, demo) {
      var slot = el('div', 'lane-slot');
      slot.appendChild(el('h4', 'lane-title', demo.title));
      parent.appendChild(slot);
      lanes.push(LAMP.lane.createLane(slot, demo, { reducedMotion: options.reducedMotion }));
    }

    var builders = {
      how: function (page) {
        content.HOW_TO_PLAY.paragraphs.forEach(function (text) { paragraph(page, text); });
        content.HOW_TO_PLAY.demos.forEach(function (demo) { demoSlot(page, demo); });
      },
      techniques: function (page) {
        content.TECHNIQUES.forEach(function (entry) {
          // In the page before its demo is made: the demo reads its
          // colours and width from where it sits.
          var section = el('section', 'technique');
          section.id = 'help-entry-' + entry.id;
          page.appendChild(section);
          var name = el('h3', 'technique-name', entry.name);
          name.tabIndex = -1;
          section.appendChild(name);
          paragraph(section, entry.text.join(' '));
          demoSlot(section, entry.demo);
        });
      },
      modes: function (page) {
        content.MODES.forEach(function (mode) {
          page.appendChild(el('h3', '', mode.title));
          paragraph(page, mode.text);
        });
      },
      about: function (page) {
        content.ABOUT.forEach(function (text) { paragraph(page, text); });
      }
    };

    function clearPage() {
      lanes.forEach(function (lane) { lane.destroy(); });
      lanes = [];
      Object.keys(pages).forEach(function (id) {
        pages[id].textContent = '';
        pages[id].hidden = true;
      });
    }

    function selectTab(id, focusTab) {
      if (!pages[id]) id = content.TABS[0].id;
      clearPage();
      activeTab = id;
      Object.keys(tabButtons).forEach(function (other) {
        var selected = other === id;
        tabButtons[other].setAttribute('aria-selected', selected ? 'true' : 'false');
        tabButtons[other].tabIndex = selected ? 0 : -1;
      });
      pages[id].hidden = false;
      builders[id](pages[id]);
      progress.setHelpTab(id);
      if (focusTab) tabButtons[id].focus();
    }

    function isOpen() {
      return !panel.hidden;
    }

    function open(tab, entryId) {
      panel.hidden = false;
      doc.body.classList.add('help-open');
      toggle.setAttribute('aria-expanded', 'true');
      if (options.onToggle) options.onToggle(true);
      selectTab(tab || progress.helpTab(), false);
      var target = entryId ? doc.getElementById('help-entry-' + entryId) : null;
      if (target) {
        target.scrollIntoView({ block: 'start' });
        target.querySelector('.technique-name').focus();
      } else {
        tabButtons[activeTab].focus();
      }
    }

    function closePanel() {
      if (!isOpen()) return;
      clearPage();
      panel.hidden = true;
      doc.body.classList.remove('help-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (options.onToggle) options.onToggle(false);
      toggle.focus();
    }

    toggle.addEventListener('click', function () {
      if (isOpen()) closePanel();
      else open();
    });
    close.addEventListener('click', closePanel);

    // Arrow keys move between tabs, as tab lists do everywhere else.
    tablist.addEventListener('keydown', function (event) {
      var ids = content.TABS.map(function (tab) { return tab.id; });
      var at = ids.indexOf(activeTab);
      var next = -1;
      if (event.key === 'ArrowRight') next = (at + 1) % ids.length;
      else if (event.key === 'ArrowLeft') next = (at + ids.length - 1) % ids.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = ids.length - 1;
      if (next === -1) return;
      event.preventDefault();
      selectTab(ids[next], true);
    });

    // Escape belongs to the panel while it is open, before the board ever
    // sees it — otherwise the same key would also offer to clear a walk.
    doc.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !isOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }, true);

    return { open: open, close: closePanel, isOpen: isOpen };
  }

  (root.LAMP = root.LAMP || {}).help = { createHelp: createHelp };
})(typeof globalThis !== 'undefined' ? globalThis : this);
