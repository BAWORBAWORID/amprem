#!/usr/bin/env python3
"""
a11y_check.py — Offline accessibility analysis for Figma node data.

Usage:
    python3 a11y_check.py <text_scan.json> <components.json> [--details node_details.json] [--out issues.json]

Input:
    text_scan.json      — Output of scan_text_nodes (has .textNodes[])
    components.json     — Output of scan_nodes_by_types for INSTANCE/COMPONENT (has .matchingNodes[])
    node_details.json   — (Optional) Output of get_node_info on root frame, used for
                          background color resolution and fontWeight data

Output:
    issues.json — JSON with {summary, issues[], annotations[]}
"""
from __future__ import annotations

import json
import math
import os
import re
import sys

# ---------------------------------------------------------------------------
# WCAG thresholds
# ---------------------------------------------------------------------------
CONTRAST_AA_NORMAL = 4.5
CONTRAST_AA_LARGE = 3.0
CONTRAST_AAA_NORMAL = 7.0
CONTRAST_AAA_LARGE = 4.5

MIN_FONT_SIZE_WARN = 12  # px
MIN_FONT_SIZE_ERROR = 10  # px

MIN_TARGET_SIZE = 44  # px (WCAG 2.5.8)

INTERACTIVE_KEYWORDS = re.compile(
    r"(?i)\b(button|btn|link|icon|toggle|checkbox|radio|switch|tab|chip|action|fab|click|press)\b"
)

# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------

