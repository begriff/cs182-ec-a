# Data notes for `thread_util/threads.json`

## Source and shape

- **Path**: `thread_util/threads.json`
- **Format**: a JSON array of thread objects.
- Each element corresponds to a **top-level Ed Discussion thread** that matched the filter text `"special participation a"` when fetched via the Ed API.
- Replies are **not** embedded; we only see counts such as `reply_count`, not the bodies of individual replies.

## Core fields observed

For each thread object we see (non-exhaustive list):

- **Identity / linkage**
  - `id` *(int)* – global thread identifier used by Ed.
  - `number` *(int)* – thread number within the course.
  - `course_id` *(int)* – course identifier (e.g., `84647`).

- **Content**
  - `title` *(str)* – thread title, typically including the extra credit label, an LLM name, and homework reference.
  - `content` *(str)* – Ed document markup (HTML/XML-like) with tags such as `<document>`, `<paragraph>`, `<file>`, etc.
  - `document` *(str)* – plain-text rendering of the content, with paragraphs separated by newlines. This is what we primarily analyze.

- **Categorization / type**
  - `category`, `subcategory`, `subsubcategory` *(str)* – Ed’s category hierarchy (e.g., `Admin`, `Curiosity`).
  - `type` *(str)* – thread type (`"post"`, `"question"`, `"announcement"`, ...).

- **Engagement / status**
  - `view_count`, `unique_view_count` *(int)* – counts of views.
  - `reply_count`, `unresolved_count` *(int)* – reply metadata.
  - `star_count`, `vote_count`, `flag_count` *(int)* – social / moderation signals.
  - `is_private`, `is_pinned`, `is_archived`, `is_locked`, `is_anonymous`, `is_endorsed`, `is_answered`, etc. *(bools)* – status flags.

- **Timestamps**
  - `created_at`, `updated_at`, `pinned_at`, `deleted_at` – ISO-8601 timestamps or `null`.

- **User**
  - `user` *(object)* with fields like:
    - `id` *(int)* – user ID.
    - `role` *(str)* – global role (`"user"`, etc.).
    - `name` *(str)* – display name.
    - `course_role` *(str)* – role in the course (`"student"`, `"admin"`, etc.).

## Grouping assumptions

- The dataset appears to include **only root posts** that matched the special participation filter.
- We treat each JSON element as a **single submission** for the purposes of this explorer.
- Replies and nested discussions are represented only through counts such as `reply_count`; we do not attempt to reconstruct conversation trees.

## Derived / constructed fields

In the processing pipeline (`scripts/process_data.py`) we derive a few extra fields:

- **`ed_url`** – best-effort deep link back to the Ed thread:
  - Assumed pattern: `https://edstem.org/us/courses/{course_id}/discussion/{id}`.
  - This matches the URLs embedded in some threads (e.g., the extra credit announcement) but may break if Ed changes their routing scheme.

- **Metrics object** (see `METRICS_DESIGN.md`):
  - `homework_id`
  - `model_name`
  - `primary_focus`
  - `depth_bucket`
  - `actionability_bucket`
  - `word_count`

These metrics are stored under a top-level `metrics` key in the processed JSON.

## Known uncertainties / assumptions

- We assume `document` is a faithful plain-text rendering of `content` and use it as the main signal for NLP-style heuristics.
- Homework identifiers (e.g., `"HW6"`, `"HW 0"`, `"Homework 11"`) are inferred from titles and body text using regex patterns; some threads may not reference a homework explicitly and will be labeled as `"Unknown"`.
- LLM model names are inferred heuristically from keywords in titles and bodies (e.g., `"Kimi"`, `"Claude"`, `"ChatGPT 5.1"`); threads that mention multiple tools or none clearly are marked `"Unknown / Multiple"`.
- We treat every element of the array as a student-facing special participation post, even if `type` is `"announcement"` (e.g., the staff announcement describing the extra credit itself). The metrics for those may be less meaningful but they are kept for completeness.
