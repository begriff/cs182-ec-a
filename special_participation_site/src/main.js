const DATA_URL = "public/data/posts_processed.json";
const MANIFEST_URL = "files/manifest.json";
const THEME_KEY = "spa-theme-mode";

const state = {
  allPosts: [],
  filtered: [],
  filesManifest: {},
  currentModalPost: null,
  qaMessages: [],
  qaEngine: null,
  qaWebllm: null,
  qaGenerating: false,
};

const els = {};
let lastFocusedElement = null;

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
  els.filtersToggle = document.getElementById("filters-toggle");
  els.filtersPanel = document.getElementById("controls");
  els.themeMode = document.getElementById("theme-mode");
  els.themeButtons = document.querySelectorAll(".appearance-btn");
  els.postModalBackdrop = document.getElementById("post-modal-backdrop");
  els.postModal = document.getElementById("post-modal");
  els.postModalTitle = document.getElementById("post-modal-title");
  els.postModalMeta = document.getElementById("post-modal-meta");
  els.postModalBadges = document.getElementById("post-modal-badges");
  els.postModalBody = document.getElementById("post-modal-body");
  els.postModalClose = document.getElementById("post-modal-close");
  els.postModalFiles = document.getElementById("post-modal-files");
  els.qaForm = document.getElementById("qa-form");
  els.qaInput = document.getElementById("qa-input");
  els.qaSend = document.getElementById("qa-send");
  els.qaMessages = document.getElementById("qa-messages");
  els.qaStatus = document.getElementById("qa-status");
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

async function loadFilesManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`Files manifest not found at ${MANIFEST_URL}`);
      return {};
    }
    return await res.json();
  } catch (err) {
    console.warn("Could not load files manifest:", err);
    return {};
  }
}

function getFilesForPost(post) {
  const threadNum = String(post.number);
  const entry = state.filesManifest[threadNum];
  if (!entry || !entry.files || !entry.files.length) return null;
  return entry.files;
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

  const parseHwNumber = (s) => {
    const m = /^HW(\d+)$/i.exec(s);
    return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };

  const sortHomeworks = (a, b) => {
    const na = parseHwNumber(a);
    const nb = parseHwNumber(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  };

  populateSelect(
    els.filterHomework,
    "homeworks",
    Array.from(homeworks).sort(sortHomeworks),
  );
  populateSelect(els.filterModel, "models", Array.from(models).sort(sortAlpha));
  populateSelect(els.filterFocus, "focus types", Array.from(focuses).sort(sortAlpha));
  populateSelect(
    els.filterActionability,
    "actionability levels",
    Array.from(actionability).sort(sortAlpha),
  );
}

function applyThemePreference(mode) {
  document.body.classList.remove("theme-light", "theme-dark");

  if (mode === "light") {
    document.body.classList.add("theme-light");
  } else if (mode === "dark") {
    document.body.classList.add("theme-dark");
  }

  if (mode === "auto") {
    try {
      localStorage.removeItem(THEME_KEY);
    } catch (err) {
      // ignore
    }
  } else {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (err) {
      // ignore
    }
  }

  if (els.themeButtons && els.themeButtons.length) {
    els.themeButtons.forEach((btn) => {
      const btnMode = btn.dataset.mode || "auto";
      const isActive = btnMode === mode;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }
}

function initThemePreference() {
  let stored = "auto";
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "auto") {
      stored = v;
    }
  } catch (err) {
    stored = "auto";
  }

  applyThemePreference(stored);
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

  if (els.filtersToggle && els.filtersPanel) {
    els.filtersToggle.addEventListener("click", () => {
      const collapsed = document.body.classList.toggle("filters-collapsed");
      els.filtersToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      els.filtersToggle.textContent = collapsed ? "Show filters" : "Hide filters";
    });
  }

  if (els.themeButtons && els.themeButtons.length) {
    els.themeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode || "auto";
        applyThemePreference(mode);
      });
    });
  }

  setupViewSwitcher();

  if (els.postsList) {
    els.postsList.addEventListener("click", handlePostListClick);
  }

  if (els.postModalClose && els.postModalBackdrop) {
    els.postModalClose.addEventListener("click", () => closePostModal());
    els.postModalBackdrop.addEventListener("click", (event) => {
      if (event.target === els.postModalBackdrop) closePostModal();
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.postModalBackdrop && !els.postModalBackdrop.hidden) {
      closePostModal();
    }
  });

  // Listen for RAG source link clicks
  window.addEventListener("open-thread", (event) => {
    const { threadNum } = event.detail;
    const post = state.allPosts.find((p) => p.number === threadNum);
    if (post) {
      openPostModal(post);
    }
  });

  // Q&A form handler
  if (els.qaForm) {
    els.qaForm.addEventListener("submit", handleQaSubmit);
  }
}

