/**
 * RAG (Retrieval-Augmented Generation) Module
 * Uses WebLLM for embeddings and provides semantic search over threads
 * Updates: Supports parsing of Text and PDF attachments.
 */

// State
const ragState = {
  embeddingEngine: null,
  webllm: null,
  pdfLib: null, // Cache for PDF.js library
  embeddings: [], // Array of { threadNum, embedding, text }
  isInitialized: false,
  isIndexing: false,
};

// Embedding model (small, fast model for embeddings)
const EMBEDDING_MODEL = "snowflake-arctic-embed-m-q0f32-MLC-b4";
const PDFJS_CDN = "https://esm.run/pdfjs-dist@3.11.174";
const PDFJS_WORKER_CDN = "https://esm.run/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

/**
 * Initialize the embedding engine
 * @param {Function} progressCallback - Called with progress updates
 * @returns {Promise<void>}
 */
export async function initEmbeddingEngine(progressCallback) {
  if (ragState.embeddingEngine) return;

  // Dynamically import WebLLM if not loaded
  if (!ragState.webllm) {
    progressCallback?.({ text: "Loading WebLLM library...", progress: 0 });
    ragState.webllm = await import("https://esm.run/@mlc-ai/web-llm");
  }

  progressCallback?.({ text: `Loading embedding model...`, progress: 0.1 });

  ragState.embeddingEngine = await ragState.webllm.CreateMLCEngine(
    EMBEDDING_MODEL,
    {
      initProgressCallback: (report) => {
        progressCallback?.({
          text: report.text || "Loading embedding model...",
          progress: report.progress,
        });
      },
    }
  );

  progressCallback?.({ text: "Embedding engine ready", progress: 1 });
}

/**
 * Lazy load PDF.js library
 */
async function loadPdfLib() {
  if (ragState.pdfLib) return ragState.pdfLib;
  
  const pdfjs = await import(PDFJS_CDN);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  ragState.pdfLib = pdfjs;
  return pdfjs;
}

/**
 * Extract text from a PDF ArrayBuffer
 * @param {ArrayBuffer} data - PDF file data
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromPdf(data) {
  try {
    const pdfjs = await loadPdfLib();
    const doc = await pdfjs.getDocument({ data }).promise;
    let fullText = "";

    // Limit pages to avoid massive processing for RAG context window
    const maxPages = Math.min(doc.numPages, 10); 
    
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str);
      fullText += strings.join(" ") + "\n";
    }
    
    return fullText;
  } catch (err) {
    console.error("PDF Parsing Error:", err);
    return "";
  }
}

/**
 * Generate embedding for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
async function embedText(text) {
  if (!ragState.embeddingEngine) {
    throw new Error("Embedding engine not initialized");
  }

  const formattedText = `[CLS] ${text} [SEP]`;

  const reply = await ragState.embeddingEngine.embeddings.create({
    input: [formattedText],
  });

  return reply.data[0].embedding;
}

/**
 * Generate embedding for a query (with query prefix)
 * @param {string} query - Query text
 * @returns {Promise<number[]>} - Embedding vector
 */
async function embedQuery(query) {
  if (!ragState.embeddingEngine) {
    throw new Error("Embedding engine not initialized");
  }

  const queryPrefix = "Represent this sentence for searching relevant passages: ";
  const formattedQuery = `[CLS] ${queryPrefix}${query} [SEP]`;

  const reply = await ragState.embeddingEngine.embeddings.create({
    input: [formattedQuery],
  });

  return reply.data[0].embedding;
}

/**
 * Compute cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} - Cosine similarity (-1 to 1)
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Build the thread content string for embedding
 * @param {Object} post - Post object from posts_processed.json
 * @param {Object} filesManifest - Files manifest object
 * @param {Function} fetchFileContent - Function to fetch file content (txt or pdf)
 * @returns {Promise<string>} - Combined text for embedding
 */
async function buildThreadText(post, filesManifest, fetchFileContent) {
  const parts = [];

  // Add title
  if (post.title) {
    parts.push(`Title: ${post.title}`);
  }

  // Add metrics info
  const m = post.metrics || {};
  if (m.homework_id) {
    parts.push(`Homework: ${m.homework_id}`);
  }
  if (m.model_name) {
    parts.push(`Model: ${m.model_name}`);
  }
  if (m.primary_focus) {
    parts.push(`Focus: ${m.primary_focus}`);
  }

  // Add document body
  if (post.document) {
    parts.push(`\nContent:\n${post.document}`);
  }

  // Add file content if available
  const threadNum = String(post.number);
  const entry = filesManifest[threadNum];
  
  if (entry?.files?.length) {
    for (const file of entry.files) {
      // Check for 'transcript' (often .txt) OR 'url' (generic attachment)
      const filePath = file.transcript || file.url;
      
      if (filePath) {
        // Skip images or non-doc types if known
        if (filePath.match(/\.(jpg|jpeg|png|gif|mp4|mov)$/i)) continue;

        try {
          const content = await fetchFileContent(filePath);
          if (content && content.length > 50) { // filter out empty/noise files
            parts.push(`\nAttached File (${file.original_filename}):\n${content}`);
          }
        } catch (err) {
          console.warn(`Failed to load file for thread ${threadNum}:`, err);
        }
      }
    }
  }

  return parts.join("\n");
}

