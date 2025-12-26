const DATA_URL = "public/data/posts_processed.json";
const INSIGHTS_URL = "public/data/insights.json";
const MANIFEST_URL = "files/manifest.json";
const THEME_KEY = "spa-theme-mode";

// -- NEW: PDF Constants --
const PDFJS_CDN = "https://esm.run/pdfjs-dist@3.11.174";
const PDFJS_WORKER_CDN = "https://esm.run/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

// Initialize shared analyzer state if not exists
if (!window.sharedAnalyzerState) {
  window.sharedAnalyzerState = {
    engine: null,
    webllm: null,
    scores: new Map(), // postId -> { score, reasoning, hw, model }
    isLoading: false,
    isRunning: false,
  };
}

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
  },
  // Analyzer state - uses shared state
  get analyzerEngine() { return window.sharedAnalyzerState.engine; },
  set analyzerEngine(v) { window.sharedAnalyzerState.engine = v; },
  get analyzerWebllm() { return window.sharedAnalyzerState.webllm; },
  set analyzerWebllm(v) { window.sharedAnalyzerState.webllm = v; },
  get analyzerScores() { return window.sharedAnalyzerState.scores; },
  analyzerLoading: false,
  analyzerRunning: false
};

const els = {};
let lastFocusedElement = null;

function cacheElements() {
  els.filterHomework = document.getElementById("filter-homework");
  els.filterModel = document.getElementById("filter-model");
  els.filterAuthor = document.getElementById("filter-author");
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
  
  // Analyzer elements
  els.overviewModelSelect = document.getElementById("overview-model-select");
  els.overviewAnalyzerStatus = document.getElementById("overview-analyzer-status");
  els.overviewLoading = document.getElementById("overview-loading");
  els.overviewLoadingText = document.getElementById("overview-loading-text");
  els.overviewProgressFill = document.getElementById("overview-progress-fill");
  els.analyzeAllBtn = document.getElementById("analyze-all-btn");
  els.clearScoresBtn = document.getElementById("clear-scores-btn");
  els.analyzeProgress = document.getElementById("analyze-progress");
  els.scoreSummary = document.getElementById("score-summary");
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
  const authors = new Set();

  for (const post of posts) {
    const m = post.metrics || {};
    if (m.homework_id) homeworks.add(m.homework_id);
    if (m.model_name) models.add(m.model_name);
    if (post.user?.name) authors.add(post.user.name);
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
  populateSelect(els.filterAuthor, "contributors", Array.from(authors).sort(sortAlpha));
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
    els.filterAuthor,
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

    // Show filters panel only on overview
    const filtersPanel = document.getElementById("controls");
    const filtersToggle = document.getElementById("filters-toggle");
    const mainLayout = document.querySelector(".main-layout");
    if (filtersPanel) {
      filtersPanel.style.display = view === "overview" ? "" : "none";
    }
    if (filtersToggle) {
      filtersToggle.style.display = view === "overview" ? "" : "none";
    }
    if (mainLayout) {
      mainLayout.classList.toggle("filters-hidden", view !== "overview");
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      if (view) setView(view);
    });
  });

  setView("matrix");
}

