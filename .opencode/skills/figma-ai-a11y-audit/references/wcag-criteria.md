# WCAG 2.2 Criteria — Quick Reference for Visual Design Audits

This reference covers the WCAG 2.2 success criteria most relevant to Figma design audits.
Only criteria that can be checked from static design data (colors, sizes, text, layout) are included.

## Perceivable

### 1.1.1 Non-text Content (Level A)

All non-text content (images, icons, controls) must have a text alternative.

| Element | Requirement |
|---------|------------|
| Informative image | Alt text describing the content |
| Decorative image | Can be marked as decorative (empty alt) |
| Icon-only button | Accessible label describing the action |
| Complex image (chart, graph) | Long description or data table alternative |

**In Figma:** Check that image nodes have annotations describing their purpose.

---

### 1.4.3 Contrast (Minimum) — Level AA

Text and images of text must have a contrast ratio of at least:

| Text type | Minimum ratio |
|-----------|--------------|
| Normal text (< 18px, or < 14px bold) | **4.5:1** |
| Large text (≥ 18px, or ≥ 14px bold) | **3.0:1** |
| Incidental (disabled, decorative, logos) | No requirement |

**Relative luminance:** L = 0.2126R + 0.7152G + 0.0722B (after sRGB linearization)

**Contrast ratio:** (L1 + 0.05) / (L2 + 0.05)

---

### 1.4.6 Contrast (Enhanced) — Level AAA

| Text type | Minimum ratio |
|-----------|--------------|
| Normal text | **7.0:1** |
| Large text | **4.5:1** |

---

### 1.4.11 Non-text Contrast — Level AA

UI components (borders, focus indicators, icons) and graphical objects must have at least **3.0:1** contrast against adjacent colors.

| Element | Requirement |
|---------|------------|
| Button border | 3:1 against background |
| Icon (informative) | 3:1 against background |
| Form input border | 3:1 against background |
| Focus indicator | 3:1 against unfocused state |
| Chart elements | 3:1 against adjacent elements |

---

### 1.4.12 Text Spacing — Level AA

Content must not be clipped or lost when text spacing is adjusted to:

| Property | Minimum |
|----------|---------|
| Line height | 1.5× font size |
| Paragraph spacing | 2× font size |
| Letter spacing | 0.12× font size |
| Word spacing | 0.16× font size |

**In Figma:** Verify `lineHeightPx` is at least 1.5× `fontSize`.

---

## Operable

### 2.5.5 Target Size (Enhanced) — Level AAA

Interactive targets must be at least **44 × 44 CSS pixels**.

### 2.5.8 Target Size (Minimum) — Level AA (WCAG 2.2)

Interactive targets must be at least **24 × 24 CSS pixels**, with exceptions for inline targets, targets with sufficient spacing, and UA-controlled targets.

**In Figma:** We use 44×44px as the recommended target (AAA) and flag elements below it as warnings. Elements below 24×24px are errors.

---

## Best Practices (Not WCAG, but Recommended)

### Minimum Font Size

| Threshold | Severity |
|-----------|----------|
| < 10px | Error — extremely difficult to read |
| < 12px | Warning — may be difficult for low-vision users |
| ≥ 12px | Pass |

### Empty Text Nodes

Text nodes with empty or whitespace-only content may indicate placeholder text that was removed, hidden content that should be deleted, or missing labels for interactive elements.

### Color-Only Information

Information conveyed only by color (e.g., red = error, green = success) should also have text labels, icons or patterns, and sufficient contrast between the colors used.

---

## Severity Mapping

| WCAG Level | Our severity | Action |
|------------|-------------|--------|
| Level A violation | **error** | Must fix |
| Level AA violation | **error** | Must fix |
| Level AAA not met | **warning** | Recommended |
| Best practice | **warning** | Recommended |

---

## References

- [WCAG 2.2 Specification](https://www.w3.org/TR/WCAG22/)
- [Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/)
- [WCAG Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Target Size requirements](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