/**
 * Index all threads for semantic search
 * @param {Array} posts - Array of post objects
 * @param {Object} filesManifest - Files manifest object
 * @param {Function} progressCallback - Called with progress updates
 * @returns {Promise<void>}
 */
export async function indexThreads(posts, filesManifest, progressCallback) {
  if (!ragState.embeddingEngine) {
    throw new Error("Embedding engine not initialized. Call initEmbeddingEngine first.");
  }

  if (ragState.isIndexing) {
    console.warn("Already indexing threads");
    return;
  }

  ragState.isIndexing = true;
  ragState.embeddings = [];

  // Helper to fetch and parse files (Text or PDF)
  const fetchFileContent = async (path) => {
    try {
      const res = await fetch(path, { cache: "force-cache" });
      if (!res.ok) return null;

      const contentType = res.headers.get("content-type") || "";
      const isPdf = path.toLowerCase().endsWith(".pdf") || contentType.includes("pdf");

      let text = "";
      if (isPdf) {
        const buffer = await res.arrayBuffer();
        text = await extractTextFromPdf(buffer);
      } else {
        // Assume text for everything else (txt, md, js, etc)
        text = await res.text();
      }

      // Truncate very long files to avoid embedding size issues
      return text.length > 8000 ? text.slice(0, 8000) + "..." : text;
    } catch (e) {
      // Silent fail for missing files to not break indexing
      return null;
    }
  };

  const total = posts.length;
  const batchSize = 4; // Match the embedding model's max batch size

  for (let i = 0; i < total; i += batchSize) {
    const batch = posts.slice(i, Math.min(i + batchSize, total));

    // Build text for each post in batch
    const textsPromises = batch.map((post) =>
      buildThreadText(post, filesManifest, fetchFileContent)
    );
    const texts = await Promise.all(textsPromises);

    // Format texts for embedding
    const formattedTexts = texts.map((t) => {
      // Truncate to reasonable length for embedding
      const truncated = t.length > 4000 ? t.slice(0, 4000) + "..." : t;
      return `[CLS] ${truncated} [SEP]`;
    });

    // Generate embeddings for batch
    const reply = await ragState.embeddingEngine.embeddings.create({
      input: formattedTexts,
    });

    // Store embeddings with metadata
    for (let j = 0; j < batch.length; j++) {
      ragState.embeddings.push({
        threadNum: batch[j].number,
        postId: batch[j].id,
        title: batch[j].title,
        edUrl: batch[j].ed_url,
        embedding: reply.data[j].embedding,
        text: texts[j],
        metrics: batch[j].metrics,
      });
    }

    const progress = Math.min((i + batch.length) / total, 1);
    progressCallback?.({
      text: `Indexing threads... ${i + batch.length}/${total}`,
      progress,
    });
  }

  ragState.isIndexing = false;
  ragState.isInitialized = true;
  progressCallback?.({
    text: `Indexed ${total} threads`,
    progress: 1,
  });
}

/**
 * Search for relevant threads given a query
 * @param {string} query - User's query
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array>} - Array of { threadNum, title, text, score, metrics }
 */
export async function searchThreads(query, topK = 3) {
  if (!ragState.isInitialized || ragState.embeddings.length === 0) {
    console.warn("RAG index not initialized or empty");
    return [];
  }

  const queryEmbedding = await embedQuery(query);

  // Compute similarity with all threads
  const scores = ragState.embeddings.map((item) => ({
    ...item,
    score: cosineSimilarity(queryEmbedding, item.embedding),
  }));

  // Sort by score (highest first) and return top K
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

/**
 * Format retrieved threads as context for the LLM
 * @param {Array} results - Search results from searchThreads
 * @returns {string} - Formatted context string
 */
export function formatContext(results) {
  if (!results.length) {
    return "";
  }

  const contextParts = results.map((r, i) => {
    const hw = r.metrics?.homework_id || "Unknown";
    const model = r.metrics?.model_name || "Unknown";
    return `[Thread ${i + 1}: "${r.title}" (${hw}, ${model}, relevance: ${(r.score * 100).toFixed(1)}%)]\n${r.text.slice(0, 2000)}${r.text.length > 2000 ? "..." : ""}`;
  });

  return `Here are the most relevant threads from the special participation posts:\n\n${contextParts.join("\n\n---\n\n")}`;
}

/**
 * Check if RAG is initialized and ready
 * @returns {boolean}
 */
export function isReady() {
  return ragState.isInitialized && ragState.embeddings.length > 0;
}

/**
 * Get the number of indexed threads
 * @returns {number}
 */
export function getIndexedCount() {
  return ragState.embeddings.length;
}

/**
 * Clear the RAG index
 */
export function clearIndex() {
  ragState.embeddings = [];
  ragState.isInitialized = false;
}

/**
 * Unload the embedding engine to free memory
 */
export async function unloadEmbeddingEngine() {
  if (ragState.embeddingEngine) {
    await ragState.embeddingEngine.unload();
    ragState.embeddingEngine = null;
  }
  clearIndex();
}