#!/usr/bin/env python3
"""Build processed JSON with simple, transparent metrics for Special Participation A posts.

Usage (from repo root):

    python3 special_participation_site/scripts/process_data.py [--insights]

This first runs fetch_threads.py to get the latest data from Ed,
then reads `thread_util/threads.json` and writes
`special_participation_site/public/data/posts_processed.json`.

Options:
    --insights    Generate AI-powered insights (requires OPENAI_API_KEY)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
  from openai import OpenAI
except ImportError:
  OpenAI = None


@dataclass
class UserLite:
  id: Optional[int]
  name: Optional[str]
  course_role: Optional[str]


@dataclass
class Metrics:
  homework_id: Optional[str]
  model_name: str
  depth_bucket: str
  word_count: int


@dataclass
class ProcessedPost:
  id: int
  number: Optional[int]
  course_id: Optional[int]
  title: str
  document: str
  category: Optional[str]
  subcategory: Optional[str]
  type: Optional[str]
  created_at: Optional[str]
  reply_count: Optional[int]
  view_count: Optional[int]
  user: UserLite
  ed_url: Optional[str]
  metrics: Metrics
  file_refs: Optional[List[Dict[str, Any]]] = None

  def to_dict(self) -> Dict[str, Any]:  # for JSON serialization
    d = asdict(self)
    return d


HW_PATTERN = re.compile(r"\b(?:hw|homework)\s*0*([0-9]+)\b", re.IGNORECASE)


def extract_homework_id(text: str) -> str:
  match = HW_PATTERN.search(text)
  if not match:
    return "Unknown"
  num = int(match.group(1))
  return f"HW{num}"


MODEL_KEYWORDS = {
  "Gemini": ["gemini"],
  "Kimi": ["kimi"],
  "Claude": ["claude"],
  "ChatGPT 5.1": ["5.1 thinking", "gpt 5.1"],
  "GPT-5": ["gpt5", "gpt 5"],
  "ChatGPT (other)": ["chatgpt", "gpt"],
  "DeepSeek": ["deepseek"],
  "Grok": ["grok"],
  "Qwen": ["qwen"],
  "Mistral": ["mistral"],
  "LLaMA": ["llama"],
  "LLM (unspecified)": ["llm", "language model"],
}


def detect_model_name(text_lower: str) -> str:
  # Check in priority order - more specific models first
  priority_order = [
    "ChatGPT 5.1",
    "GPT-5", 
    "Gemini",
    "DeepSeek",
    "Claude",
    "Kimi",
    "Grok",
    "Qwen",
    "Mistral",
    "LLaMA",
    "ChatGPT (other)",
    "LLM (unspecified)",
  ]
  
  for label in priority_order:
    phrases = MODEL_KEYWORDS.get(label, [])
    for phrase in phrases:
      if phrase in text_lower:
        return label
  
  return "Unknown / Multiple"


def detect_model_name_with_llm(client: Any, title: str, content: str) -> str:
  """Use LLM to detect and categorize the model with version/mode details."""
  prompt = f"""Based on this student post title and content, identify the LLM model being evaluated.

Title: {title}
Content: {content[:800]}

Extract ONLY the base model name and major version. IGNORE minor variations and thinking modes.

NORMALIZATION RULES:
1. ChatGPT/GPT models: Always use "GPT-X" format (NOT "ChatGPT X")
   - ChatGPT 4 or 4o → "GPT-4o"
   - ChatGPT 5 (but NOT 5.1) → "GPT-5"
   - ChatGPT 5.1 or GPT-5.1 → "GPT-5.1"
   - ChatGPT o3 → "GPT-o3"

2. Claude: Use "Claude Sonnet" or "Claude Opus" (ignore version numbers like 4.5/3.5)

3. Gemini: ONLY two categories based on capability
   - If mentions "Pro" OR "Thinking" → "Gemini Pro"
   - If mentions "Flash" OR "Fast" → "Gemini Flash"
   - Otherwise → "Gemini Flash" (default)

4. DeepSeek: Always just "DeepSeek" (ignore all version/mode info)

5. Other models: Use base name only
   - Kimi/KIMI K2 → "Kimi"
   - Mistral/Le Chat/Mistral AI → "Mistral"
   - Qwen/Qwen3-Max/etc → "Qwen"
   - Grok → "Grok" or "Grok 4" if version 4
   - GPT-Oss/gpt-oss-120b → "GPT-Oss"
   - Gemma → "Gemma"
   - LLaMA/Llama → "LLaMA"

