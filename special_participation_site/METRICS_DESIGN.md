# Metric design for Special Participation A Explorer

Each thread in `public/data/posts_processed.json` is enriched with a `metrics` object:

```jsonc
{
  "id": 7412832,
  "title": "Special Participation A: Kimi on HW6",
  "document": "...",
  "metrics": {
    "homework_id": "HW6",
    "model_name": "Kimi",
    "primary_focus": "model_performance",
    "depth_bucket": "high",
    "actionability_bucket": "medium",
    "word_count": 420
  }
}
```

Below are the metrics, why they exist, and how they are computed.

---

## 1. `homework_id`

- **Type**: string (e.g., `"HW0"`, `"HW6"`, `"HW11"`, or `"Unknown"`)
- **Motivation**: Staff often want to see, for a particular homework, how students used LLMs, what went wrong, and what patterns repeat across submissions.
- **Heuristic**:
  - Build a combined text field: `title + '\n' + document`.
  - Run a regex over it:
    - `\b(?:hw|homework)\s*0*([0-9]+)\b` (case-insensitive).
  - If a match is found, convert the captured integer to the canonical form `"HW{n}"`.
  - If nothing matches, assign `"Unknown"`.

---

## 2. `model_name`

- **Type**: string categorical
  - Possible values include: `"Kimi"`, `"Claude"`, `"ChatGPT 5.1"`, `"GPT-5"`, `"ChatGPT (other)"`, `"DeepSeek"`, `"LLaMA"`, `"LLM (unspecified)"`, `"Unknown / Multiple"`.
- **Motivation**: Quickly answer questions like "How did Kimi do on HW6 vs Claude?" or "Show me posts where students used GPT-5.1 Thinking.".
- **Heuristic** (lowercased combined text):
  - If it contains `"kimi"` → `"Kimi"`.
  - Else if `"claude"` → `"Claude"`.
  - Else if `"5.1 thinking"` or (`"5.1"` and `"chatgpt"`) → `"ChatGPT 5.1"`.
  - Else if `"gpt5"` or `"gpt 5"` → `"GPT-5"`.
  - Else if `"chatgpt"` → `"ChatGPT (other)"`.
  - Else if `"deepseek"` → `"DeepSeek"`.
  - Else if `"llama"` → `"LLaMA"`.
  - Else if `"llm"` or `"language model"` → `"LLM (unspecified)"`.
  - Otherwise → `"Unknown / Multiple"`.

This is intentionally coarse but gives a useful first-pass grouping by system.

---

## 3. `primary_focus`

- **Type**: string categorical
  - Values: `"model_performance"`, `"assignment_feedback"`, `"prompting_strategy"`, `"meta_reflection"`, `"mixed/other"`.
- **Motivation**: Distinguish between posts that mainly evaluate **how well the model solved the homework** vs. those that critique the **assignment design** or focus on **prompting strategies** or broader **reflections**.
- **Heuristic**:
  - Lowercase the combined text (`title + document`).
  - Maintain keyword buckets:
    - `model_performance`: `hallucination`, `hallucinate`, `correct`, `incorrect`, `mistake`, `error`, `accuracy`, `reasoning`, `solve`, `solution`.
    - `assignment_feedback`: `homework`, `assignment`, `question wording`, `ambiguous`, `clarity of the question`, `problem statement`.
    - `prompting_strategy`: `prompt`, `system prompt`, `zero-shot`, `few-shot`, `chain-of-thought`, `cot`, `step by step`, `turn-by-turn`.
    - `meta_reflection`: `reflection`, `reflect`, `experience`, `takeaway`, `take-away`, `lesson`, `learned`, `student`, `meta`.
  - Count hits for each focus type by checking whether each keyword appears as a substring.
  - Pick the category with the highest score, breaking ties with a priority order:
    - `model_performance` → `assignment_feedback` → `prompting_strategy` → `meta_reflection`.
  - If all scores are zero, assign `"mixed/other"`.

This gives a coarse, but generally meaningful, topical label for each post.

---

## 4. `depth_bucket`

- **Type**: string categorical
  - Values: `"low"`, `"medium"`, `"high"`.
- **Motivation**: Separate short, surface-level blurbs from long, detailed analyses that staff may want to read more carefully.
- **Heuristic**:
  - Work with the plain-text `document` field.
  - Compute `word_count = len(document.split())`.
  - Check for the presence of depth-signaling terms: `analysis`, `reasoning`, `derivation`, `step by step`, `carefully`, `detailed`, `intuition`, `discussion`.
  - Let `score = word_count + 150` if any of those terms appear, otherwise `score = word_count`.
  - Bucket by score:
    - `< 200` → `"low"`.
    - `200–599` → `"medium"`.
    - `>= 600` → `"high"`.

This favors longer posts and slightly boosts posts that explicitly frame themselves as analyses or detailed reasoning.

---

## 5. `actionability_bucket`

- **Type**: string categorical
  - Values: `"low"`, `"medium"`, `"high"`.
- **Motivation**: Help staff find posts that contain **concrete, actionable suggestions** (for assignments, for tooling, for how to use LLMs), not just description.
- **Heuristic**:
  - Lowercase the combined text.
  - Count occurrences of suggestion verbs/phrases: `should`, `recommend`, `suggest`, `could`, `would`, `might be better`, `improve`, `change`, `consider`, `it would help`, `we could`.
  - Let `hits` be the number of phrases that appear at least once.
  - Map to buckets:
    - `hits == 0` → `"low"`.
    - `1 <= hits <= 3` → `"medium"`.
    - `hits > 3` → `"high"`.

This is intentionally simple and interpretable; it correlates with how many concrete proposals the student makes.

---

## 6. `word_count`

- **Type**: integer
- **Motivation**: Provide a raw measure of post length, useful both for sorting and as a simple sanity check on `depth_bucket`.
- **Heuristic**:
  - `word_count = len(document.split())` on the plain-text body.

The frontend may use this value for summaries or tie-breaking when sorting by depth.

---

## Why this set of metrics?

- **Small and focused**: 3–7 metrics were requested; this design uses **5 core metrics** plus a simple `word_count` for extra texture.
- **Staff-usable**: Each metric answers concrete questions instructors might ask:
  - "Which homework is this about?"
  - "Which model did they use?"
  - "Are they mostly evaluating model performance or giving assignment feedback?"
  - "Is this a quick impression or a deep analysis?"
  - "Does this post contain actionable suggestions?"
- **Heuristic but transparent**: All computations are simple keyword/length heuristics, described here and mirrored in `scripts/process_data.py`, so they can be easily tweaked without touching any ML stack.