function setupViewSwitcher() {
  const tabs = Array.from(document.querySelectorAll(".view-tab"));
  const sections = Array.from(document.querySelectorAll(".view-section"));
  if (!tabs.length || !sections.length) return;

  const setView = (view) => {
    sections.forEach((section) => {
      const isActive = section.dataset.view === view;
      section.hidden = !isActive;
      section.setAttribute("aria-hidden", isActive ? "false" : "true");
      section.classList.toggle("view-active", isActive);
    });

    tabs.forEach((tab) => {
      const isActive = tab.dataset.view === view;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      if (view) setView(view);
    });
  });

  setView("overview");
}

function handlePostListClick(event) {
  if (!els.postsList) return;
  const card = event.target.closest(".post-card");
  if (!card || !els.postsList.contains(card)) return;

  // Let explicit links behave normally.
  if (event.target.closest("a")) return;

  const indexAttr = card.getAttribute("data-index");
  const index = indexAttr ? Number(indexAttr) : NaN;
  if (Number.isNaN(index) || !state.filtered[index]) return;

  event.preventDefault();
  openPostModal(state.filtered[index]);
}

function buildFilesHtml(files) {
  if (!files || !files.length) return "";
  
  const fileLinks = files.map((f) => {
    const filename = escapeHtml(f.original_filename);
    const filePath = escapeAttribute(f.saved_as);
    const hasTxt = f.transcript;
    const txtPath = hasTxt ? escapeAttribute(f.transcript) : "";

    let links = `<a href="${filePath}" target="_blank" rel="noopener noreferrer" title="Download ${filename}">${filename}</a>`;
    if (hasTxt) {
      links += ` <a href="${txtPath}" target="_blank" rel="noopener noreferrer" class="file-transcript-link" title="View transcript">[txt]</a>`;
    }
    return `<span class="file-item">${links}</span>`;
  });
  return `<div class="post-files"><span class="files-label">📎 Files:</span> ${fileLinks.join(" ")}</div>`;
}

function openPostModal(post) {
  if (!els.postModalBackdrop || !els.postModalBody || !els.postModalTitle) return;

  lastFocusedElement = document.activeElement;
  state.currentModalPost = post;
  state.qaMessages = [];
  if (els.qaMessages) els.qaMessages.innerHTML = "";
  
  // Check for shared engine or existing engine
  const hasEngine = state.qaEngine || window.sharedLLMEngine;
  if (els.qaStatus) {
    if (hasEngine) {
      els.qaStatus.textContent = window.sharedLLMEngine ? "Ready (shared)" : "Ready";
      els.qaStatus.className = "qa-status ready";
    } else {
      els.qaStatus.textContent = "Load model in chat first, or ask a question";
      els.qaStatus.className = "qa-status";
    }
  }

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

  const meta = [];
  if (createdStr) meta.push(escapeHtml(createdStr));
  if (author) meta.push(`by ${escapeHtml(author)}${role ? ` (${escapeHtml(role)})` : ""}`);
  if (post.ed_url) {
    meta.push(
      `<a href="${escapeAttribute(post.ed_url)}" target="_blank" rel="noopener noreferrer">View on Ed</a>`,
    );
  }

  els.postModalTitle.textContent = post.title || "Untitled post";
  els.postModalMeta.innerHTML = meta.join(" · ");

  if (els.postModalBadges) {
    const badgesHtml = [
      `<span class="badge badge-hw">${escapeHtml(hw)}</span>`,
      `<span class="badge badge-model">${escapeHtml(model)}</span>`,
      `<span class="badge badge-focus">${escapeHtml(focus)}</span>`,
      `<span class="badge badge-depth depth-${escapeHtml(depth)}">depth: ${escapeHtml(depth)}</span>`,
      `<span class="badge badge-action act-${escapeHtml(act)}">actionability: ${escapeHtml(act)}</span>`,
    ].join(" ");
    els.postModalBadges.innerHTML = badgesHtml;
  }

  const stats = [];
  if (wc != null) stats.push(`${wc} words`);
  if (typeof post.view_count === "number") stats.push(`${post.view_count} views`);
  if (typeof post.reply_count === "number") stats.push(`${post.reply_count} replies`);

  if (stats.length && els.postModalMeta) {
    const statsHtml = escapeHtml(stats.join(" · "));
    els.postModalMeta.innerHTML = `${els.postModalMeta.innerHTML}${meta.length ? " · " : ""}${statsHtml}`;
  }

  // Add files to modal
  if (els.postModalFiles) {
    const files = getFilesForPost(post);
    els.postModalFiles.innerHTML = buildFilesHtml(files);
  }

  els.postModalBody.textContent = post.document || "(no body text available)";

  els.postModalBackdrop.hidden = false;
  document.body.classList.add("modal-open");

  if (els.postModalClose) {
    els.postModalClose.focus();
  }
}