function handlePostListClick(event) {
  if (!els.postsList) return;
  const card = event.target.closest(".post-card");
  if (!card || !els.postsList.contains(card)) return;
  
  // If clicking the "Full View" button, let standard navigation happen
  if (event.target.closest(".btn-full-view")) return;
  if (event.target.closest("a")) return;
  // If clicking the "Analyze" button, don't open modal
  if (event.target.closest(".btn-analyze")) return;

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
  
  // For streaming messages, start with plain text
  if (isStreaming) {
    div.innerHTML = `<div class="message-content"><p>${escapeHtml(content)}</p></div>`;
  } else {
    // Render markdown/latex for completed messages
    const rendered = role === "assistant" && window.renderMarkdownLatex 
      ? window.renderMarkdownLatex(content) 
      : escapeHtml(content);
    div.innerHTML = `<div class="message-content">${rendered}</div>`;
  }
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

/**
 * Update QA message content and optionally render markdown when done
 */
function updateQaMessageContent(messageEl, content, finalize = false) {
  const contentEl = messageEl.querySelector(".message-content");
  if (!contentEl) return;
  
  if (finalize && window.renderMarkdownLatex) {
    contentEl.innerHTML = window.renderMarkdownLatex(content);
  } else {
    contentEl.innerHTML = `<p>${escapeHtml(content)}</p>`;
  }
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
        updateQaMessageContent(assistantEl, fullResponse, false);
        if(container) container.scrollTop = container.scrollHeight;
      }
    }
    if(assistantEl) {
      assistantEl.classList.remove("streaming");
      updateQaMessageContent(assistantEl, fullResponse, true);
    }
  } catch (err) {
    console.error("QA generation error:", err);
    if(assistantEl) {
      updateQaMessageContent(assistantEl, "Sorry, something went wrong.", true);
      assistantEl.classList.remove("streaming");
    }
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

/**
 * Parse search query for special prefixes like author:, model:, hw:
 * Returns { terms: string[], filters: { author?, model?, hw? } }
 */
function parseSearchQuery(query) {
  const filters = {};
  const terms = [];
  
  // Split by spaces but respect quoted strings
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  
  for (const token of tokens) {
    const lower = token.toLowerCase();
    
    // Check for prefix filters
    if (lower.startsWith('author:') || lower.startsWith('by:') || lower.startsWith('student:')) {
      filters.author = token.split(':')[1].replace(/"/g, '').toLowerCase();
    } else if (lower.startsWith('model:') || lower.startsWith('llm:')) {
      filters.model = token.split(':')[1].replace(/"/g, '').toLowerCase();
    } else if (lower.startsWith('hw:') || lower.startsWith('homework:')) {
      filters.hw = token.split(':')[1].replace(/"/g, '').toUpperCase();
    } else {
      // Regular search term
      terms.push(token.replace(/"/g, '').toLowerCase());
    }
  }
  
  return { terms, filters };
}

function applyFiltersAndRender() {
  const homeworkVal = decodeURIComponent(els.filterHomework?.value || "");
  const modelVal = decodeURIComponent(els.filterModel?.value || "");
  const authorVal = decodeURIComponent(els.filterAuthor?.value || "");
  const searchRaw = (els.searchText?.value || "").trim();
  const sortOrder = els.sortOrder?.value || "newest";
  
  // Parse search for special syntax
  const { terms: searchTerms, filters: searchFilters } = parseSearchQuery(searchRaw);

  let results = state.allPosts.filter((post) => {
    const m = post.metrics || {};
    const authorName = (post.user?.name || "");
    const authorNameLower = authorName.toLowerCase();
    const modelName = (m.model_name || "").toLowerCase();
    const hwId = (m.homework_id || "").toUpperCase();
    
    // Dropdown filters
    if (homeworkVal && m.homework_id !== homeworkVal) return false;
    if (modelVal && m.model_name !== modelVal) return false;
    if (authorVal && authorName !== authorVal) return false;
    
    // Search prefix filters (author:, model:, hw:)
    if (searchFilters.author && !authorNameLower.includes(searchFilters.author)) return false;
    if (searchFilters.model && !modelName.includes(searchFilters.model)) return false;
    if (searchFilters.hw && !hwId.includes(searchFilters.hw)) return false;
    
    // General search terms - search across multiple fields
    if (searchTerms.length > 0) {
      // Build comprehensive haystack including all searchable fields
      const haystack = [
        post.title || "",
        post.document || "",
        post.user?.name || "",
        m.model_name || "",
        m.homework_id || "",
        // Include file names if any
        ...(post.file_refs || []).map(f => f.filename || "")
      ].join(" ").toLowerCase();
      
      // All search terms must match (AND logic)
      for (const term of searchTerms) {
        if (!haystack.includes(term)) return false;
      }
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
  } else if (order === "author") {
    arr.sort((a, b) => {
      const authorA = a.user?.name || "";
      const authorB = b.user?.name || "";
      return authorA.localeCompare(authorB);
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
  const authors = new Set();
  for (const post of state.filtered) {
    const m = post.metrics || {};
    if (m.homework_id) hw.add(m.homework_id);
    if (m.model_name) models.add(m.model_name);
    if (post.user?.name) authors.add(post.user.name);
  }
  
  // Build summary with stats
  const stats = [
    `Showing ${shown} of ${total} posts`,
    `${authors.size} contributors`,
    `${hw.size} homeworks`,
    `${models.size} models`
  ];
  els.summaryBar.textContent = stats.join(" · ");
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
  
  // Check if we have a score for this post
  const scoreData = state.analyzerScores.get(post.id);
  let scoreBadgeHtml = "";
  let scoreJustificationHtml = "";
  let analyzeButtonHtml = "";
  
  if (scoreData) {
    const scoreLabels = ["", "Very Poor", "Poor", "Mediocre", "Good", "Excellent"];
    scoreBadgeHtml = `<span class="post-score-badge score-${scoreData.score}">
      <span>${scoreData.score}/5</span>
      <span class="score-label">${scoreLabels[scoreData.score]}</span>
    </span>`;
    scoreJustificationHtml = `<div class="post-score-justification score-${scoreData.score}">
      <span class="justification-icon">💬</span>
      <span class="justification-text">${escapeHtml(scoreData.reasoning)}</span>
    </div>`;
  } else {
    const isDisabled = !state.analyzerEngine ? "disabled" : "";
    analyzeButtonHtml = `<button class="btn-analyze" data-post-id="${post.id}" ${isDisabled}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20V10"></path>
        <path d="M18 20V4"></path>
        <path d="M6 20v-4"></path>
      </svg>
      Analyze
    </button>`;
  }
  
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
<article class="post-card" data-index="${index}" data-post-id="${post.id}">
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
  <div class="post-badges">
    ${badges.join(" ")}
    ${scoreBadgeHtml}
  </div>
  ${scoreJustificationHtml}
  
  <div style="margin: 0.75rem 0; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
    <a href="?thread=${post.number}" class="btn-full-view" style="display:inline-flex; align-items:center; gap:0.5rem; padding:0.4rem 0.8rem; background:#eff6ff; color:#1d4ed8; text-decoration:none; border-radius:6px; font-size:0.875rem; font-weight:500;">
      <span>Open Full View ↗</span>
    </a>
    ${analyzeButtonHtml}
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

// Render the improved filters inside the Insights panel
function renderInsightsFilters(allHw, allModels) {
  const container = document.createElement('div');
  container.className = 'insights-filters-container';

  // Title
  const titleDiv = document.createElement('div');
  titleDiv.className = 'insights-filters-title';
  titleDiv.innerHTML = `<span>🎯</span> Filter Insights`;
  container.appendChild(titleDiv);

  // Create pill-style filter groups
  const makeFilterGroup = (label, items, type, icon) => {
    const group = document.createElement('div');
    group.className = 'insights-filter-group';
    
    const labelEl = document.createElement('span');
    labelEl.className = 'insights-filter-label';
    labelEl.textContent = `${icon} ${label}`;
    group.appendChild(labelEl);

    const pillsContainer = document.createElement('div');
    pillsContainer.className = 'insights-filter-pills';
    
    items.forEach(item => {
      const pill = document.createElement('label');
      pill.className = `insights-filter-pill${state.insightsFilters[type].has(item) ? ' active' : ''}`;
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.insightsFilters[type].has(item);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          state.insightsFilters[type].add(item);
          pill.classList.add('active');
        } else {
          state.insightsFilters[type].delete(item);
          pill.classList.remove('active');
        }
        renderHomeworkInsights();
      };
      
      pill.appendChild(checkbox);
      pill.appendChild(document.createTextNode(item));
      pillsContainer.appendChild(pill);
    });
    
    group.appendChild(pillsContainer);
    return group;
  };

  container.appendChild(makeFilterGroup("Homeworks", allHw, 'homeworks', '📚'));
  container.appendChild(makeFilterGroup("Models", allModels, 'models', '🤖'));

  // Actions row
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'insights-filter-actions';
  
  const resetBtn = document.createElement('button');
  resetBtn.className = 'insights-clear-btn';
  resetBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Clear All Filters`;
  resetBtn.onclick = () => {
    state.insightsFilters.homeworks.clear();
    state.insightsFilters.models.clear();
    renderHomeworkInsights();
  };
  actionsDiv.appendChild(resetBtn);
  
  const activeCount = state.insightsFilters.homeworks.size + state.insightsFilters.models.size;
  if (activeCount > 0) {
    const countSpan = document.createElement('span');
    countSpan.style.cssText = 'font-size: 0.8rem; color: var(--accent); font-weight: 600;';
    countSpan.textContent = `${activeCount} filter${activeCount > 1 ? 's' : ''} active`;
    actionsDiv.appendChild(countSpan);
  }
  
  container.appendChild(actionsDiv);

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

  // Render Filters
  els.homeworkInsightsBody.appendChild(renderInsightsFilters(hwIds, sortedModels));

  // --- FILTERING LOGIC ---
  if (state.insightsFilters.homeworks.size > 0) {
    hwIds = hwIds.filter(id => state.insightsFilters.homeworks.has(id));
  }
  
  if (hwIds.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'insights-empty-state';
    emptyState.innerHTML = `
      <div class="insights-empty-icon">🔍</div>
      <div class="insights-empty-title">No matching homeworks</div>
      <p class="insights-empty-text">Try adjusting your filters to see more insights.</p>
    `;
    els.homeworkInsightsBody.appendChild(emptyState);
    return;
  }

  // Grid container for cards
  const insightsGrid = document.createElement('div');
  insightsGrid.className = 'insights-grid';

  hwIds.forEach(hwId => {
    const data = homeworkData[hwId];
    const hwNumber = hwId.replace(/\D/g, '');
    
    // Create HW Card
    const card = document.createElement('details');
    card.className = "insight-card";
    card.open = true;

    // Custom summary/header
    const summaryEl = document.createElement('summary');
    summaryEl.className = 'insight-card-header';
    
    // Group posts for this HW by model for stats
    const postsForHw = state.allPosts.filter(p => p.metrics?.homework_id === hwId);
    const modelsInHw = {};
    postsForHw.forEach(p => {
      const mName = p.metrics?.model_name || "Unknown";
      if (!modelsInHw[mName]) modelsInHw[mName] = [];
      modelsInHw[mName].push(p);
    });
    let modelNames = Object.keys(modelsInHw).sort();
    
    // Filter Models if selected
    if (state.insightsFilters.models.size > 0) {
      modelNames = modelNames.filter(m => state.insightsFilters.models.has(m));
    }
    
    summaryEl.innerHTML = `
      <div class="insight-card-title-group">
        <div class="insight-card-icon">📘</div>
        <div>
          <h3 class="insight-card-title">${escapeHtml(hwId)}</h3>
          <div class="insight-card-subtitle">AI Performance Analysis</div>
        </div>
      </div>
      <div class="insight-card-meta">
        <span class="insight-card-stat">
          <span class="insight-card-stat-value">${data.post_count}</span> reports
        </span>
        <span class="insight-card-stat">
          <span class="insight-card-stat-value">${Object.keys(modelsInHw).length}</span> models
        </span>
        <div class="insight-card-chevron">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>
    `;
    card.appendChild(summaryEl);

    // Body content
    const body = document.createElement('div');
    body.className = 'insight-card-body';

    // Parse and format summary with sections
    const summaryContent = document.createElement('div');
    summaryContent.className = 'insight-summary-content';
    summaryContent.innerHTML = formatInsightTextEnhanced(data.summary);
    body.appendChild(summaryContent);

    // --- RENDER MODEL LIST ---
    if (modelNames.length > 0) {
      const modelsSection = document.createElement('div');
      modelsSection.className = 'insight-models-section';
      
      modelsSection.innerHTML = `
        <div class="insight-models-header">
          <span>🤖</span> Models Evaluated (${modelNames.length})
        </div>
      `;
      
      const modelsGrid = document.createElement('div');
      modelsGrid.className = 'insight-models-grid';
      
      modelNames.forEach(mName => {
        const mPosts = modelsInHw[mName];
        
        const modelCard = document.createElement('details');
        modelCard.className = 'insight-model-card';
        
        const modelHeader = document.createElement('summary');
        modelHeader.className = 'insight-model-header';
        modelHeader.innerHTML = `
          <span class="insight-model-name">
            <span class="insight-model-icon">🔹</span>
            ${escapeHtml(mName)}
          </span>
          <span class="insight-model-count">${mPosts.length}</span>
        `;
        modelCard.appendChild(modelHeader);
        
        const modelPosts = document.createElement('div');
        modelPosts.className = 'insight-model-posts';
        
        mPosts.forEach(p => {
          const link = document.createElement('a');
          link.href = `?thread=${p.number}`;
          link.className = 'insight-model-post-link';
          link.textContent = p.title || `Post #${p.number}`;
          modelPosts.appendChild(link);
        });
        
        modelCard.appendChild(modelPosts);
        modelsGrid.appendChild(modelCard);
      });
      
      modelsSection.appendChild(modelsGrid);
      body.appendChild(modelsSection);
    } else if (state.insightsFilters.models.size > 0) {
      const noMatchMsg = document.createElement('div');
      noMatchMsg.className = 'insights-empty-state';
      noMatchMsg.style.padding = '2rem';
      noMatchMsg.innerHTML = `
        <div class="insights-empty-icon" style="font-size:2rem;">🔍</div>
        <p class="insights-empty-text">No models match your current filter for this homework.</p>
      `;
      body.appendChild(noMatchMsg);
    }

    card.appendChild(body);
    insightsGrid.appendChild(card);
  });

  els.homeworkInsightsBody.appendChild(insightsGrid);
}

// Enhanced text formatter with better sections
function formatInsightTextEnhanced(text) {
  if (!text) return "";
  
  // Split by numbered sections (1. **..., 2. **..., etc.)
  const sections = text.split(/(?=\d+\.\s+\*\*)/);
  let html = '';
  
  for (const section of sections) {
    if (!section.trim()) continue;
    
    // Check for section types
    const isEasiest = /easiest|hardest|problem/i.test(section.slice(0, 100));
    const isStrengths = /strengths?|best|success|excell/i.test(section.slice(0, 100));
    const isWeaknesses = /weakness|limitation|challenge|struggle|difficult/i.test(section.slice(0, 100));
    const isThemes = /theme|strateg|common|approach/i.test(section.slice(0, 100));
    const isTrends = /trend|performance|pattern/i.test(section.slice(0, 100));
    const isInsights = /insight|notable|observation|finding/i.test(section.slice(0, 100));
    
    let sectionClass = '';
    let sectionIcon = '📌';
    let sectionLabel = '';
    
    if (isStrengths) {
      sectionClass = 'insight-strengths';
      sectionIcon = '✅';
      sectionLabel = 'Strengths';
    } else if (isWeaknesses) {
      sectionClass = 'insight-weaknesses';
      sectionIcon = '⚠️';
      sectionLabel = 'Challenges';
    } else if (isEasiest) {
      sectionIcon = '🎯';
      sectionLabel = 'Problem Difficulty';
    } else if (isThemes) {
      sectionIcon = '💡';
      sectionLabel = 'Common Strategies';
    } else if (isTrends) {
      sectionIcon = '📈';
      sectionLabel = 'Performance Trends';
    } else if (isInsights) {
      sectionIcon = '🔎';
      sectionLabel = 'Key Insights';
    }
    
    // Format the section content
    let formatted = escapeHtml(section);
    
    // Format bold text
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Format lists
    formatted = formatted.replace(/(?:^|\n)[\s]*[-•]\s+/g, '<br>• ');
    
    // Format line breaks for readability
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Wrap in paragraph if not already
    if (!formatted.startsWith('<p>')) {
      formatted = `<p>${formatted}</p>`;
    }
    
    if (sectionClass) {
      html += `
        <div class="insight-section ${sectionClass}">
          <div class="insight-section-header">
            <span class="insight-section-icon">${sectionIcon}</span>
            <span>${sectionLabel}</span>
          </div>
          ${formatted}
        </div>
      `;
    } else if (sectionLabel) {
      html += `
        <div class="insight-section" style="background: var(--bg-inset); border: 1px solid var(--border);">
          <div class="insight-section-header" style="color: var(--fg-secondary);">
            <span class="insight-section-icon">${sectionIcon}</span>
            <span>${sectionLabel}</span>
          </div>
          ${formatted}
        </div>
      `;
    } else {
      html += formatted;
    }
  }
  
  return html || formatMarkdownText(text);
}

// -- INSIGHTS LOGIC END --

// -- MATRIX VIEW LOGIC --

// State for matrix orientation: false = models as rows, true = homeworks as rows
let matrixTransposed = false;

function renderMatrixView() {
  const container = document.getElementById("matrix-container");
  if (!container) return;
  
  // Collect all unique homeworks and models
  const homeworks = new Set();
  const models = new Set();
  
  for (const post of state.allPosts) {
    const m = post.metrics || {};
    if (m.homework_id) homeworks.add(m.homework_id);
    if (m.model_name) models.add(m.model_name);
  }
  
  // Sort homeworks numerically
  const sortedHomeworks = Array.from(homeworks).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });
  
  // Sort models alphabetically
  const sortedModels = Array.from(models).sort((a, b) => a.localeCompare(b));
  
  if (sortedHomeworks.length === 0 || sortedModels.length === 0) {
    container.innerHTML = `
      <div class="insights-empty-state">
        <div class="insights-empty-icon">📋</div>
        <div class="insights-empty-title">No data available</div>
        <p class="insights-empty-text">Posts need homework and model metadata to generate the matrix.</p>
      </div>
    `;
    return;
  }
  
  // Build a lookup: { modelName: { hwId: [posts] } }
  const matrix = {};
  for (const model of sortedModels) {
    matrix[model] = {};
    for (const hw of sortedHomeworks) {
      matrix[model][hw] = [];
    }
  }
  
  for (const post of state.allPosts) {
    const m = post.metrics || {};
    const hw = m.homework_id;
    const model = m.model_name;
    if (hw && model && matrix[model] && matrix[model][hw]) {
      matrix[model][hw].push(post);
    }
  }
  
  let html = '<table class="matrix-table">';
  
  if (matrixTransposed) {
    // TRANSPOSED: Homeworks as rows, Models as columns
    const modelTotals = {};
    sortedModels.forEach(m => modelTotals[m] = 0);
    
    // Header row with models
    html += '<thead><tr>';
    html += '<th class="matrix-corner-cell">HW \\ Model</th>';
    for (const model of sortedModels) {
      const shortName = shortenModelName(model);
      html += `<th class="matrix-hw-header" title="${escapeHtml(model)}">${escapeHtml(shortName)}</th>`;
    }
    html += '</tr></thead>';
    
    // Body rows for each homework
    html += '<tbody>';
    for (const hw of sortedHomeworks) {
      html += '<tr>';
      html += `<th>${escapeHtml(hw)}</th>`;
      
      for (const model of sortedModels) {
        const posts = matrix[model][hw];
        modelTotals[model] += posts.length;
        
        if (posts.length === 0) {
          html += '<td class="matrix-cell-empty">—</td>';
        } else {
          html += '<td><div class="matrix-cell-authors">';
          const displayPosts = posts.slice(0, 3);
          for (const post of displayPosts) {
            const authorName = post.user?.name || "Unknown";
            const shortAuthor = shortenAuthorName(authorName);
            html += `<a href="?thread=${post.number}" class="matrix-author-tag" title="${escapeHtml(authorName)}">${escapeHtml(shortAuthor)}</a>`;
          }
          if (posts.length > 3) {
            html += `<span class="matrix-author-count">+${posts.length - 3} more</span>`;
          }
          html += '</div></td>';
        }
      }
      html += '</tr>';
    }
    
    // Stats row with totals per model
    html += '<tr class="matrix-stats-row">';
    html += '<th>Total</th>';
    for (const model of sortedModels) {
      html += `<td>${modelTotals[model]}</td>`;
    }
    html += '</tr>';
  } else {
    // DEFAULT: Models as rows, Homeworks as columns
    const hwTotals = {};
    sortedHomeworks.forEach(hw => hwTotals[hw] = 0);
    
    // Header row with homeworks
    html += '<thead><tr>';
    html += '<th class="matrix-corner-cell">Model \\ HW</th>';
    for (const hw of sortedHomeworks) {
      html += `<th class="matrix-hw-header">${escapeHtml(hw)}</th>`;
    }
    html += '</tr></thead>';
    
    // Body rows for each model
    html += '<tbody>';
    for (const model of sortedModels) {
      html += '<tr>';
      const shortName = shortenModelName(model);
      html += `<th title="${escapeHtml(model)}">${escapeHtml(shortName)}</th>`;
      
      for (const hw of sortedHomeworks) {
        const posts = matrix[model][hw];
        hwTotals[hw] += posts.length;
        
        if (posts.length === 0) {
          html += '<td class="matrix-cell-empty">—</td>';
        } else {
          html += '<td><div class="matrix-cell-authors">';
          const displayPosts = posts.slice(0, 3);
          for (const post of displayPosts) {
            const authorName = post.user?.name || "Unknown";
            const shortAuthor = shortenAuthorName(authorName);
            html += `<a href="?thread=${post.number}" class="matrix-author-tag" title="${escapeHtml(authorName)}">${escapeHtml(shortAuthor)}</a>`;
          }
          if (posts.length > 3) {
            html += `<span class="matrix-author-count">+${posts.length - 3} more</span>`;
          }
          html += '</div></td>';
        }
      }
      html += '</tr>';
    }
    
    // Stats row with totals per homework
    html += '<tr class="matrix-stats-row">';
    html += '<th>Total</th>';
    for (const hw of sortedHomeworks) {
      html += `<td>${hwTotals[hw]}</td>`;
    }
    html += '</tr>';
  }
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

function toggleMatrixTranspose() {
  matrixTransposed = !matrixTransposed;
  renderMatrixView();
}

function shortenModelName(name) {
  // Shorten common model names for display in narrow columns
  const replacements = [
    [/ChatGPT[-\s]?5\.1\s*(Thinking|Extended)/gi, 'GPT-5.1'],
    [/ChatGPT[-\s]?5\.1/gi, 'GPT-5.1'],
    [/ChatGPT[-\s]?4o/gi, 'GPT-4o'],
    [/ChatGPT[-\s]?o3/gi, 'GPT-o3'],
    [/ChatGPT/gi, 'GPT'],
    [/Claude\s*Opus\s*4\.5.*Extended.*Thinking/gi, 'Opus 4.5 ET'],
    [/Claude\s*Opus\s*4\.5/gi, 'Opus 4.5'],
    [/Claude\s*Sonnet\s*4\.5/gi, 'Sonnet 4.5'],
    [/Claude/gi, 'Claude'],
    [/DeepSeek[-\s]?v?3\.2/gi, 'DeepSeek'],
    [/Deepseek/gi, 'DeepSeek'],
    [/Gemini\s*3\.?0?\s*Pro.*Thinking/gi, 'Gem 3 Pro'],
    [/Gemini\s*3\s*Pro/gi, 'Gem 3 Pro'],
    [/Gemini\s*2\.5\s*Flash/gi, 'Gem Flash'],
    [/Gemini\s*2\.5\s*Pro/gi, 'Gem 2.5 Pro'],
    [/Gemini\s*Flash/gi, 'Gem Flash'],
    [/Gemini\s*Pro/gi, 'Gem Pro'],
    [/Gemini/gi, 'Gemini'],
    [/Mistral\s*AI/gi, 'Mistral'],
    [/Le\s*Chat/gi, 'Mistral'],
    [/Kimi\s*K2/gi, 'Kimi K2'],
    [/Llama\s*4\s*Maverick/gi, 'Llama 4'],
    [/Perplexity\s*Sonar/gi, 'Perplexity'],
    [/gpt-oss-120b/gi, 'GPT-OSS'],
    [/GPT-Oss/gi, 'GPT-OSS'],
  ];
  
  let result = name;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  
  // Truncate if still too long
  if (result.length > 14) {
    result = result.slice(0, 12) + '…';
  }
  
  return result;
}

function shortenAuthorName(name) {
  // Try to get first name only, or truncate
  if (!name) return "?";
  
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    // Return first name + last initial
    const firstName = parts[0];
    const lastInitial = parts[parts.length - 1][0];
    const short = `${firstName} ${lastInitial}.`;
    if (short.length <= 12) return short;
    // If still too long, just first name
    return firstName.slice(0, 10);
  }
  
  // Single name - truncate if needed
  return name.length > 10 ? name.slice(0, 9) + '…' : name;
}

// -- END MATRIX VIEW LOGIC --

function renderModelInsights() {
  if (!state.insights || !state.insights.models || !els.modelInsightsBody) {
    return;
  }
  
  const modelData = state.insights.models;
  const modelNames = Object.keys(modelData).sort();
  
  if (modelNames.length === 0) {
    els.modelInsightsBody.innerHTML = `
      <div class="insights-empty-state">
        <div class="insights-empty-icon">🤖</div>
        <div class="insights-empty-title">No model insights available</div>
        <p class="insights-empty-text">Run the insights generator to create model summaries.</p>
      </div>
    `;
    return;
  }
  
  let html = `<div class="insights-grid">`;
  
  modelNames.forEach(model => {
    const data = modelData[model];
    const formattedSummary = formatInsightTextEnhanced(data.summary);
    
    html += `
      <details class="insight-card" open>
        <summary class="insight-card-header">
          <div class="insight-card-title-group">
            <div class="insight-card-icon">🤖</div>
            <div>
              <h3 class="insight-card-title">${escapeHtml(model)}</h3>
              <div class="insight-card-subtitle">Model Performance Summary</div>
            </div>
          </div>
          <div class="insight-card-meta">
            <span class="insight-card-stat">
              <span class="insight-card-stat-value">${data.post_count}</span> evaluation${data.post_count !== 1 ? 's' : ''}
            </span>
            <div class="insight-card-chevron">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
        </summary>
        <div class="insight-card-body">
          <div class="insight-summary-content">
            ${formattedSummary}
          </div>
        </div>
      </details>
    `;
  });
  
  html += '</div>';
  els.modelInsightsBody.innerHTML = html;
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
      .fullpage-qa-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .fullpage-qa-input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      /* Sidebar control styling */
      .sidebar-control-group {
        margin-bottom: 0.5rem;
      }
      .sidebar-select {
        width: 100%;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-panel);
        color: var(--fg-primary);
        font-size: 0.85rem;
        cursor: pointer;
      }
      .sidebar-select:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: var(--shadow-focus);
      }
      .sidebar-action-btn {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--fg-muted);
        width: 32px;
        height: 32px;
        border-radius: var(--radius-md);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .sidebar-action-btn:hover {
        background: var(--bg-inset);
        color: var(--fg-primary);
      }
      .sidebar-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        background: var(--bg-inset);
        border-radius: var(--radius-md);
      }
      .sidebar-loading[hidden] { display: none; }
      .loading-spinner-small {
        width: 20px;
        height: 20px;
        border: 2px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .progress-bar-small {
        width: 100%;
        height: 4px;
        background: var(--border);
        border-radius: 2px;
        overflow: hidden;
      }
      .progress-bar-small .progress-fill {
        height: 100%;
        background: var(--accent);
        transition: width 0.3s ease;
        width: 0%;
      }
      /* RAG toggle */
      .rag-toggle-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
      }
      .rag-toggle-input { display: none; }
      .rag-toggle-switch {
        width: 36px;
        height: 20px;
        background: var(--border);
        border-radius: 10px;
        position: relative;
        transition: background 0.2s;
      }
      .rag-toggle-switch::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: var(--bg-panel);
        border-radius: 50%;
        transition: transform 0.2s;
      }
      .rag-toggle-input:checked + .rag-toggle-switch {
        background: var(--accent);
      }
      .rag-toggle-input:checked + .rag-toggle-switch::after {
        transform: translateX(16px);
      }
      /* QA messages */
      .qa-message {
        max-width: 90%;
        padding: 0.75rem 1rem;
        border-radius: var(--radius-md);
        font-size: 0.9rem;
        line-height: 1.5;
      }
      .qa-message.qa-user {
        align-self: flex-end;
        background: var(--accent);
        color: white;
        border-bottom-right-radius: 2px;
      }
      .qa-message.qa-assistant {
        align-self: flex-start;
        background: var(--bg-inset);
        color: var(--fg-primary);
        border: 1px solid var(--border);
        border-bottom-left-radius: 2px;
      }
      .qa-status.ready { color: #22c55e !important; font-weight: 600; }
      .qa-status.loading { color: var(--accent) !important; }
      .qa-status.error { color: #ef4444 !important; }
      /* Message content styling */
      .message-content { overflow-wrap: break-word; }
      .message-content p { margin: 0 0 0.5rem 0; }
      .message-content p:last-child { margin-bottom: 0; }
      .message-content pre {
        background: rgba(0,0,0,0.1);
        padding: 0.5rem;
        border-radius: 4px;
        overflow-x: auto;
        font-size: 0.85rem;
      }
      .message-content code {
        background: rgba(0,0,0,0.1);
        padding: 0.1rem 0.3rem;
        border-radius: 3px;
        font-size: 0.85em;
      }
      .message-content pre code { background: none; padding: 0; }
      .message-content ul, .message-content ol {
        margin: 0.5rem 0;
        padding-left: 1.25rem;
      }
      .message-content blockquote {
        border-left: 3px solid var(--accent);
        margin: 0.5rem 0;
        padding-left: 0.75rem;
        color: var(--fg-muted);
      }
      .qa-message.streaming .message-content::after {
        content: "▋";
        animation: blink 1s infinite;
      }
      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
      /* KaTeX display */
      .katex-display {
        margin: 0.5rem 0;
        overflow-x: auto;
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
    <div class="fullpage-view sidebar-collapsed">
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
        <div class="fullpage-sidebar-header" style="display:flex; flex-direction:column; gap:0.75rem;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <h2 class="fullpage-sidebar-title">AI Assistant</h2>
              <div id="qa-status" class="qa-status" style="font-size:0.75rem; color:var(--fg-muted); margin-top:0.25rem;">Select a model to start</div>
            </div>
            <div style="display:flex; gap:0.5rem;">
              <button id="qa-clear" class="sidebar-action-btn" title="Clear conversation">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <button id="sidebar-collapse" class="sidebar-collapse-btn" title="Collapse sidebar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
          </div>
          
          <!-- Model Selection -->
          <div class="sidebar-control-group">
            <label for="qa-model-select" style="font-size:0.75rem; font-weight:600; color:var(--fg-secondary); margin-bottom:0.25rem; display:block;">Model</label>
            <select id="qa-model-select" class="sidebar-select">
              <option value="">Select a model...</option>
              <option value="Llama-3.2-1B-Instruct-q4f16_1-MLC">Llama 3.2 1B (fastest)</option>
              <option value="Llama-3.2-3B-Instruct-q4f16_1-MLC">Llama 3.2 3B (balanced)</option>
              <option value="SmolLM2-1.7B-Instruct-q4f16_1-MLC">SmolLM2 1.7B</option>
              <option value="Qwen2.5-1.5B-Instruct-q4f16_1-MLC">Qwen 2.5 1.5B</option>
            </select>
          </div>
          
          <!-- RAG Toggle -->
          <div class="sidebar-control-group" style="display:flex; align-items:center; justify-content:space-between;">
            <label class="rag-toggle-label" style="display:flex; align-items:center; gap:0.5rem;">
              <input type="checkbox" id="qa-rag-toggle" class="rag-toggle-input" />
              <span class="rag-toggle-switch"></span>
              <span style="font-size:0.8rem; font-weight:600;">RAG Mode</span>
            </label>
            <span id="qa-rag-status" style="font-size:0.7rem; color:var(--fg-muted);">Disabled</span>
          </div>
          
          <!-- Loading Progress -->
          <div id="qa-loading" class="sidebar-loading" hidden>
            <div class="loading-spinner-small"></div>
            <span id="qa-loading-text" style="font-size:0.75rem;">Loading...</span>
            <div class="progress-bar-small">
              <div id="qa-progress-fill" class="progress-fill"></div>
            </div>
          </div>
        </div>

        <div id="qa-messages" class="fullpage-qa-messages">
          <div class="qa-message qa-assistant">
             <div class="message-content"><p>Hi! Select a model above to start chatting. I can help you understand this thread and any attached documents.</p></div>
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
              disabled
            >
            <button type="submit" id="qa-send" class="fullpage-qa-send" disabled>Send</button>
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
  
  // Model selection handler
  const modelSelect = document.getElementById('qa-model-select');
  if (modelSelect) {
    // Check if shared engine exists and pre-select the model
    if (window.sharedLLMEngine) {
      state.qaEngine = window.sharedLLMEngine;
      state.qaWebllm = window.sharedLLMWebllm;
      const statusEl = document.getElementById('qa-status');
      if (statusEl) {
        statusEl.textContent = '✓ Model ready (shared)';
        statusEl.className = 'qa-status ready';
      }
      const inputEl = document.getElementById('qa-input');
      const sendEl = document.getElementById('qa-send');
      const messagesEl = document.getElementById('qa-messages');
      if (inputEl) inputEl.disabled = false;
      if (sendEl) sendEl.disabled = false;
      if (messagesEl) {
        messagesEl.innerHTML = `
          <div class="qa-message qa-assistant">
            <div class="message-content"><p>✓ <strong>Model ready!</strong> Ask me anything about this thread or the attached documents.</p></div>
          </div>
        `;
      }
    }
    
    modelSelect.addEventListener('change', async () => {
      const selectedModel = modelSelect.value;
      if (!selectedModel) return;
      
      // If we already have a shared engine, skip loading
      if (window.sharedLLMEngine) {
        state.qaEngine = window.sharedLLMEngine;
        state.qaWebllm = window.sharedLLMWebllm;
        const statusEl = document.getElementById('qa-status');
        if (statusEl) {
          statusEl.textContent = '✓ Model ready (shared)';
          statusEl.className = 'qa-status ready';
        }
        const inputEl = document.getElementById('qa-input');
        const sendEl = document.getElementById('qa-send');
        const messagesEl = document.getElementById('qa-messages');
        if (inputEl) inputEl.disabled = false;
        if (sendEl) sendEl.disabled = false;
        if (messagesEl) {
          messagesEl.innerHTML = `
            <div class="qa-message qa-assistant">
              <div class="message-content"><p>✓ <strong>Model ready!</strong> Ask me anything about this thread or the attached documents.</p></div>
            </div>
          `;
        }
        return;
      }
      
      await initFullPageQaEngine(selectedModel);
    });
  }
  
  // RAG toggle handler
  const ragToggle = document.getElementById('qa-rag-toggle');
  if (ragToggle) {
    ragToggle.addEventListener('change', async () => {
      const ragStatus = document.getElementById('qa-rag-status');
      if (ragToggle.checked) {
        if (ragStatus) ragStatus.textContent = 'Initializing...';
        // RAG would need to be initialized here - for now just show status
        if (ragStatus) ragStatus.textContent = 'Enabled';
      } else {
        if (ragStatus) ragStatus.textContent = 'Disabled';
      }
    });
  }
  
  // Clear chat handler
  const clearBtn = document.getElementById('qa-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const messagesContainer = document.getElementById('qa-messages');
      if (messagesContainer) {
        messagesContainer.innerHTML = `
          <div class="qa-message qa-assistant">
            <div class="message-content"><p>Conversation cleared. How can I help you with this thread?</p></div>
          </div>
        `;
      }
    });
  }
  
  // Load rendering libraries for markdown/LaTeX
  if (window.loadRenderingLibraries) {
    window.loadRenderingLibraries();
  }
}

