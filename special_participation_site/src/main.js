const DATA_URL = "public/data/posts_processed.json";

const state = {
  allPosts: [],
  filtered: [],
};

const els = {};

function cacheElements() {
  els.filterHomework = document.getElementById("filter-homework");
  els.filterModel = document.getElementById("filter-model");
  els.filterFocus = document.getElementById("filter-focus");
  els.filterActionability = document.getElementById("filter-actionability");
  els.searchText = document.getElementById("search-text");
  els.sortOrder = document.getElementById("sort-order");
  els.postsList = document.getElementById("posts-list");
  els.summaryBar = document.getElementById("summary-bar");
  els.errorMessage = document.getElementById("error-message");
}

async function loadData() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed to load ${DATA_URL} (status ${res.status}). Did you run process_data.py?`,
    );
  }
  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error("Expected an array of posts in posts_processed.json");
  }
  return json;
}

function populateSelect(selectEl, label, values) {
  const opts = [
    `<option value="">All ${label}</option>`,
    ...values.map((v) => `<option value="${encodeURIComponent(v)}">${escapeHtml(v)}</option>`),
  ];
  selectEl.innerHTML = opts.join("");
}

function buildFilters(posts) {
  const homeworks = new Set();
  const models = new Set();
  const focuses = new Set();
  const actionability = new Set();

  for (const post of posts) {
    const m = post.metrics || {};
    if (m.homework_id) homeworks.add(m.homework_id);
    if (m.model_name) models.add(m.model_name);
    if (m.primary_focus) focuses.add(m.primary_focus);
    if (m.actionability_bucket) actionability.add(m.actionability_bucket);
  }

  const sortAlpha = (a, b) => a.localeCompare(b);

  populateSelect(els.filterHomework, "homeworks", Array.from(homeworks).sort(sortAlpha));
  populateSelect(els.filterModel, "models", Array.from(models).sort(sortAlpha));
  populateSelect(els.filterFocus, "focus types", Array.from(focuses).sort(sortAlpha));
  populateSelect(
    els.filterActionability,
    "actionability levels",
    Array.from(actionability).sort(sortAlpha),
  );
}

function attachEvents() {
  const onChange = () => applyFiltersAndRender();
  [
    els.filterHomework,
    els.filterModel,
    els.filterFocus,
    els.filterActionability,
    els.sortOrder,
  ].forEach((el) => el && el.addEventListener("change", onChange));

  if (els.searchText) {
    els.searchText.addEventListener("input", () => applyFiltersAndRender());
  }
}

function applyFiltersAndRender() {
  const homeworkVal = decodeURIComponent(els.filterHomework.value || "");
  const modelVal = decodeURIComponent(els.filterModel.value || "");
  const focusVal = decodeURIComponent(els.filterFocus.value || "");
  const actionVal = decodeURIComponent(els.filterActionability.value || "");
  const search = (els.searchText.value || "").toLowerCase().trim();
  const sortOrder = els.sortOrder.value || "newest";

  let results = state.allPosts.filter((post) => {
    const m = post.metrics || {};

    if (homeworkVal && m.homework_id !== homeworkVal) return false;
    if (modelVal && m.model_name !== modelVal) return false;
    if (focusVal && m.primary_focus !== focusVal) return false;
    if (actionVal && m.actionability_bucket !== actionVal) return false;

    if (search) {
      const haystack = `${post.title || ""}\n${post.document || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  results = sortResults(results, sortOrder);

  state.filtered = results;
  renderSummaryBar();
  renderPosts();
}

