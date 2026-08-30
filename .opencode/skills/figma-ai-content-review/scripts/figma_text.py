#!/usr/bin/env python3
"""
figma_text.py — Extract text from Figma nodes and apply text changes.

Usage:
    Extract:  python3 figma_text.py extract <channel> <nodeId> [--out texts.json]
    Apply:    python3 figma_text.py apply <channel> <changes.json>

Extract mode: scans all text nodes under a node tree, outputs JSON.
Apply mode: reads a JSON array of {nodeId, newText} and sets text content.
"""
import json, subprocess, os, sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Use the project's figma_cmd.mjs
CMD_SCRIPT = os.path.join(SCRIPT_DIR, '..', '..', '..', '..', 'scripts', 'figma_cmd.mjs')

def cmd(channel, command, params):
    env = os.environ.copy()
    env['FIGMA_TIMEOUT_MS'] = '30000'
    out = subprocess.check_output(
        ['node', CMD_SCRIPT, channel, command, json.dumps(params)],
        env=env, timeout=35
    )
    data = json.loads(out)
    if data.get('error'):
        print(f"  ERROR: {data['error'][:80]}")
    return data.get('result', {})

def extract_texts(channel, node_id, out_file):
    """Scan all text nodes under a node and extract their content."""
    result = cmd(channel, 'scan_text_nodes', {'nodeId': node_id})

    texts = []
    for node in result.get('textNodes', result.get('nodes', [])):
        texts.append({
            'nodeId': node.get('id', node.get('nodeId', '')),
            'nodeName': node.get('name', node.get('nodeName', '')),
            'text': node.get('characters', node.get('text', '')),
            'fontSize': node.get('fontSize', ''),
            'visible': node.get('visible', True),
        })

    print(f"Extracted {len(texts)} text nodes")
    json.dump(texts, open(out_file, 'w'), indent=2, ensure_ascii=False)
    print(f"Written to {out_file}")

    for t in texts:
        preview = t['text'][:60].replace('\n', ' ')
        vis = '' if t['visible'] else ' [hidden]'
        print(f"  {t['nodeId']:50s} {preview}{vis}")

    return texts

def apply_changes(channel, changes_file):
    """Apply text changes to Figma nodes."""
    changes = json.load(open(changes_file))

    if not changes:
        print("No changes to apply")
        return

    print(f"Applying {len(changes)} text changes...")
    success = 0
    failed = 0

    for c in changes:
        result = cmd(channel, 'set_text_content', {
            'nodeId': c['nodeId'],
            'text': c['newText'],
        })
        if result.get('success') or result.get('id'):
            success += 1
        else:
            failed += 1
            print(f"  FAIL: {c['nodeId']}")

    print(f"Done: {success} updated, {failed} failed")

def main():
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python3 figma_text.py extract <channel> <nodeId> [--out texts.json]")
        print("  python3 figma_text.py apply <channel> <changes.json>")
        sys.exit(1)

    mode = sys.argv[1]
    channel = sys.argv[2]

    if mode == 'extract':
        if len(sys.argv) < 4:
            print("Need nodeId")
            sys.exit(1)
        node_id = sys.argv[3]
        out_file = '/tmp/figma_texts.json'
        if '--out' in sys.argv:
            out_file = sys.argv[sys.argv.index('--out') + 1]
        extract_texts(channel, node_id, out_file)

    elif mode == 'apply':
        if len(sys.argv) < 4:
            print("Need changes.json file")
            sys.exit(1)
        changes_file = sys.argv[3]
        apply_changes(channel, changes_file)

    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)

if __name__ == '__main__':
    main()
