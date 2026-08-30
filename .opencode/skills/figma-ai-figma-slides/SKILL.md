---
name: figma-slides
description: >
  Create presentation slides in Figma. Use when asked to create slides, a deck,
  a presentation, or a pitch in Figma. Builds 1920×1080 slide frames with title,
  body, key points, and visual references using standard slide layout patterns.
---

# Figma Slides

Build presentation slides in Figma. **One command per slide** via `create_slide`, or batch multiple slides. Combine with `online-research` skill for data-driven decks.

**MANDATORY:** Every deck must be organized into logical sections. Each section = one row on the canvas, starting with a cover slide cloned from an existing template. The agent must autonomously decide how to divide content into sections — do NOT ask the user for section structure.

## Prerequisites

- **figma-ai-bridge plugin** running in Figma and connected
- The `create_slide` command registered in `code.js`
- Helper: `scripts/figma_cmd.mjs <channel> create_slide '<paramsJSON>'`

## Slide Types

### Type 1: `title` — Section Cover / Title Slide

Clone an existing slide template via `templateNodeId` to get the decorative background, then update text.

```json
{
  "type": "title",
  "templateNodeId": "<node-id>",
  "header": "Project Name",
  "title": "Presentation Title",
  "x": 0, "y": 0
}
```

- **Always use `templateNodeId`** — cover slides must clone a template for visual style
- **Discover the template autonomously:** Use `get_selection`, or scan with `get_document_info` and `get_node_info` to find an INSTANCE named "Slide templates". Only ask the user if no template exists.

### Type 2: `content` — Title + Body + Key Points (Two-Column)

Left column has body text, right column has bold heading + description pairs.

```json
{
  "type": "content",
  "title": "Key Findings",
  "body": "Our research across three verticals revealed...",
  "points": [
    {"heading": "Finding One", "description": "Details about the first finding..."},
    {"heading": "Finding Two", "description": "Details about the second finding..."}
  ],
  "x": 0, "y": 0
}
```

### Type 3: `visual` — Title + Body + Cloned Visual

Left side has title and body. Right side clones an existing Figma node (UI mockup, screenshot, diagram).

```json
{
  "type": "visual",
  "title": "Feature Preview",
  "body": "This shows the new user onboarding flow...",
  "imageNodeId": "<node-id>",
  "x": 0, "y": 0
}
```

### Type 4: `statement` — Big Quote / Key Message

Single impactful statement, large text.

```json
{
  "type": "statement",
  "title": "Key Insight",
  "statement": "Users complete tasks 3x faster with the new workflow.",
  "x": 0, "y": 0
}
```

### Type 5: `columns` — Side-by-Side Equal Columns

Two parallel text blocks for contrasting or complementary concepts.

```json
{
  "type": "columns",
  "title": "Trade-offs",
  "columns": [
    {"text": "Approach A:\n• Fast to implement\n• Lower cost\n• Less flexible"},
    {"text": "Approach B:\n• Slower rollout\n• Higher investment\n• More extensible"}
  ],
  "x": 0, "y": 0
}
```

### Type 6: `comparison` — Table / Comparison Grid

```json
{
  "type": "comparison",
  "title": "Feature Comparison",
  "headers": ["Dimension", "Option A", "Option B"],
  "rows": [
    ["Performance", "Fast", "Moderate"],
    ["Cost", "$$$", "$$"],
    ["Scalability", "✅ High", "⚠️ Medium"]
  ],
  "x": 0, "y": 0
}
```

### Type 7: `numbered` — Numbered Decision / Action List

```json
{
  "type": "numbered",
  "title": "Decisions Needed",
  "items": [
    {"text": "Approve the new architecture", "detail": "Sets technical direction for Q3"},
    {"text": "Hire two more engineers", "detail": "Needed to meet the timeline"}
  ],
  "x": 0, "y": 0
}
```

## Workflow

### 1. Plan the Deck

Each slide = one idea:
- **Title** for opener and section breaks
- **Content** for arguments with supporting points
- **Visual** for UI mockups, screenshots, diagrams
- **Statement** for key takeaways and quotes
- **Columns** for side-by-side contrasts
- **Comparison** for structured data / feature matrices
- **Numbered** for ordered decisions or action items

### 2. Plan Sections (MANDATORY — autonomous)

Group slides into 3–5 sections by theme. Each section = one row on the canvas, starting with a cloned cover slide.

Example structure:
```
Row 1 — Opening:     [Cover] [Content] [Content] [Statement]
Row 2 — Analysis:    [Cover] [Comparison] [Content] [Content]
Row 3 — Strategy:    [Cover] [Content] [Statement] [Comparison]
Row 4 — Next Steps:  [Cover] [Columns] [Numbered] [Statement]
```

**Grid formula:**
- x = (slideIndex % 5) × 2020
- y = rowIndex × 1338

### 3. Build Slides

For multiple slides, use batch mode which auto-avoids overlapping existing content:

```sh
FIGMA_TIMEOUT_MS=300000 node scripts/figma_cmd.mjs <ch> batch_slides /tmp/slides.json
```

For a single slide:
```sh
FIGMA_TIMEOUT_MS=60000 node scripts/figma_cmd.mjs <ch> create_slide '<JSON>'
```

## Typography

| Element | Font | Weight | Size | Color |
|---------|------|--------|------|-------|
| Header (deck title) | Inter | Semibold 600 | 24 | #1f1f1f |
| Slide title | Inter | Bold 700 | 68 | #242424 |
| Body text | Inter | Regular 400 | 28 | #525252 |
| Key point heading | Inter | Semibold 600 | 28 | #242424 |
| Key point description | Inter | Regular 400 | 28 | #525252 |
| Statement text | Inter | Bold 700 | 48 | #242424 |
| Table header | Inter | Semibold 600 | 20 | #242424 |
| Table body | Inter | Regular 400 | 20 | #525252 |
| Numbered item | Inter | Bold 700 | 40 | #242424 |

## Layout

| Element | Value |
|---------|-------|
| Slide size | 1920 × 1080 |
| Corner radius | 48 (content), 32 (title) |
| Fill | #ffffff |
| Content margin | 75px |
| Column gap | 150 |
| Line height (body 28px) | 42px |
| Line height (title 68px) | 92px |

## Content Guidelines

- **One idea per slide**
- **Short, declarative titles** — state the conclusion, not the topic
- **3–5 sentences max** per column
- **2–4 key points** per content slide
- **Visual slides** clone existing Figma nodes via `imageNodeId`

## Deck Structure Patterns

### Leadership Presentation (12–16 slides, 4 sections)
- Section 1: Opening — problem + framing
- Section 2: Analysis — options + evidence
- Section 3: Strategy — opportunity + recommendation
- Section 4: Ask — decisions + closing

### Feature Overview (8–10 slides, 3 sections)
- Section 1: Overview — what and why
- Section 2: Deep Dives — feature mockups
- Section 3: Summary — matrix + next steps

### Research Findings (10–12 slides, 3 sections)
- Section 1: Context — summary + key distinction
- Section 2: Findings — data + analysis
- Section 3: Recommendations — actions + takeaway

## Notes

- **Cover slides MUST use `templateNodeId`** — discover template autonomously
- **Section planning is autonomous** — never ask the user how to group slides
- Use `get_canvas_bounds` to avoid overlap
- Cloned visuals retain their original styling
