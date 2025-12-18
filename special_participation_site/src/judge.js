/**
 * LLM as Judge Module
 * Uses WebLLM to evaluate and score model-homework reports on a scale from 1-5
 * Provides multiple visualization modes for the judging results
 * 
 * Shares state with the Overview analyzer panel via window.sharedAnalyzerState
 */

const DATA_URL = "public/data/posts_processed.json";
const MANIFEST_URL = "files/manifest.json";

// Initialize shared state if not exists
if (!window.sharedAnalyzerState) {
  window.sharedAnalyzerState = {
    engine: null,
    webllm: null,
    scores: new Map(), // postId -> { score, reasoning, hw, model }
    isLoading: false,
    isRunning: false,
  };
}

// Local state (UI-specific)
const judgeState = {
  get engine() { return window.sharedAnalyzerState.engine; },
  set engine(v) { window.sharedAnalyzerState.engine = v; },
  get webllm() { return window.sharedAnalyzerState.webllm; },
  set webllm(v) { window.sharedAnalyzerState.webllm = v; },
  get results() { return window.sharedAnalyzerState.scores; },
  isLoading: false,
  isJudging: false,
  currentModel: null,
  posts: [],
  filesManifest: {},
  currentViz: "by-homework",
  currentFilter: "",
};

// DOM Elements
const els = {};

function cacheElements() {
  els.modelSelect = document.getElementById("judge-model-select");
  els.status = document.getElementById("judge-status");
  els.loading = document.getElementById("judge-loading");
  els.loadingText = document.getElementById("judge-loading-text");
  els.progressFill = document.getElementById("judge-progress-fill");
  els.runAllBtn = document.getElementById("judge-run-all");
  els.clearBtn = document.getElementById("judge-clear");
  els.progressText = document.getElementById("judge-progress-text");
  els.chartContainer = document.getElementById("judge-chart-container");
  els.chartLegend = document.getElementById("judge-chart-legend");
  els.resultsTable = document.getElementById("judge-results-table");
  els.filterSelect = document.getElementById("judge-filter-select");
  els.filterLabel = document.getElementById("judge-filter-label");
  els.vizTabs = document.querySelectorAll(".judge-viz-tab");
}

function attachEvents() {
  if (els.modelSelect) {
    els.modelSelect.addEventListener("change", handleModelChange);
  }
  if (els.runAllBtn) {
    els.runAllBtn.addEventListener("click", runJudgeOnAll);
  }
  if (els.clearBtn) {
    els.clearBtn.addEventListener("click", clearResults);
  }
  if (els.filterSelect) {
    els.filterSelect.addEventListener("change", handleFilterChange);
  }
  els.vizTabs.forEach((tab) => {
    tab.addEventListener("click", () => handleVizChange(tab.dataset.viz));
  });
}

async function loadData() {
  if (judgeState.posts.length > 0) return;

  try {
    const [postsRes, manifestRes] = await Promise.all([
      fetch(DATA_URL, { cache: "no-store" }),
      fetch(MANIFEST_URL, { cache: "no-store" }),
    ]);

    if (postsRes.ok) {
      judgeState.posts = await postsRes.json();
    }
    if (manifestRes.ok) {
      judgeState.filesManifest = await manifestRes.json();
    }

    populateFilters();
  } catch (err) {
    console.error("Failed to load data for judge:", err);
  }
}

function populateFilters() {
  const homeworks = new Set();
  const models = new Set();

  judgeState.posts.forEach((post) => {
    const m = post.metrics || {};
    if (m.homework_id) homeworks.add(m.homework_id);
    if (m.model_name) models.add(m.model_name);
  });

  // Store for later use
  judgeState.allHomeworks = Array.from(homeworks).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
    return numA - numB;
  });
  judgeState.allModels = Array.from(models).sort();

  updateFilterOptions();
}

