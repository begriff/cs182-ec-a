# Special Participation A Explorer

This mini-site curates "special participation A" posts from the EECS 182 Ed Discussion forum.

It reads `thread_util/threads.json`, annotates each thread with a small set of pedagogically useful metrics, and exposes an interactive UI so staff and students can explore how different LLMs behaved on the homework.

## Project layout

```
special_participation_site/
├── DATA_NOTES.md             # Observed schema + assumptions for threads.json
├── METRICS_DESIGN.md         # Definitions + heuristics for every metric
├── README.md                 # This file
├── index.html                # Entry point for the static site
├── public/
│   └── data/
│       └── posts_processed.json   # Generated dataset powering the UI
├── scripts/
│   └── process_data.py       # Deterministic data-prep pipeline (Python)
└── src/
    ├── main.js              # Client-side logic (filters, sort, rendering)
    └── styles.css           # Lightweight styling
```

## Requirements

- Python 3.9+ available on your PATH
- A local copy of `thread_util/threads.json` (already produced by your existing Ed fetcher)

No Node/npm toolchain is required; the site is fully static.

## 1. Build the processed dataset

From the **repo root** (the directory that contains `thread_util/` and `special_participation_site/`):

```bash
python3 special_participation_site/scripts/process_data.py
```

This script:

1. Loads `thread_util/threads.json`.
2. Computes the metrics described in `METRICS_DESIGN.md` for each thread.
3. Writes `special_participation_site/public/data/posts_processed.json`.

Re-run the script whenever `threads.json` changes.

## 2. Serve the site locally

From the repo root:

```bash
cd special_participation_site
python3 -m http.server 4173
```

Then visit:

- <http://localhost:4173>

Any static file server will work; using Python’s built-in HTTP server keeps things dependency-free.

## 3. Features

- **Overview panel** explaining what the data is and what each metric means.
- **Explore view** with:
  - List of posts with title, homework ID, model, author, and creation date.
  - Metric badges for depth, actionability, and focus.
  - Optional link back to the original Ed thread (best-effort URL construction).
- **Interactions**:
  - Filter by homework, model, primary focus, and actionability bucket.
  - Free-text search over title + body text.
  - Sorting by recency, depth, or actionability.
  - Click-to-expand detail view showing the full write-up.

## 4. Limitations / next steps

- Metrics are intentionally heuristic and keyword-based; for research use you may want to plug in a lightweight embedding model or classifier.
- Only top-level threads are included; replies are not part of `threads.json` and thus are not surfaced here.
- If Ed’s URL scheme changes, the constructed `ed_url` field may need to be updated in `scripts/process_data.py`.
