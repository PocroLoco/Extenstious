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

  // Extentious: in-popup "New profile" dialog.
  var NewProfileViewModel = function(root) {
    var self = this;

    self.isOpen = ko.observable(false);
    self.name = ko.observable("");
    self.selected = ko.observableArray();
    self.error = ko.observable("");
    self.focusName = ko.observable(false);

    self.selectedCount = ko.pureComputed(function() {
      var n = self.selected().length;
      return "(" + n + " selected)";
    });

    self.open = function() {
      self.name("");
      self.error("");
      // Start from whatever is turned on right now, same as the Profiles page does.
      self.selected(root.exts.enabled.pluck().slice());
      self.isOpen(true);
      self.focusName(true);
    };

    self.close = function() {
      self.isOpen(false);
    };

    self.selectAll = function() {
      self.selected(root.exts.extensions.pluck().slice());
    };

    self.selectNone = function() {
      self.selected([]);
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
      // Keep the list in the same order it loads in (reserved first, then A-Z).
      root.profiles.items.sort(function(a, b) {
        var ka = (a.name().startsWith("__") ? " " : "") + a.name().toUpperCase();
        var kb = (b.name().startsWith("__") ? " " : "") + b.name().toUpperCase();
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
      root.profiles.save(function() {});
      // Show the new profile opened so you can see what's in it.
      if(!_(root.expandedProfiles()).contains(n)) root.expandedProfiles.push(n);
      self.close();
    };

    // Esc closes the dialog.
    document.addEventListener("keydown", function(e) {
      if(e.key === "Escape" && self.isOpen()) {
        e.preventDefault();
        self.close();
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
    self.activeProfile = ko.observable().extend({persistable: "activeProfile"});

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

    // Extentious: which profiles have their extension list open (remembered).
    self.expandedProfiles = ko.observableArray().extend({persistable: "expandedProfiles"});

    self.toggleExpanded = function(p) {
      if(_(self.expandedProfiles()).contains(p.name())) {
        self.expandedProfiles.remove(p.name());
      } else {
        self.expandedProfiles.push(p.name());
      }
    };

    // Extentious: give each profile a sorted list of the installed
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
        p.expanded = ko.pureComputed(function() {
          return _(self.expandedProfiles()).contains(p.name());
        });
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

    // Extentious: "+" on the Profiles bar opens this small create-profile dialog.
    self.newProfile = new NewProfileViewModel(self);

    self.emptyItems = ko.pureComputed(function() {
      return self.listedApps.none() && self.listedExtensions.none();
    });

    self.setProfile = function(p) {
      self.activeProfile(p.name());
      // Profile items, plus always-on items
      var ids = _.union(p.items(), self.profiles.always_on().items());
      var to_enable = _.intersection(self.exts.disabled.pluck(),ids);
      var to_disable = _.difference(self.exts.enabled.pluck(), ids);
      _(to_enable).each(function(id) { self.exts.find(id).enable() });
      _(to_disable).each(function(id) { self.exts.find(id).disable() });
    };

    self.unsetProfile = function() {
      self.activeProfile(undefined);
    };

    self.toggleExtension = function(e) {
      e.toggle();
      self.unsetProfile();
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
    setupProfileDragAndDrop(vm); // Extentious: drag extensions into/out of profiles
  });

  // Workaround for Chrome bug https://bugs.chromium.org/p/chromium/issues/detail?id=307912
  window.setTimeout(function() { document.getElementById('workaround-307912').style.display = 'block'; }, 0);
});