/**
 * Initialize QA engine for full page view with progress feedback
 */
async function initFullPageQaEngine(modelId) {
  const statusEl = document.getElementById('qa-status');
  const loadingEl = document.getElementById('qa-loading');
  const loadingText = document.getElementById('qa-loading-text');
  const progressFill = document.getElementById('qa-progress-fill');
  const inputEl = document.getElementById('qa-input');
  const sendEl = document.getElementById('qa-send');
  
  if (!navigator.gpu) {
    if (statusEl) {
      statusEl.textContent = 'WebGPU not supported';
      statusEl.className = 'qa-status error';
    }
    return;
  }
  
  try {
    if (loadingEl) loadingEl.hidden = false;
    if (statusEl) {
      statusEl.textContent = 'Loading model...';
      statusEl.className = 'qa-status loading';
    }
    
    if (!state.qaWebllm) {
      if (loadingText) loadingText.textContent = 'Loading WebLLM library...';
      state.qaWebllm = await import("https://esm.run/@mlc-ai/web-llm");
    }
    
    if (loadingText) loadingText.textContent = `Loading ${modelId}...`;
    
    state.qaEngine = await state.qaWebllm.CreateMLCEngine(modelId, {
      initProgressCallback: (progress) => {
        const percent = Math.round(progress.progress * 100);
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (loadingText) loadingText.textContent = progress.text || 'Loading...';
      },
    });
    
    // Share engine globally
    window.sharedLLMEngine = state.qaEngine;
    window.sharedLLMWebllm = state.qaWebllm;
    
    if (loadingEl) loadingEl.hidden = true;
    if (statusEl) {
      statusEl.textContent = '✓ Model ready';
      statusEl.className = 'qa-status ready';
    }
    if (inputEl) inputEl.disabled = false;
    if (sendEl) sendEl.disabled = false;
    if (inputEl) inputEl.focus();
    
    // Update messages area with ready message
    const messagesEl = document.getElementById('qa-messages');
    if (messagesEl) {
      messagesEl.innerHTML = `
        <div class="qa-message qa-assistant">
          <div class="message-content"><p>✓ <strong>Model ready!</strong> Ask me anything about this thread or the attached documents.</p></div>
        </div>
      `;
    }
    
    // Load rendering libraries
    if (window.loadRenderingLibraries) {
      await window.loadRenderingLibraries();
    }
    
  } catch (err) {
    console.error('Failed to init QA engine:', err);
    if (loadingEl) loadingEl.hidden = true;
    if (statusEl) {
      statusEl.textContent = 'Failed to load model';
      statusEl.className = 'qa-status error';
    }
  }
}

