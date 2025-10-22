# College Student Interview Survey — Proof of Concept

## Overview

This project is a **proof of concept (PoC)** for an interactive platform that visualizes and explores qualitative interview data from college students.
It demonstrates an **end-to-end search and clustering experience** built from structured JSON analysis outputs.

The pipeline consists of:

1. **Upstream LLM Analysis (external)** — An external process generates structured JSON documents (summaries, themes, quotes, timelines, etc.) from transcripts.
2. **Embedding Enrichment (this repo)** — This repository ingests those LLM-generated JSONs, applies text embeddings via `all-MiniLM-L6-v2`, and prepares them for visualization.
3. **Static Site Build (this repo)** — A React-based static website (published to GitHub Pages) demonstrates:

   * Full-text and semantic search
   * Cluster analysis of interview embeddings
   * Interactive exploration of interviews, summaries, and themes

---

## 🧠 System Flow

```
[Transcripts] → [LLM Processor (External Repo)] → [Structured JSON w/o Embeddings]
                        ↓
          [This Repo] → [Embedding Generator + Validator]
                        ↓
                [Static Site Build]
                        ↓
        [Interactive Cluster + Search Visualization]
```

---

## 1.1 Transcript Ingestion (External)

> **Note:** Transcript ingestion and LLM analysis occur outside this repository.
> This repo assumes that fully analyzed JSON documents are provided **without embeddings**.

### Expected Upstream Output

Each JSON file should conform to the schema described below, containing:

* Interview metadata (IDs, format, demographics)
* LLM-generated summaries, themes, quotes, and improvement areas
* Empty `embedding` arrays (to be populated here)

---

## 🧱 JSON Schema (Expected Input)

```json
{
  "interviewId": "",
  "intervieweeName": "",
  "interviewDate": "",
  "interviewFormat": "",
  "interviewerName": "",
  "demographics": {
    "age": "",
    "gender": "",
    "major": "",
    "year": "",
    "other": ""
  },
  "transcript": {
    "fileName": "",
    "fileType": "",
    "rawText": "",
    "wordCount": 0,
    "validation": {
      "minimumLengthCheck": {
        "passed": false,
        "warningIssued": false,
        "overrideApprovedBy": ""
      }
    }
  },
  "analysis": {
    "model": {
      "provider": "OpenRouter",
      "modelName": "",
      "temperature": 0.7,
      "promptVersion": "",
      "promptTemplateId": ""
    },
    "summaries": [
      {
        "category": "",
        "title": "",
        "summaryText": "",
        "embedding": []
      }
    ],
    "timelinePoints": [
      {
        "eventDescription": "",
        "timeframeType": "",
        "category": "",
        "sentiment": "",
        "embedding": []
      }
    ],
    "themes": [
      {
        "themeId": "",
        "title": "",
        "description": "",
        "frequency": 0,
        "impactScore": 0,
        "actionable": false,
        "category": "",
        "relatedQuoteIds": [],
        "embedding": []
      }
    ],
    "quotes": [
      {
        "quoteId": "",
        "quoteText": "",
        "context": "",
        "timestamp": "",
        "tags": [],
        "sentiment": "",
        "significanceLevel": "",
        "relatedThemeIds": [],
        "embedding": []
      }
    ],
    "areasForImprovement": [
      {
        "areaId": "",
        "title": "",
        "description": "",
        "priority": "",
        "stakeholders": [],
        "actionItems": [],
        "embedding": []
      }
    ]
  },
  "metadata": {
    "createdAt": "",
    "updatedAt": "",
    "version": "1.0",
    "source": "manual-upload",
    "validatedBy": ""
  }
}
```

All `embedding` fields are expected to be **empty arrays** in the upstream data.

---

## ⚙️ 1.6 Data Ingestion and Validation (This Repo)

### 1.6.3 Data Ingestion and Validation

#### 1.6.3.1 JSON Collection

* On build, the **embedding generator** scans for JSON files in `/data/interviews/`.
* Only **modified or new** files (since last successful build) are reprocessed.
* First-time runs process all JSONs.

#### 1.6.3.2 Schema Validation

* Each JSON is validated against the current schema version.
* Results appear in the build UI:

  * ✅ **Valid files** — green checkmark with count
  * ⚠️ **Schema warnings** — yellow icon, partial rendering possible
  * ❌ **Critical errors** — red icon, blocks build

#### 1.6.3.3 Embedding Generation

* For each valid JSON, the following text fields are embedded using [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2):

  * Summaries
  * Themes
  * Timeline points
  * Quotes
  * Areas for improvement
* Generated embeddings are inserted back into the JSON and cached in a local build directory.

---

### 1.6.4 Search Index Generation

#### 1.6.4.1 Vector Database Build

* Uses **FAISS (WebAssembly build)** for client-side vector similarity search.
* Supports:

  * Semantic search across all summaries, themes, quotes, and timelines
  * Filtering by metadata (year, demographics, theme category)
  * Configurable similarity threshold
* Serialized index is stored for fast static loading.

#### 1.6.4.2 Full-Text Search Index

* Built using **Lunr.js** for lightweight keyword-based search.
* Includes all text fields except full transcripts.
* **d3.js** powers visualizations and cluster diagrams.

---

## 💡 Static Site Generator

* React-based static site (built via Vite).
* Deployment target: **GitHub Pages**.
* **Main Page**: Cluster analysis visualization showing all interviews as nodes.

  * Hovering highlights interviews and related entities (summaries, themes, etc.)
  * Clicking opens the **rendered JSON object** view for that interview.
* Demonstrates:

  * Semantic grouping of similar interview experiences
  * Cross-linking between themes and quotes
  * Validation and data provenance visualization

---

## 🔧 Tech Stack

| Layer            | Technology                                   |
| ---------------- | -------------------------------------------- |
| Embedding        | `sentence-transformers` (`all-MiniLM-L6-v2`) |
| Vector Search    | FAISS (WebAssembly)                          |
| Full-Text Search | Lunr.js                                      |
| Visualization    | D3.js                                        |
| Frontend         | React + Tailwind                             |
| Deployment       | GitHub Pages                                 |
| Validation       | JSON Schema via ydantic              |

---


