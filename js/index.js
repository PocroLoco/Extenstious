document.addEventListener("DOMContentLoaded", function() {

  var SearchViewModel = function() {
    var self = this;
    self.q = ko.observable("");

    // TODO: Add more search control here.
  };

  var SwitchViewModel = function(exts, profiles, opts) {
    var self = this;

    var init = [];

    self.exts = exts;
    self.profiles = profiles;
    self.opts = opts;
    self.toggled = ko.observableArray().extend({persistable: "toggled"});

    self.any = ko.computed(function() {
      return self.toggled().length > 0;
    });

    self.toggleStyle = ko.pureComputed(function() {
      return (self.any()) ? 'fa-toggle-off' : 'fa-toggle-on'
    });

    var disableFilterFn = function(item) {
      // Filter out Always On extensions when disabling, if option is set.
      if(!self.opts.keepAlwaysOn()) return true;
      return !_(self.profiles.always_on().items()).contains(item.id());
    };

    self.flip = function() {
      if(self.any()) {
        // Re-enable
        _(self.toggled()).each(function(id) {
          // Old disabled extensions may be removed
          try{ self.exts.find(id).enable();} catch(e) {};
        });
        self.toggled([]);
      } else {
        // Disable
        self.toggled(self.exts.enabled.pluck());
        self.exts.enabled.disable(disableFilterFn);
      };
    };

  };

  // Extensious: in-popup "New profile" dialog.
  var NewProfileViewModel = function(root) {
    var self = this;

    self.isOpen = ko.observable(false);
    self.name = ko.observable("");
    self.selected = ko.observableArray();
    self.error = ko.observable("");
    self.focusName = ko.observable(false);

    // Search box to filter the extension list by name.
    self.query = ko.observable("");

    self.filtered = ko.pureComputed(function() {
      var q = self.query().trim().toUpperCase();
      var all = root.exts.extensions();
      if(!q) return all;
      return _(all).filter(function(e) { return e.name().toUpperCase().indexOf(q) !== -1; });
    });

    self.noMatches = ko.pureComputed(function() {
      return self.filtered().length === 0;
    });

    var filteredIds = function() {
      return _(self.filtered()).map(function(e) { return e.id(); });
    };

    self.searchKey = function(vm, e) {
      // Enter in the search box shouldn't create the profile.
      if(e.key === "Enter") { e.preventDefault(); return false; }
      // First Esc clears the search, the next one closes the dialog.
      if(e.key === "Escape" && self.query()) { e.preventDefault(); e.stopPropagation(); self.query(""); return false; }
      return true;
    };

    self.selectedCount = ko.pureComputed(function() {
      var n = self.selected().length;
      return "(" + n + " selected)";
    });

    var initialSelected = [];

    var show = function(draft) {
      self.name(draft.name || "");
      self.error("");
      self.query(draft.query || "");
      self.selected((draft.selected || []).slice());
      initialSelected = root.exts.enabled.pluck().slice();
      self.isOpen(true);
      self.focusName(true);
    };

    self.open = function() {
      // Start from whatever is turned on right now, same as the Profiles page does.
      show({ name: "", query: "", selected: root.exts.enabled.pluck() });
    };

    // Closes without keeping anything (used after Create).
    self.close = function() {
      self.isOpen(false);
      forgetDraft();
    };

    // Did you type or tick anything?
    var hasWork = function(d) {
      return (d.name || "").trim() !== "" ||
        _.difference(d.selected, initialSelected).length > 0 ||
        _.difference(initialSelected, d.selected).length > 0;
    };

    var currentDraft = function() {
      return { name: self.name(), query: self.query(), selected: self.selected().slice() };
    };

    // Closing without creating (Cancel, clicking outside, Esc) keeps what you had,
    // so Cmd/Ctrl+Z brings the dialog back exactly as you left it.
    var closeKeepingDraft = function(withHint) {
      var d = currentDraft();
      self.isOpen(false);
      forgetDraft();
      if(hasWork(d)) {
        root.pushUndo("closing New profile", function() { show(d); }, true);
        if(withHint) root.toast("Closed. Press " + root.undoKey + " to bring it back.");
      }
    };

    self.cancel = function() { closeKeepingDraft(false); };
    self.dismiss = function() { closeKeepingDraft(true); };

    // While the dialog is open, keep a copy in storage. If the whole popup
    // closes (you clicked outside Chrome's popup), we can bring it back next time.
    var forgetDraft = function() {
      chrome.storage.local.remove("newProfileDraft");
    };

    ko.computed(function() {
      if(!self.isOpen()) return;
      var d = currentDraft();
      d.touched = hasWork(d);
      chrome.storage.local.set({ newProfileDraft: d });
    });

    chrome.storage.local.get("newProfileDraft", function(v) {
      var d = v && v.newProfileDraft;
      if(!d) return;
      forgetDraft();
      if(!d.touched) return; // you hadn't typed or ticked anything
      root.pushUndo("closing New profile", function() { show(d); }, true);
      root.toast("Your unfinished profile got closed. Press " + root.undoKey + " to bring it back.", 6000);
    });

    // All / None apply to what the search is showing (everything if no search).
    self.selectAll = function() {
      self.selected(_.union(self.selected(), filteredIds()));
    };

    self.selectNone = function() {
      self.selected(_.difference(self.selected(), filteredIds()));
    };

    self.create = function() {
      var n = (self.name() || "").trim();
      if(!n) {
        self.error("Give it a name first.");
        self.focusName(true);
        return;
      }
      if(n.startsWith("__")) {
        self.error("Names can't start with two underscores.");
        return;
      }
      var taken = _(root.profiles.items()).some(function(p) {
        return p.name().toUpperCase() == n.toUpperCase();
      });
      if(taken) {
        self.error("You already have a profile called \"" + n + "\".");
        return;
      }

      root.profiles.add(n, _(self.selected()).uniq());
      var created = root.profiles.find(n);
      // Keep the list in the same order it loads in (reserved first, then A-Z).
      root.sortProfiles();
      root.profiles.save(function() {});
      // Show the new profile opened so you can see what's in it.
      if(!_(root.expandedProfiles()).contains(n)) root.expandedProfiles.push(n);
      var draft = currentDraft();
      self.close();

      // Undo: remove the profile again and reopen the dialog as it was.
      root.pushUndo("creating " + n, function() {
        var name = created.name();
        var wasOn = root.isActive(name);
        root.profiles.remove(created);
        root.activeProfiles.remove(name);
        root.expandedProfiles.remove(name);
        if(wasOn) root.applyProfiles();
        show(draft);
      });
    };

    // Esc closes the dialog.
    document.addEventListener("keydown", function(e) {
      if(e.key === "Escape" && self.isOpen()) {
        e.preventDefault();
        self.dismiss();
      }
    });
  };

  var ExtensityViewModel = function() {
    var self = this;

    self.profiles = new ProfileCollectionModel();
    self.exts = new ExtensionCollectionModel();
    self.opts = new OptionsCollection();
    self.dismissals = new DismissalsCollection();
    self.switch = new SwitchViewModel(self.exts, self.profiles, self.opts);
    self.search = new SearchViewModel();
    // Extensious: several profiles can be on at the same time.
    self.activeProfiles = ko.observableArray([]);
    chrome.storage.sync.get(["activeProfiles", "activeProfile"], function(v) {
      // Carry over the single active profile from older versions.
      var names = v.activeProfiles || (v.activeProfile ? [v.activeProfile] : []);
      self.activeProfiles(names);
      self.activeProfiles.subscribe(function(val) {
        chrome.storage.sync.set({activeProfiles: val});
      });
    });

    self.isActive = function(name) {
      return _(self.activeProfiles()).contains(name);
    };

    var filterFn = function(i) {
      // Filtering function for search box
      if(!self.opts.searchBox()) return true;
      if(!self.search.q()) return true;
      return i.name().toUpperCase().indexOf(self.search.q().toUpperCase()) !== -1;
    };

    var filterProfileFn = function(i) {
      if(!i.reserved()) return true;
      return self.opts.showReserved() && i.hasItems();
    }

    var filterFavoriteFn = function(i) {
      return (self.profiles.favorites().contains(i));
    }

    var nameSortFn = function(i) {
      return i.name().toUpperCase();
    };

    var statusSortFn = function(i) {
      return self.opts.enabledFirst() && !i.status();
    };

    self.openChromeExtensions = function() {
      openTab("chrome://extensions");
    };

    self.launchApp = function(app) {
      chrome.management.launchApp(app.id());
    };

    self.launchOptions = function(ext) {
      chrome.tabs.create({url: ext.optionsUrl(), active: true});
    };

    self.listedExtensions = ko.computed(function() {
      // Sorted/Filtered list of extensions
      return _(self.exts.extensions()).chain()
        .filter(filterFn)
        .sortBy(nameSortFn)
        .sortBy(statusSortFn)
        .value()
    }).extend({countable: null});

    self.listedApps = ko.computed(function() {
      // Sorted/Filtered list of apps
      return _(self.exts.apps())
        .filter(filterFn);
    }).extend({countable: null});

    self.listedItems = ko.computed(function() {
      // Sorted/Filtered list of all items
      return _(self.exts.items())
        .filter(filterFn);
    }).extend({countable: null});

    // Extensious: which profiles have their extension list open (remembered).
    self.expandedProfiles = ko.observableArray().extend({persistable: "expandedProfiles"});

    self.toggleExpanded = function(p) {
      if(_(self.expandedProfiles()).contains(p.name())) {
        self.expandedProfiles.remove(p.name());
      } else {
        self.expandedProfiles.push(p.name());
      }
    };

    // Extensious: give each profile a sorted list of the installed
    // extensions/apps it contains, so the popup can show them under the profile.
    var withExtensions = function(p) {
      if(!p.extensions) {
        p.extensions = ko.pureComputed(function() {
          return _(p.items()).chain()
            .map(function(id) { return self.exts.find(id); })
            .compact() // skip extensions that were uninstalled
            .sortBy(nameSortFn)
            .value();
        });
        p.count = ko.pureComputed(function() {
          return p.extensions().length;
        });
        p.active = ko.pureComputed(function() {
          return self.isActive(p.name());
        });
        // Inline rename state
        p.editing = ko.observable(false);
        p.draft = ko.observable("");
        p.focusEdit = ko.observable(false);
        p.renameError = ko.observable("");
        p.expanded = ko.pureComputed(function() {
          return _(self.expandedProfiles()).contains(p.name());
        });
        // Clicking an extension under a profile turns just that extension
        // on/off (same as in the main list), instead of switching profiles.
        p.toggleItem = function(ext) {
          self.toggleExtension(ext);
        };
      }
      return p;
    };

    self.listedProfiles = ko.computed(function() {
      return _(self.profiles.items()).chain()
        .filter(filterProfileFn)
        .map(withExtensions)
        .value();
    }).extend({countable: null});

    self.listedFavorites = ko.computed(function() {
      return _(self.exts.extensions()).chain()
        .filter(filterFavoriteFn)
        .filter(filterFn)
        .sortBy(nameSortFn)
        .sortBy(statusSortFn)
        .value();
    }).extend({countable: null});

    // Extensious: Cmd/Ctrl+Z undoes the last profile change.
    self.undoKey = (navigator.platform.indexOf("Mac") > -1) ? "\u2318Z" : "Ctrl+Z";
    self.undoStack = [];

    // label: shown as "Undid: <label>"; fn: puts things back.
    // quiet: no toast (the action itself makes the result obvious).
    self.pushUndo = function(label, fn, quiet) {
      self.undoStack.push({ label: label, fn: fn, quiet: !!quiet });
      if(self.undoStack.length > 30) self.undoStack.shift();
    };

    self.undo = function() {
      var a = self.undoStack.pop();
      if(!a) { self.toast("Nothing to undo."); return; }
      a.fn();
      self.profiles.save(function() {});
      if(!a.quiet) self.toast("Undid " + a.label + ".");
      else self.toastShown(false);
    };

    // Small message at the bottom of the popup.
    self.toastText = ko.observable("");
    self.toastShown = ko.observable(false);
    var toastTimer = null;
    self.toast = function(msg, ms) {
      self.toastText(msg);
      self.toastShown(true);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function() { self.toastShown(false); }, ms || 3500);
    };

    document.addEventListener("keydown", function(e) {
      if(!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if(e.key !== "z" && e.key !== "Z") return;
      var t = e.target;
      var inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      // Inside a text box you're typing in, Cmd+Z undoes your typing like normal.
      if(inField && (t.value || (t.closest && t.closest(".modal, .profile-row")))) return;
      if(self.newProfile.isOpen()) return;
      e.preventDefault();
      self.undo();
    });

    // Extensious: "+" on the Profiles bar opens this small create-profile dialog.
    self.newProfile = new NewProfileViewModel(self);

    self.emptyItems = ko.pureComputed(function() {
      return self.listedApps.none() && self.listedExtensions.none();
    });

    // Extensious: keep profiles in load order (reserved first, then A-Z).
    self.sortProfiles = function() {
      self.profiles.items.sort(function(a, b) {
        var ka = (a.name().startsWith("__") ? " " : "") + a.name().toUpperCase();
        var kb = (b.name().startsWith("__") ? " " : "") + b.name().toUpperCase();
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
    };

    // Extensious: rename a profile right in the popup (pencil next to the name).
    self.noop = function() { return true; };

    self.startRename = function(p) {
      p.draft(p.name());
      p.renameError("");
      p.editing(true);
      p.focusEdit(true);
      // Select the old name so you can just type over it.
      // (Knockout renders the input synchronously, so it's already there.)
      var input = document.querySelector("input.rename-input");
      if(input) { input.focus(); input.select(); }
    };

    var replaceName = function(arr, oldName, newName) {
      if(_(arr()).contains(oldName)) {
        arr(_(arr()).map(function(n) { return n === oldName ? newName : n; }));
      }
    };

    // Returns true if the rename was applied (or nothing changed).
    var commitRename = function(p, showErrors) {
      if(!p.editing()) return true;
      var oldName = p.name();
      var n = (p.draft() || "").trim();
      var fail = function(msg) {
        if(showErrors) { p.renameError(msg); p.focusEdit(true); }
        else { p.editing(false); } // clicked away with a bad name: keep the old one
        return false;
      };
      if(!n || n === oldName) { p.editing(false); return true; }
      if(n.startsWith("__")) return fail("Names can't start with two underscores.");
      var taken = _(self.profiles.items()).some(function(o) {
        return o !== p && o.name().toUpperCase() == n.toUpperCase();
      });
      if(taken) return fail("You already have a profile called \"" + n + "\".");

      renameProfile(p, n);
      p.editing(false);
      self.pushUndo("renaming " + oldName, function() {
        var clash = _(self.profiles.items()).some(function(o) {
          return o !== p && o.name().toUpperCase() == oldName.toUpperCase();
        });
        if(!clash) renameProfile(p, oldName);
      });
      return true;
    };

    var renameProfile = function(p, newName) {
      var oldName = p.name();
      p.name(newName);
      replaceName(self.activeProfiles, oldName, newName);
      replaceName(self.expandedProfiles, oldName, newName);
      self.sortProfiles();
      self.profiles.save(function() {});
    };

    self.renameKey = function(p, e) {
      if(e.key === "Enter") { e.preventDefault(); commitRename(p, true); return false; }
      if(e.key === "Escape") { e.preventDefault(); e.stopPropagation(); p.editing(false); return false; }
      if(p.renameError()) p.renameError("");
      return true; // let normal typing through
    };

    self.renameBlur = function(p) {
      commitRename(p, false);
    };

    // Turn on exactly what the active profiles (plus Always On) contain,
    // and turn everything else off. Overlapping extensions are simply on.
    self.applyProfiles = function() {
      var active = _(self.profiles.items()).filter(function(p) { return self.isActive(p.name()); });
      var ids = _.union.apply(_, _(active).map(function(p) { return p.items(); })
        .concat([self.profiles.always_on().items()]));
      var to_enable = _.intersection(self.exts.disabled.pluck(), ids);
      var to_disable = _.difference(self.exts.enabled.pluck(), ids);
      _(to_enable).each(function(id) { self.exts.find(id).enable() });
      _(to_disable).each(function(id) { self.exts.find(id).disable() });
    };

    // Clicking a profile turns it on or off.
    self.toggleProfile = function(p) {
      if(self.isActive(p.name())) {
        self.activeProfiles.remove(p.name());
      } else {
        self.activeProfiles.push(p.name());
      }
      self.applyProfiles();
    };

    // Is this extension wanted by any active profile (or Always On)?
    self.wantedByActiveProfiles = function(id) {
      if(_(self.profiles.always_on().items()).contains(id)) return true;
      return _(self.profiles.items()).some(function(p) {
        return self.isActive(p.name()) && _(p.items()).contains(id);
      });
    };

    // Turning a single extension on/off by hand leaves your profiles on.
    self.toggleExtension = function(e) {
      e.toggle();
    }

    // Private helper functions
    var openTab = function (url) {
      chrome.tabs.create({url: url});
      close();
    };

    var close = function() {
      window.close();
    };

    // View helpers
    var visitedProfiles = ko.computed(function() {
      return (self.dismissals.dismissed("profile_page_viewed") || self.profiles.any());
    });

  };

  _.defer(function() {
    vm = new ExtensityViewModel();
    ko.bindingProvider.instance = new ko.secureBindingsProvider({});
    ko.applyBindings(vm, document.body);
    setupProfileDragAndDrop(vm); // Extensious: drag extensions into/out of profiles
  });

  // Workaround for Chrome bug https://bugs.chromium.org/p/chromium/issues/detail?id=307912
  window.setTimeout(function() { document.getElementById('workaround-307912').style.display = 'block'; }, 0);
});
