/**
 * Browser-based Chat Assistant using WebLLM
 * Runs LLM inference entirely in the browser using WebGPU
 * Supports RAG (Retrieval-Augmented Generation) for context-aware responses
 */

import * as rag from "./rag.js";

// State
const chatState = {
  engine: null,
  webllm: null,
  isLoading: false,
  isGenerating: false,
  messages: [],
  currentModel: null,
  ragEnabled: false,
  ragIndexed: false,
  posts: [],
  filesManifest: {},
};

// DOM Elements
const els = {};

function cacheElements() {
  els.widget = document.getElementById("chat-widget");
  els.toggle = document.getElementById("chat-toggle");
  els.panel = document.getElementById("chat-panel");
  els.status = document.getElementById("chat-status");
  els.modelSelect = document.getElementById("model-select");
  els.messages = document.getElementById("chat-messages");
  els.loading = document.getElementById("chat-loading");
  els.loadingText = document.getElementById("loading-text");
  els.progressFill = document.getElementById("progress-fill");
  els.form = document.getElementById("chat-form");
  els.input = document.getElementById("chat-input");
  els.send = document.getElementById("chat-send");
  els.ragToggle = document.getElementById("rag-toggle");
  els.ragStatus = document.getElementById("rag-status");
  els.clearChat = document.getElementById("clear-chat");
}

function attachEvents() {
  els.toggle.addEventListener("click", toggleChat);
  els.form.addEventListener("submit", handleSubmit);
  els.modelSelect.addEventListener("change", handleModelChange);
  if (els.ragToggle) {
    els.ragToggle.addEventListener("change", handleRagToggle);
  }
  if (els.clearChat) {
    els.clearChat.addEventListener("click", clearConversation);
  }
}

function toggleChat() {
  const isOpen = els.widget.classList.toggle("open");
  els.panel.hidden = !isOpen;

  if (isOpen) {
    els.input.focus();
  }
}

async function initEngine() {
  const selectedModel = els.modelSelect.value;
  if (!selectedModel) {
    els.status.textContent = "Select a model to start";
    return;
  }

  chatState.isLoading = true;
  els.loading.hidden = false;
  els.status.textContent = "Initializing...";
  els.status.className = "chat-status";

  try {
    // Check for WebGPU support
    if (!navigator.gpu) {
      throw new Error(
        "WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+."
      );
    }

    // Dynamically import WebLLM if not loaded yet
    if (!chatState.webllm) {
      els.loadingText.textContent = "Loading WebLLM library...";
      chatState.webllm = await import("https://esm.run/@mlc-ai/web-llm");
    }

    chatState.currentModel = selectedModel;

    els.loadingText.textContent = `Loading ${getModelDisplayName(selectedModel)}...`;

    // Create engine with progress callback
    chatState.engine = await chatState.webllm.CreateMLCEngine(selectedModel, {
      initProgressCallback: (progress) => {
        const percent = Math.round(progress.progress * 100);
        els.progressFill.style.width = `${percent}%`;

        if (progress.text) {
          els.loadingText.textContent = progress.text;
        }
      },
    });

    els.loading.hidden = true;
    els.status.textContent = "Ready";
    els.status.className = "chat-status ready";
    els.input.disabled = false;
    els.send.disabled = false;
    els.input.focus();

    // Initialize system message
    chatState.messages = [
      {
        role: "system",
        content: `You are a helpful AI assistant integrated into a web app that explores EECS 182 "special participation A" posts where students evaluated LLMs on homework problems. Be concise and helpful. If asked about the posts, explain that users can filter and search them in the main interface.`,
      },
    ];

    // Expose engine globally for thread Q&A to use
    window.sharedLLMEngine = chatState.engine;
    window.sharedLLMWebllm = chatState.webllm;
  } catch (error) {
    console.error("Failed to initialize WebLLM:", error);
    els.loading.hidden = true;
    els.status.textContent = "Error loading model";
    els.status.className = "chat-status error";

    addMessage(
      "assistant",
      `Sorry, I couldn't load the model. ${error.message || "Please try a different browser or model."}`
    );
  } finally {
    chatState.isLoading = false;
  }
}

