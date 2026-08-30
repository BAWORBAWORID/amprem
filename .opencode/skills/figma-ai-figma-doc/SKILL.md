---
name: figma-doc
description: >
  Create structured documentation pages in Figma. Use when asked to create a doc,
  documentation page, spec, brief, write-up, or analysis page in Figma. Builds a
  complete documentation frame with title, sections, body text, and separators in
  a single plugin command.
---

# Figma Documentation Page

Build a structured documentation page in Figma using a standard layout format. **One command** — generate content, call `create_doc_page`, done.

## Prerequisites

- **figma-ai-bridge plugin** running in Figma and connected
- The `create_doc_page` command registered in `code.js`
- Helper: `scripts/figma_cmd.mjs <channel> create_doc_page '<paramsJSON>'`

## Workflow

### 1. Generate Content

Read the user's topic, spec, or description. Organize content into sections:

```json
{
  "title": "Document Title",
  "width": 1600,
  "x": 0,
  "y": 0,
  "sections": [
    { "heading": "Section Title", "body": "Paragraph text..." },
    { "heading": "Comparison", "columns": [{"text": "Left col"}, {"text": "Right col"}] },
    { "heading": "Feature Matrix", "table": {
        "headers": ["Requirement", "Option A", "Option B"],
        "rows": [
          ["Goal-oriented workflows", "✅ Native", "❌ Not core"],
          ["Multi-step execution", "✅ First-class", "⚠️ Limited"]
        ]
      }
    }
  ]
}
```

Each section has ONE of these content types:
- **body** — paragraph text with `\n` for line breaks
- **columns** — array of `{text}` objects (for side-by-side comparison)
- **table** — `{headers: [...], rows: [[...], ...]}` (for structured data, feature matrices)

### Information Design Guidelines

| Content type | Best format | Example |
|---|---|---|
| Narrative explanation | `body` | Executive summary, background, recommendations |
| Pros/cons, either/or | `columns` | "Follow this" vs "Don't follow that" |
| Feature comparison matrix | `table` | Requirements × options with ✅/❌ |
| Structured criteria list | `table` | Dimensions with ratings or status |
| Side-by-side analysis | `columns` | Two approaches described in prose |
| Action items / bullet lists | `body` | Numbered steps, bullet points |
| Visual reference with description | `columns` + `imageNodeId` | Component screenshot + explanation text |

### Cloning Visuals from Source

Columns and body sections support `imageNodeId` to clone an existing Figma node into the new doc:
- `columns[].imageNodeId` — clone into that column (image above text)
- `section.imageNodeId` — clone into the body section (image above text)

**IMPORTANT — Never clone table widgets.** If the source design contains Figma table widgets (WIDGET type), extract the data and use the `table` format instead.

### 2. Build in Figma (ONE call)

```sh
node scripts/figma_cmd.mjs <ch> create_doc_page '{
  "title": "...",
  "width": 1600,
  "sections": [
    {"heading": "Executive Summary", "body": "..."},
    {"heading": "Background", "body": "..."},
    {"heading": "Comparison", "columns": [{"text": "Left"}, {"text": "Right"}]}
  ]
}'
```

This single command builds the entire page: root frame, title, documentation container, all sections with headers/body, separators between sections.

**Returns:** `{ id, name, width, height, sectionCount, sections: [{id, heading, type}] }`

### 3. Post-Creation Adjustments (optional)

Use individual MCP tools to tweak:
- `set_text_content` to edit a specific text node
- `create_frame` / `create_text` to add more content
- `move_node` / `resize_node` for repositioning

## Content Guidelines

### Typical Section Patterns
- **Executive Summary** — one paragraph framing the problem and approach
- **Overview / Background** — context and setup
- **Analysis / Case Study** — detailed breakdown
- **Design Implications** — actionable takeaways with bold lead-in keywords
- **Comparison** — side-by-side using `columns`

### Text Formatting
- Use `\n` for line breaks within body text
- For bullet lists, use `\n` with bullet characters (•) or numbered prefixes
- For bold sub-headings within body, put them on their own line
- Keep section bodies focused — one concept per section

### Section Count
- Aim for 3–7 sections per document
- Start with summary/overview, end with implications/next steps

## What Gets Built

```
<title> (FRAME, white, cornerRadius:20, width:1600, VERTICAL auto-layout)
├── Title (TEXT, Inter Bold 40px, #424242)
└── Documentation (FRAME, cornerRadius:20, VERTICAL, spacing:64)
    ├── Section (FRAME, VERTICAL)
    │   ├── Header (TEXT, Inter Semibold 28px)
    │   └── Body (TEXT, Inter Regular 20px)
    ├── Separator (1px, #e0e0e0)
    ├── Section ...
    └── ...
```

## Typography

| Element | Font | Weight | Size | Color |
|---------|------|--------|------|-------|
| Title | Inter | Bold 700 | 40 | #424242 |
| Section heading | Inter | Semibold 600 | 28 | #424242 |
| Body text | Inter | Regular 400 | 20 | #424242 |

## Width Options

- **1600** — standard documentation (default)
- **2087** — wide format (specs with diagrams)

## Notes

- **Avoid overlapping existing content** — query `get_canvas_bounds` to find existing frames, then set `x`/`y` accordingly
- Separators are auto-inserted between sections
- The entire page builds in a single WebSocket roundtrip (~2-5 seconds)
- **Never clone Figma table widgets** — always extract data and use the `table` format
