const DATA_URL = "public/data/posts_processed.json";
const INSIGHTS_URL = "public/data/insights.json";
const MANIFEST_URL = "files/manifest.json";
const THEME_KEY = "spa-theme-mode";

const state = {
  allPosts: [],
  filtered: [],
  filesManifest: {},
  insights: null,
  currentModalPost: null,
  qaMessages: [],
  qaEngine: null,
  qaWebllm: null,
  qaGenerating: false,
  // New state for insights filtering
  insightsFilters: {
    homeworks: new Set(),
    models: new Set()
  }
};

const els = {};
let lastFocusedElement = null;

function cacheElements() {
  els.filterHomework = document.getElementById("filter-homework");
  els.filterModel = document.getElementById("filter-model");
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
  els.homeworkInsightsBody = document.getElementById("homework-insights-body");
  els.modelInsightsBody = document.getElementById("model-insights-body");
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

async function loadInsights() {
  try {
    const res = await fetch(INSIGHTS_URL, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`Insights not found at ${INSIGHTS_URL}. Run with --insights flag to generate.`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("Could not load insights:", err);
    return null;
  }
}

function getFilesForPost(post) {
  const threadNum = String(post.number);
  const entry = state.filesManifest[threadNum];
  if (!entry || !entry.files || !entry.files.length) return null;
  return entry.files;
}

function formatBodyWithLinks(bodyText, files) {
  let formatted = escapeHtml(bodyText);
  
  if (files && files.length > 0) {
    formatted = formatted.replace(/\[📎 ([^\]]+)\]/g, (match, filename) => {
      const file = files.find(f => f.original_filename === filename.trim());
      if (file) {
        return `<a href="${escapeAttribute(file.saved_as)}" class="inline-file-link" target="_blank" rel="noopener">📎 ${escapeHtml(filename)}</a>`;
      }
      return match;
    });
  }
  
  formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    return `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
  });
  
  formatted = formatted.replace(/\n/g, '<br>');
  return formatted;
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

  for (const post of posts) {
    const m = post.metrics || {};
    if (m.homework_id) homeworks.add(m.homework_id);
    if (m.model_name) models.add(m.model_name);
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
    } catch (err) { }
  } else {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (err) { }
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
    if (v === "light" || v === "dark" || v === "auto") stored = v;
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

  window.addEventListener("open-thread", (event) => {
    const { threadNum } = event.detail;
    const post = state.allPosts.find((p) => p.number === threadNum);
    if (post) {
      openPostModal(post);
    }
  });

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

    let icon = "📄";
    if (filename.toLowerCase().endsWith(".pdf")) icon = "📄";
    else if (filename.toLowerCase().endsWith(".png") || filename.toLowerCase().endsWith(".jpg")) icon = "🖼️";
    else if (filename.toLowerCase().endsWith(".txt")) icon = "📝";

    let links = `<a href="${filePath}" target="_blank" rel="noopener noreferrer" title="Download ${filename}" class="file-download-link">${icon} ${filename}</a>`;
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

  const files = getFilesForPost(post);
  if (els.postModalFiles) {
    els.postModalFiles.innerHTML = buildFilesHtml(files);
  }

  let bodyText = post.document || "(no body text available)";
  const fileRefs = post.file_refs || [];
  
  if (fileRefs && fileRefs.length > 0) {
    const sorted = [...fileRefs].sort((a, b) => b.position - a.position);
    for (const ref of sorted) {
      const pos = ref.position;
      if (pos >= 0 && pos <= bodyText.length) {
        const marker = `\n\n[📎 ${ref.filename}]\n\n`;
        bodyText = bodyText.slice(0, pos) + marker + bodyText.slice(pos);
      }
    }
  }
  
  els.postModalBody.innerHTML = formatBodyWithLinks(bodyText, files);

  // PDF Preview Embedding
  if (files && files.length > 0) {
    const pdfs = files.filter(f => f.saved_as.toLowerCase().endsWith('.pdf'));
    if (pdfs.length > 0) {
      const pdfEmbeds = pdfs.map(pdf => `
        <div class="pdf-embed-container" style="margin-top: 2rem; border-top: 1px solid #ccc; padding-top: 1rem;">
          <h4 style="margin-bottom:0.5rem;">📄 Preview: ${escapeHtml(pdf.original_filename)}</h4>
          <object data="${escapeAttribute(pdf.saved_as)}" type="application/pdf" width="100%" height="600px" style="border: 1px solid #ddd; border-radius: 4px;">
            <p>
              Your browser does not support inline PDF viewing. 
              <a href="${escapeAttribute(pdf.saved_as)}" target="_blank">Click here to download the PDF</a>.
            </p>
          </object>
        </div>
      `).join('');
      els.postModalBody.insertAdjacentHTML('beforeend', pdfEmbeds);
    }
  }

  els.postModalBackdrop.hidden = false;
  document.body.classList.add("modal-open");
  if (els.postModalClose) els.postModalClose.focus();
}

function closePostModal() {
  if (!els.postModalBackdrop) return;
  els.postModalBackdrop.hidden = true;
  document.body.classList.remove("modal-open");
  state.currentModalPost = null;
  state.qaMessages = [];
  if (els.qaMessages) els.qaMessages.innerHTML = "";
  if (els.qaStatus) els.qaStatus.textContent = "";

  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    try { lastFocusedElement.focus(); } catch { }
  }
}

async function initQaEngine() {
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
        if (els.qaStatus) els.qaStatus.textContent = progress.text || "Loading...";
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
        } catch { }
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

  if (!state.qaEngine) {
    await initQaEngine();
    if (!state.qaEngine) return;
  }

  addQaMessage("user", question);
  els.qaInput.value = "";
  state.qaGenerating = true;
  els.qaInput.disabled = true;
  els.qaSend.disabled = true;
  if (els.qaStatus) els.qaStatus.textContent = "Thinking...";

  const assistantEl = addQaMessage("assistant", "", true);

  try {
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
  const search = (els.searchText.value || "").toLowerCase().trim();
  const sortOrder = els.sortOrder.value || "newest";

  let results = state.allPosts.filter((post) => {
    const m = post.metrics || {};
    if (homeworkVal && m.homework_id !== homeworkVal) return false;
    if (modelVal && m.model_name !== modelVal) return false;
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
  
  // Also re-render insights to respect updates if needed (though insights usually use their own filters)
  renderHomeworkInsights();
}

function parseDateSafe(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sortResults(list, order) {
  const arr = list.slice();
  if (order === "homework") {
    arr.sort((a, b) => {
      const hwA = a.metrics?.homework_id || "";
      const hwB = b.metrics?.homework_id || "";
      const numA = hwA.match(/\d+/);
      const numB = hwB.match(/\d+/);
      if (numA && numB) return parseInt(numA[0], 10) - parseInt(numB[0], 10);
      return hwA.localeCompare(hwB);
    });
  } else if (order === "model") {
    arr.sort((a, b) => {
      const modelA = a.metrics?.model_name || "";
      const modelB = b.metrics?.model_name || "";
      return modelA.localeCompare(modelB);
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
    { root: null, rootMargin: "0px 0px -10% 0px", threshold: 0 }
  );
  cards.forEach((card) => observer.observe(card));
}

function postToHtml(post, index) {
  const m = post.metrics || {};
  const hw = m.homework_id || "Unknown";
  const model = m.model_name || "Unknown";
  const wc = typeof m.word_count === "number" ? m.word_count : null;
  const created = post.created_at ? new Date(post.created_at) : null;
  const createdStr = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : "";
  const author = post.user?.name || "Unknown";
  const role = post.user?.course_role || "";

  const badges = [
    `<span class="badge badge-hw">${escapeHtml(hw)}</span>`,
    `<span class="badge badge-model">${escapeHtml(model)}</span>`,
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

// -- INSIGHTS LOGIC START --

// Parses markdown summary to find Strengths and Weaknesses sections
function formatInsightText(text) {
  let formatted = escapeHtml(text || "");

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Split sections if possible
  const sections = [];
  
  // Heuristic: Check for "Strengths:" and "Weaknesses:" or "Pros/Cons"
  // We'll wrap these in colored blocks if we find them
  const strRegex = /(?:^|\n)(?:\*\*|###\s)?(Strengths|Pros):?(?:\*\*)?(?:\n|$)/i;
  const weakRegex = /(?:^|\n)(?:\*\*|###\s)?(Weaknesses|Cons|Limitations):?(?:\*\*)?(?:\n|$)/i;
  
  // If we can't find structured headers, just return basic markdown
  if (!strRegex.test(text) && !weakRegex.test(text)) {
    return formatMarkdownText(text); // Fallback to simple markdown
  }

  // Very basic parser to split the blob by these headers
  const lines = text.split('\n');
  let currentMode = 'normal'; // normal, strengths, weaknesses
  let buffer = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const block = buffer.join('\n');
    const html = formatMarkdownText(block); // recursive simple format
    if (currentMode === 'strengths') {
      sections.push(`<div class="insight-section insight-strengths"><strong>Strengths:</strong>${html}</div>`);
    } else if (currentMode === 'weaknesses') {
      sections.push(`<div class="insight-section insight-weaknesses"><strong>Weaknesses:</strong>${html}</div>`);
    } else {
      sections.push(`<div class="insight-section">${html}</div>`);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (strRegex.test(line)) {
      flushBuffer();
      currentMode = 'strengths';
      continue; // Skip the header line itself
    }
    if (weakRegex.test(line)) {
      flushBuffer();
      currentMode = 'weaknesses';
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();

  return sections.join('');
}

// Basic markdown formatter (lists, code)
function formatMarkdownText(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  
  // Bold/Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Lists
  const lines = html.split('\n');
  let inList = false;
  let result = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || /^\d+\./.test(trimmed)) {
      if (!inList) { result += '<ul>'; inList = true; }
      result += `<li>${trimmed.replace(/^(\* |-\s|\d+\.\s)/, '')}</li>`;
    } else {
      if (inList) { result += '</ul>'; inList = false; }
      if (trimmed) result += `<p>${trimmed}</p>`;
    }
  }
  if (inList) result += '</ul>';
  return result;
}

// Render the checkbox filters inside the Insights panel
function renderInsightsFilters(allHw, allModels) {
  const container = document.createElement('div');
  container.className = 'insights-filters-container';
  container.style.marginBottom = '20px';
  container.style.padding = '15px';
  container.style.backgroundColor = 'var(--bg-card)';
  container.style.border = '1px solid var(--border-color)';
  container.style.borderRadius = '8px';

  const makeCheckboxGroup = (label, items, type) => {
    const group = document.createElement('div');
    group.style.marginBottom = '10px';
    const title = document.createElement('strong');
    title.textContent = label + ": ";
    title.style.marginRight = '10px';
    group.appendChild(title);

    items.forEach(item => {
      const labelEl = document.createElement('label');
      labelEl.style.marginRight = '15px';
      labelEl.style.display = 'inline-block';
      
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = item;
      box.checked = state.insightsFilters[type].has(item);
      box.onclick = () => {
        if (box.checked) state.insightsFilters[type].add(item);
        else state.insightsFilters[type].delete(item);
        renderHomeworkInsights(); // Re-render logic
      };
      
      labelEl.appendChild(box);
      labelEl.appendChild(document.createTextNode(" " + item));
      group.appendChild(labelEl);
    });
    return group;
  };

  container.appendChild(makeCheckboxGroup("Homeworks", allHw, 'homeworks'));
  container.appendChild(makeCheckboxGroup("Models", allModels, 'models'));

  // Reset button
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Clear Filters";
  resetBtn.className = "appearance-btn"; 
  resetBtn.style.fontSize = "0.8rem";
  resetBtn.onclick = () => {
    state.insightsFilters.homeworks.clear();
    state.insightsFilters.models.clear();
    renderHomeworkInsights();
  };
  container.appendChild(resetBtn);

  return container;
}

function renderHomeworkInsights() {
  if (!state.insights || !state.insights.homework || !els.homeworkInsightsBody) {
    return;
  }

  // Clear current view
  els.homeworkInsightsBody.innerHTML = '';

  const homeworkData = state.insights.homework;
  let hwIds = Object.keys(homeworkData).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  // Collect all models for filter UI
  const allModels = new Set();
  state.allPosts.forEach(p => {
    if (p.metrics?.model_name) allModels.add(p.metrics.model_name);
  });
  const sortedModels = Array.from(allModels).sort();

  // Render Filters at top
  els.homeworkInsightsBody.appendChild(renderInsightsFilters(hwIds, sortedModels));

  // --- FILTERING LOGIC ---
  if (state.insightsFilters.homeworks.size > 0) {
    hwIds = hwIds.filter(id => state.insightsFilters.homeworks.has(id));
  }
  
  if (hwIds.length === 0) {
    const msg = document.createElement('p');
    msg.className = "muted-text";
    msg.textContent = "No homeworks match the selected filters.";
    els.homeworkInsightsBody.appendChild(msg);
    return;
  }

  hwIds.forEach(hwId => {
    const data = homeworkData[hwId];
    
    // Create HW Card
    const card = document.createElement('details');
    card.className = "insight-card";
    card.open = true; // Default open
    card.style.marginBottom = "20px";
    card.style.border = "1px solid var(--border-color)";
    card.style.borderRadius = "8px";
    card.style.padding = "10px";
    card.style.backgroundColor = "var(--bg-card)";

    const summaryEl = document.createElement('summary');
    summaryEl.style.cursor = "pointer";
    summaryEl.style.fontWeight = "bold";
    summaryEl.style.fontSize = "1.1rem";
    summaryEl.style.padding = "10px 0";
    summaryEl.textContent = `${hwId}`; // e.g. "Homework 0"
    card.appendChild(summaryEl);

    const body = document.createElement('div');
    body.style.paddingLeft = "15px";

    // Overall HW Stats/Summary
    const summaryHtml = formatInsightText(data.summary);
    const metaHtml = `<p class="insight-meta" style="margin-bottom:15px; font-style:italic; color:var(--text-muted)">${data.post_count} posts analyzed</p>`;
    
    // Inject Styles for Green/Red sections locally
    const styleBlock = `
      <style>
        .insight-section { margin-bottom: 10px; padding: 8px; border-radius: 4px; }
        .insight-strengths { background-color: rgba(40, 167, 69, 0.1); border-left: 4px solid #28a745; color: var(--text-color); }
        .insight-weaknesses { background-color: rgba(220, 53, 69, 0.1); border-left: 4px solid #dc3545; color: var(--text-color); }
        .insight-strengths strong, .insight-weaknesses strong { display:block; margin-bottom:5px; }
        .model-list-item { border-top: 1px solid var(--border-color); padding: 8px 0; }
        .model-list-item summary { cursor: pointer; outline: none; }
      </style>
    `;
    
    body.innerHTML = styleBlock + metaHtml + summaryHtml;

    // --- RENDER MODEL LIST FOR THIS HOMEWORK ---
    const modelListDiv = document.createElement('div');
    modelListDiv.className = "insight-model-list";
    modelListDiv.style.marginTop = "15px";

    // Group posts for this HW by model
    const postsForHw = state.allPosts.filter(p => p.metrics?.homework_id === hwId);
    const modelsInHw = {};
    postsForHw.forEach(p => {
      const mName = p.metrics?.model_name || "Unknown";
      if (!modelsInHw[mName]) modelsInHw[mName] = [];
      modelsInHw[mName].push(p);
    });

    let modelNames = Object.keys(modelsInHw).sort();
    
    // Filter Models if checkboxes selected
    if (state.insightsFilters.models.size > 0) {
      modelNames = modelNames.filter(m => state.insightsFilters.models.has(m));
    }

    if (modelNames.length > 0) {
      modelNames.forEach(mName => {
        const mPosts = modelsInHw[mName];
        
        const mDetails = document.createElement('details');
        mDetails.className = "model-list-item";
        
        const mSummary = document.createElement('summary');
        mSummary.innerHTML = `<strong>${escapeHtml(mName)}</strong> <span class="muted-text">(${mPosts.length})</span>`;
        mDetails.appendChild(mSummary);
        
        const mBody = document.createElement('div');
        mBody.style.padding = "10px 0 10px 20px";
        
        // List links to the actual threads
        mPosts.forEach(p => {
            const linkDiv = document.createElement('div');
            linkDiv.style.marginBottom = "4px";
            const link = document.createElement('a');
            link.href = "#";
            link.textContent = p.title || `Post #${p.number}`;
            link.onclick = (e) => {
                e.preventDefault();
                openPostModal(p);
            };
            linkDiv.appendChild(link);
            mBody.appendChild(linkDiv);
        });

        mDetails.appendChild(mBody);
        modelListDiv.appendChild(mDetails);
      });
      body.appendChild(modelListDiv);
    } else {
       if (state.insightsFilters.models.size > 0) {
         body.innerHTML += `<p class="muted-text" style="margin-top:10px">No models match filter for this homework.</p>`;
       }
    }

    card.appendChild(body);
    els.homeworkInsightsBody.appendChild(card);
  });
}