// -- ANALYZER FUNCTIONS --

async function initAnalyzerEngine(modelId) {
  if (state.analyzerLoading) return;
  
  state.analyzerLoading = true;
  
  if (els.overviewLoading) els.overviewLoading.classList.add("is-visible");
  if (els.overviewAnalyzerStatus) {
    els.overviewAnalyzerStatus.textContent = "Loading...";
    els.overviewAnalyzerStatus.className = "analyzer-status-badge loading";
  }
  
  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported");
    }
    
    // Try to use shared engine first
    if (window.sharedLLMEngine && window.sharedLLMWebllm) {
      state.analyzerEngine = window.sharedLLMEngine;
      state.analyzerWebllm = window.sharedLLMWebllm;
      
      if (els.overviewLoading) els.overviewLoading.classList.remove("is-visible");
      if (els.overviewAnalyzerStatus) {
        els.overviewAnalyzerStatus.textContent = "✓ Ready";
        els.overviewAnalyzerStatus.className = "analyzer-status-badge ready";
      }
      if (els.analyzeAllBtn) els.analyzeAllBtn.disabled = false;
      renderPosts(); // Re-render to enable analyze buttons
      return;
    }
    
    // Load WebLLM
    if (!state.analyzerWebllm) {
      if (els.overviewLoadingText) els.overviewLoadingText.textContent = "Loading WebLLM...";
      state.analyzerWebllm = await import("https://esm.run/@mlc-ai/web-llm");
    }
    
    if (els.overviewLoadingText) els.overviewLoadingText.textContent = `Loading model...`;
    
    state.analyzerEngine = await state.analyzerWebllm.CreateMLCEngine(modelId, {
      initProgressCallback: (progress) => {
        const percent = Math.round(progress.progress * 100);
        if (els.overviewProgressFill) els.overviewProgressFill.style.width = `${percent}%`;
        if (els.overviewLoadingText) els.overviewLoadingText.textContent = progress.text || "Loading...";
      },
    });
    
    // Share globally
    window.sharedLLMEngine = state.analyzerEngine;
    window.sharedLLMWebllm = state.analyzerWebllm;
    
    if (els.overviewLoading) els.overviewLoading.classList.remove("is-visible");
    if (els.overviewAnalyzerStatus) {
      els.overviewAnalyzerStatus.textContent = "✓ Ready";
      els.overviewAnalyzerStatus.className = "analyzer-status-badge ready";
    }
    if (els.analyzeAllBtn) els.analyzeAllBtn.disabled = false;
    renderPosts(); // Re-render to enable analyze buttons
    
    // Notify judge panel that engine is ready
    window.dispatchEvent(new CustomEvent("analyzer-engine-ready"));
    
  } catch (err) {
    console.error("Failed to load analyzer:", err);
    if (els.overviewLoading) els.overviewLoading.classList.remove("is-visible");
    if (els.overviewAnalyzerStatus) {
      els.overviewAnalyzerStatus.textContent = "Error";
      els.overviewAnalyzerStatus.className = "analyzer-status-badge error";
    }
  } finally {
    state.analyzerLoading = false;
  }
}

