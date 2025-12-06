/**
 * Browser-based Chat Assistant using WebLLM
 * Runs LLM inference entirely in the browser using WebGPU
 */

import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// State
const chatState = {
  engine: null,
  isLoading: false,
  isGenerating: false,
  messages: [],
  currentModel: null,
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
}

function attachEvents() {
  els.toggle.addEventListener("click", toggleChat);
  els.form.addEventListener("submit", handleSubmit);
  els.modelSelect.addEventListener("change", handleModelChange);
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

    chatState.currentModel = selectedModel;

    els.loadingText.textContent = `Loading ${getModelDisplayName(selectedModel)}...`;

    // Create engine with progress callback
    chatState.engine = await webllm.CreateMLCEngine(selectedModel, {
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

async function handleSubmit(e) {
  e.preventDefault();

  const userMessage = els.input.value.trim();
  if (!userMessage || chatState.isGenerating || !chatState.engine) return;

  // Add user message
  addMessage("user", userMessage);
  els.input.value = "";

  // Add to conversation history
  chatState.messages.push({ role: "user", content: userMessage });

  // Generate response
  chatState.isGenerating = true;
  els.input.disabled = true;
  els.send.disabled = true;
  els.status.textContent = "Thinking...";

  // Create assistant message placeholder
  const assistantEl = addMessage("assistant", "", true);

  try {
    let fullResponse = "";

    // Use streaming for better UX
    const asyncGenerator = await chatState.engine.chat.completions.create({
      messages: chatState.messages,
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

