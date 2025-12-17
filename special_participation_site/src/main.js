const DATA_URL = "public/data/posts_processed.json";
const INSIGHTS_URL = "public/data/insights.json";
const MANIFEST_URL = "files/manifest.json";
const THEME_KEY = "spa-theme-mode";

// -- NEW: PDF Constants --
const PDFJS_CDN = "https://esm.run/pdfjs-dist@3.11.174";
const PDFJS_WORKER_CDN = "https://esm.run/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

const state = {
  allPosts: [],
  filtered: [],
  filesManifest: {},
  insights: null,
  currentModalPost: null,
  activeThreadPost: null, // New: for full page view
  qaMessages: [],
  qaEngine: null,
  qaWebllm: null,
  qaGenerating: false,
  pdfLib: null, // New: cache for PDF library
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
  
  // QA Els (Note: these might be re-bound in full page mode)
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

// -- NEW: PDF Extraction Logic --

async function loadPdfLib() {
  if (state.pdfLib) return state.pdfLib;
  const pdfjs = await import(PDFJS_CDN);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  state.pdfLib = pdfjs;
  return pdfjs;
}

async function extractTextFromPdf(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const arrayBuffer = await res.arrayBuffer();
    
    const pdfjs = await loadPdfLib();
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = "";
    // Limit pages to avoid context overflow
    const maxPages = Math.min(doc.numPages, 10); 
    
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str);
      fullText += strings.join(" ") + "\n";
    }
    return fullText;
  } catch (err) {
    console.error("PDF Parse Error:", err);
    return "";
  }
}

// -- End PDF Logic --

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
  
  // If clicking the "Full View" button, let standard navigation happen
  if (event.target.closest(".btn-full-view")) return;
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

  // PDF Preview Embedding in Modal
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

// -- UPDATED: Support PDF extraction --
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
      // 1. Try simple text transcript first
      if (file.transcript) {
        try {
          const res = await fetch(file.transcript, { cache: "force-cache" });
          if (res.ok) {
            let txt = await res.text();
            if (txt.length > 6000) txt = txt.slice(0, 6000) + "...";
            parts.push(`\nAttached file (${file.original_filename}):\n${txt}`);
            continue; // if found, move to next file
          }
        } catch { }
      }
      
      // 2. Try PDF extraction if available
      const savedPath = file.saved_as || file.url;
      if (savedPath && savedPath.toLowerCase().endsWith('.pdf')) {
        parts.push(`\n(Reading PDF: ${file.original_filename}...)`);
        const pdfText = await extractTextFromPdf(savedPath);
        if (pdfText && pdfText.length > 50) {
           parts.push(`\nAttached PDF Content (${file.original_filename}):\n${pdfText}`);
        }
      }
    }
  }
  return parts.join("\n");
}