function closePostModal() {
  if (!els.postModalBackdrop) return;
  els.postModalBackdrop.hidden = true;
  document.body.classList.remove("modal-open");

  // Clear Q&A state for this modal
  state.currentModalPost = null;
  state.qaMessages = [];
  if (els.qaMessages) els.qaMessages.innerHTML = "";
  if (els.qaStatus) els.qaStatus.textContent = "";

  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    try {
      lastFocusedElement.focus();
    } catch {
      // ignore
    }
  }
}

async function initQaEngine() {
  // Check if shared engine from chat widget is available
  if (window.sharedLLMEngine) {
    state.qaEngine = window.sharedLLMEngine;
    state.qaWebllm = window.sharedLLMWebllm;
    if (els.qaStatus) {
      els.qaStatus.textContent = "Ready (shared)";
      els.qaStatus.className = "qa-status ready";
    }
    return;
  }

  if (state.qaEngine) return;

  if (!navigator.gpu) {
    if (els.qaStatus) {
      els.qaStatus.textContent = "WebGPU not supported";
      els.qaStatus.className = "qa-status error";
    }
    return;
  }

  try {
    if (els.qaStatus) {
      els.qaStatus.textContent = "Loading model...";
      els.qaStatus.className = "qa-status loading";
    }

    if (!state.qaWebllm) {
      state.qaWebllm = await import("https://esm.run/@mlc-ai/web-llm");
    }

    const modelId = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
    state.qaEngine = await state.qaWebllm.CreateMLCEngine(modelId, {
      initProgressCallback: (progress) => {
        if (els.qaStatus) {
          els.qaStatus.textContent = progress.text || "Loading...";
        }
      },
    });

    if (els.qaStatus) {
      els.qaStatus.textContent = "Ready";
      els.qaStatus.className = "qa-status ready";
    }
  } catch (err) {
    console.error("Failed to init QA engine:", err);
    if (els.qaStatus) {
      els.qaStatus.textContent = "Failed to load";
      els.qaStatus.className = "qa-status error";
    }
  }
}