function buildAnalyzerPrompt(post) {
  const m = post.metrics || {};
  const hw = m.homework_id || "Unknown";
  const model = m.model_name || "Unknown";
  
  let content = post.document || "";
  if (content.length > 2500) {
    content = content.slice(0, 2500) + "...";
  }
  
  return `You are evaluating how well an AI model (${model}) performed on homework (${hw}) based on a student's report.

STUDENT REPORT:
Title: ${post.title || "Untitled"}
${content}

Score how well ${model} performed (NOT the report quality):
1 = Very Poor: Most answers wrong, fundamental errors
2 = Poor: Significant mistakes, struggled with key concepts
3 = Mediocre: Mixed performance, some correct, some errors
4 = Good: Most things correct, minor mistakes only
5 = Excellent: Correct answers, strong reasoning, minimal errors

Respond ONLY with JSON: {"score": <1-5>, "reasoning": "<brief explanation>"}`;
}

async function analyzePost(post) {
  if (!state.analyzerEngine) return null;
  
  const prompt = buildAnalyzerPrompt(post);
  
  try {
    const response = await state.analyzerEngine.chat.completions.create({
      messages: [
        { role: "system", content: "You are a precise evaluator. Respond with valid JSON only." },
        { role: "user", content: prompt }
      ],
      max_tokens: 150,
      temperature: 0.3,
    });
    
    const text = response.choices[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const score = Math.min(5, Math.max(1, Math.round(parsed.score || 3)));
      return {
        score,
        reasoning: parsed.reasoning || "No reasoning provided",
        hw: post.metrics?.homework_id || "Unknown",
        model: post.metrics?.model_name || "Unknown",
        title: post.title || "Untitled",
        postId: post.id,
      };
    }
    
    // Fallback
    const numMatch = text.match(/\b([1-5])\b/);
    return {
      score: numMatch ? parseInt(numMatch[1], 10) : 3,
      reasoning: "Score extracted from response",
      hw: post.metrics?.homework_id || "Unknown",
      model: post.metrics?.model_name || "Unknown",
      title: post.title || "Untitled",
      postId: post.id,
    };
  } catch (err) {
    console.error("Analyze error:", err);
    return {
      score: 3,
      reasoning: "Error during analysis",
      hw: post.metrics?.homework_id || "Unknown",
      model: post.metrics?.model_name || "Unknown",
      title: post.title || "Untitled",
      postId: post.id,
    };
  }
}

