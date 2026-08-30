---
name: a11y-audit
description: >
  Audit Figma designs for WCAG accessibility issues — color contrast, minimum font size,
  touch target sizing, and missing text alternatives. Use when asked to check accessibility,
  audit contrast ratios, find a11y issues, verify WCAG compliance, or review designs for
  accessibility problems. Scans nodes, analyzes offline, and annotates issues in Figma.
---

# Figma Accessibility Audit

Scan Figma frames for WCAG 2.2 accessibility violations and annotate issues directly. **Be fast** — scan, analyze, present, annotate.

## Prerequisites

- **figma-ai-bridge plugin** running in Figma and connected
- Helper scripts:
  - `scripts/figma_cmd.mjs <channel> <command> [paramsJSON]` — single command
  - `.github/skills/a11y-audit/scripts/a11y_check.py` — offline analysis
- Reference: `.github/skills/a11y-audit/references/wcag-criteria.md`
- Use `FIGMA_TIMEOUT_MS=30000` for scan commands, `FIGMA_TIMEOUT_MS=60000` for large trees

## Workflow — Do This Quickly

### 1. Scan text nodes

Get the selection, then scan all text nodes:

```sh
FIGMA_TIMEOUT_MS=30000 node scripts/figma_cmd.mjs <ch> scan_text_nodes '{"nodeId":"<id>"}' > /tmp/a11y_text_scan.json
```

Returns `{textNodes: [{id, name, characters, fontSize, fontFamily, fontStyle, width, height, x, y, path, depth}]}`.

### 2. Scan interactive elements

Scan for component instances and frames (potential buttons/controls):

```sh
FIGMA_TIMEOUT_MS=30000 node scripts/figma_cmd.mjs <ch> scan_nodes_by_types '{"nodeId":"<id>","types":["INSTANCE","COMPONENT"]}' > /tmp/a11y_components.json
```

Returns `{matchingNodes: [{id, name, type, bbox: {x, y, width, height}}]}`.

### 3. Enrich with full node info

Batch-fetch details including fills and parent background colors:

```sh
FIGMA_TIMEOUT_MS=60000 node scripts/figma_cmd.mjs <ch> get_nodes_info '{"nodeIds":["<id1>","<id2>",...]}' > /tmp/a11y_node_details.json
```

For each text node, also fetch its parent node(s) to find the background color. Walk up the tree: get the text node's parent from `get_node_info`, check if it has a solid fill. If not, get that node's parent. Stop at 3 levels or when a solid fill is found.

**Efficient approach:** Use `get_node_info` on the root frame with full children — the nested `children` array includes `fills` for all descendants, so you can walk the tree in one call for background resolution.

### 4. Analyze (offline)

Run the analysis script:

```sh
python3 .github/skills/a11y-audit/scripts/a11y_check.py \
  /tmp/a11y_text_scan.json \
  /tmp/a11y_components.json \
  --details /tmp/a11y_node_details.json \
  --out /tmp/a11y_issues.json
```

The script performs all checks offline and outputs categorized issues. It prints a summary to stdout.

### 5. Present issues for review

Show a table to the user:

| # | Node | Issue | Current | Required | Severity |
|---|------|-------|---------|----------|----------|

Group by severity (errors first, then warnings). Include:
- **Contrast** — show ratio and required ratio
- **Font size** — show size and minimum
- **Touch target** — show dimensions and minimum
- **Empty text** — flag nodes with no content
- **Image alt** — flag images without annotations

Wait for user to review. They may choose: annotate all, annotate selected, or skip.

### 6. Annotate issues in Figma

On user approval, apply annotations:

```sh
FIGMA_TIMEOUT_MS=30000 node scripts/figma_cmd.mjs <ch> set_multiple_annotations '{"nodeId":"<rootId>","annotations":<annotations_array>}'
```

The annotations array comes from the `annotations` field in `/tmp/a11y_issues.json`.

## Checks Performed

### Color Contrast (WCAG 1.4.3 / 1.4.6)

| Level | Normal text | Large text (>=18px or >=14px bold) |
|-------|-------------|-------------------------------------|
| **AA** (error) | >= 4.5:1 | >= 3:1 |
| **AAA** (warning) | >= 7:1 | >= 4.5:1 |

- Foreground color = text node's first solid fill color
- Background color = nearest ancestor's first solid fill, or `#FFFFFF` if none found
- Gradient/image backgrounds flagged as "manual review" (cannot auto-compute)
- Opacity is factored into the effective color before computing contrast

### Minimum Font Size (Best Practice)

- Flag text nodes with `fontSize` < 12px as warning
- Flag text nodes with `fontSize` < 10px as error

### Touch Target Size (WCAG 2.5.8)

- Flag interactive elements (INSTANCE/COMPONENT) smaller than 44×44px
- Interactive element detection by name (case-insensitive): `button`, `btn`, `link`, `icon`, `toggle`, `checkbox`, `radio`, `switch`, `tab`, `chip`, `action`, `fab`
- Only the smaller dimension is reported if one axis passes

### Empty Text Content

- Flag text nodes where `characters` is empty or whitespace-only
- Severity: warning

### Image Without Annotation (WCAG 1.1.1)

- Nodes with image fills (`type: "IMAGE"`) that have no annotations
- Severity: warning

## Background Color Resolution

1. Get the text node's parent from `get_node_info` (or from the root tree)
2. Check if the parent has a SOLID fill → use that color
3. If not, check the grandparent (up to 3 levels)
4. If no solid fill found in ancestors, assume `#FFFFFF` (white)
5. If an ancestor has a gradient or image fill, flag as "manual review needed"

## Annotation Format

```
**A11y: <Issue Type>** — <Description>
```

Examples:
- `**A11y: Contrast** — Ratio 2.8:1 (need 4.5:1 for AA)`
- `**A11y: Font Size** — 10px is below 12px minimum`
- `**A11y: Touch Target** — 32×28px is below 44×44px minimum`
- `**A11y: Empty Text** — Text node has no content`
- `**A11y: Image Alt** — Image has no annotation (add alt text description)`

## Notes

- **AA is the default target.** AA violations = errors, AAA violations = warnings.
- **Large text threshold:** >=18px regular weight, or >=14px with fontWeight >= 700 (bold).
- **Opacity compositing:** If a text node has fill opacity < 1, blend with background before computing contrast.
- **Hidden nodes are skipped** by `scan_text_nodes` and `scan_nodes_by_types` automatically.
- **Performance:** For large frames (1000+ nodes), use chunked scanning: `scan_text_nodes` with `{"useChunking": true, "chunkSize": 200}`.