Examples:
- "ChatGPT 5.1 (Extended Thinking)" → "GPT-5.1"
- "ChatGPT 5 (Thinking)" → "GPT-5"
- "GPT 5.1" → "GPT-5.1"
- "Gemini 3 Pro (Thinking)" → "Gemini Pro"
- "Gemini 2.5 Flash" → "Gemini Flash"
- "Gemini" (no variant) → "Gemini Flash"
- "DeepSeek v3.2 Deep Think" → "DeepSeek"
- "Claude Opus 4.5 Extended" → "Claude Opus"
- "gpt-oss-120b" → "GPT-Oss"
- "GPT-Oss" → "GPT-Oss" (NOT ChatGPT)

Response with ONLY the normalized model name:"""

  try:
    response = client.chat.completions.create(
      model="gpt-4o-mini",
      messages=[
        {"role": "system", "content": "You are a precise model identification assistant. Normalize model names to their base forms, ignoring minor variations and thinking modes."},
        {"role": "user", "content": prompt}
      ],
      max_tokens=30,
      temperature=0
    )
    model_name = response.choices[0].message.content.strip()
    
    # Post-process to catch common variations
    model_name = normalize_model_name(model_name)
    
    if not model_name or len(model_name) > 50:
      return "Unknown / Multiple"
    return model_name
  except Exception as e:
    print(f"  Warning: LLM model detection failed: {e}")
    # Fallback to keyword detection
    return detect_model_name((title + " " + content).lower())


def normalize_model_name(name: str) -> str:
  """Apply final normalization to catch common variations."""
  name_lower = name.lower()
  
  # DeepSeek - always just "DeepSeek"
  if "deepseek" in name_lower:
    return "DeepSeek"
  
  # GPT-Oss variants - check BEFORE ChatGPT/GPT to avoid false matches
  if "gpt-oss" in name_lower or "gpt_oss" in name_lower:
    return "GPT-Oss"
  
  # ChatGPT/GPT variants - normalize to GPT-X format
  if "chatgpt" in name_lower or name_lower.startswith("gpt"):
    # Extract version
    if "5.1" in name or "gpt-5.1" in name_lower:
      return "GPT-5.1"
    elif "5" in name or "gpt-5" in name_lower:
      return "GPT-5"
    elif "4o" in name_lower:
      return "GPT-4o"
    elif "o3" in name_lower:
      return "GPT-o3"
    elif "4" in name:
      return "GPT-4"
    return "ChatGPT"
  
  # Claude variants
  if "claude" in name_lower:
    if "sonnet" in name_lower:
      return "Claude Sonnet"
    if "opus" in name_lower:
      return "Claude Opus"
    return "Claude"
  
  # Gemini variants - Pro for thinking, Flash for fast, default to Flash
  if "gemini" in name_lower:
    # Check for thinking mode or "pro" variant
    if "thinking" in name_lower or "pro" in name_lower:
      return "Gemini Pro"
    # Check for flash/fast variant OR default to Flash
    if "flash" in name_lower or "fast" in name_lower:
      return "Gemini Flash"
    # Default to Flash when variant not specified
    return "Gemini Flash"
  
  # Gemma
  if "gemma" in name_lower:
    return "Gemma"
  
  # Kimi variants
  if "kimi" in name_lower:
    return "Kimi"
  
  # Mistral variants
  if "mistral" in name_lower or "le chat" in name_lower:
    return "Mistral"
  
  # Qwen variants
  if "qwen" in name_lower:
    return "Qwen"
  
  # Grok variants
  if "grok" in name_lower:
    if "4" in name:
      return "Grok 4"
    return "Grok"
  
  # LLaMA variants
  if "llama" in name_lower:
    return "LLaMA"
  
  # Perplexity
  if "perplexity" in name_lower or "sonar" in name_lower:
    return "Perplexity"
  
  return name


FOCUS_KEYWORDS = {
  "model_performance": [
    "hallucination",
    "hallucinate",
    "correct",
    "incorrect",
    "mistake",
    "error",
    "accuracy",
    "reasoning",
    "solve",
    "solution",
  ],
  "assignment_feedback": [
    "assignment",
    "question wording",
    "ambiguous",
    "clarity of the question",
    "problem statement",
  ],
  "prompting_strategy": [
    "prompt",
    "system prompt",
    "zero-shot",
    "few-shot",
    "chain-of-thought",
    "cot",
    "step by step",
    "turn-by-turn",
  ],
  "meta_reflection": [
    "reflection",
    "reflect",
    "experience",
    "takeaway",
    "take-away",
    "lesson",
    "learned",
    "meta",
  ],
}

FOCUS_PRIORITY = [
  "model_performance",
  "assignment_feedback",
  "prompting_strategy",
  "meta_reflection",
]


def determine_primary_focus(text_lower: str) -> str:
  scores = {k: 0 for k in FOCUS_KEYWORDS}
  for label, words in FOCUS_KEYWORDS.items():
    for w in words:
      if w in text_lower:
        scores[label] += 1

  max_score = max(scores.values()) if scores else 0
  if max_score == 0:
    return "mixed/other"

  # Pick highest, break ties by priority list
  best_label = "mixed/other"
  best_score = -1
  for label in FOCUS_PRIORITY:
    score = scores.get(label, 0)
    if score > best_score:
      best_score = score
      best_label = label
  if best_score <= 0:
    return "mixed/other"
  return best_label


DEPTH_TERMS = [
  "analysis",
  "reasoning",
  "derivation",
  "step by step",
  "carefully",
  "detailed",
  "intuition",
  "discussion",
]


def compute_depth_and_word_count(document: str) -> tuple[str, int]:
  # Simple whitespace-based tokenization is enough here.
  words = document.split()
  word_count = len(words)
  doc_lower = document.lower()

  score = word_count
  if any(term in doc_lower for term in DEPTH_TERMS):
    score += 150

  if score < 200:
    bucket = "low"
  elif score < 600:
    bucket = "medium"
  else:
    bucket = "high"

  return bucket, word_count


ACTIONABILITY_PHRASES = [
  "should",
  "recommend",
  "suggest",
  "could",
  "would",
  "might be better",
  "improve",
  "change",
  "consider",
  "it would help",
  "we could",
]


def compute_actionability_bucket(text_lower: str) -> str:
  hits = 0
  for phrase in ACTIONABILITY_PHRASES:
    if phrase in text_lower:
      hits += 1

  if hits == 0:
    return "low"
  if hits <= 3:
    return "medium"
  return "high"


def build_ed_url(course_id: Optional[int], thread_id: Optional[int]) -> Optional[str]:
  if course_id is None or thread_id is None:
    return None
  return f"https://edstem.org/us/courses/{course_id}/discussion/{thread_id}"


def extract_file_references(content: str, document: str) -> List[Dict[str, Any]]:
  """Extract file references from content and map them to positions in the document."""
  import re
  
  # Find file tags in content
  pattern = r'<file\s+url="([^"]+)"\s+filename="([^"]+)"\s*/>'
  file_refs = []
  
  for match in re.finditer(pattern, content):
    url, filename = match.groups()
    
    # Find approximate position in the cleaned document
    # Look for context around the file tag
    context_start = max(0, match.start() - 200)
    context_end = min(len(content), match.end() + 100)
    context_raw = content[context_start:match.start()]  # Only look BEFORE the file tag
    
    # Clean HTML tags to match document text
    context_clean = re.sub(r'<[^>]+>', '', context_raw)
    context_clean = re.sub(r'\s+', ' ', context_clean).strip()
    
    # Try to find this context in the document
    # Use last few words before the file to locate position
    context_words = context_clean.split()
    if len(context_words) > 10:
      # Use last 8 words before the file
      search_text = ' '.join(context_words[-8:])
    else:
      search_text = context_clean
    
    position = -1
    if search_text:
      # Case-insensitive search
      doc_lower = document.lower()
      search_lower = search_text.lower()
      found_pos = doc_lower.find(search_lower)
      if found_pos >= 0:
        # Position after the matched text (end of context)
        position = found_pos + len(search_text)
        # Find next word boundary (space or punctuation)
        while position < len(document) and document[position] not in ' \n\t.,;:!?':
          position += 1
        # Skip any spaces after
        while position < len(document) and document[position] in ' \t':
          position += 1
    
    file_refs.append({
      'filename': filename,
      'position': position if position >= 0 else len(document),  # Default to end if not found
      'context': context_clean[-100:] if context_clean else ''  # Store last 100 chars of context
    })
  
  return file_refs


def process_thread(raw: Dict[str, Any], llm_client: Optional[Any] = None) -> ProcessedPost:
  title = (raw.get("title") or "").strip()
  document = (raw.get("document") or "").strip()
  content = (raw.get("content") or "")
  combined = f"{title}\n{document}"
  combined_lower = combined.lower()
  
  # Extract file references with positions from content
  file_refs = extract_file_references(content, document)

  homework_id = extract_homework_id(combined)
  
  # Use LLM for model detection if available, otherwise fall back to keyword matching
  if llm_client:
    model_name = detect_model_name_with_llm(llm_client, title, document)
  else:
    model_name = detect_model_name(combined_lower)
  
  depth_bucket, word_count = compute_depth_and_word_count(document)

  metrics = Metrics(
    homework_id=homework_id,
    model_name=model_name,
    depth_bucket=depth_bucket,
    word_count=word_count,
  )

  user_obj = raw.get("user") or {}
  user = UserLite(
    id=user_obj.get("id"),
    name=user_obj.get("name"),
    course_role=user_obj.get("course_role"),
  )

  ed_url = build_ed_url(raw.get("course_id"), raw.get("id"))

  return ProcessedPost(
    id=int(raw["id"]),
    number=raw.get("number"),
    course_id=raw.get("course_id"),
    title=title,
    document=document,
    category=raw.get("category"),
    subcategory=raw.get("subcategory"),
    type=raw.get("type"),
    created_at=raw.get("created_at"),
    reply_count=raw.get("reply_count"),
    view_count=raw.get("view_count"),
    user=user,
    ed_url=ed_url,
    metrics=metrics,
    file_refs=file_refs if file_refs else None,
  )


def main(auto_categorize: bool = False) -> Path:
  script_dir = Path(__file__).parent
  repo_root = script_dir.parent.parent
  threads_path = repo_root / "thread_util" / "threads.json"
  output_path = script_dir.parent / "public" / "data" / "posts_processed.json"

  # Run fetch_threads.py first
  fetch_script = repo_root / "thread_util" / "fetch_threads.py"
  if fetch_script.exists():
    print("=" * 60)
    print("FETCHING THREADS FROM ED")
    print("=" * 60 + "\n")
    
    result = subprocess.run([sys.executable, str(fetch_script)], cwd=str(fetch_script.parent))
    if result.returncode != 0:
      print(f"Warning: fetch_threads.py returned non-zero exit code {result.returncode}")
  
  # Initialize LLM client if auto-categorize is enabled
  llm_client = None
  if auto_categorize:
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
      print("\nWarning: OPENAI_API_KEY not found. Auto-categorization disabled.")
      print("Using keyword-based model detection instead.\n")
    else:
      try:
        from openai import OpenAI
        llm_client = OpenAI(api_key=api_key)
        print(f"\n✓ LLM-based model categorization enabled (GPT-4o-mini)")
        print(f"  This will analyze each post to extract precise model versions\n")
      except Exception as e:
        print(f"\nWarning: Could not initialize OpenAI client: {e}")
        print("Using keyword-based model detection instead.\n")
  
  # Load and process threads
  with open(threads_path, encoding="utf-8") as f:
    threads = json.load(f)
  
  print(f"Processing {len(threads)} threads...")
  if llm_client:
    print("Using LLM for model categorization (progress updates every 10 posts)\n")
  
  processed_posts = []
  for idx, thread in enumerate(threads, 1):
    processed = process_thread(thread, llm_client=llm_client)
    processed_posts.append(processed)
    
    # Progress update for LLM categorization
    if llm_client and idx % 10 == 0:
      print(f"  Processed {idx}/{len(threads)} posts...")
  
  if llm_client:
    print(f"  Completed {len(threads)} posts with LLM categorization\n")
  
  # Save processed data
  output_path.parent.mkdir(parents=True, exist_ok=True)
  with open(output_path, "w", encoding="utf-8") as f:
    json.dump([asdict(p) for p in processed_posts], f, indent=2, ensure_ascii=False)
  
  print(f"✓ Saved {len(processed_posts)} processed posts to {output_path}\n")
  return output_path


def run_insights_generation(posts_path: Path):
  """Run the insights generation script."""
  print("\n" + "=" * 60)
  print("GENERATING AI INSIGHTS")
  print("=" * 60 + "\n")
  
  insights_script = Path(__file__).parent / "generate_insights.py"
  
  try:
    result = subprocess.run(
      [sys.executable, str(insights_script)],
      cwd=str(insights_script.parent),
      check=True
    )
    print("\n" + "=" * 60)
    print("Insights generation completed successfully!")
    print("=" * 60 + "\n")
  except subprocess.CalledProcessError as e:
    print(f"\nWarning: Insights generation failed with exit code {e.returncode}")
    print("This is optional - your posts_processed.json is still valid.\n")
  except FileNotFoundError:
    print(f"\nWarning: Could not find {insights_script}")
    print("This is optional - your posts_processed.json is still valid.\n")


if __name__ == "__main__":  # pragma: no cover
  parser = argparse.ArgumentParser(
    description="Process Ed Discussion threads into annotated posts"
  )
  parser.add_argument(
    "--insights",
    action="store_true",
    help="Generate AI-powered insights using OpenAI API (requires OPENAI_API_KEY)"
  )
  parser.add_argument(
    "--auto-categorize",
    action="store_true",
    help="Use LLM to automatically categorize models with version/mode details (requires OPENAI_API_KEY, adds ~$0.10 cost)"
  )
  
  args = parser.parse_args()
  
  posts_path = main(auto_categorize=args.auto_categorize)
  
  if args.insights:
    run_insights_generation(posts_path)