async function buildThreadContext(post) {
  const parts = [];
  parts.push(`Title: ${post.title || "Untitled"}`);

  const m = post.metrics || {};
  if (m.homework_id) parts.push(`Homework: ${m.homework_id}`);
  if (m.model_name) parts.push(`Model evaluated: ${m.model_name}`);

  parts.push(`\nThread content:\n${post.document || "(no content)"}`);

  // Try to load associated txt files
  const threadNum = String(post.number);
  const entry = state.filesManifest[threadNum];
  if (entry?.files?.length) {
    for (const file of entry.files) {
      if (file.transcript) {
        try {
          const res = await fetch(file.transcript, { cache: "force-cache" });
          if (res.ok) {
            let txt = await res.text();
            if (txt.length > 6000) txt = txt.slice(0, 6000) + "...";
            parts.push(`\nAttached file (${file.original_filename}):\n${txt}`);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return parts.join("\n");
}

function addQaMessage(role, content, isStreaming = false) {
  const div = document.createElement("div");
  div.className = `qa-message qa-${role}${isStreaming ? " streaming" : ""}`;
  div.innerHTML = `<p>${escapeHtml(content)}</p>`;
  els.qaMessages.appendChild(div);
  els.qaMessages.scrollTop = els.qaMessages.scrollHeight;
  return div;
}

async function handleQaSubmit(e) {
  e.preventDefault();

  const question = els.qaInput.value.trim();
  if (!question || state.qaGenerating || !state.currentModalPost) return;

  // Initialize engine if needed
  if (!state.qaEngine) {
    await initQaEngine();
    if (!state.qaEngine) return;
  }

  // Add user message
  addQaMessage("user", question);
  els.qaInput.value = "";

  state.qaGenerating = true;
  els.qaInput.disabled = true;
  els.qaSend.disabled = true;
  if (els.qaStatus) els.qaStatus.textContent = "Thinking...";

  const assistantEl = addQaMessage("assistant", "", true);

  try {
    // Build context from the thread
    const threadContext = await buildThreadContext(state.currentModalPost);

    const messages = [
      {
        role: "system",
        content: "You are a helpful assistant answering questions about a specific thread from EECS 182 special participation posts. Answer based on the thread content provided. Be concise.",
      },
      {
        role: "user",
        content: `Here is the thread content:\n\n${threadContext}\n\n---\n\nQuestion: ${question}\n\nPlease answer based on the thread content above.`,
      },
    ];

    let fullResponse = "";
    const asyncGenerator = await state.qaEngine.chat.completions.create({
      messages,
      stream: true,
      max_tokens: 400,
      temperature: 0.7,
    });

    for await (const chunk of asyncGenerator) {
      const delta = chunk.choices[0]?.delta?.content || "";
      fullResponse += delta;
      assistantEl.querySelector("p").textContent = fullResponse;
      els.qaMessages.scrollTop = els.qaMessages.scrollHeight;
    }

    assistantEl.classList.remove("streaming");
  } catch (err) {
    console.error("QA generation error:", err);
    assistantEl.querySelector("p").textContent = "Sorry, something went wrong.";
    assistantEl.classList.remove("streaming");
  } finally {
    state.qaGenerating = false;
    els.qaInput.disabled = false;
    els.qaSend.disabled = false;
    if (els.qaStatus) {
      els.qaStatus.textContent = "Ready";
      els.qaStatus.className = "qa-status ready";
    }
    els.qaInput.focus();
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

  const items = state.filtered.map((post, index) => postToHtml(post, index));
  els.postsList.innerHTML = items.join("\n");
  setupPostReveal();
}

function setupPostReveal() {
  if (!els.postsList || typeof IntersectionObserver === "undefined") return;

  const cards = Array.from(els.postsList.querySelectorAll(".post-card"));
  if (!cards.length) return;

  cards.forEach((card) => {
    card.classList.add("is-revealing");
  });

  const observer = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          entry.target.classList.remove("is-revealing");
        } else {
          entry.target.classList.remove("is-visible");
          entry.target.classList.add("is-revealing");
        }
      }
    },
    {
      root: null,
      rootMargin: "0px 0px -10% 0px",
      threshold: 0,
    },
  );

  cards.forEach((card) => observer.observe(card));
}

function postToHtml(post, index) {
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
    `<span class="badge badge-hw">${escapeHtml(hw)}</span>`,
    `<span class="badge badge-model">${escapeHtml(model)}</span>`,
    `<span class="badge badge-focus">${escapeHtml(focus)}</span>`,
    `<span class="badge badge-depth depth-${escapeHtml(depth)}">depth: ${escapeHtml(depth)}</span>`,
    `<span class="badge badge-action act-${escapeHtml(act)}">actionability: ${escapeHtml(act)}</span>`,
  ];

  const stats = [];
  if (wc != null) stats.push(`${wc} words`);
  if (typeof post.view_count === "number") stats.push(`${post.view_count} views`);
  if (typeof post.reply_count === "number") stats.push(`${post.reply_count} replies`);

  const edLink = post.ed_url
    ? `<a href="${escapeAttribute(post.ed_url)}" target="_blank" rel="noopener noreferrer">View on Ed</a>`
    : "";

  const title = escapeHtml(post.title || "Untitled post");
  const body = escapeHtml(post.document || "(no body text available)");

  // Build file links if available
  const files = getFilesForPost(post);
  const filesHtml = buildFilesHtml(files);

  return `
<article class="post-card" data-index="${index}">
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
  <p class="post-stats">${stats.map(escapeHtml).join(" · ")}</p>
  ${filesHtml}
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
  initThemePreference();
  attachEvents();

  try {
    const [posts, manifest] = await Promise.all([
      loadData(),
      loadFilesManifest(),
    ]);
    state.allPosts = posts;
    state.filesManifest = manifest;
    buildFilters(posts);
    applyFiltersAndRender();
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  }
}

window.addEventListener("DOMContentLoaded", init);
