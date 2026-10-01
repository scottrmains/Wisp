// Small progressive enhancement; the page and every poster work without JS.
// Each silent demo plays once on arrival, never loops, and keeps a real control.
export function enhanceMotion() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const connection = navigator.connection;
  const economical = () =>
    connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "");
  const demos = [...document.querySelectorAll("[data-demo]")].map((figure) => ({
    figure,
    video: figure.querySelector("video"),
    button: figure.querySelector(".demo-toggle"),
    label: figure
      .querySelector("video")
      .getAttribute("aria-label")
      .split(" demonstration:")[0],
    arrived: false,
    seen: false,
    failed: false,
  }));
  const update = (demo) => {
    const { video, button } = demo;
    const verb = demo.failed
      ? "Retry"
      : !video.paused
        ? "Pause"
        : video.ended
          ? "Replay"
          : video.currentTime > 0
            ? "Resume"
            : "Play";
    button.textContent = `${!video.paused ? "Ⅱ" : "▶"} ${verb} demo`;
    button.setAttribute("aria-label", `${verb} ${demo.label} demonstration`);
    demo.notice.hidden = !demo.failed;
  };
  const pause = (demo) => {
    demo.video.pause();
    update(demo);
  };
  const play = async (demo) => {
    for (const other of demos) if (other !== demo) pause(other);
    demo.seen = true;
    demo.failed = false;
    if (!demo.video.getAttribute("src") || demo.video.error) {
      demo.video.src = demo.video.dataset.src;
      demo.video.load();
    }
    if (demo.video.ended) demo.video.currentTime = 0;
    try {
      await demo.video.play();
    } catch (error) {
      // Scrolling/preference changes may cancel play before media has loaded.
      if (error.name !== "AbortError" && error.name !== "NotAllowedError") {
        demo.failed = true;
        demo.video.removeAttribute("data-ready");
        demo.figure.dataset.demoStatus = "unavailable";
      }
    }
    update(demo);
  };
  for (const demo of demos) {
    demo.notice = document.createElement("span");
    demo.notice.className = "demo-feedback";
    demo.notice.hidden = true;
    demo.notice.setAttribute("aria-live", "polite");
    demo.notice.textContent = "Screenshot shown. Demo unavailable—try again.";
    demo.figure.querySelector("figcaption").append(demo.notice);
    demo.button.hidden = false;
    demo.video.setAttribute("aria-hidden", "true");
    demo.video.tabIndex = -1;
    demo.button.addEventListener("click", () =>
      demo.video.paused ? void play(demo) : pause(demo),
    );
    demo.video.addEventListener("playing", () => {
      demo.video.dataset.ready = "";
      delete demo.figure.dataset.demoStatus;
      update(demo);
    });
    for (const event of ["pause", "ended"])
      demo.video.addEventListener(event, () => update(demo));
    demo.video.addEventListener("error", () => {
      demo.failed = true;
      demo.video.removeAttribute("data-ready");
      demo.figure.dataset.demoStatus = "unavailable";
      update(demo);
    });
  }
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const demo = demos.find((item) => item.figure === entry.target);
          demo.arrived =
            entry.isIntersecting && entry.intersectionRatio >= 0.45;
          if (!demo.arrived) pause(demo);
          else if (
            !demo.seen &&
            !reduced.matches &&
            !economical() &&
            !document.hidden
          )
            void play(demo);
        }
      },
      { threshold: [0, 0.45] },
    );
    for (const demo of demos) observer.observe(demo.figure);
    const reveals = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            if (!reduced.matches) entry.target.classList.add("reveal-arrived");
            reveals.unobserve(entry.target);
          }
      },
      { threshold: 0.12 },
    );
    for (const element of document.querySelectorAll("[data-reveal]"))
      reveals.observe(element);
  }
  const stop = () => {
    for (const demo of demos) pause(demo);
  };
  connection?.addEventListener?.("change", () => {
    if (economical()) stop();
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches) {
      stop();
      for (const demo of demos) demo.video.removeAttribute("data-ready");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  window.addEventListener("pagehide", stop);
  // Anchored compatibility links open the real disclosure, also on initial load.
  const disclose = () => {
    if (location.hash === "#compatibility")
      document.getElementById("compatibility").open = true;
  };
  window.addEventListener("hashchange", disclose);
  disclose();
}