function addQaMessage(role, content, isStreaming = false) {
  // Must dynamically find container because it changes between views
  const container = document.getElementById("qa-messages");
  if (!container) return null;
  
  const div = document.createElement("div");
  div.className = `qa-message qa-${role}${isStreaming ? " streaming" : ""}`;
  div.innerHTML = `<p>${escapeHtml(content)}</p>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function handleQaSubmit(e) {
  e.preventDefault();
  // Dynamically query input in case view changed
  const inputEl = document.getElementById("qa-input");
  const sendEl = document.getElementById("qa-send");
  const statusEl = document.getElementById("qa-status");
  const container = document.getElementById("qa-messages");
  
  const question = inputEl.value.trim();
  // Check active thread (Full page) OR modal thread
  const contextPost = state.activeThreadPost || state.currentModalPost;

  if (!question || state.qaGenerating || !contextPost) return;

  if (!state.qaEngine) {
    await initQaEngine();
    if (!state.qaEngine) return;
  }

  addQaMessage("user", question);
  inputEl.value = "";
  state.qaGenerating = true;
  inputEl.disabled = true;
  sendEl.disabled = true;
  if (statusEl) statusEl.textContent = "Reading & Thinking...";

  const assistantEl = addQaMessage("assistant", "", true);

  try {
    const threadContext = await buildThreadContext(contextPost);
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
      if (assistantEl) {
        assistantEl.querySelector("p").textContent = fullResponse;
        if(container) container.scrollTop = container.scrollHeight;
      }
    }
    if(assistantEl) assistantEl.classList.remove("streaming");
  } catch (err) {
    console.error("QA generation error:", err);
    if(assistantEl) assistantEl.querySelector("p").textContent = "Sorry, something went wrong.";
    if(assistantEl) assistantEl.classList.remove("streaming");
  } finally {
    state.qaGenerating = false;
    if(inputEl) inputEl.disabled = false;
    if(sendEl) sendEl.disabled = false;
    if (statusEl) {
      statusEl.textContent = "Ready";
      statusEl.className = "qa-status ready";
    }
    if(inputEl) inputEl.focus();
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

  // New Button for Full View added below badges
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
  
  <div style="margin: 0.75rem 0;">
    <a href="?thread=${post.number}" class="btn-full-view" style="display:inline-flex; align-items:center; gap:0.5rem; padding:0.4rem 0.8rem; background:#eff6ff; color:#1d4ed8; text-decoration:none; border-radius:6px; font-size:0.875rem; font-weight:500;">
      <span>Open Full View & PDF ↗</span>
    </a>
  </div>

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
            link.href = `?thread=${p.number}`; // Link to Full Page View
            link.textContent = p.title || `Post #${p.number}`;
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

// -- NEW: Full Page Thread Renderer --

function renderFullPageThread(post) {
  state.activeThreadPost = post;
  state.currentModalPost = null; 

  const m = post.metrics || {};
  const files = getFilesForPost(post);
  
  // Find PDF for split view
  let pdfUrl = null;
  if (files) {
    const pdf = files.find(f => 
      (f.transcript && f.transcript.endsWith('.pdf')) || 
      (f.url && f.url.endsWith('.pdf')) ||
      (f.saved_as && f.saved_as.endsWith('.pdf'))
    );
    if (pdf) pdfUrl = pdf.saved_as;
  }

  // Preserve theme class from body before replacing
  const themeClass = document.body.classList.contains('theme-dark') ? 'theme-dark' : 
                     document.body.classList.contains('theme-light') ? 'theme-light' : '';

  const html = `
    <style>
      .fullpage-view {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100vh;
        background: var(--bg-app);
        display: flex;
        font-family: var(--font-sans);
        color: var(--fg-primary);
      }
      .fullpage-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100%;
        border-right: 1px solid var(--border);
        overflow: hidden;
      }
      .fullpage-header {
        padding: 1.5rem;
        border-bottom: 1px solid var(--border);
        background: var(--bg-panel);
      }
      .fullpage-back {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--fg-muted);
        text-decoration: none;
        margin-bottom: 1rem;
        font-size: 0.875rem;
      }
      .fullpage-back:hover {
        color: var(--accent);
      }
      .fullpage-title {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0.5rem 0;
        color: var(--fg-primary);
      }
      .fullpage-meta {
        font-size: 0.875rem;
        color: var(--fg-muted);
        display: flex;
        gap: 1rem;
      }
      .fullpage-meta a {
        color: var(--accent);
      }
      .fullpage-content {
        flex: 1;
        overflow-y: auto;
        padding: 2rem;
        background: var(--bg-app);
      }
      .fullpage-content-inner {
        max-width: 800px;
        margin: 0 auto;
      }
      .fullpage-body {
        background: var(--bg-panel);
        padding: 2rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border);
        margin-bottom: 2rem;
        line-height: 1.6;
        color: var(--fg-secondary);
      }
      .fullpage-pdf-container {
        height: 800px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--bg-panel);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .fullpage-pdf-header {
        background: var(--bg-inset);
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .fullpage-pdf-title {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--fg-secondary);
      }
      .fullpage-pdf-download {
        font-size: 0.75rem;
        color: var(--accent);
      }
      .fullpage-pdf-iframe {
        width: 100%;
        flex: 1;
        border: none;
        background: var(--bg-inset);
      }
      .fullpage-no-pdf {
        padding: 3rem;
        text-align: center;
        color: var(--fg-muted);
        border: 2px dashed var(--border);
        border-radius: var(--radius-lg);
      }
      .fullpage-sidebar {
        width: 400px;
        min-width: 400px;
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-panel);
        border-left: 1px solid var(--border);
        box-shadow: -4px 0 15px rgba(0,0,0,0.05);
      }
      .fullpage-sidebar-header {
        padding: 1rem;
        border-bottom: 1px solid var(--border);
        background: var(--bg-inset);
      }
      .fullpage-sidebar-title {
        font-weight: 600;
        color: var(--fg-primary);
        margin: 0;
      }
      .fullpage-qa-messages {
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: var(--bg-panel);
      }
      .fullpage-qa-form-container {
        padding: 1rem;
        border-top: 1px solid var(--border);
        background: var(--bg-inset);
      }
      .fullpage-qa-form {
        display: flex;
        gap: 0.5rem;
      }
      .fullpage-qa-input {
        flex: 1;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        font-size: 0.875rem;
        background: var(--bg-panel);
        color: var(--fg-primary);
      }
      .fullpage-qa-input:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: var(--shadow-focus);
      }
      .fullpage-qa-send {
        padding: 0.5rem 1rem;
        background: var(--accent);
        color: var(--accent-fg);
        border: none;
        border-radius: var(--radius-md);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
      }
      .fullpage-qa-send:hover {
        background: var(--accent-hover);
      }
      /* Sidebar toggle button (visible when collapsed) */
      .sidebar-toggle-btn {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 40px;
        height: 80px;
        background: var(--accent);
        color: var(--accent-fg);
        border: none;
        border-radius: var(--radius-md) 0 0 var(--radius-md);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: -2px 0 10px rgba(0,0,0,0.1);
        z-index: 100;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }
      .sidebar-toggle-btn:hover {
        background: var(--accent-hover);
      }
      .sidebar-toggle-btn svg {
        width: 20px;
        height: 20px;
      }
      .fullpage-view.sidebar-collapsed .sidebar-toggle-btn {
        opacity: 1;
        pointer-events: auto;
      }
      /* Collapse button in sidebar header */
      .sidebar-collapse-btn {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--fg-muted);
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .sidebar-collapse-btn:hover {
        background: var(--bg-panel);
        color: var(--fg-primary);
        border-color: var(--border-hover);
      }
      .sidebar-collapse-btn svg {
        width: 16px;
        height: 16px;
      }
      /* Sidebar collapsed state */
      .fullpage-sidebar {
        transition: transform 0.3s ease, opacity 0.3s ease, width 0.3s ease, min-width 0.3s ease;
      }
      .fullpage-view.sidebar-collapsed .fullpage-sidebar {
        transform: translateX(100%);
        opacity: 0;
        width: 0;
        min-width: 0;
        overflow: hidden;
        border-left: none;
      }
      .fullpage-view.sidebar-collapsed .fullpage-main {
        border-right: none;
      }
      @media (max-width: 900px) {
        .fullpage-view {
          flex-direction: column;
        }
        .fullpage-sidebar {
          width: 100%;
          min-width: 100%;
          height: 300px;
        }
        .fullpage-view.sidebar-collapsed .fullpage-sidebar {
          transform: translateY(100%);
          height: 0;
        }
        .sidebar-toggle-btn {
          right: 50%;
          top: auto;
          bottom: 0;
          transform: translateX(50%);
          width: 80px;
          height: 40px;
          border-radius: var(--radius-md) var(--radius-md) 0 0;
        }
      }
    </style>
    <div class="fullpage-view">
      <!-- Toggle button to open sidebar when collapsed -->
      <button id="sidebar-toggle" class="sidebar-toggle-btn" title="Open AI Assistant">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>

      <div class="fullpage-main">
        <div class="fullpage-header">
          <a href="?" class="fullpage-back">← Back to Dashboard</a>
          
          <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
            <span class="badge badge-hw">${escapeHtml(m.homework_id || 'HW')}</span>
            <span class="badge badge-model">${escapeHtml(m.model_name || 'Model')}</span>
          </div>
          
          <h1 class="fullpage-title">${escapeHtml(post.title)}</h1>
          
          <div class="fullpage-meta">
             <span>${escapeHtml(post.user?.name || 'Unknown')}</span>
             <span>•</span>
             <a href="${post.ed_url}" target="_blank">View on Ed</a>
          </div>
        </div>

        <div class="fullpage-content">
           <div class="fullpage-content-inner">
              <div class="fullpage-body">
                 ${formatBodyWithLinks(post.document, files)}
              </div>

              ${pdfUrl ? `
                <div class="fullpage-pdf-container">
                  <div class="fullpage-pdf-header">
                     <span class="fullpage-pdf-title">Document Viewer</span>
                     <a href="${pdfUrl}" target="_blank" class="fullpage-pdf-download">Download PDF</a>
                  </div>
                  <iframe src="${pdfUrl}" class="fullpage-pdf-iframe"></iframe>
                </div>
              ` : `
                <div class="fullpage-no-pdf">
                  No PDF attachment found.
                </div>
              `}
           </div>
        </div>
      </div>

      <div class="fullpage-sidebar">
        <div class="fullpage-sidebar-header" style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h2 class="fullpage-sidebar-title">AI Assistant</h2>
            <div id="qa-status" class="qa-status" style="font-size:0.75rem; color:var(--fg-muted); margin-top:0.25rem;">Ready</div>
          </div>
          <button id="sidebar-collapse" class="sidebar-collapse-btn" title="Collapse sidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>

        <div id="qa-messages" class="fullpage-qa-messages">
          <div class="qa-message qa-assistant">
             <p>Hi! I've analyzed this thread and any attached PDFs. What would you like to know?</p>
          </div>
        </div>

        <div class="fullpage-qa-form-container">
          <form id="qa-form" class="fullpage-qa-form">
            <input 
              type="text" 
              id="qa-input" 
              class="fullpage-qa-input"
              placeholder="Ask about this thread..." 
              autocomplete="off"
            >
            <button type="submit" id="qa-send" class="fullpage-qa-send">Send</button>
          </form>
        </div>
      </div>
    </div>
  `;

  // Completely replace body content for this view
  document.body.innerHTML = html;
  
  // Restore theme class
  if (themeClass) {
    document.body.classList.add(themeClass);
  }
  
  // Re-bind events since we wiped the DOM
  const form = document.getElementById("qa-form");
  if (form) form.addEventListener("submit", handleQaSubmit);
  
  // Sidebar toggle functionality
  const fullpageView = document.querySelector('.fullpage-view');
  const collapseBtn = document.getElementById('sidebar-collapse');
  const toggleBtn = document.getElementById('sidebar-toggle');
  
  if (collapseBtn && fullpageView) {
    collapseBtn.addEventListener('click', () => {
      fullpageView.classList.add('sidebar-collapsed');
    });
  }
  
  if (toggleBtn && fullpageView) {
    toggleBtn.addEventListener('click', () => {
      fullpageView.classList.remove('sidebar-collapsed');
    });
  }
}

// -- INIT --

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
    
    // -- NEW: Routing Check --
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get('thread');
    if (threadId) {
      const post = posts.find(p => String(p.number) === threadId);
      if (post) {
        renderFullPageThread(post);
        return; // Skip rendering dashboard
      }
    }

    buildFilters(posts);
    applyFiltersAndRender();
    renderHomeworkInsights();
    renderModelInsights();
  } catch (err) {
    console.error(err);
    // Fallback error display
    if (els.errorMessage) {
       els.errorMessage.textContent = err.message || String(err);
       els.errorMessage.hidden = false;
    }
  }
}

window.addEventListener("DOMContentLoaded", init);