def hex_to_rgb(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    if len(h) == 8:
        h = h[:6]
    if len(h) != 6:
        return (0.0, 0.0, 0.0)
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
    return (r, g, b)


def hex_to_rgba(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    if len(h) == 8:
        r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
        a = int(h[6:8], 16) / 255.0
        return (r, g, b, a)
    if len(h) == 6:
        r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
        return (r, g, b, 1.0)
    return (0.0, 0.0, 0.0, 1.0)


def linearize(c: float) -> float:
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(r: float, g: float, b: float) -> float:
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)


def contrast_ratio(l1: float, l2: float) -> float:
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def blend_alpha(fg: tuple, bg: tuple, alpha: float) -> tuple:
    return (
        fg[0] * alpha + bg[0] * (1 - alpha),
        fg[1] * alpha + bg[1] * (1 - alpha),
        fg[2] * alpha + bg[2] * (1 - alpha),
    )


def is_large_text(font_size, font_weight=400) -> bool:
    if font_size is None:
        return False
    if font_size >= 18:
        return True
    if font_size >= 14 and font_weight >= 700:
        return True
    return False


# ---------------------------------------------------------------------------
# Node tree helpers
# ---------------------------------------------------------------------------

def build_node_map(node, parent_id=None, node_map=None):
    if node_map is None:
        node_map = {}
    nid = node.get("id", "")
    if nid:
        node_map[nid] = {"node": node, "parentId": parent_id}
    for child in node.get("children", []):
        build_node_map(child, parent_id=nid, node_map=node_map)
    return node_map


def get_solid_fill_color(node) -> str | None:
    for fill in node.get("fills", []):
        if fill.get("type") == "SOLID" and fill.get("visible", True):
            color = fill.get("color", "")
            if color:
                return color
    return None


def has_image_fill(node) -> bool:
    for fill in node.get("fills", []):
        if fill.get("type") == "IMAGE" and fill.get("visible", True):
            return True
    return False


def has_gradient_or_image_fill(node) -> bool:
    for fill in node.get("fills", []):
        if fill.get("visible", True) and fill.get("type") in (
            "GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR",
            "GRADIENT_DIAMOND", "IMAGE",
        ):
            return True
    return False


def resolve_background(node_id: str, node_map: dict, max_depth: int = 3) -> dict:
    entry = node_map.get(node_id)
    if not entry:
        return {"color": "#ffffff", "source": "assumed", "manual_review": False}

    current_id = entry.get("parentId")
    for _ in range(max_depth):
        if not current_id:
            break
        parent_entry = node_map.get(current_id)
        if not parent_entry:
            break
        parent_node = parent_entry["node"]

        if has_gradient_or_image_fill(parent_node):
            return {"color": None, "source": "gradient_or_image", "manual_review": True}

        solid = get_solid_fill_color(parent_node)
        if solid:
            return {"color": solid, "source": "parent", "manual_review": False}

        current_id = parent_entry.get("parentId")

    return {"color": "#ffffff", "source": "assumed", "manual_review": False}


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_contrast(text_nodes, node_map):
    issues = []

    for tn in text_nodes:
        node_id = tn.get("id", tn.get("nodeId", ""))
        node_name = tn.get("name", tn.get("nodeName", ""))
        font_size = tn.get("fontSize")
        characters = tn.get("characters", tn.get("text", ""))

        if not characters or not characters.strip():
            continue

        detail_entry = node_map.get(node_id)
        if not detail_entry:
            continue
        detail_node = detail_entry["node"]
        fg_hex = get_solid_fill_color(detail_node)
        if not fg_hex:
            continue

        style = detail_node.get("style", {})
        font_weight = style.get("fontWeight", 400)
        if font_size is None:
            font_size = style.get("fontSize")

        bg_info = resolve_background(node_id, node_map)
        if bg_info["manual_review"]:
            issues.append({
                "nodeId": node_id,
                "nodeName": node_name,
                "type": "contrast",
                "severity": "warning",
                "current": "unknown",
                "required": "manual review",
                "details": f"Background is gradient/image — cannot auto-compute contrast for '{characters[:40]}'",
            })
            continue

        bg_hex = bg_info["color"]
        fg_rgba = hex_to_rgba(fg_hex)
        bg_rgb = hex_to_rgb(bg_hex)

        if fg_rgba[3] < 1.0:
            effective_fg = blend_alpha(fg_rgba[:3], bg_rgb, fg_rgba[3])
        else:
            effective_fg = fg_rgba[:3]

        fg_lum = relative_luminance(*effective_fg)
        bg_lum = relative_luminance(*bg_rgb)
        ratio = contrast_ratio(fg_lum, bg_lum)
        ratio_str = f"{ratio:.1f}:1"

        large = is_large_text(font_size, font_weight)
        aa_threshold = CONTRAST_AA_LARGE if large else CONTRAST_AA_NORMAL
        aaa_threshold = CONTRAST_AAA_LARGE if large else CONTRAST_AAA_NORMAL

        size_label = f"{font_size}px" if font_size else "unknown"
        weight_label = "bold" if font_weight >= 700 else "regular"
        text_class = "large" if large else "normal"

        if ratio < aa_threshold:
            issues.append({
                "nodeId": node_id,
                "nodeName": node_name,
                "type": "contrast",
                "severity": "error",
                "current": ratio_str,
                "required": f"{aa_threshold}:1 (AA, {text_class} text)",
                "details": f"fg={fg_hex} bg={bg_hex} size={size_label} weight={weight_label}",
            })
        elif ratio < aaa_threshold:
            issues.append({
                "nodeId": node_id,
                "nodeName": node_name,
                "type": "contrast",
                "severity": "warning",
                "current": ratio_str,
                "required": f"{aaa_threshold}:1 (AAA, {text_class} text)",
                "details": f"fg={fg_hex} bg={bg_hex} size={size_label} weight={weight_label}",
            })

    return issues


def check_font_size(text_nodes):
    issues = []
    for tn in text_nodes:
        node_id = tn.get("id", tn.get("nodeId", ""))
        node_name = tn.get("name", tn.get("nodeName", ""))
        font_size = tn.get("fontSize")
        characters = tn.get("characters", tn.get("text", ""))

        if font_size is None:
            continue
        if not characters or not characters.strip():
            continue

        if font_size < MIN_FONT_SIZE_ERROR:
            issues.append({
                "nodeId": node_id,
                "nodeName": node_name,
                "type": "font-size",
                "severity": "error",
                "current": f"{font_size}px",
                "required": f">= {MIN_FONT_SIZE_ERROR}px",
                "details": f"Text: '{characters[:40]}'",
            })
        elif font_size < MIN_FONT_SIZE_WARN:
            issues.append({
                "nodeId": node_id,
                "nodeName": node_name,
                "type": "font-size",
                "severity": "warning",
                "current": f"{font_size}px",
                "required": f">= {MIN_FONT_SIZE_WARN}px",
                "details": f"Text: '{characters[:40]}'",
            })

    return issues


def check_touch_targets(components):
    issues = []
    for comp in components:
        node_id = comp.get("id", "")
        node_name = comp.get("name", "")
        bbox = comp.get("bbox", {})
        w = bbox.get("width", 0)
        h = bbox.get("height", 0)

        if not INTERACTIVE_KEYWORDS.search(node_name):
            continue

        if w < MIN_TARGET_SIZE or h < MIN_TARGET_SIZE:
            issues.append({
                "nodeId": node_id,
                "nodeName": node_name,
                "type": "touch-target",
                "severity": "warning",
                "current": f"{w:.0f}×{h:.0f}px",
                "required": f">= {MIN_TARGET_SIZE}×{MIN_TARGET_SIZE}px",
                "details": f"Interactive element below minimum target size",
            })

    return issues


def check_empty_text(text_nodes):
    issues = []
    for tn in text_nodes:
        node_id = tn.get("id", tn.get("nodeId", ""))
        node_name = tn.get("name", tn.get("nodeName", ""))
        characters = tn.get("characters", tn.get("text", ""))

        if characters is not None and (not characters or not characters.strip()):
            issues.append({
                "nodeId": node_id,
                "nodeName": node_name,
                "type": "empty-text",
                "severity": "warning",
                "current": "(empty)",
                "required": "Non-empty text content",
                "details": f"Text node has no visible content",
            })

    return issues


def check_image_alt(node_map):
    issues = []
    for node_id, entry in node_map.items():
        node = entry["node"]
        if not has_image_fill(node):
            continue

        annotations = node.get("annotations", [])
        if not annotations:
            issues.append({
                "nodeId": node_id,
                "nodeName": node.get("name", ""),
                "type": "image-alt",
                "severity": "warning",
                "current": "No annotation",
                "required": "Alt text annotation",
                "details": "Image has no annotation — consider adding a description for accessibility",
            })

    return issues


# ---------------------------------------------------------------------------
# Annotation formatting
# ---------------------------------------------------------------------------

ANNOTATION_TEMPLATES = {
    "contrast": "**A11y: Contrast** — Ratio {current} (need {required})",
    "font-size": "**A11y: Font Size** — {current} is below {required} minimum",
    "touch-target": "**A11y: Touch Target** — {current} is below {required} minimum",
    "empty-text": "**A11y: Empty Text** — Text node has no content",
    "image-alt": "**A11y: Image Alt** — Image has no annotation (add alt text description)",
}


def format_annotation(issue):
    template = ANNOTATION_TEMPLATES.get(issue["type"], "**A11y** — {details}")
    return template.format(**issue)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Offline WCAG accessibility analysis for Figma data")
    parser.add_argument("text_scan", help="JSON from scan_text_nodes")
    parser.add_argument("components", help="JSON from scan_nodes_by_types (INSTANCE/COMPONENT)")
    parser.add_argument("--details", help="JSON from get_node_info on root frame (for bg colors & fontWeight)")
    parser.add_argument("--out", default="/tmp/a11y_issues.json", help="Output file (default: /tmp/a11y_issues.json)")
    args = parser.parse_args()

    with open(args.text_scan) as f:
        text_data = json.load(f)
    text_nodes = text_data.get("textNodes", text_data.get("result", {}).get("textNodes", []))
    if not text_nodes:
        text_nodes = text_data if isinstance(text_data, list) else text_data.get("nodes", [])

    with open(args.components) as f:
        comp_data = json.load(f)
    components = comp_data.get("matchingNodes", comp_data.get("result", {}).get("matchingNodes", []))
    if not components:
        components = comp_data if isinstance(comp_data, list) else []

    node_map = {}
    if args.details:
        with open(args.details) as f:
            details_data = json.load(f)
        if isinstance(details_data, list):
            for entry in details_data:
                doc = entry.get("document", entry)
                build_node_map(doc, node_map=node_map)
        elif isinstance(details_data, dict):
            result = details_data.get("result", details_data)
            if isinstance(result, dict) and "document" in result:
                build_node_map(result["document"], node_map=node_map)
            elif isinstance(result, list):
                for entry in result:
                    doc = entry.get("document", entry)
                    build_node_map(doc, node_map=node_map)
            else:
                build_node_map(result, node_map=node_map)

    all_issues = []

    if node_map:
        all_issues.extend(check_contrast(text_nodes, node_map))
    else:
        print("WARNING: No --details provided; skipping contrast checks (need node tree for bg colors)")

    all_issues.extend(check_font_size(text_nodes))
    all_issues.extend(check_touch_targets(components))
    all_issues.extend(check_empty_text(text_nodes))

    if node_map:
        all_issues.extend(check_image_alt(node_map))

    seen = set()
    unique_issues = []
    for issue in all_issues:
        key = (issue["nodeId"], issue["type"])
        if key not in seen:
            seen.add(key)
            unique_issues.append(issue)
    all_issues = unique_issues

    severity_order = {"error": 0, "warning": 1}
    all_issues.sort(key=lambda x: (severity_order.get(x["severity"], 2), x["type"], x["nodeName"]))

    annotations = []
    for issue in all_issues:
        annotations.append({
            "nodeId": issue["nodeId"],
            "labelMarkdown": format_annotation(issue),
            "categoryId": "13:2",
        })

    by_severity = {}
    by_type = {}
    for issue in all_issues:
        by_severity[issue["severity"]] = by_severity.get(issue["severity"], 0) + 1
        by_type[issue["type"]] = by_type.get(issue["type"], 0) + 1

    summary = {
        "total_issues": len(all_issues),
        "by_severity": by_severity,
        "by_type": by_type,
    }

    output = {
        "summary": summary,
        "issues": all_issues,
        "annotations": annotations,
    }

    with open(args.out, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"  A11y Audit Results")
    print(f"{'='*60}")
    print(f"  Total issues: {summary['total_issues']}")
    for sev, count in sorted(by_severity.items()):
        print(f"    {sev}: {count}")
    for typ, count in sorted(by_type.items()):
        print(f"    {typ}: {count}")
    print(f"{'='*60}")

    if all_issues:
        print(f"\n  {'#':<4} {'Severity':<10} {'Type':<14} {'Node':<30} {'Current':<16} {'Required'}")
        print(f"  {'-'*4} {'-'*10} {'-'*14} {'-'*30} {'-'*16} {'-'*20}")
        for i, issue in enumerate(all_issues, 1):
            name = issue["nodeName"][:28]
            print(f"  {i:<4} {issue['severity']:<10} {issue['type']:<14} {name:<30} {issue['current']:<16} {issue['required']}")

    print(f"\n  Output written to: {args.out}")
    if annotations:
        print(f"  {len(annotations)} annotations ready to apply")

    return 0 if summary["total_issues"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