async function analyzeSinglePost(postId) {
  const post = state.allPosts.find(p => p.id === postId);
  if (!post || !state.analyzerEngine) return;
  
  // Find and update button state
  const btn = document.querySelector(`.btn-analyze[data-post-id="${postId}"]`);
  if (btn) {
    btn.classList.add("is-analyzing");
    btn.disabled = true;
    btn.innerHTML = `<span>Analyzing...</span>`;
  }
  
  const result = await analyzePost(post);
  if (result) {
    state.analyzerScores.set(postId, result);
    if (els.clearScoresBtn) els.clearScoresBtn.disabled = false;
    if (els.analyzeProgress) els.analyzeProgress.textContent = `${state.analyzerScores.size} posts scored`;
    renderPosts();
    updateScoreSummary();
    // Notify judge panel immediately
    window.dispatchEvent(new CustomEvent("analyzer-scores-updated"));
  }
}

async function analyzeAllPosts() {
  if (!state.analyzerEngine || state.analyzerRunning) return;
  
  state.analyzerRunning = true;
  window.sharedAnalyzerState.isRunning = true;
  if (els.analyzeAllBtn) els.analyzeAllBtn.disabled = true;
  if (els.clearScoresBtn) els.clearScoresBtn.disabled = true;
  
  const total = state.allPosts.length;
  let completed = 0;
  let newlyScored = 0;
  
  for (const post of state.allPosts) {
    if (state.analyzerScores.has(post.id)) {
      completed++;
      continue;
    }
    
    if (els.analyzeProgress) {
      els.analyzeProgress.textContent = `Analyzing ${completed + 1}/${total}...`;
    }
    
    const result = await analyzePost(post);
    if (result) {
      state.analyzerScores.set(post.id, result);
      newlyScored++;
    }
    
    completed++;
    
    // Update UI after every new score (real-time updates)
    renderPosts();
    updateScoreSummary();
    // Notify judge panel for every score
    window.dispatchEvent(new CustomEvent("analyzer-scores-updated"));
    
    await new Promise(r => setTimeout(r, 50));
  }
  
  state.analyzerRunning = false;
  window.sharedAnalyzerState.isRunning = false;
  if (els.analyzeAllBtn) els.analyzeAllBtn.disabled = false;
  if (els.clearScoresBtn) els.clearScoresBtn.disabled = false;
  if (els.analyzeProgress) els.analyzeProgress.textContent = `${state.analyzerScores.size} posts scored`;
  
  renderPosts();
  updateScoreSummary();
  // Final notification
  window.dispatchEvent(new CustomEvent("analyzer-scores-updated"));
}

