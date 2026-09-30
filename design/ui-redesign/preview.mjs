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
  $("prepare-toggle").setAttribute("aria-expanded", show);
  if (show) setPlan(false);
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
}
function time(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
$("position").addEventListener("input", () => {
  $("position-label").textContent = time(Number($("position").value));
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
$("prep-wave").innerHTML = wave(280, 64);
$("mini-wave").innerHTML = wave(600, 27, true);
let cueCount = 2;
function addCue(seconds, label) {
  const row = document.createElement("div");
  row.className = "cue-row";
  const button = document.createElement("button");
  button.className = "cue-time";
  button.textContent = time(seconds);
  button.dataset.tip = `Seek demo playhead to ${time(seconds)}`;
  button.addEventListener("click", () => {
    $("position").value = seconds;
    $("position-label").textContent = time(seconds);
  });
  const name = document.createElement("span");
  name.textContent = label;
  const check = document.createElement("i");
  check.innerHTML = icon("Check");
  row.append(button, name, check);
  $("memory-cues").append(row);
}
addCue(30, "Intro");
addCue(280, "Mix out");
$("add-cue").addEventListener("click", () => {
  if (cueCount >= 10) {
    notice(
      "The illustrated Memory Cue bank is full. No real cues were changed.",
    );
    return;
  }
  addCue(Number($("position").value), "New demo cue");
  cueCount++;
  $("cue-count").textContent = `${cueCount} / 10`;
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
