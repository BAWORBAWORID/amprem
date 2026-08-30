#!/usr/bin/env python3
"""Quick tests for a11y_check.py core functions."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
import a11y_check as a

# --- Color helpers ---
assert a.hex_to_rgb('#000000') == (0.0, 0.0, 0.0)
assert a.hex_to_rgb('#ffffff') == (1.0, 1.0, 1.0)
assert a.hex_to_rgba('#ff000080') == (1.0, 0.0, 0.0, 128/255)

l_black = a.relative_luminance(0, 0, 0)
l_white = a.relative_luminance(1, 1, 1)
ratio = a.contrast_ratio(l_black, l_white)
assert abs(ratio - 21.0) < 0.01, f'Expected 21:1, got {ratio}'

rgb_gray = a.hex_to_rgb('#777777')
l_gray = a.relative_luminance(*rgb_gray)
ratio2 = a.contrast_ratio(l_gray, l_white)
assert 4.4 < ratio2 < 4.6, f'Expected ~4.48:1, got {ratio2}'

blended = a.blend_alpha((0, 0, 0), (1, 1, 1), 0.5)
assert all(abs(c - 0.5) < 0.01 for c in blended)

# --- Large text ---
assert a.is_large_text(18, 400) == True
assert a.is_large_text(14, 700) == True
assert a.is_large_text(14, 400) == False
assert a.is_large_text(12, 400) == False

# --- Font size checks ---
issues = a.check_font_size([
    {"id": "1", "name": "Tiny", "characters": "Hello", "fontSize": 8},
    {"id": "2", "name": "Small", "characters": "World", "fontSize": 11},
    {"id": "3", "name": "Normal", "characters": "OK", "fontSize": 14},
])
assert len(issues) == 2
assert issues[0]["severity"] == "error"
assert issues[1]["severity"] == "warning"

# --- Touch target checks ---
issues2 = a.check_touch_targets([
    {"id": "1", "name": "Button Primary", "bbox": {"width": 30, "height": 30}},
    {"id": "2", "name": "Icon Toggle", "bbox": {"width": 20, "height": 44}},
    {"id": "3", "name": "Big Button", "bbox": {"width": 100, "height": 48}},
    {"id": "4", "name": "Plain Frame", "bbox": {"width": 10, "height": 10}},
])
assert len(issues2) == 2
assert issues2[0]["nodeName"] == "Button Primary"
assert issues2[1]["nodeName"] == "Icon Toggle"

# --- Empty text checks ---
issues3 = a.check_empty_text([
    {"id": "1", "name": "Empty", "characters": ""},
    {"id": "2", "name": "Spaces", "characters": "   "},
    {"id": "3", "name": "Content", "characters": "Hello"},
])
assert len(issues3) == 2

# --- Node map & background resolution ---
root = {
    "id": "root", "name": "Frame", "type": "FRAME",
    "fills": [{"type": "SOLID", "color": "#003366", "visible": True}],
    "children": [
        {
            "id": "child1", "name": "Card", "type": "FRAME",
            "fills": [{"type": "SOLID", "color": "#ffffff", "visible": True}],
            "children": [
                {"id": "text1", "name": "Label", "type": "TEXT", "fills": [{"type": "SOLID", "color": "#333333", "visible": True}], "style": {"fontSize": 14, "fontWeight": 400}, "children": []},
            ]
        },
        {
            "id": "child2", "name": "Banner", "type": "FRAME",
            "fills": [{"type": "IMAGE", "visible": True}],
            "children": [
                {"id": "text2", "name": "Title", "type": "TEXT", "fills": [{"type": "SOLID", "color": "#ffffff", "visible": True}], "style": {"fontSize": 24, "fontWeight": 700}, "children": []},
            ]
        }
    ]
}
node_map = a.build_node_map(root)
assert len(node_map) == 5

bg1 = a.resolve_background("text1", node_map)
assert bg1["color"] == "#ffffff"
assert bg1["source"] == "parent"

bg2 = a.resolve_background("text2", node_map)
assert bg2["manual_review"] == True

bg_root = a.resolve_background("root", node_map)
assert bg_root["color"] == "#ffffff"

print("All tests passed!")
print(f"  Black on white: {ratio:.2f}:1")
print(f"  #777 on white:  {ratio2:.2f}:1")
