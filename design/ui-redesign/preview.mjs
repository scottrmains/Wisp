// Fictional interaction model only. No WISP API, native bridge, storage or audio.
const icons = await fetch("/icons.json").then((response) => {
  if (!response.ok) throw new Error("Preview icons unavailable");
  return response.json();
});
const $ = (id) => document.getElementById(id);
const icon = (name) => icons[name] ?? "";
const tracks = [
  ["Sunday Club", "Moving Through", 124, "8A", "Deep House", "5:30"],
  ["Nina Vale", "Back To You (Dub)", 125, "9A", "Deep House", "6:12"],
  ["Side Room", "After Hours", 126, "9A", "Deep House", "5:48"],
  ["The North Line", "Let It Breathe", 126, "10A", "Deep House", "5:56"],
  ["Lena Grey", "Half Past Midnight", 127, "10A", "House", "6:04"],
  ["Soft Signal", "Deep End", 128, "11A", "House", "5:32"],
  ["The Late Shift", "Something Good", 128, "11A", "House", "6:10"],
  ["Common Ground", "On & On", 129, "12A", "House", "5:44"],
  ["Blue Avenue", "Feeling This", 130, "12A", "UK Garage", "5:21"],
  ["The Loop Theory", "Stay A Little Longer", 130, "1A", "UK Garage", "6:24"],
  ["Room Two", "If You Know", 131, "1A", "UK Garage", "5:12"],
  ["Local Motion", "Open Late", 131, "2A", "UK Garage", "5:42"],
  ["Violet Hours", "The Way It Was", 132, "2A", "UK Garage", "6:02"],
  ["New Perspective", "Soft Landing", 132, "3A", "UK Garage", "5:32"],
  [
    "Paper Lanterns",
    "Another Kind Of Morning (After The Rain Extended Mix)",
    133,
    "3A",
    "Garage",
    "7:18",
  ],
  ["Harbour Lights", "Slow Release", 134, "4A", "Garage", "5:46"],
  ["Second Nature", "Hold The Moment", 134, "4A", "Garage", "6:00"],
  ["Sunday Club", "A Place To Start", 135, "5A", "Garage", "5:38"],
].map((values, id) => ({
  id,
  artist: values[0],
  title: values[1],
  bpm: values[2],
  key: values[3],
  genre: values[4],
  length: values[5],
}));
const playlists = [
  { name: "Sunday warm-up", ids: tracks.slice(0, 10).map((t) => t.id) },
  { name: "Late night grooves", ids: tracks.slice(8).map((t) => t.id) },
  { name: "New finds", ids: tracks.slice(0, 6).map((t) => t.id) },
  { name: "Vinyl favourites", ids: [2, 6, 8, 14] },
  { name: "Sunday afternoons — warm-up selections", ids: [0, 3, 4, 7] },
];
let selected = new Set();
let currentTrack = tracks[0];
let activePlaylist = null;
let compactOverride = null;
let noticeTimer;
let lastDialogTrigger;
let preferredPrepHeight = 236; // Retained only for this preview session.
let waveStart = 130;
const demoCues = new Map(
  tracks.map((t) => [
    t.id,
    [
      { seconds: 30, label: "Intro" },
      { seconds: duration(t) - 50, label: "Mix out" },
    ],
  ]),
);
function duration(t = currentTrack) {
  const [minutes, seconds] = t.length.split(":").map(Number);
  return minutes * 60 + seconds;
}

function fillIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}
function notice(message) {
  const openDialog = document.querySelector("dialog[open]");
  (openDialog ?? document.body).append($("notice"));
  $("notice").textContent = message;
  $("notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("notice").hidden = true;
  }, 4500);
}
function openDialog(id, trigger) {
  lastDialogTrigger = trigger;
  hideTooltip();
  $(id).showModal();
}
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("close", () => lastDialogTrigger?.focus());
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const targets = [
      ...dialog.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]",
      ),
    ].filter((node) => node.getBoundingClientRect().width > 0);
    const destination =
      event.shiftKey && document.activeElement === targets[0]
        ? targets.at(-1)
        : !event.shiftKey && document.activeElement === targets.at(-1)
          ? targets[0]
          : null;
    if (destination) {
      event.preventDefault();
      destination.focus();
    }
  });
});
document
  .querySelectorAll(".dialog-close")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
