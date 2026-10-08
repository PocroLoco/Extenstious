// Extensious: drag extensions into and out of profiles in the popup.
//
// - Drag an extension from the list onto a profile  -> "Add to <profile>"
// - Drag an extension out of a profile's open list  -> "Remove from <profile>"
// - Drag it from one profile onto another profile   -> "Add to <other>" (copy)
//
// Uses plain pointer events (not HTML5 drag & drop) so the bubble follows the
// mouse smoothly and a normal click still toggles the extension.

var setupProfileDragAndDrop = function(vm) {
  var THRESHOLD = 5;   // px the mouse must move before a click becomes a drag
  var EDGE = 40;       // px from the top/bottom edge where auto-scroll kicks in

  var drag = null;
  var suppressClick = false;

  var profileAt = function(el) {
    var li = el && el.closest ? el.closest("li.profile") : null;
    return li ? { li: li, profile: ko.dataFor(li) } : null;
  };

  var save = function() {
    vm.profiles.save(function() {});
  };

  var flash = function(li) {
    if(!li) return;
    li.classList.remove("dropped");
    void li.offsetWidth; // restart the animation
    li.classList.add("dropped");
    setTimeout(function() { li.classList.remove("dropped"); }, 700);
  };

  var start = function() {
    drag.active = true;
    drag.el.classList.add("drag-source");
    document.body.classList.add("dragging");

    drag.bubble = document.createElement("div");
    drag.bubble.className = "drag-bubble";
    var img = document.createElement("img");
    img.src = drag.ext.icon;
    drag.label = document.createElement("span");
    drag.bubble.appendChild(img);
    drag.bubble.appendChild(drag.label);
    document.body.appendChild(drag.bubble);

    autoScroll();
  };

  var update = function() {
    var over = profileAt(document.elementFromPoint(drag.x, drag.y));
    var name = function(p) { return p.short_name(); };
    var action = null, text = drag.ext.short_name();

    if(over && drag.from && over.profile === drag.from.profile) {
      action = null; // back over its own profile: nothing happens
    } else if(over) {
      if(over.profile.contains(drag.ext)) {
        action = "already"; text = "Already in " + name(over.profile);
      } else {
        action = "add"; text = "Add to " + name(over.profile);
      }
    } else if(drag.from) {
      action = "remove"; text = "Remove from " + name(drag.from.profile);
    }

    // Highlight the profile under the mouse.
    var targetLi = (over && action) ? over.li : null;
    if(drag.targetLi && drag.targetLi !== targetLi) drag.targetLi.classList.remove("drop-target");
    if(targetLi) targetLi.classList.add("drop-target");
    drag.targetLi = targetLi;
    drag.target = over;
    drag.action = action;

    drag.label.textContent = text;
    drag.bubble.className = "drag-bubble" + (action ? " " + action : "");

    // Keep the bubble next to the mouse, inside the popup.
    var bw = drag.bubble.offsetWidth, bh = drag.bubble.offsetHeight;
    var left = Math.min(drag.x + 14, window.innerWidth - bw - 4);
    var top = Math.min(drag.y + 12, window.innerHeight - bh - 4);
    drag.bubble.style.left = Math.max(4, left) + "px";
    drag.bubble.style.top = Math.max(4, top) + "px";
  };

  var drop = function() {
    var ext = drag.ext;
    var wasOn = ext.status();
    if(drag.action === "add") {
      var p = drag.target.profile;
      p.items.push(ext.id());
      vm.setUndo({ label: "adding " + ext.short_name() + " to " + p.short_name(), type: "unadd",
        data: { profile: p.name(), id: ext.id(), wasOn: wasOn } });
      // If that profile is on, turn the extension on too.
      if(vm.isActive(p.name()) && !ext.status()) ext.enable();
      save();
      flash(drag.target.li);
    } else if(drag.action === "remove") {
      var from = drag.from.profile;
      from.items.remove(ext.id());
      vm.setUndo({ label: "removing " + ext.short_name() + " from " + from.short_name(), type: "unremove",
        data: { profile: from.name(), id: ext.id(), wasOn: wasOn } });
      // If that profile is on, turn the extension off too, unless another
      // active profile (or Always On) still wants it.
      if(vm.isActive(from.name()) && ext.status() && !vm.wantedByActiveProfiles(ext.id())) ext.disable();
      save();
      flash(drag.from.li);
    }
  };

  var cleanup = function() {
    if(!drag) return;
    if(drag.active) {
      drag.el.classList.remove("drag-source");
      if(drag.targetLi) drag.targetLi.classList.remove("drop-target");
      if(drag.bubble) drag.bubble.remove();
      document.body.classList.remove("dragging");
    }
    drag = null;
  };

  // Scroll the popup while dragging near its top or bottom edge,
  // so you can drag from far down the list up to the profiles.
  var autoScroll = function() {
    if(!drag || !drag.active) return;
    var dy = 0;
    if(drag.y < EDGE) dy = -Math.ceil((EDGE - drag.y) / 3);
    else if(drag.y > window.innerHeight - EDGE) dy = Math.ceil((drag.y - (window.innerHeight - EDGE)) / 3);
    if(dy) {
      window.scrollBy(0, dy);
      update();
    }
    requestAnimationFrame(autoScroll);
  };

  document.addEventListener("pointerdown", function(e) {
    if(e.button !== 0 || vm.newProfile.isOpen()) return;
    if(e.target.closest(".fa-gear, a")) return; // options gear, links, arrows
    var sub = e.target.closest("ul.profile-items > li");
    var item = sub || e.target.closest("li.extension");
    if(!item) return;
    var ext = ko.dataFor(item);
    if(!ext || !ext.id) return;
    drag = {
      ext: ext,
      el: item,
      from: sub ? profileAt(sub) : null,
      sx: e.clientX, sy: e.clientY,
      x: e.clientX, y: e.clientY,
      active: false
    };
  });

  document.addEventListener("pointermove", function(e) {
    if(!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if(!drag.active) {
      if(Math.abs(drag.x - drag.sx) + Math.abs(drag.y - drag.sy) < THRESHOLD) return;
      start();
    }
    e.preventDefault();
    update();
  });

  document.addEventListener("pointerup", function(e) {
    if(!drag) return;
    if(drag.active) {
      drag.x = e.clientX; drag.y = e.clientY;
      update();
      drop();
      // The browser fires a click right after this; don't let it toggle anything.
      suppressClick = true;
      setTimeout(function() { suppressClick = false; }, 300);
    }
    cleanup();
  });

  // Grabbing an icon would otherwise start Chrome's built-in image drag,
  // which cancels ours. Nothing in the popup needs native drag.
  document.addEventListener("dragstart", function(e) {
    if(e.target.closest && e.target.closest("#content")) e.preventDefault();
  });

  document.addEventListener("pointercancel", cleanup);
  window.addEventListener("blur", cleanup);
  document.addEventListener("keydown", function(e) {
    if(e.key === "Escape" && drag && drag.active) { e.preventDefault(); cleanup(); }
  });

  document.addEventListener("click", function(e) {
    if(suppressClick) {
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
};