async function handleModelChange() {
  const newModel = els.modelSelect.value;
  if (!newModel || newModel === chatState.currentModel) return;

  // Reset engine
  if (chatState.engine) {
    await chatState.engine.unload();
    chatState.engine = null;
  }

  chatState.messages = [];
  els.messages.innerHTML = `
    <div class="chat-message assistant">
      <p>Loading ${getModelDisplayName(newModel)}...</p>
    </div>
  `;

  els.input.disabled = true;
  els.send.disabled = true;

  await initEngine();
}

async function handleRagToggle() {
  chatState.ragEnabled = els.ragToggle.checked;
  updateRagStatus();

  if (chatState.ragEnabled && !chatState.ragIndexed) {
    await initRag();
  }
}

function clearConversation() {
  // Reset messages to just the system message
  chatState.messages = [
    {
      role: "system",
      content: `You are a helpful AI assistant integrated into a web app that explores EECS 182 "special participation A" posts where students evaluated LLMs on homework problems. Be concise and helpful. If asked about the posts, explain that users can filter and search them in the main interface.`,
    },
  ];

  // Clear the messages display
  els.messages.innerHTML = `
    <div class="chat-message assistant">
      <p>Conversation cleared. How can I help you?</p>
    </div>
  `;
}

function updateRagStatus() {
  if (!els.ragStatus) return;

  if (!chatState.ragEnabled) {
    els.ragStatus.textContent = "RAG disabled";
    els.ragStatus.className = "rag-status";
  } else if (chatState.ragIndexed) {
    els.ragStatus.textContent = `RAG ready (${rag.getIndexedCount()} threads)`;
    els.ragStatus.className = "rag-status ready";
  } else {
    els.ragStatus.textContent = "RAG not indexed";
    els.ragStatus.className = "rag-status";
  }
}

async function loadPostsData() {
  if (chatState.posts.length > 0) return;

  try {
    const [postsRes, manifestRes] = await Promise.all([
      fetch("public/data/posts_processed.json", { cache: "no-store" }),
      fetch("files/manifest.json", { cache: "no-store" }),
    ]);

    if (postsRes.ok) {
      chatState.posts = await postsRes.json();
    }
    if (manifestRes.ok) {
      chatState.filesManifest = await manifestRes.json();
    }
  } catch (err) {
    console.error("Failed to load posts data:", err);
  }
}

async function initRag() {
  if (chatState.ragIndexed) return;

  els.loading.hidden = false;
  els.loadingText.textContent = "Initializing RAG...";
  els.progressFill.style.width = "0%";

  try {
    // Load posts data first
    els.loadingText.textContent = "Loading thread data...";
    await loadPostsData();

    if (chatState.posts.length === 0) {
      throw new Error("No posts data available");
    }

    // Initialize embedding engine
    await rag.initEmbeddingEngine((progress) => {
      els.loadingText.textContent = progress.text;
      els.progressFill.style.width = `${Math.round(progress.progress * 50)}%`;
    });

    // Index all threads
    await rag.indexThreads(chatState.posts, chatState.filesManifest, (progress) => {
      els.loadingText.textContent = progress.text;
      els.progressFill.style.width = `${50 + Math.round(progress.progress * 50)}%`;
    });

    chatState.ragIndexed = true;
    updateRagStatus();

    addMessage(
      "assistant",
      `RAG initialized! I can now search through ${rag.getIndexedCount()} threads to find relevant context for your questions.`
    );
  } catch (err) {
    console.error("Failed to initialize RAG:", err);
    addMessage(
      "assistant",
      `Failed to initialize RAG: ${err.message}. Falling back to standard chat.`
    );
    chatState.ragEnabled = false;
    if (els.ragToggle) els.ragToggle.checked = false;
    updateRagStatus();
  } finally {
    els.loading.hidden = true;
  }
}