// -- INSIGHTS LOGIC END --

function renderModelInsights() {
  if (!state.insights || !state.insights.models || !els.modelInsightsBody) {
    return;
  }
  const modelData = state.insights.models;
  const modelNames = Object.keys(modelData).sort();
  if (modelNames.length === 0) {
    els.modelInsightsBody.innerHTML = '<p class="muted-text">No model insights available yet.</p>';
    return;
  }
  const cards = modelNames.map(model => {
    const data = modelData[model];
    const formattedSummary = formatInsightText(data.summary);
    return `
      <div class="insight-item">
        <h4>${escapeHtml(model)}</h4>
        <div class="insight-summary">${formattedSummary}</div>
        <p class="insight-meta">${data.post_count} evaluation${data.post_count !== 1 ? 's' : ''} analyzed</p>
      </div>
    `;
  }).join('');
  els.modelInsightsBody.innerHTML = cards;
}

async function init() {
  cacheElements();
  initThemePreference();
  attachEvents();

  try {
    const [posts, manifest, insights] = await Promise.all([
      loadData(),
      loadFilesManifest(),
      loadInsights(),
    ]);
    state.allPosts = posts;
    state.filesManifest = manifest;
    state.insights = insights;
    buildFilters(posts);
    applyFiltersAndRender();
    renderHomeworkInsights();
    renderModelInsights();
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  }
}

window.addEventListener("DOMContentLoaded", init);