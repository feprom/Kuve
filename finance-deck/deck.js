(() => {
  const stage = document.querySelector(".stage");
  const slides = [...stage.querySelectorAll(".slide")];
  const previous = document.querySelector("#previous");
  const next = document.querySelector("#next");
  const count = document.querySelector("#slide-count");
  const progress = document.querySelector("#progress");
  const language = document.querySelector(".language");
  const fullscreen = document.querySelector("#fullscreen");
  const indexDialog = document.querySelector("#index-dialog");
  const shareDialog = document.querySelector("#share-dialog");
  const shareAddress = document.querySelector("#share-address");
  const status = document.querySelector("#deck-status");
  const list = document.querySelector(".contents");
  const number = (value) => String(value).padStart(2, "0");
  // Old links used zero-based positions. Keep them pointed at the closest topic.
  const legacySlides = ["slide-1", "slide-2", "slide-6", "ahorro-renta", "slide-3", "backtest", "backtest", "slide-6", "slide-9"];
  let current = -1;
  let swipeStart;

  function locationIndex() {
    const hash = window.location.hash;
    const legacy = /^#s=(\d+)$/.exec(hash);
    const id = legacy ? legacySlides[Number(legacy[1])] : hash.slice(1);
    return Math.max(0, slides.findIndex((slide) => slide.id === id || (id && slide.dataset.alias?.split(" ").includes(id))));
  }

  const entries = slides.map((slide, index) => {
    const entry = document.createElement("li");
    const button = document.createElement("button");
    const position = document.createElement("span");
    button.type = "button";
    position.textContent = number(index + 1);
    button.append(position, slide.dataset.topic);
    button.addEventListener("click", () => {
      indexDialog.close();
      show(index, { updateUrl: true, focusHeading: true });
    });
    entry.append(button);
    list.append(entry);
    return button;
  });

  function show(index, { updateUrl = false, focusHeading = false } = {}) {
    if (index < 0 || index >= slides.length) return;

    const changed = index !== current;
    const focused = document.activeElement;
    const slide = slides[index];
    const heading = slide.querySelector("h1, h2");
    current = index;
    slides.forEach((item, itemIndex) => {
      item.hidden = itemIndex !== index;
      if (itemIndex === index) entries[itemIndex].setAttribute("aria-current", "step");
      else entries[itemIndex].removeAttribute("aria-current");
    });

    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    count.querySelector("span").textContent = `${number(index + 1)} / ${number(slides.length)}`;
    progress.max = slides.length;
    progress.value = index + 1;
    language.hash = slide.id;

    if (updateUrl && window.location.hash !== `#${slide.id}`) {
      history.pushState(null, "", `#${slide.id}`);
    }

    if (changed) {
      window.scrollTo({ top: 0, behavior: "instant" });
      status.textContent = `${index + 1} / ${slides.length}. ${heading.textContent}`;
    }

    if (focusHeading || (changed && focused && (focused.disabled || focused.closest("[hidden]")))) {
      heading.focus({ preventScroll: true });
    }
  }

  previous.addEventListener("click", () => show(current - 1, { updateUrl: true }));
  next.addEventListener("click", () => show(current + 1, { updateUrl: true }));
  count.addEventListener("click", () => {
    indexDialog.showModal();
    entries[current].focus();
  });

  document.querySelectorAll("[data-slide-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const index = slides.findIndex((slide) => `#${slide.id}` === link.hash);
      if (index === -1) return;
      event.preventDefault();
      show(index, { updateUrl: true, focusHeading: true });
    });
  });

  window.addEventListener("hashchange", () => show(locationIndex()));
  window.addEventListener("popstate", () => show(locationIndex()));
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || document.querySelector("dialog[open]") || event.target.matches("input, textarea, select, [contenteditable]")) return;

    const targets = {
      ArrowLeft: current - 1,
      PageUp: current - 1,
      ArrowRight: current + 1,
      PageDown: current + 1,
      Home: 0,
      End: slides.length - 1,
    };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    show(targets[event.key], { updateUrl: true, focusHeading: true });
  });

  stage.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || event.target.closest("a, button, input, select, .chart-surface")) {
      swipeStart = undefined;
      return;
    }
    const { clientX, clientY } = event.touches[0];
    swipeStart = { x: clientX, y: clientY };
  }, { passive: true });
  stage.addEventListener("touchcancel", () => { swipeStart = undefined; }, { passive: true });
  stage.addEventListener("touchend", (event) => {
    if (!swipeStart) return;
    const { clientX, clientY } = event.changedTouches[0];
    const x = clientX - swipeStart.x;
    const y = clientY - swipeStart.y;
    swipeStart = undefined;
    if (Math.abs(x) >= 55 && Math.abs(x) > Math.abs(y) * 1.6) {
      show(current + (x > 0 ? -1 : 1), { updateUrl: true });
    }
  }, { passive: true });

  if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    fullscreen.hidden = false;
    const setFullscreenMessage = () => {
      const label = document.fullscreenElement ? fullscreen.dataset.exit : fullscreen.dataset.enter;
      fullscreen.title = label;
      fullscreen.setAttribute("aria-label", label);
      fullscreen.querySelector(".wide-label").textContent = label;
    };
    document.addEventListener("fullscreenchange", setFullscreenMessage);
    fullscreen.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        status.textContent = fullscreen.dataset.unavailable;
      }
    });
  }

  document.querySelectorAll("[data-share]").forEach((button) => {
    button.addEventListener("click", async () => {
      const url = new URL(window.location.href);
      url.hash = slides[current].id;
      if (navigator.share) {
        try {
          await navigator.share({ title: document.title, url: url.href });
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
      shareAddress.value = url.href;
      shareDialog.showModal();
      shareAddress.select();
    });
  });

  document.querySelector("#copy-link").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(shareAddress.value);
      document.querySelector("#copy-status").textContent = button.dataset.copied;
    } catch {
      shareAddress.focus();
      shareAddress.select();
      document.querySelector("#copy-status").textContent = button.dataset.manual;
    }
  });

  shareDialog.addEventListener("close", () => {
    document.querySelector("#copy-status").textContent = "";
  });

  document.documentElement.classList.add("enhanced");
  show(locationIndex());
})();
