/**
 * Otentikasi, model user, dan kemampuan role.
 * Pindahan dari server.js monolit — memakai bcrypt + store.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getUsers, saveUsers, randomKey, nowISO } from './store.js';

export function hashPassword(password) {
    return bcrypt.hashSync(String(password), 10);
}

export function verifyPassword(user, password) {
    const stored = String(user.password || '');
    if (stored.indexOf('$2') === 0) return bcrypt.compareSync(String(password), stored);
    return stored === crypto.createHash('sha256').update(String(password)).digest('hex');
}

export function seedOwner() {
    const users = getUsers();
    if (!users['alwayscodex']) {
        users['alwayscodex'] = {
            id: 'owner-' + Date.now().toString(36),
            username: 'alwayscodex',
            password: hashPassword('Akunff+62'),
            role: 'owner',
            credits: 999999,
            apiKey: 'Codex' + randomKey(31),
            apiPlan: 'lifetime',
            apiExpiresAt: null,
            apiActive: true,
            createdAt: nowISO(),
            banned: false,
            ip: '',
            device: '',
            referralCode: generateReferralCode(users),
            referredBy: '', referralCount: 0, referralEarned: 0,
            referralPending: 0, referralClaimed: 0, referrals: [],
        };
        saveUsers(users);
        console.log('[SEED] Owner account created: alwayscodex');
    }
}

/* ============================== REFERAL ============================== */

const REFERRAL_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate kode referal unik format xxx-xxx (6 karakter alfanumerik + strip).
 * Contoh: 628-hs6
 */
export function generateReferralCode(users) {
    const rand = () => REFERRAL_CHARS[Math.floor(Math.random() * REFERRAL_CHARS.length)];
    for (let attempt = 0; attempt < 50; attempt++) {
        const code = rand() + rand() + rand() + '-' + rand() + rand() + rand();
        const taken = Object.keys(users).some(function (k) {
            return String(users[k].referralCode || '').toLowerCase() === code;
        });
        if (!taken) return code;
    }
    // Fallback ekstrem (praktis tak mungkin terjadi)
    return rand() + rand() + rand() + '-' + rand() + rand() + rand();
}

/**
 * Pastikan user punya kode referal. Dipanggil saat login/profile agar akun
 * lama (yang terdaftar sebelum fitur ini) otomatis mendapat kode.
 */
export function ensureReferralCode(user) {
    if (!user) return null;
    if (user.referralCode) return user.referralCode;
    const users = getUsers();
    user.referralCode = generateReferralCode(users);
    users[user.username] = user;
    saveUsers(users);
    return user.referralCode;
}

/**
 * Cari pemilik kode referal (case-insensitive).
 */
export function findReferralOwner(users, code) {
    const norm = String(code || '').trim().toLowerCase();
    if (!norm) return null;
    for (const key of Object.keys(users)) {
        if (String(users[key].referralCode || '').toLowerCase() === norm) return users[key];
    }
    return null;
}

export function sanitizeUser(u) {
    if (!u) return null;
    return {
        id: u.id,
        username: u.username,
        role: u.role,
        credits: u.credits,
        apiKey: u.apiKey,
        apiPlan: u.apiPlan || '',
        apiExpiresAt: u.apiExpiresAt || null,
        apiActive: !!u.apiActive,
        createdAt: u.createdAt,
        banned: !!u.banned,
        referralCode: u.referralCode || '',
        referredBy: u.referredBy || '',
        referralCount: u.referralCount || 0,
        referralEarned: u.referralEarned || 0,
        referralPending: u.referralPending || 0,
        referralClaimed: u.referralClaimed || 0,
    };
}

/* ============================== REFERAL REWARD (PENDING/CLAIMED) ============================== */

/** Reward per undangan (dalam kredit) — sumber kebenaran tunggal. */
export const REFERRAL_REWARD = 40;