function updateFilterOptions() {
  if (!els.filterSelect) return;

  const viz = judgeState.currentViz;

  if (viz === "by-homework") {
    els.filterLabel.textContent = "Select Homework:";
    els.filterSelect.innerHTML =
      `<option value="">-- Select a homework --</option>` +
      judgeState.allHomeworks
        .map((hw) => `<option value="${hw}">${hw}</option>`)
        .join("");
    els.filterSelect.parentElement.style.display = "block";
  } else if (viz === "by-model") {
    els.filterLabel.textContent = "Select Model:";
    els.filterSelect.innerHTML =
      `<option value="">-- Select a model --</option>` +
      judgeState.allModels
        .map((m) => `<option value="${m}">${m}</option>`)
        .join("");
    els.filterSelect.parentElement.style.display = "block";
  } else {
    // Holistic views don't need filter
    els.filterSelect.parentElement.style.display = "none";
  }

  judgeState.currentFilter = "";
  renderChart();
}

function handleFilterChange() {
  judgeState.currentFilter = els.filterSelect.value;
  renderChart();
}

function handleVizChange(viz) {
  judgeState.currentViz = viz;

  els.vizTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.viz === viz);
  });

  updateFilterOptions();
}

async function handleModelChange() {
  const newModel = els.modelSelect.value;
  if (!newModel) {
    els.status.textContent = "Select model to start";
    els.status.className = "judge-status";
    els.runAllBtn.disabled = true;
    return;
  }

  if (newModel === judgeState.currentModel && judgeState.engine) {
    return;
  }

  // Reset engine if switching models
  if (judgeState.engine) {
    try {
      await judgeState.engine.unload();
    } catch (e) {
      console.warn("Error unloading engine:", e);
    }
    judgeState.engine = null;
  }

  judgeState.isLoading = true;
  els.loading.classList.add("is-visible");
  els.runAllBtn.disabled = true;
  els.status.textContent = "Loading model...";
  els.status.className = "judge-status loading";

  try {
    // Check WebGPU
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported. Please use Chrome 113+ or Edge 113+.");
    }

    // Try to use shared engine first
    if (window.sharedLLMEngine && window.sharedLLMWebllm) {
      judgeState.engine = window.sharedLLMEngine;
      judgeState.webllm = window.sharedLLMWebllm;
      judgeState.currentModel = "shared";

      els.loading.classList.remove("is-visible");
      els.status.textContent = "✓ Using shared model";
      els.status.className = "judge-status ready";
      els.runAllBtn.disabled = false;
      els.clearBtn.disabled = judgeState.results.size === 0;
      return;
    }

    // Load WebLLM
    if (!judgeState.webllm) {
      els.loadingText.textContent = "Loading WebLLM library...";
      judgeState.webllm = await import("https://esm.run/@mlc-ai/web-llm");
    }

    els.loadingText.textContent = `Loading ${getModelDisplayName(newModel)}...`;

    judgeState.engine = await judgeState.webllm.CreateMLCEngine(newModel, {
      initProgressCallback: (progress) => {
        const percent = Math.round(progress.progress * 100);
        els.progressFill.style.width = `${percent}%`;
        if (progress.text) {
          els.loadingText.textContent = progress.text;
        }
      },
    });

    judgeState.currentModel = newModel;

    // Share globally
    window.sharedLLMEngine = judgeState.engine;
    window.sharedLLMWebllm = judgeState.webllm;

    els.loading.classList.remove("is-visible");
    els.status.textContent = `✓ ${getModelDisplayName(newModel)} ready`;
    els.status.className = "judge-status ready";
    els.runAllBtn.disabled = false;
    els.clearBtn.disabled = judgeState.results.size === 0;
    
    // Notify overview panel that engine is ready
    window.dispatchEvent(new CustomEvent("analyzer-engine-ready"));
  } catch (err) {
    console.error("Failed to load judge model:", err);
    els.loading.classList.remove("is-visible");
    els.status.textContent = "Error loading model";
    els.status.className = "judge-status error";
    els.runAllBtn.disabled = true;
  } finally {
    judgeState.isLoading = false;
  }
}

