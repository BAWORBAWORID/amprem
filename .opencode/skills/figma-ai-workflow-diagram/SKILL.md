---
name: workflow-diagram
description: >
  Create workflow diagrams, flowcharts, and process maps in Figma with shapes, arrows, and text.
  Use when asked to create a workflow, flowchart, process diagram, decision tree, or any
  node-and-edge diagram in Figma. Supports process boxes, decision diamonds, start/end pills,
  subprocess shapes, notes, swimlanes, and automatic graph layout.
---

# Workflow Diagram

Build workflow diagrams in Figma using the `create_workflow_diagram` command. **One command builds the entire diagram** — shapes, arrows, labels, and layout are handled automatically.

## Prerequisites

- **figma-ai-bridge plugin** running in Figma and connected
- The `create_workflow_diagram` command registered in `code.js`
- Helper: `scripts/figma_cmd.mjs <channel> create_workflow_diagram '<paramsJSON>'`

## Shape Types

| Type | Shape | Use for |
|------|-------|---------|
| `start` | Green pill | Entry point of a workflow |
| `end` | Red pill | Termination / completion points |
| `process` | White rectangle | Actions, tasks, operations |
| `decision` | Yellow diamond | Yes/no branches, conditions. **Always has 2+ labeled outgoing edges** |
| `subprocess` | Purple double-border rectangle | Referenced sub-processes, external calls |
| `note` | Dashed yellow box | Comments, annotations, side notes |

## Command Schema

