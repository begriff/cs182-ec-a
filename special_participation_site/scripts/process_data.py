#!/usr/bin/env python3
"""Build processed JSON with simple, transparent metrics for Special Participation A posts.

Usage (from repo root):

    python3 special_participation_site/scripts/process_data.py

This first runs fetch_threads.py to get the latest data from Ed,
then reads `thread_util/threads.json` and writes
`special_participation_site/public/data/posts_processed.json`.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class UserLite:
  id: Optional[int]
  name: Optional[str]
  course_role: Optional[str]


@dataclass
class Metrics:
  homework_id: str
  model_name: str
  primary_focus: str
  depth_bucket: str
  actionability_bucket: str
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
  "Kimi": ["kimi"],
  "Claude": ["claude"],
  "ChatGPT 5.1": ["5.1 thinking", "gpt 5.1"],
  "GPT-5": ["gpt5", "gpt 5"],
  "ChatGPT (other)": ["chatgpt"],
  "DeepSeek": ["deepseek"],
  "LLaMA": ["llama"],
  "LLM (unspecified)": ["llm", "language model"],
}


def detect_model_name(text_lower: str) -> str:
  hits: List[str] = []
  for label, phrases in MODEL_KEYWORDS.items():
    for phrase in phrases:
      if phrase in text_lower:
        hits.append(label)
        break

  if not hits:
    return "Unknown / Multiple"

  unique = sorted(set(hits))
  if len(unique) > 1:
    return "Unknown / Multiple"
  return unique[0]


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
  if not course_id or not thread_id:
    return None
  return f"https://edstem.org/us/courses/{course_id}/discussion/{thread_id}"


def process_thread(raw: Dict[str, Any]) -> ProcessedPost:
  title = (raw.get("title") or "").strip()
  document = (raw.get("document") or "").strip()
  combined = f"{title}\n{document}"
  combined_lower = combined.lower()

  homework_id = extract_homework_id(combined)
  model_name = detect_model_name(combined_lower)
  primary_focus = determine_primary_focus(combined_lower)
  depth_bucket, word_count = compute_depth_and_word_count(document)
  actionability_bucket = compute_actionability_bucket(combined_lower)

  metrics = Metrics(
    homework_id=homework_id,
    model_name=model_name,
    primary_focus=primary_focus,
    depth_bucket=depth_bucket,
    actionability_bucket=actionability_bucket,
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
  )


def main() -> None:
  script_path = Path(__file__).resolve()
  site_dir = script_path.parent.parent
  root_dir = site_dir.parent

  threads_path = root_dir / "thread_util" / "threads.json"
  output_path = site_dir / "public" / "data" / "posts_processed.json"

  # First, run fetch_threads.py to get the latest data
  fetch_script = root_dir / "thread_util" / "fetch_threads.py"
  if not fetch_script.exists():
    print(f"Warning: {fetch_script} not found, skipping fetch step")
  else:
    print("Running fetch_threads.py to get latest data from Ed...")
    print("=" * 60)
    try:
      result = subprocess.run(
        [sys.executable, str(fetch_script)],
        cwd=str(fetch_script.parent),
        check=True
      )
      print("=" * 60)
      print("Fetch completed successfully!\n")
    except subprocess.CalledProcessError as e:
      print(f"Error running fetch_threads.py: {e}")
      raise SystemExit(f"Failed to fetch threads. Exit code: {e.returncode}")

  if not threads_path.exists():
    raise SystemExit(f"threads.json not found at {threads_path}")

  print(f"Reading threads from {threads_path}...")
  with threads_path.open("r", encoding="utf-8") as f:
    threads_raw = json.load(f)

  if not isinstance(threads_raw, list):
    raise SystemExit("Expected threads.json to contain a JSON array.")

  processed: List[Dict[str, Any]] = []
  for raw in threads_raw:
    try:
      post = process_thread(raw)
      processed.append(post.to_dict())
    except Exception as exc:  # pragma: no cover - defensive
      # If a single row is malformed, log it but continue.
      print(f"Warning: failed to process thread id={raw.get('id')}: {exc}")

  output_path.parent.mkdir(parents=True, exist_ok=True)
  with output_path.open("w", encoding="utf-8") as f:
    json.dump(processed, f, indent=2, ensure_ascii=False)

  print(f"Wrote {len(processed)} posts to {output_path}")


if __name__ == "__main__":  # pragma: no cover
  main()