function getModelDisplayName(modelId) {
  const names = {
    "Llama-3.2-1B-Instruct-q4f16_1-MLC": "Llama 3.2 1B",
    "Llama-3.2-3B-Instruct-q4f16_1-MLC": "Llama 3.2 3B",
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": "Qwen 2.5 1.5B",
  };
  return names[modelId] || modelId;
}

function buildJudgePrompt(post) {
  const m = post.metrics || {};
  const hw = m.homework_id || "Unknown";
  const model = m.model_name || "Unknown";

  let content = post.document || "";
  if (content.length > 2500) {
    content = content.slice(0, 2500) + "...";
  }

  return `You are evaluating how well an AI model (${model}) performed on a homework assignment (${hw}) based on a student's report.

STUDENT REPORT ABOUT ${model}'s PERFORMANCE ON ${hw}:
Title: ${post.title || "Untitled"}

Report:
${content}

YOUR TASK: Based on the student's description, score how well ${model} performed on the homework problems.

SCORING CRITERIA (how well the MODEL did, NOT the report quality):
1 = Very Poor: Model got most answers wrong, made fundamental errors, showed poor understanding
2 = Poor: Model made significant mistakes, struggled with key concepts, needed much correction
3 = Mediocre: Model got some things right but made notable errors, mixed performance
4 = Good: Model performed well overall, got most things correct, minor mistakes only
5 = Excellent: Model performed excellently, correct answers, strong reasoning, minimal/no errors

Look for indicators like:
- Did the report say the model got answers correct or incorrect?
- Did the model need reprompting or corrections?
- Did the student describe the model as doing "well", "poorly", "struggling", etc.?
- Were there mentions of mistakes, errors, or wrong answers?
- Did the model demonstrate good understanding or make conceptual errors?

Respond ONLY with a JSON object in this exact format:
{"score": <number 1-5>, "reasoning": "<brief explanation of how the model performed>"}`;
}

async function judgePost(post) {
  if (!judgeState.engine) return null;

  const prompt = buildJudgePrompt(post);

  try {
    const response = await judgeState.engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a precise evaluator. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    const text = response.choices[0]?.message?.content || "";

    // Try to parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const score = Math.min(5, Math.max(1, Math.round(parsed.score || 3)));
      return {
        score,
        reasoning: parsed.reasoning || "No reasoning provided",
        hw: post.metrics?.homework_id || "Unknown",
        model: post.metrics?.model_name || "Unknown",
        title: post.title,
        postId: post.id,
      };
    }

    // Fallback: try to extract just a number
    const numMatch = text.match(/\b([1-5])\b/);
    if (numMatch) {
      return {
        score: parseInt(numMatch[1], 10),
        reasoning: "Score extracted from response",
        hw: post.metrics?.homework_id || "Unknown",
        model: post.metrics?.model_name || "Unknown",
        title: post.title,
        postId: post.id,
      };
    }

    return {
      score: 3,
      reasoning: "Could not parse response, defaulting to 3",
      hw: post.metrics?.homework_id || "Unknown",
      model: post.metrics?.model_name || "Unknown",
      title: post.title,
      postId: post.id,
    };
  } catch (err) {
    console.error("Error judging post:", err);
    return {
      score: 3,
      reasoning: "Error during evaluation",
      hw: post.metrics?.homework_id || "Unknown",
      model: post.metrics?.model_name || "Unknown",
      title: post.title,
      postId: post.id,
    };
  }
}