```json
{
  "title": "My Workflow",
  "direction": "TB",
  "nodes": [
    { "id": "start", "type": "start", "label": "Begin" },
    { "id": "step1", "type": "process", "label": "Do something" },
    { "id": "check", "type": "decision", "label": "OK?" },
    { "id": "done", "type": "end", "label": "Done" }
  ],
  "edges": [
    { "from": "start", "to": "step1" },
    { "from": "step1", "to": "check" },
    { "from": "check", "to": "done", "label": "Yes" },
    { "from": "check", "to": "step1", "label": "No" }
  ],
  "x": 0,
  "y": 0
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | No | "Workflow Diagram" | Diagram title |
| `nodes` | array | **Yes** | — | Node definitions |
| `edges` | array | **Yes** | — | Edge definitions |
| `direction` | "TB" \| "LR" | No | "TB" | Top-to-bottom or left-to-right |
| `swimlanes` | array | No | — | Optional lane groupings |
| `x`, `y` | number | No | 0 | Canvas placement offset |
| `spacing` | object | No | — | Override `nodeWidth`, `nodeHeight`, `horizontalGap`, `verticalGap` |

### Node Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **Yes** | Unique identifier |
| `type` | string | **Yes** | `start`, `end`, `process`, `decision`, `subprocess`, `note` |
| `label` | string | **Yes** | Display text inside the shape |
| `sublabel` | string | No | Smaller text below the shape |
| `x`, `y` | number | No | Manual position override |

### Edge Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | **Yes** | Source node `id` |
| `to` | string | **Yes** | Target node `id` |
| `label` | string | No | Text label on the arrow ("Yes", "No", "Error") |

### Swimlane Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **Yes** | Lane identifier |
| `label` | string | **Yes** | Header text |
| `nodeIds` | string[] | **Yes** | Node IDs belonging to this lane |

## Workflow

### 1. Analyze the User's Description

Parse the description and identify:
- **Steps** → `process` nodes
- **Decision points** → `decision` nodes
- **Start/End** → `start` / `end` nodes
- **Sub-processes** → `subprocess` nodes
- **Annotations** → `note` nodes
- **Roles/departments** → swimlanes
- **Direction**: default TB; use LR for timelines or horizontal processes

### 2. Plan Nodes and Edges

- Assign unique short `id` strings (e.g., `validate_email`, `send_welcome`)
- Write concise labels (1–4 words ideal)
- **Every `decision` node must have labeled outgoing edges**
- Every node should be reachable from a start node
- Every path should lead to an end node (unless it's a loop)

### 3. Build the Diagram

```sh
FIGMA_TIMEOUT_MS=60000 node scripts/figma_cmd.mjs <channel> create_workflow_diagram '<JSON>'
```

Use `get_canvas_bounds` first to avoid overlap with existing content.

### 4. Refine (Optional)

- `set_fill_color` — change a node's color
- `set_text_content` — update a label
- `move_node` — reposition a node
- `set_focus` — zoom to the diagram

## Common Patterns

### Linear Flow
```json
{
  "title": "Order Processing",
  "nodes": [
    { "id": "start", "type": "start", "label": "Order Received" },
    { "id": "validate", "type": "process", "label": "Validate Order" },
    { "id": "charge", "type": "process", "label": "Charge Payment" },
    { "id": "ship", "type": "process", "label": "Ship Item" },
    { "id": "done", "type": "end", "label": "Complete" }
  ],
  "edges": [
    { "from": "start", "to": "validate" },
    { "from": "validate", "to": "charge" },
    { "from": "charge", "to": "ship" },
    { "from": "ship", "to": "done" }
  ]
}
```

### Branching Decision
```json
{
  "title": "Login Flow",
  "nodes": [
    { "id": "start", "type": "start", "label": "User Login" },
    { "id": "auth", "type": "process", "label": "Authenticate" },
    { "id": "valid", "type": "decision", "label": "Valid?" },
    { "id": "dashboard", "type": "process", "label": "Show Dashboard" },
    { "id": "error", "type": "process", "label": "Show Error" },
    { "id": "retry", "type": "decision", "label": "Retry?" },
    { "id": "done", "type": "end", "label": "Done" }
  ],
  "edges": [
    { "from": "start", "to": "auth" },
    { "from": "auth", "to": "valid" },
    { "from": "valid", "to": "dashboard", "label": "Yes" },
    { "from": "valid", "to": "error", "label": "No" },
    { "from": "error", "to": "retry" },
    { "from": "retry", "to": "auth", "label": "Yes" },
    { "from": "retry", "to": "done", "label": "No" },
    { "from": "dashboard", "to": "done" }
  ]
}
```

### Swimlane Layout
```json
{
  "title": "Support Ticket Flow",
  "swimlanes": [
    { "id": "customer", "label": "Customer", "nodeIds": ["submit"] },
    { "id": "support", "label": "Support Team", "nodeIds": ["triage", "assign"] },
    { "id": "engineering", "label": "Engineering", "nodeIds": ["investigate", "resolve", "close"] }
  ]
}
```

## Layout Algorithm

Built-in layered graph layout (Sugiyama-style):
1. **Rank assignment**: BFS from start nodes assigns each node to a layer
2. **Crossing minimization**: Barycenter heuristic (4 passes)
3. **Coordinate assignment**: Nodes evenly spaced, centered
4. **Manual overrides**: If a node has explicit `x`/`y`, those are used

Default spacing: `nodeWidth=240`, `nodeHeight=72`, `horizontalGap=120`, `verticalGap=80`

## Design Tokens

### Shape Colors

| Shape | Fill | Stroke |
|-------|------|--------|
| Process | `#FFFFFF` | `#D1D6DC` |
| Decision | `#FFF9EB` | `#E3C78A` |
| Start | `#ECF9EC` | `#8CC78C` |
| End | `#FAECEC` | `#D18C8C` |
| Subprocess | `#EFEFFA` | `#A6A6D6` |
| Note | `#FDFCF3` | `#D1CCB3` (dashed) |

### Typography

| Element | Font | Weight | Size | Color |
|---------|------|--------|------|-------|
| Diagram title | Inter | Bold | 24px | `#212631` |
| Node label | Inter | Semibold | 14px | `#212631` |
| Node sublabel | Inter | Regular | 11px | `#737A85` |
| Edge label | Inter | Regular | 11px | `#666E78` |
| Swimlane header | Inter | Semibold | 13px | `#59616B` |

## Notes

- **Auto-layout is built-in** — no coordinate math required
- **Direction**: Use `TB` for most workflows, `LR` for pipelines/timelines
- **Swimlanes are optional** — only use when roles/departments are mentioned
- Use `get_canvas_bounds` to avoid overlap with existing content
- Node `id` values should be short, snake_case identifiers
- Keep labels concise (1–4 words). Use sublabels for additional context.