document
  .querySelectorAll(".settings-open")
  .forEach((button) =>
    button.addEventListener("click", () => openDialog("settings", button)),
  );

function renderPlaylists(container, query = "") {
  container.replaceChildren();
  const matches = playlists.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );
  for (const p of matches) {
    const row = document.createElement("div");
    row.className = `playlist${p === activePlaylist ? " active" : ""}`;
    const button = document.createElement("button");
    button.dataset.tip = p.name;
    button.setAttribute("aria-label", `${p.name}, ${p.ids.length} tracks`);
    if (p === activePlaylist) button.setAttribute("aria-current", "page");
    const name = document.createElement("span");
    name.textContent = p.name;
    const count = document.createElement("small");
    count.textContent = p.ids.length;
    button.append(name, count);
    button.addEventListener("click", () => {
      setPlaylist(p);
      $("playlist-drawer").close();
    });
    const more = document.createElement("button");
    more.className = "icon-button";
    more.setAttribute("aria-label", `Actions for ${p.name}`);
    more.dataset.tip = "Playlist actions — illustrated only";
    more.innerHTML = icon("MoreHorizontal");
    more.addEventListener("click", () =>
      notice(
        "Rename, duplicate and delete will use a keyboard-accessible menu in WISP. This preview cannot change playlists.",
      ),
    );
    row.append(button, more);
    container.append(row);
  }
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "helper";
    empty.textContent = "No matching demo playlists.";
    container.append(empty);
  }
}
function setPlaylist(p) {
  activePlaylist = p;
  selected.clear();
  $("library-heading").textContent = p?.name ?? "Library";
  $("collection-caption").textContent = p ? "PLAYLIST" : "YOUR COLLECTION";
  $("breadcrumb").textContent = p ? "Playlists" : "Library";
  $("collection-summary").textContent = p
    ? `${p.ids.length} tracks · Your saved play order`
    : "18 tracks · Ready for your next set";
  $("all-tracks").hidden = !p;
  $("usb").hidden = !p;
  renderPlaylists($("playlist-list"), $("playlist-search").value);
  renderPlaylists($("drawer-playlists"), $("drawer-search").value);
  renderTracks();
}
$("all-tracks").addEventListener("click", () => setPlaylist(null));
$("playlist-search-toggle").addEventListener("click", () => {
  const field = document.querySelector(".playlist-search");
  field.hidden = !field.hidden;
  $("playlist-search-toggle").setAttribute("aria-expanded", !field.hidden);
  if (!field.hidden) $("playlist-search").focus();
});
$("playlist-search").addEventListener("input", () =>
  renderPlaylists($("playlist-list"), $("playlist-search").value),
);
$("drawer-search").addEventListener("input", () =>
  renderPlaylists($("drawer-playlists"), $("drawer-search").value),
);
$("compact-playlists").addEventListener("click", (event) =>
  openDialog("playlist-drawer", event.currentTarget),
);
document.querySelectorAll("[data-page]").forEach((button) => {
  button.setAttribute("aria-label", button.dataset.page);
  button.addEventListener("click", () => {
    if (button.dataset.page === "Library") setPlaylist(null);
    else
      notice(
        `${button.dataset.page} is shown for navigation placement. This approval preview only contains the Library workspace.`,
      );
  });
});

function setCompact() {
  const compact =
    compactOverride ?? window.matchMedia("(max-width: 1100px)").matches;
  document.querySelector(".shell").classList.toggle("compact", compact);
  $("collapse").innerHTML = icon(compact ? "PanelLeftOpen" : "PanelLeftClose");
  $("collapse").setAttribute(
    "aria-label",
    compact ? "Expand navigation" : "Collapse navigation",
  );
  $("collapse").dataset.tip = compact
    ? "Expand navigation"
    : "Collapse navigation";
}
$("collapse").addEventListener("click", () => {
  compactOverride = !document
    .querySelector(".shell")
    .classList.contains("compact");
  setCompact();
});
window.matchMedia("(max-width: 1100px)").addEventListener("change", () => {
  compactOverride = null;
  setCompact();
});