async function runJudgeOnAll() {
  if (!judgeState.engine || judgeState.isJudging) return;

  await loadData();

  if (judgeState.posts.length === 0) {
    els.progressText.textContent = "No posts to evaluate";
    return;
  }

  judgeState.isJudging = true;
  els.runAllBtn.disabled = true;
  els.clearBtn.disabled = true;
  els.status.textContent = "Judging...";
  els.status.className = "judge-status loading";

  const total = judgeState.posts.length;
  let completed = 0;

  for (const post of judgeState.posts) {
    // Skip if already judged
    if (judgeState.results.has(post.id)) {
      completed++;
      continue;
    }

    els.progressText.textContent = `Evaluating ${completed + 1}/${total}...`;

    const result = await judgePost(post);
    if (result) {
      judgeState.results.set(post.id, result);
    }

    completed++;

    // Update progress and render periodically
    if (completed % 5 === 0 || completed === total) {
      renderChart();
      renderResultsTable();
      // Notify overview panel
      window.dispatchEvent(new CustomEvent("analyzer-scores-updated"));
    }

    // Small delay to prevent overwhelming
    await new Promise((r) => setTimeout(r, 100));
  }

  judgeState.isJudging = false;
  els.runAllBtn.disabled = false;
  els.clearBtn.disabled = false;
  els.status.textContent = `✓ Evaluated ${total} reports`;
  els.status.className = "judge-status ready";
  els.progressText.textContent = `${total} reports scored`;

  renderChart();
  renderResultsTable();
  // Notify overview panel
  window.dispatchEvent(new CustomEvent("analyzer-scores-updated"));
}

function clearResults() {
  judgeState.results.clear();
  els.progressText.textContent = "";
  els.clearBtn.disabled = true;

  renderChart();
  renderResultsTable();
  // Notify overview panel
  window.dispatchEvent(new CustomEvent("analyzer-scores-updated"));
}

function renderChart() {
  if (!els.chartContainer) return;

  const results = Array.from(judgeState.results.values());

  if (results.length === 0) {
    els.chartContainer.innerHTML = `
      <div class="judge-chart-placeholder">
        <div class="judge-chart-placeholder-icon">📊</div>
        <p>Load a model and run the judge to see visualizations</p>
      </div>
    `;
    els.chartLegend.innerHTML = "";
    return;
  }

  const viz = judgeState.currentViz;

  if (viz === "by-homework") {
    renderByHomeworkChart(results);
  } else if (viz === "by-model") {
    renderByModelChart(results);
  } else if (viz === "homework-holistic") {
    renderHomeworkHolisticChart(results);
  } else if (viz === "model-holistic") {
    renderModelHolisticChart(results);
  }
}

function renderByHomeworkChart(results) {
  // Require a homework selection
  if (!judgeState.currentFilter) {
    els.chartContainer.innerHTML = `
      <div class="judge-chart-placeholder">
        <div class="judge-chart-placeholder-icon">📚</div>
        <p>Select a homework above to see how different models performed on it</p>
      </div>
    `;
    els.chartLegend.innerHTML = "";
    return;
  }

  // Filter by selected homework
  const filtered = results.filter((r) => r.hw === judgeState.currentFilter);

  // Group by model for the selected homework
  const grouped = {};
  filtered.forEach((r) => {
    if (!grouped[r.model]) grouped[r.model] = [];
    grouped[r.model].push(r.score);
  });

  // Calculate averages
  const data = Object.entries(grouped)
    .map(([model, scores]) => ({
      label: model,
      value: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    }))
    .sort((a, b) => b.value - a.value);

  const title = `Model Performance on ${judgeState.currentFilter}`;

  renderBarChart(data, title, "Model", "Avg Performance Score");
}