/**
 * Ambil data referal user dalam bentuk siap-tampil (untuk GET /api/referral).
 * Kompatibel dengan akun lama yang reward-nya langsung masuk otomatis
 * (referralPending 0, referralClaimed 0) — semuanya sudah terhitung di referralEarned.
 */
export function getReferralData(user) {
    if (!user) return null;
    const referrals = Array.isArray(user.referrals) ? user.referrals : [];
    const totalInvited = referrals.length || (parseInt(user.referralCount, 10) || 0);
    const pendingCount = parseInt(user.referralPending, 10) || 0;
    const claimedCount = parseInt(user.referralClaimed, 10) || 0;
    return {
        referralCode: user.referralCode || '',
        totalInvited: totalInvited,
        pendingReward: pendingCount * REFERRAL_REWARD,
        claimedReward: claimedCount * REFERRAL_REWARD,
        rewardPerReferral: REFERRAL_REWARD,
        referrals: referrals.map(function (r) {
            return {
                id: r.id,
                username: r.username,
                joinedAt: r.joinedAt,
                status: r.status === 'claimed' ? 'claimed' : 'pending',
                reward: REFERRAL_REWARD,
            };
        }),
    };
}

/**
 * Klaim semua reward pending user menjadi kredit.
 * Mengembalikan { success, credits, claimedReward, message } — throw bila error.
 * Aman dari duplicate-claim: proses dilakukan atomik (baca-ubah-tulis) dan
 * pendataan pending di-reset ke 0 setelah berhasil.
 */
export function claimReferralRewards(user) {
    const pendingCount = parseInt(user.referralPending, 10) || 0;
    if (pendingCount <= 0) {
        return { success: false, claimedReward: 0, message: 'Tidak ada reward untuk diklaim.' };
    }
    const reward = pendingCount * REFERRAL_REWARD;
    user.credits = (parseInt(user.credits, 10) || 0) + reward;
    user.referralEarned = (parseInt(user.referralEarned, 10) || 0) + reward;
    user.referralClaimed = (parseInt(user.referralClaimed, 10) || 0) + pendingCount;
    user.referralPending = 0;
    if (Array.isArray(user.referrals)) {
        user.referrals.forEach(function (r) {
            if (r.status !== 'claimed') r.status = 'claimed';
        });
    }
    return {
        success: true,
        credits: user.credits,
        claimedReward: reward,
        message: 'Referral berhasil diklaim! +' + reward + ' kredit telah ditambahkan.',
    };
}

/* ============================== ROLE CAPABILITIES ============================== */

export function isUnlimitedRole(role) {
    return ['reseller', 'premium', 'autogen', 'admin', 'owner'].indexOf(role) !== -1;
}

export function hasApiRole(role) {
    return ['premium', 'autogen', 'admin', 'owner'].indexOf(role) !== -1;
}

export function hasBulkRole(role) {
    return ['autogen', 'admin', 'owner'].indexOf(role) !== -1;
}

export function prepareApiRole(user, previousRole) {
    if (!user || !hasApiRole(user.role)) return;
    // New API-capable roles start without a key. Renewals preserve a key
    // that the user generated manually.
    if (!hasApiRole(previousRole)) {
        user.apiKey = '';
        user.apiActive = false;
        user.apiKeyRevoked = false;
    }
}

/**
 * Semua role premium (reseller/premium/autogen/admin) mendukung masa aktif
 * (expired). Lifetime = apiExpiresAt null. Role apa pun yang punya apiExpiresAt
 * lewat dari waktu sekarang dianggap kedaluwarsa.
 */
export function isPremiumExpired(user) {
    return !!(user && user.apiExpiresAt && Date.parse(user.apiExpiresAt) <= Date.now());
}

export function canUseGenerator(user) {
    return !!(user && (user.role === 'user' || isUnlimitedRole(user.role)) && !isPremiumExpired(user));
}

export function canUseBatch(user, batch) {
    if (!user || !batch || !hasBulkRole(user.role)) return false;
    return ['admin', 'owner'].indexOf(user.role) !== -1 || batch.operator === user.username;
}