function clearAnalyzerScores() {
  state.analyzerScores.clear();
  if (els.clearScoresBtn) els.clearScoresBtn.disabled = true;
  if (els.analyzeProgress) els.analyzeProgress.textContent = "";
  renderPosts();
  updateScoreSummary();
  // Notify judge panel
  window.dispatchEvent(new CustomEvent("analyzer-scores-updated"));
}

function updateScoreSummary() {
  if (!els.scoreSummary) return;
  
  const scores = Array.from(state.analyzerScores.values());
  if (scores.length === 0) {
    els.scoreSummary.classList.remove("has-scores");
    els.scoreSummary.innerHTML = "";
    return;
  }
  
  // Calculate stats
  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const scoreCounts = [0, 0, 0, 0, 0, 0]; // index 1-5
  scores.forEach(s => scoreCounts[s.score]++);
  
  // Group by model
  const modelScores = {};
  scores.forEach(s => {
    if (!modelScores[s.model]) modelScores[s.model] = [];
    modelScores[s.model].push(s.score);
  });
  
  // Find best/worst model
  let bestModel = { name: "", avg: 0 };
  let worstModel = { name: "", avg: 6 };
  Object.entries(modelScores).forEach(([name, modelScoreList]) => {
    const avg = modelScoreList.reduce((a, b) => a + b, 0) / modelScoreList.length;
    if (avg > bestModel.avg) bestModel = { name, avg };
    if (avg < worstModel.avg) worstModel = { name, avg };
  });
  
  const scoreClass = `score-${Math.round(avgScore)}`;
  
  els.scoreSummary.classList.add("has-scores");
  els.scoreSummary.innerHTML = `
    <div class="score-summary-grid">
      <div class="score-summary-item">
        <div class="score-summary-label">Posts Scored</div>
        <div class="score-summary-value">${scores.length}</div>
      </div>
      <div class="score-summary-item">
        <div class="score-summary-label">Avg Performance</div>
        <div class="score-summary-value ${scoreClass}">${avgScore.toFixed(1)}</div>
      </div>
      <div class="score-summary-item">
        <div class="score-summary-label">Top Performer</div>
        <div class="score-summary-value score-4" style="font-size:1rem;">${escapeHtml(bestModel.name) || "-"}</div>
      </div>
      <div class="score-summary-item">
        <div class="score-summary-label">Needs Work</div>
        <div class="score-summary-value score-2" style="font-size:1rem;">${escapeHtml(worstModel.name) || "-"}</div>
      </div>
    </div>
  `;
}