async function handleSubmit(e) {
  e.preventDefault();

  const userMessage = els.input.value.trim();
  if (!userMessage || chatState.isGenerating || !chatState.engine) return;

  // Add user message
  addMessage("user", userMessage);
  els.input.value = "";

  // Generate response
  chatState.isGenerating = true;
  els.input.disabled = true;
  els.send.disabled = true;

  // Create assistant message placeholder
  const assistantEl = addMessage("assistant", "", true);

  try {
    let contextMessage = "";

    // If RAG is enabled and indexed, search for relevant threads
    let ragResults = [];
    if (chatState.ragEnabled && chatState.ragIndexed) {
      els.status.textContent = "Searching threads...";
      ragResults = await rag.searchThreads(userMessage, 3);

      if (ragResults.length > 0) {
        contextMessage = rag.formatContext(ragResults);

        // Show which threads were found
        const threadList = ragResults
          .map((r) => `"${r.title}" (${(r.score * 100).toFixed(0)}%)`)
          .join(", ");
        console.log("RAG retrieved threads:", threadList);
      }
    }

    els.status.textContent = "Thinking...";

    // Build messages for this request
    const messagesForRequest = [...chatState.messages];

    // Add user message with optional RAG context
    if (contextMessage) {
      messagesForRequest.push({
        role: "user",
        content: `${contextMessage}\n\nUser question: ${userMessage}\n\nPlease answer the question based on the thread content above. If the threads don't contain relevant information, say so and answer based on your general knowledge.`,
      });
    } else {
      messagesForRequest.push({ role: "user", content: userMessage });
    }

    // Add to conversation history (without RAG context for cleaner history)
    chatState.messages.push({ role: "user", content: userMessage });

    let fullResponse = "";

    // Use streaming for better UX
    const asyncGenerator = await chatState.engine.chat.completions.create({
      messages: messagesForRequest,
      stream: true,
      max_tokens: 512,
      temperature: 0.7,
    });

    for await (const chunk of asyncGenerator) {
      const delta = chunk.choices[0]?.delta?.content || "";
      fullResponse += delta;
      assistantEl.querySelector("p").textContent = fullResponse;
      scrollToBottom();
    }

    // Remove streaming cursor
    assistantEl.classList.remove("streaming");

    // Add source links if RAG was used
    if (ragResults.length > 0) {
      const sourcesDiv = document.createElement("div");
      sourcesDiv.className = "rag-sources";
      sourcesDiv.innerHTML = `
        <span class="rag-sources-label">Sources:</span>
        ${ragResults
          .map((r) => {
            const hw = r.metrics?.homework_id || "";
            const score = (r.score * 100).toFixed(0);
            const badge = hw ? `<span class="rag-source-badge">${escapeHtml(hw)}</span>` : "";
            const link = `<a href="#" class="rag-source-link" data-thread-num="${r.threadNum}">${escapeHtml(r.title)}</a>`;
            return `<div class="rag-source-item">${badge}${link}<span class="rag-source-score">${score}%</span></div>`;
          })
          .join("")}
      `;
      
      // Add click handlers for source links
      sourcesDiv.querySelectorAll(".rag-source-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const threadNum = parseInt(link.dataset.threadNum, 10);
          // Dispatch custom event for main.js to handle
          window.dispatchEvent(new CustomEvent("open-thread", { detail: { threadNum } }));
        });
      });
      
      assistantEl.appendChild(sourcesDiv);
      scrollToBottom();
    }

    // Add to conversation history
    chatState.messages.push({ role: "assistant", content: fullResponse });
  } catch (error) {
    console.error("Generation error:", error);
    assistantEl.querySelector("p").textContent =
      "Sorry, something went wrong. Please try again.";
    assistantEl.classList.remove("streaming");
  } finally {
    chatState.isGenerating = false;
    els.input.disabled = false;
    els.send.disabled = false;
    els.status.textContent = "Ready";
    els.input.focus();
  }
}

function addMessage(role, content, isStreaming = false) {
  const div = document.createElement("div");
  div.className = `chat-message ${role}${isStreaming ? " streaming" : ""}`;
  div.innerHTML = `<p>${escapeHtml(content)}</p>`;
  els.messages.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getModelDisplayName(modelId) {
  const names = {
    "Llama-3.2-1B-Instruct-q4f16_1-MLC": "Llama 3.2 1B",
    "Llama-3.2-3B-Instruct-q4f16_1-MLC": "Llama 3.2 3B",
    "SmolLM2-1.7B-Instruct-q4f16_1-MLC": "SmolLM2 1.7B",
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": "Qwen 2.5 1.5B",
  };
  return names[modelId] || modelId;
}

// Initialize on DOM ready
function init() {
  cacheElements();
  attachEvents();

  // Pre-check WebGPU support
  if (!navigator.gpu) {
    els.status.textContent = "WebGPU not supported";
    els.status.className = "chat-status error";
  } else {
    els.status.textContent = "Select a model to start";
  }

  // Initialize RAG status
  updateRagStatus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}




