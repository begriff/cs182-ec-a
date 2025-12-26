# EECS182 Special Participation A Explorer

An interactive web app for exploring student evaluations of AI models across homework assignments. Just drag and drop special_participation_site and you're good to go.

---

## 📋 Views

| View | Description |
|------|-------------|
| **Matrix View** | Contribution matrix showing which students evaluated which AI models per homework, with transpose toggle |
| **Threads View** | Browse all posts with metadata, badges, and expandable details |
| **Homework Insights** | AI-generated summaries analyzing model performance per assignment |
| **Model Insights** | AI-generated summaries of each model's overall strengths and weaknesses |
| **Performance Analyzer** | Score AI model performance (1–5 scale) using an on-device LLM |

## 🔍 Filtering & Search

- **Advanced search** with prefixes: `author:John`, `model:Claude`, `hw:HW5`
- Filter by **Contributor**, **Homework**, and **Model**
- Sort by newest/oldest, homework, model (A–Z), or contributor (A–Z)
- Collapsible filter panel

## 📎 Post Details & Attachments

- PDF/Text attachment support with direct download links
- Renders Markdown and LaTeX in chat responses

## 🤖 AI Features

- **AI Chat Assistant** — Floating chat widget running LLMs entirely in-browser (Llama 3.2, SmolLM2, Qwen 2.5)
- **RAG** — Toggle semantic search over threads for context-aware responses
- **Per-thread Q&A** — Ask questions about individual threads in the post modal
- **Performance Analyzer** — On-device LLM scores how well AI models performed based on student reports
- **Visualizations** — Charts by homework or model, including holistic views

## 🎨 UI/UX

- Theme toggle (Auto / Light / Dark) with persistence
- Static site — no build toolchain required; works with any HTTP server

## 🔧 Data Pipeline

- `process_data.py` processes raw Ed thread data
- Tag corrections via `tag_fix/corrections.json`

---

## Submission History

- [Version History](docs/VERSIONS.md) — Commit ids of our initial red team submission and final blue team submission