// Track if analyzer listeners have been added
let analyzerListenersAttached = false;

function handleAnalyzerScoresUpdated() {
  renderPosts();
  updateScoreSummary();
  // Update button states
  if (els.clearScoresBtn) {
    els.clearScoresBtn.disabled = state.analyzerScores.size === 0;
  }
  if (els.analyzeProgress && state.analyzerScores.size > 0) {
    els.analyzeProgress.textContent = `${state.analyzerScores.size} posts scored`;
  }
}

function handleAnalyzerEngineReady() {
  if (els.overviewAnalyzerStatus) {
    els.overviewAnalyzerStatus.textContent = "✓ Ready";
    els.overviewAnalyzerStatus.className = "analyzer-status-badge ready";
  }
  if (els.analyzeAllBtn) els.analyzeAllBtn.disabled = false;
  renderPosts();
}

function attachAnalyzerEvents() {
  // Model select
  if (els.overviewModelSelect) {
    els.overviewModelSelect.addEventListener("change", () => {
      const modelId = els.overviewModelSelect.value;
      if (modelId) initAnalyzerEngine(modelId);
    });
  }
  
  // Analyze all button
  if (els.analyzeAllBtn) {
    els.analyzeAllBtn.addEventListener("click", analyzeAllPosts);
  }
  
  // Clear scores button
  if (els.clearScoresBtn) {
    els.clearScoresBtn.addEventListener("click", clearAnalyzerScores);
  }
  
  // Delegate click for individual analyze buttons
  if (els.postsList) {
    els.postsList.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-analyze");
      if (btn && !btn.disabled) {
        const postId = parseInt(btn.dataset.postId, 10);
        if (postId) analyzeSinglePost(postId);
      }
    });
  }
  
  // Add global listeners only once
  if (!analyzerListenersAttached) {
    analyzerListenersAttached = true;
    window.addEventListener("analyzer-scores-updated", handleAnalyzerScoresUpdated);
    window.addEventListener("analyzer-engine-ready", handleAnalyzerEngineReady);
  }
  
  // Check if shared engine already exists
  if (window.sharedAnalyzerState?.engine || window.sharedLLMEngine) {
    state.analyzerEngine = window.sharedAnalyzerState?.engine || window.sharedLLMEngine;
    state.analyzerWebllm = window.sharedAnalyzerState?.webllm || window.sharedLLMWebllm;
    if (els.overviewAnalyzerStatus) {
      els.overviewAnalyzerStatus.textContent = "✓ Ready";
      els.overviewAnalyzerStatus.className = "analyzer-status-badge ready";
    }
    if (els.analyzeAllBtn) els.analyzeAllBtn.disabled = false;
    // Update score summary if there are existing scores
    if (state.analyzerScores.size > 0) {
      updateScoreSummary();
      if (els.clearScoresBtn) els.clearScoresBtn.disabled = false;
    }
  }
}

// -- INIT --

async function init() {
  cacheElements();
  initThemePreference();
  attachEvents();
  attachAnalyzerEvents();

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
    renderMatrixView();
    
    // Attach matrix transpose button listener
    const transposeBtn = document.getElementById("transpose-matrix-btn");
    if (transposeBtn) {
      transposeBtn.addEventListener("click", toggleMatrixTranspose);
    }
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