function renderByModelChart(results) {
  // Require a model selection
  if (!judgeState.currentFilter) {
    els.chartContainer.innerHTML = `
      <div class="judge-chart-placeholder">
        <div class="judge-chart-placeholder-icon">🤖</div>
        <p>Select a model above to see how it performed across different homeworks</p>
      </div>
    `;
    els.chartLegend.innerHTML = "";
    return;
  }

  // Filter by selected model
  const filtered = results.filter((r) => r.model === judgeState.currentFilter);

  // Group by homework
  const grouped = {};
  filtered.forEach((r) => {
    if (!grouped[r.hw]) grouped[r.hw] = [];
    grouped[r.hw].push(r.score);
  });

  // Calculate averages
  const data = Object.entries(grouped)
    .map(([hw, scores]) => ({
      label: hw,
      value: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    }))
    .sort((a, b) => {
      const numA = parseInt(a.label.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.label.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });

  const title = `${judgeState.currentFilter} Performance by Homework`;

  renderBarChart(data, title, "Homework", "Avg Performance Score");
}

function renderHomeworkHolisticChart(results) {
  // Average score by homework (across all models)
  const grouped = {};
  results.forEach((r) => {
    if (!grouped[r.hw]) grouped[r.hw] = [];
    grouped[r.hw].push(r.score);
  });

  const data = Object.entries(grouped)
    .map(([hw, scores]) => ({
      label: hw,
      value: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    }))
    .sort((a, b) => {
      const numA = parseInt(a.label.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.label.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });

  renderBarChart(
    data,
    "Average Model Performance by Homework",
    "Homework",
    "Avg Performance Score"
  );
}

function renderModelHolisticChart(results) {
  // Average score by model (across all homeworks)
  const grouped = {};
  results.forEach((r) => {
    if (!grouped[r.model]) grouped[r.model] = [];
    grouped[r.model].push(r.score);
  });

  const data = Object.entries(grouped)
    .map(([model, scores]) => ({
      label: model,
      value: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    }))
    .sort((a, b) => b.value - a.value);

  renderBarChart(
    data,
    "Overall Model Performance Rankings",
    "Model",
    "Avg Performance Score"
  );
}

function renderBarChart(data, title, xLabel, yLabel) {
  if (data.length === 0) {
    els.chartContainer.innerHTML = `
      <div class="judge-chart-placeholder">
        <div class="judge-chart-placeholder-icon">📊</div>
        <p>No data for current filter</p>
      </div>
    `;
    return;
  }

  const maxValue = 5;
  const barColors = [
    "#ef4444", // 1 - red
    "#f97316", // 2 - orange
    "#eab308", // 3 - yellow
    "#22c55e", // 4 - green
    "#10b981", // 5 - emerald
  ];

  const getBarColor = (value) => {
    const idx = Math.min(4, Math.max(0, Math.floor(value) - 1));
    return barColors[idx];
  };

  const chartHtml = `
    <div class="judge-chart">
      <div class="judge-chart-title">${escapeHtml(title)}</div>
      <div class="judge-chart-body">
        <div class="judge-chart-y-axis">
          <span>5</span>
          <span>4</span>
          <span>3</span>
          <span>2</span>
          <span>1</span>
          <span>0</span>
        </div>
        <div class="judge-chart-bars">
          ${data
            .map(
              (d) => `
            <div class="judge-bar-group">
              <div class="judge-bar-wrapper">
                <div 
                  class="judge-bar" 
                  style="height: ${(d.value / maxValue) * 100}%; background: ${getBarColor(d.value)};"
                  title="${escapeHtml(d.label)}: ${d.value.toFixed(2)} (n=${d.count})"
                >
                  <span class="judge-bar-value">${d.value.toFixed(1)}</span>
                </div>
              </div>
              <div class="judge-bar-label" title="${escapeHtml(d.label)}">${escapeHtml(truncateLabel(d.label, 12))}</div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
      <div class="judge-chart-x-label">${escapeHtml(xLabel)}</div>
    </div>
  `;

  els.chartContainer.innerHTML = chartHtml;

  // Legend
  els.chartLegend.innerHTML = `
    <div class="judge-legend">
      <span class="judge-legend-item"><span class="judge-legend-color" style="background:#ef4444"></span>1 (Very Poor)</span>
      <span class="judge-legend-item"><span class="judge-legend-color" style="background:#f97316"></span>2 (Poor)</span>
      <span class="judge-legend-item"><span class="judge-legend-color" style="background:#eab308"></span>3 (Mediocre)</span>
      <span class="judge-legend-item"><span class="judge-legend-color" style="background:#22c55e"></span>4 (Good)</span>
      <span class="judge-legend-item"><span class="judge-legend-color" style="background:#10b981"></span>5 (Excellent)</span>
    </div>
  `;
}

function truncateLabel(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function renderResultsTable() {
  if (!els.resultsTable) return;

  const results = Array.from(judgeState.results.values());

  if (results.length === 0) {
    els.resultsTable.innerHTML = `<p class="muted-text">No results yet. Run the judge to score reports.</p>`;
    return;
  }

  // Sort by score descending
  const sorted = results.sort((a, b) => b.score - a.score);

  const tableHtml = `
    <table class="judge-table">
      <thead>
        <tr>
          <th>Performance</th>
          <th>Homework</th>
          <th>Model Evaluated</th>
          <th>Report Title</th>
          <th>Judge Reasoning</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
          .map(
            (r) => `
          <tr class="judge-table-row score-${r.score}">
            <td class="judge-table-score">
              <span class="judge-score-badge score-${r.score}">${r.score}</span>
            </td>
            <td>${escapeHtml(r.hw)}</td>
            <td>${escapeHtml(r.model)}</td>
            <td class="judge-table-title" title="${escapeHtml(r.title)}">${escapeHtml(truncateLabel(r.title, 40))}</td>
            <td class="judge-table-reasoning">${escapeHtml(r.reasoning)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;

  els.resultsTable.innerHTML = tableHtml;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Track if global listeners have been added
let globalListenersAttached = false;

// Initialize
function init() {
  cacheElements();

  // Only initialize if elements exist (we're on the right page/view)
  if (!els.modelSelect) {
    // Retry after a short delay in case DOM isn't ready
    setTimeout(init, 500);
    return;
  }

  attachEvents();
  loadData();

  // Check if shared engine is available
  if (window.sharedAnalyzerState?.engine || window.sharedLLMEngine) {
    judgeState.engine = window.sharedAnalyzerState?.engine || window.sharedLLMEngine;
    judgeState.webllm = window.sharedAnalyzerState?.webllm || window.sharedLLMWebllm;
    judgeState.currentModel = "shared";
    if (els.status) {
      els.status.textContent = "✓ Using shared model";
      els.status.className = "judge-status ready";
    }
    if (els.runAllBtn) els.runAllBtn.disabled = false;
  }
  
  // Update UI if there are existing scores
  if (judgeState.results.size > 0) {
    if (els.clearBtn) els.clearBtn.disabled = false;
    renderChart();
    renderResultsTable();
  }
}

// Global event handlers (added only once)
async function handleScoresUpdated() {
  // Re-cache elements in case tab wasn't visible before
  cacheElements();
  
  // Ensure data is loaded before rendering
  await loadData();
  
  // Update UI
  if (els.clearBtn) els.clearBtn.disabled = judgeState.results.size === 0;
  if (els.progressText && judgeState.results.size > 0) {
    els.progressText.textContent = `${judgeState.results.size} reports scored`;
  }
  
  // Only render if elements exist (tab has been viewed)
  if (els.chartContainer) renderChart();
  if (els.resultsTable) renderResultsTable();
}

function handleEngineReady() {
  if (els.status) {
    els.status.textContent = "✓ Using shared model";
    els.status.className = "judge-status ready";
  }
  if (els.runAllBtn) els.runAllBtn.disabled = false;
}

function attachGlobalListeners() {
  if (globalListenersAttached) return;
  globalListenersAttached = true;
  
  window.addEventListener("analyzer-scores-updated", handleScoresUpdated);
  window.addEventListener("analyzer-engine-ready", handleEngineReady);
}

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    attachGlobalListeners();
    init();
  });
} else {
  attachGlobalListeners();
  init();
}

// Also listen for view changes to re-init (but not re-add global listeners)
window.addEventListener("judge-view-active", init);