function parseDateSafe(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function depthScore(depth) {
  switch (depth) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function actionabilityScore(a) {
  switch (a) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function sortResults(list, order) {
  const arr = list.slice();

  if (order === "depth") {
    arr.sort((a, b) => {
      const da = depthScore(a.metrics?.depth_bucket);
      const db = depthScore(b.metrics?.depth_bucket);
      return db - da;
    });
  } else if (order === "actionability") {
    arr.sort((a, b) => {
      const aa = actionabilityScore(a.metrics?.actionability_bucket);
      const ab = actionabilityScore(b.metrics?.actionability_bucket);
      return ab - aa;
    });
  } else if (order === "oldest") {
    arr.sort((a, b) => {
      const da = parseDateSafe(a.created_at);
      const db = parseDateSafe(b.created_at);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
  } else {
    // newest
    arr.sort((a, b) => {
      const da = parseDateSafe(a.created_at);
      const db = parseDateSafe(b.created_at);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db - da;
    });
  }

  return arr;
}

function renderSummaryBar() {
  const total = state.allPosts.length;
  const shown = state.filtered.length;
  if (!els.summaryBar) return;

  if (!total) {
    els.summaryBar.textContent = "No posts loaded yet.";
    return;
  }

  const hw = new Set();
  const models = new Set();

  for (const post of state.filtered) {
    const m = post.metrics || {};
    if (m.homework_id) hw.add(m.homework_id);
    if (m.model_name) models.add(m.model_name);
  }

  els.summaryBar.textContent = `Showing ${shown} of ${total} posts | Homeworks: ${hw.size} | Models: ${models.size}`;
}

function renderPosts() {
  if (!els.postsList) return;

  if (!state.filtered.length) {
    els.postsList.innerHTML = "<p class=\"muted\">No posts match the current filters.</p>";
    return;
  }

  const items = state.filtered.map((post) => postToHtml(post));
  els.postsList.innerHTML = items.join("\n");
}

function postToHtml(post) {
  const m = post.metrics || {};
  const hw = m.homework_id || "Unknown";
  const model = m.model_name || "Unknown";
  const focus = m.primary_focus || "mixed/other";
  const depth = m.depth_bucket || "n/a";
  const act = m.actionability_bucket || "n/a";
  const wc = typeof m.word_count === "number" ? m.word_count : null;

  const created = post.created_at ? new Date(post.created_at) : null;
  const createdStr = created && !Number.isNaN(created.getTime())
    ? created.toLocaleString()
    : "";

  const author = post.user?.name || "Unknown";
  const role = post.user?.course_role || "";

  const badges = [
    `<span class=\"badge badge-hw\">${escapeHtml(hw)}</span>`,
    `<span class=\"badge badge-model\">${escapeHtml(model)}</span>`,
    `<span class=\"badge badge-focus\">${escapeHtml(focus)}</span>`,
    `<span class=\"badge badge-depth depth-${escapeHtml(depth)}\">depth: ${escapeHtml(depth)}</span>`,
    `<span class=\"badge badge-action act-${escapeHtml(act)}\">actionability: ${escapeHtml(act)}</span>`,
  ];

  const stats = [];
  if (wc != null) stats.push(`${wc} words`);
  if (typeof post.view_count === "number") stats.push(`${post.view_count} views`);
  if (typeof post.reply_count === "number") stats.push(`${post.reply_count} replies`);

  const edLink = post.ed_url
    ? `<a href=\"${escapeAttribute(post.ed_url)}\" target=\"_blank\" rel=\"noopener noreferrer\">View on Ed</a>`
    : "";

  const title = escapeHtml(post.title || "Untitled post");
  const body = escapeHtml(post.document || "(no body text available)");

  return `
<article class="post-card">
  <header class="post-header">
    <div>
      <h3 class="post-title">${title}</h3>
      <p class="post-meta">
        <span>${createdStr}</span>
        <span>by ${escapeHtml(author)}${role ? ` (${escapeHtml(role)})` : ""}</span>
        ${edLink ? `<span>${edLink}</span>` : ""}
      </p>
    </div>
  </header>
  <div class="post-badges">${badges.join(" ")}</div>
  <p class="post-stats">${stats.map(escapeHtml).join("  b7 ")}</p>
  <details class="post-details">
    <summary>Show full write-up</summary>
    <pre class="post-body">${body}</pre>
  </details>
</article>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function showError(msg) {
  if (!els.errorMessage) return;
  els.errorMessage.hidden = false;
  els.errorMessage.textContent = msg;
}

async function init() {
  cacheElements();
  attachEvents();

  try {
    const posts = await loadData();
    state.allPosts = posts;
    buildFilters(posts);
    applyFiltersAndRender();
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  }
}

window.addEventListener("DOMContentLoaded", init);
