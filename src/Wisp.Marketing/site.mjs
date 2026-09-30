import { latestInstaller, buildsUrl, releasesUrl } from "./release.mjs";

const link = document.getElementById("installer-link");
const message = document.getElementById("release-message");
const notes = document.getElementById("release-notes");
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 6000);
message.textContent = "Checking the latest published Windows release…";

try {
  const { state, installer } = await latestInstaller(fetch, controller.signal);
  if (installer) {
    link.href = installer.url;
    link.textContent = "Download for Windows";
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↓";
    link.append(arrow);
    notes.href = installer.notesUrl;
    message.textContent = `${installer.version} · Windows 64-bit${installer.size ? ` · ${installer.size} MB` : ""}. Download served by GitHub.`;
  } else if (state === "unavailable") {
    showUnavailable();
  } else {
    link.href = buildsUrl;
    message.textContent =
      "Public releases are being set up. Current builds are available through GitHub Actions and require GitHub sign-in.";
  }
} catch {
  showUnavailable();
} finally {
  clearTimeout(timeout);
}

function showUnavailable() {
  link.href = releasesUrl;
  link.textContent = "Check GitHub downloads ↗";
  message.textContent =
    "Release information is unavailable right now. Check GitHub Releases for a published installer, or GitHub Actions for current builds.";
}