function visibleTracks() {
  const query = $("track-search").value.toLowerCase();
  const filtered = tracks.filter(
    (t) =>
      (!activePlaylist || activePlaylist.ids.includes(t.id)) &&
      `${t.artist} ${t.title}`.toLowerCase().includes(query),
  );
  if ($("sort").value === "artist")
    filtered.sort((a, b) => a.artist.localeCompare(b.artist));
  if ($("sort").value === "bpm") filtered.sort((a, b) => a.bpm - b.bpm);
  return filtered;
}
function renderTracks() {
  const focusLabel = document.activeElement.closest?.("#track-rows")
    ? document.activeElement.getAttribute("aria-label")
    : null;
  const rows = $("track-rows");
  rows.replaceChildren();
  const visible = visibleTracks();
  for (const [index, t] of visible.entries()) {
    const row = document.createElement("tr");
    row.className = `${selected.has(t.id) ? "selected " : ""}${currentTrack.id === t.id ? "active" : ""}`;
    row.dataset.id = t.id;
    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(t.id);
    checkbox.setAttribute("aria-label", `Select ${t.artist} — ${t.title}`);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? selected.add(t.id) : selected.delete(t.id);
      renderTracks();
    });
    checkCell.append(checkbox);
    row.append(checkCell);
    for (const [column, value] of [
      [null, index + 1],
      [null, t.artist],
      [null, t.title],
      [null, t.bpm],
      ["key", t.key],
      ["genre-cell", t.genre],
      [null, t.length],
      ["date-cell", "26 Sep 2026"],
    ]) {
      const cell = document.createElement("td");
      if (column === "key") {
        const key = document.createElement("span");
        key.className = `key${t.bpm > 126 ? " key-b" : ""}`;
        key.textContent = value;
        cell.append(key);
      } else if (value === t.title && !column) {
        const title = document.createElement("button");
        title.className = "track-title";
        title.textContent = value;
        title.setAttribute("aria-label", `Prepare ${t.artist} — ${t.title}`);
        title.dataset.tip = t.title;
        title.addEventListener("click", () => {
          currentTrack = t;
          updateTrack();
          setInspector(true);
          renderTracks();
        });
        cell.append(title);
      } else {
        cell.textContent = value;
        if (column) cell.className = column;
      }
      if (column === "date-cell") cell.hidden = !$("show-dates").checked;
      if (column === "genre-cell") cell.hidden = !$("show-genre").checked;
      row.append(cell);
    }
    row.addEventListener("click", (event) => {
      if (event.target.closest("input, button")) return;
      if (event.ctrlKey || event.metaKey) {
        selected.has(t.id) ? selected.delete(t.id) : selected.add(t.id);
        renderTracks();
      } else {
        selected = new Set([t.id]);
        renderTracks();
      }
    });
    row.addEventListener("dblclick", () => {
      currentTrack = t;
      updateTrack();
      setInspector(true);
      renderTracks();
    });
    rows.append(row);
  }
  $("select-all").checked =
    !!visible.length && visible.every((t) => selected.has(t.id));
  $("select-all").indeterminate =
    visible.some((t) => selected.has(t.id)) && !$("select-all").checked;
  $("selection-tools").hidden = selected.size === 0;
  $("browse-tools").hidden = selected.size > 0;
  $("selection-count").textContent = `${selected.size} selected`;
  $("visible-count").textContent =
    `${visible.length} tracks${selected.size ? ` · ${selected.size} selected` : ""}`;
  $("empty-search").hidden = visible.length > 0;
  if (focusLabel)
    [...rows.querySelectorAll("[aria-label]")]
      .find((node) => node.getAttribute("aria-label") === focusLabel)
      ?.focus();
}
$("select-all").addEventListener("change", (event) => {
  for (const t of visibleTracks())
    event.target.checked ? selected.add(t.id) : selected.delete(t.id);
  renderTracks();
});
$("clear-selection").addEventListener("click", () => {
  selected.clear();
  renderTracks();
});
$("track-search").addEventListener("input", renderTracks);
$("sort").addEventListener("change", renderTracks);
for (const [button, panel] of [
  ["filters-toggle", "filters"],
  ["columns-toggle", "columns"],
]) {
  $(button).addEventListener("click", () => {
    $(panel).hidden = !$(panel).hidden;
    $(button).setAttribute("aria-expanded", !$(panel).hidden);
  });
}
for (const id of ["show-dates", "show-genre"])
  $(id).addEventListener("change", () => {
    document.querySelector(".date-col").style.display = $("show-dates").checked
      ? "table-column"
      : "none";
    document.querySelector(".genre-col").style.display = $("show-genre").checked
      ? "table-column"
      : "none";
    document.querySelector("th.date-cell").hidden = !$("show-dates").checked;
    document.querySelector("th.genre-cell").hidden = !$("show-genre").checked;
    renderTracks();
  });

