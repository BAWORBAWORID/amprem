// Global announcement store (data/announcements.json).
// Admin-managed notices rendered on the Dashboard. Writes are atomic via writeJSON.
import { readJSON, writeJSON } from './store.js';

const FILE = 'announcements'; // readJSON/writeJSON sudah menambahkan .json

let nextId = 1;
try {
    const current = readJSON(FILE) || [];
    for (const a of current) {
        const n = parseInt(a.id, 10);
        if (Number.isFinite(n) && n >= nextId) nextId = n + 1;
    }
} catch {
    // First run: no file yet.
}

export function listAnnouncements() {
    return readJSON(FILE) || [];
}

export function getAnnouncement(id) {
    return listAnnouncements().find((a) => String(a.id) === String(id)) || null;
}

export function createAnnouncement({ type = 'INFO', title, body, priority = 'normal', enabled = true }) {
    const list = listAnnouncements();
    const item = {
        id: String(nextId++),
        type: String(type || 'INFO').toUpperCase(),
        title: String(title || '').slice(0, 120),
        body: String(body || '').slice(0, 1000),
        priority: String(priority || 'normal').toLowerCase(),
        enabled: enabled !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    list.push(item);
    writeJSON(FILE, list);
    return item;
}

export function updateAnnouncement(id, patch) {
    const list = listAnnouncements();
    const idx = list.findIndex((a) => String(a.id) === String(id));
    if (idx === -1) return null;
    const prev = list[idx];
    const next = {
        ...prev,
        ...('type' in patch ? { type: String(patch.type).toUpperCase() } : {}),
        ...('title' in patch ? { title: String(patch.title).slice(0, 120) } : {}),
        ...('body' in patch ? { body: String(patch.body).slice(0, 1000) } : {}),
        ...('priority' in patch ? { priority: String(patch.priority).toLowerCase() } : {}),
        ...('enabled' in patch ? { enabled: patch.enabled !== false } : {}),
        updatedAt: new Date().toISOString(),
    };
    list[idx] = next;
    writeJSON(FILE, list);
    return next;
}

export function deleteAnnouncement(id) {
    const list = listAnnouncements();
    const idx = list.findIndex((a) => String(a.id) === String(id));
    if (idx === -1) return false;
    list.splice(idx, 1);
    writeJSON(FILE, list);
    return true;
}