function setInspector(show) {
  $("inspector").hidden = !show;
  $("preparation-dock").hidden = !show;
  document.querySelector(".library-body").classList.toggle("preparing", show);
  $("prepare-toggle").setAttribute("aria-expanded", show);
  $("player-prep").setAttribute("aria-expanded", show);
  if (show) {
    setPlan(false);
    resizePrep(preferredPrepHeight);
    renderPrecisionWave();
  }
}
function setPlan(show) {
  $("plan").hidden = !show;
  $("plan-toggle").setAttribute("aria-expanded", show);
  if (show) setInspector(false);
}
$("prepare-toggle").addEventListener("click", () =>
  setInspector($("inspector").hidden),
);
$("player-prep").addEventListener("click", () =>
  setInspector($("inspector").hidden),
);
$("close-inspector").addEventListener("click", () => {
  setInspector(false);
  $("prepare-toggle").focus();
});
$("focus-list").addEventListener("click", () => {
  setInspector(false);
  $("library-heading").focus();
});
$("plan-toggle").addEventListener("click", () => setPlan($("plan").hidden));
$("close-plan").addEventListener("click", () => {
  setPlan(false);
  $("plan-toggle").focus();
});
function updateTrack() {
  for (const id of ["player-title", "inspector-title"])
    $(id).textContent = currentTrack.title;
  for (const id of ["player-artist", "inspector-artist"])
    $(id).textContent = currentTrack.artist;
  $("inspector-bpm").textContent = `${currentTrack.bpm} BPM`;
  $("inspector-key").textContent = currentTrack.key;
  $("inspector-duration").textContent = currentTrack.length;
  $("player-duration").textContent = currentTrack.length;
  $("position").max = duration();
  $("wave-zoom").options[0].value = duration();
  renderCues();
  setPosition(30, true);
}
function time(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
$("position").addEventListener("input", () => {
  setPosition(Number($("position").value));
});
$("play").addEventListener("click", () => {
  const playing = $("play").getAttribute("aria-pressed") === "true";
  $("play").setAttribute("aria-pressed", !playing);
  $("play").setAttribute(
    "aria-label",
    playing ? "Play demo presentation" : "Pause demo presentation",
  );
  $("play").innerHTML = icon(playing ? "Play" : "Pause");
  notice(
    "Playback controls demonstrate appearance only. This preview does not play audio.",
  );
});
for (const [id, step] of [
  ["previous", -1],
  ["next", 1],
])
  $(id).addEventListener("click", () => {
    currentTrack =
      tracks[(currentTrack.id + step + tracks.length) % tracks.length];
    updateTrack();
    renderTracks();
  });
function wave(width, height, muted = false) {
  const lines = Array.from({ length: 120 }, (_, i) => {
    const envelope =
      0.2 +
      0.55 * Math.abs(Math.sin(i * 0.105)) +
      0.15 * Math.abs(Math.sin(i * 0.37));
    const amplitude = height * envelope * 0.43;
    return `<path d="M ${(i * width) / 120} ${height / 2 - amplitude} v ${amplitude * 2}"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="${muted ? "#a18cac" : "#b493d4"}" stroke-width="2">${lines}</g></svg>`;
}
$("mini-wave").innerHTML = wave(600, 27, true);
function preciseTime(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  return `${time(Math.floor(milliseconds / 1000))}.${String(milliseconds % 1000).padStart(3, "0")}`;
}
function setPosition(seconds, centre = false) {
  const position = Math.max(
    0,
    Math.min(duration(), Math.round(seconds * 100) / 100),
  );
  $("position").value = position;
  $("position-label").textContent = time(position);
  $("precise-position").textContent = preciseTime(position);
  const span = Number($("wave-zoom").value);
  if (centre || position < waveStart || position > waveStart + span)
    waveStart = Math.max(0, Math.min(duration() - span, position - span / 2));
  renderPrecisionWave();
}
function renderPrecisionWave() {
  const span = Number($("wave-zoom").value);
  waveStart = Math.max(0, Math.min(duration() - span, waveStart));
  const position = Number($("position").value);
  const xAt = (seconds) => ((seconds - waveStart) / span) * 1000;
  const lines = Array.from({ length: 700 }, (_, i) => {
    const seconds = waveStart + (i / 700) * span;
    const envelope =
      0.25 +
      0.48 * Math.abs(Math.sin(seconds * 0.37)) +
      0.15 * Math.abs(Math.sin(seconds * 3.17));
    const amplitude =
      48 * envelope * (0.4 + 0.6 * Math.abs(Math.sin(seconds * 57.1)));
    return `<path d="M ${(i / 700) * 1000} ${50 - amplitude} v ${amplitude * 2}"/>`;
  }).join("");
  const marks = demoCues
    .get(currentTrack.id)
    .filter(
      (cue) => cue.seconds >= waveStart && cue.seconds <= waveStart + span,
    )
    .map(
      (cue, i) =>
        `<line x1="${xAt(cue.seconds)}" x2="${xAt(cue.seconds)}" y1="0" y2="100" stroke="#abd4b7" stroke-width="2"/><text class="wave-cue-label" x="${Math.min(940, xAt(cue.seconds) + 6)}" y="${14 + (i % 3) * 16}">M${demoCues.get(currentTrack.id).indexOf(cue) + 1}</text>`,
    )
    .join("");
  $("prep-wave").innerHTML =
    `<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path d="M 0 50 H 1000" stroke="#3c3743"/><g fill="none" stroke="#b493d4" stroke-width="1.2">${lines}</g>${marks}<line x1="${xAt(position)}" x2="${xAt(position)}" y1="0" y2="100" stroke="#f3f0e7" stroke-width="2"/></svg>`;
  $("prep-wave").setAttribute("aria-valuemax", duration());
  $("prep-wave").setAttribute("aria-valuenow", position);
  $("prep-wave").setAttribute("aria-valuetext", preciseTime(position));
  $("wave-ruler").replaceChildren(
    ...Array.from({ length: 5 }, (_, i) => {
      const label = document.createElement("span");
      label.textContent = preciseTime(waveStart + (span * i) / 4);
      return label;
    }),
  );
}
$("wave-zoom").addEventListener("change", () =>
  setPosition(Number($("position").value), true),
);
$("centre-wave").addEventListener("click", () =>
  setPosition(Number($("position").value), true),
);
for (const [id, delta] of [
  ["nudge-back", -0.01],
  ["nudge-forward", 0.01],
])
  $(id).addEventListener("click", () =>
    setPosition(Number($("position").value) + delta),
  );
$("prep-wave").addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const bounds = $("prep-wave").getBoundingClientRect();
  setPosition(
    waveStart +
      Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) *
        Number($("wave-zoom").value),
  );
  $("prep-wave").focus();
});
$("prep-wave").addEventListener("keydown", (event) => {
  const steps = {
    ArrowLeft: -0.01,
    ArrowRight: 0.01,
    ArrowDown: -1,
    ArrowUp: 1,
  };
  if (!(event.key in steps) && !["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  setPosition(
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? duration()
        : Number($("position").value) + steps[event.key],
  );
});
function prepMaximum() {
  return Math.max(
    210,
    Math.min(360, document.querySelector(".library-body").clientHeight - 320),
  );
}
function resizePrep(height, remember = false) {
  const clamped = Math.max(210, Math.min(prepMaximum(), height));
  $("preparation-dock").style.setProperty("--prep-height", `${clamped}px`);
  $("prep-resize").setAttribute("aria-valuenow", clamped);
  $("prep-resize").setAttribute("aria-valuemax", prepMaximum());
  if (remember) preferredPrepHeight = clamped;
}
let resizeDrag;
$("prep-resize").addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  resizeDrag = {
    y: event.clientY,
    height: $("preparation-dock").getBoundingClientRect().height,
  };
  $("prep-resize").setPointerCapture(event.pointerId);
});
$("prep-resize").addEventListener("pointermove", (event) => {
  if (resizeDrag)
    resizePrep(resizeDrag.height + event.clientY - resizeDrag.y, true);
});
for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
  $("prep-resize").addEventListener(event, () => {
    resizeDrag = null;
  });
$("prep-resize").addEventListener("dblclick", () => resizePrep(236, true));
$("prep-resize").addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const height = Number($("prep-resize").getAttribute("aria-valuenow"));
  resizePrep(
    event.key === "Home"
      ? 210
      : event.key === "End"
        ? prepMaximum()
        : height + (event.key === "ArrowUp" ? -16 : 16),
    true,
  );
});
window.addEventListener("resize", () => {
  if (!$("inspector").hidden) resizePrep(preferredPrepHeight);
});
function addCueRow(seconds, label) {
  const row = document.createElement("div");
  row.className = "cue-row";
  const button = document.createElement("button");
  button.className = "cue-time";
  button.textContent = preciseTime(seconds);
  button.dataset.tip = `Seek demo playhead to ${time(seconds)}`;
  button.addEventListener("click", () => {
    setPosition(seconds, true);
  });
  const name = document.createElement("span");
  name.textContent = label;
  const check = document.createElement("i");
  check.innerHTML = icon("Check");
  row.append(button, name, check);
  $("memory-cues").append(row);
}
function renderCues() {
  $("memory-cues").replaceChildren();
  const cues = demoCues.get(currentTrack.id);
  for (const cue of cues) addCueRow(cue.seconds, cue.label);
  $("cue-count").textContent = `${cues.length} / 10`;
}
renderCues();
setPosition(30, true);
$("add-cue").addEventListener("click", () => {
  const cues = demoCues.get(currentTrack.id);
  if (cues.length >= 10) {
    notice(
      "The illustrated Memory Cue bank is full. No real cues were changed.",
    );
    return;
  }
  const seconds = Number($("position").value);
  if (cues.some((cue) => cue.seconds === seconds)) {
    notice(
      "A demo Memory Cue already exists here. Move the playhead to another position.",
    );
    return;
  }
  cues.push({ seconds, label: "New demo cue" });
  cues.sort((a, b) => a.seconds - b.seconds);
  renderCues();
  renderPrecisionWave();
  notice(
    "Added an illustrative Memory Cue in this preview only. No audio metadata or USB was written.",
  );
});
document.querySelectorAll("[data-prep-tab]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-prep-tab]")
      .forEach((tab) => tab.setAttribute("aria-pressed", tab === button));
    for (const [name, id] of [
      ["cues", "cue-panel"],
      ["notes", "notes-panel"],
      ["details", "details-panel"],
    ])
      $(id).hidden = name !== button.dataset.prepTab;
  }),
);
tracks.slice(0, 5).forEach((t, index) => {
  const row = document.createElement("li");
  row.innerHTML = `<span class="plan-number">${String(index + 1).padStart(2, "0")}</span><div><strong>${t.title}</strong><small>${t.artist} · ${t.bpm} BPM · ${t.key}</small>${index === 0 ? "<p>Let the intro breathe.</p>" : index === 2 ? "<p>Swap bass on the phrase.</p>" : ""}</div>`;
  $("plan-tracks").append(row);
});
document.querySelectorAll("[data-state]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-state]")
      .forEach((b) => b.setAttribute("aria-pressed", b === button));
    selected.clear();
    $("track-search").value = "";
    setPlaylist(null);
    $("filters").hidden = true;
    $("columns").hidden = true;
    setInspector(button.dataset.state === "prepare");
    setPlan(button.dataset.state === "selected");
    if (button.dataset.state === "selected") selected = new Set([0, 1, 2]);
    renderTracks();
  }),
);
$("transfers-toggle").addEventListener("click", () => {
  $("transfers").hidden = !$("transfers").hidden;
  $("transfers-toggle").setAttribute("aria-expanded", !$("transfers").hidden);
});
document.addEventListener("click", (event) => {
  if (event.target.closest(".demo"))
    notice(
      "Visual proposal only. This action is not connected to WISP, your files or any external service.",
    );
  if (!event.target.closest("#transfers, #transfers-toggle")) {
    $("transfers").hidden = true;
    $("transfers-toggle").setAttribute("aria-expanded", false);
  }
});

// One restrained tooltip surface, accessible on hover/focus and Escape-dismissable.
let tooltipTimer;
let tooltipTarget;
let previousDescription;
function hideTooltip() {
  clearTimeout(tooltipTimer);
  $("tooltip").hidden = true;
  if (tooltipTarget) {
    if (previousDescription)
      tooltipTarget.setAttribute("aria-describedby", previousDescription);
    else tooltipTarget.removeAttribute("aria-describedby");
  }
  tooltipTarget = null;
}
function showTooltip(target) {
  hideTooltip();
  tooltipTarget = target;
  previousDescription = target.getAttribute("aria-describedby");
  tooltipTimer = setTimeout(() => {
    if (!target.isConnected) return hideTooltip();
    $("tooltip").textContent = target.dataset.tip;
    $("tooltip").hidden = false;
    target.setAttribute(
      "aria-describedby",
      [previousDescription, "tooltip"].filter(Boolean).join(" "),
    );
    const bounds = target.getBoundingClientRect();
    const box = $("tooltip").getBoundingClientRect();
    $("tooltip").style.left =
      `${Math.max(8, Math.min(bounds.left, innerWidth - box.width - 8))}px`;
    $("tooltip").style.top =
      `${bounds.bottom + box.height + 8 > innerHeight ? Math.max(8, bounds.top - box.height - 6) : bounds.bottom + 6}px`;
  }, 350);
}
document.addEventListener("pointerover", (event) => {
  const target = event.target.closest("[data-tip]");
  if (target && target !== tooltipTarget) showTooltip(target);
});
document.addEventListener("pointerout", (event) => {
  if (
    event.relatedTarget?.closest?.("#tooltip") ||
    event.relatedTarget?.closest?.("[data-tip]") === tooltipTarget
  )
    return;
  if (event.target.closest("[data-tip]")) hideTooltip();
});
$("tooltip").addEventListener("pointerleave", hideTooltip);
document.addEventListener("focusin", (event) => {
  const target = event.target.closest("[data-tip]");
  if (target) showTooltip(target);
});
document.addEventListener("focusout", hideTooltip);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideTooltip();
    $("transfers").hidden = true;
    $("transfers-toggle").setAttribute("aria-expanded", false);
  }
});
window.addEventListener("resize", hideTooltip);
fillIcons();
setCompact();
renderPlaylists($("playlist-list"));
renderPlaylists($("drawer-playlists"));
renderTracks();
