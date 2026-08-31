/**
 * Otentikasi, model user, dan kemampuan role.
 * Pindahan dari server.js monolit.
 *
 * HASHING: memakai scrypt bawaan Node (memory-hard, tahan GPU/ASIC) secara
 * ASYNC di threadpool — tidak memblokir event loop seperti bcryptjs sync.
 * Format tersimpan: scrypt$N$r$p$<salt_hex>$<key_hex> (versi lengkap tersimpan
 * sehingga parameter bisa dimigrasikan tanpa kehilangan data).
 * Hash bcrypt lama (prefix $2) tetap diverifikasi lalu otomatis di-upgrade
 * ke scrypt saat login berikutnya (lihat api.js).
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getUsers, saveUsers, generateApiKey, nowISO, readJSON } from './store.js';

// Parameter scrypt (N=2^15, r=8, p=1, key 64-byte). Memory-hard: ≈32 MB per
// operasi, jauh lebih mahal untuk GPU/ASIC dibanding bcrypt cost-10.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password, salt, keylen, opts) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
    });
}

export async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scryptAsync(String(password), salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
    });
    return 'scrypt$' + SCRYPT_N + '$' + SCRYPT_R + '$' + SCRYPT_P + '$' + salt.toString('hex') + '$' + key.toString('hex');
}

export function isScryptHash(stored) {
    return typeof stored === 'string' && stored.indexOf('scrypt$') === 0;
}

/**
 * Perlu re-hash? True bila bukan scrypt saat ini (bcrypt lama / plaintext).
 */
export function needsPasswordRehash(user) {
    return !isScryptHash(String(user && user.password || ''));
}

export async function verifyPassword(user, password) {
    const stored = String(user && user.password || '');
    // Layout scrypt: scrypt$N$r$p$salt$key
    if (isScryptHash(stored)) {
        const parts = stored.split('$');
        if (parts.length !== 6) return false;
        const N = parseInt(parts[1], 10);
        const r = parseInt(parts[2], 10);
        const p = parseInt(parts[3], 10);
        const salt = Buffer.from(parts[4], 'hex');
        const expected = Buffer.from(parts[5], 'hex');
        if (!N || !r || !p || !salt.length || !expected.length) return false;
        try {
            const key = await scryptAsync(String(password), salt, expected.length, {
                N, r, p, maxmem: SCRYPT_MAXMEM,
            });
            return key.length === expected.length && crypto.timingSafeEqual(key, expected);
        } catch (e) {
            return false;
        }
    }
    // Legacy: hanya terima hash bcrypt (prefix $2). Hash lemah (SHA-256/plaintext)
    // ditolak agar tidak ada jalur verifikasi yang tidak aman.
    if (stored.indexOf('$2') !== 0) return false;
    return bcrypt.compareSync(String(password), stored);
}

export function isValidUsername(username) {
    return /^[a-z0-9_.-]{3,32}$/.test(String(username || '').toLowerCase());
}

export async function seedOwner() {
    const users = getUsers();
    if (!users['alwayscodex']) {
        users['alwayscodex'] = {
            id: 'owner-' + Date.now().toString(36),
            username: 'alwayscodex',
            password: await hashPassword('Akunff+62'),
            role: 'owner',
            credits: 999999,
            apiKey: generateApiKey(),
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
    return ['reseller', 'premium', 'autogen', 'vip', 'owner'].indexOf(role) !== -1;
}

export function hasApiRole(role) {
    return ['premium', 'autogen', 'vip', 'owner', 'pro'].indexOf(role) !== -1;
}

export function hasBulkRole(role) {
    return ['autogen', 'vip', 'owner'].indexOf(role) !== -1;
}

// Apakah user boleh pakai API Key (generate + panggil API bot).
// Role premium/autogen/vip/owner selalu boleh. Role 'user' (gratis) boleh
// HANYA bila maintenance.apikeyUserDisabled tidak aktif (toggle "Nonaktifkan
// Apikey Untuk User" dalam posisi OFF).
export function canUseApiKey(user) {
    if (!user) return false;
    if (hasApiRole(user.role)) return true;
    if (user.role === 'user') {
        const settings = readJSON('settings', {});
        const disabled = !!(settings.maintenance && settings.maintenance.apikeyUserDisabled);
        return !disabled;
    }
    return false;
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
 * Semua role premium (reseller/premium/autogen/vip) mendukung masa aktif
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
    return ['vip', 'owner'].indexOf(user.role) !== -1 || batch.operator === user.username;
}

// Kredit harian per role — RESET PENUH ke nilai ini setiap jam 00.00 WIB
// (lazy reset via ensureDailyUserCredits saat user mengakses).
export const ROLE_DAILY_CREDITS = { user: 50, pro: 100 };
export const DAILY_USER_CREDIT_GRANT = 50; // kompatibilitas lama (= role user)
export const DEFAULT_USER_CREDITS = DAILY_USER_CREDIT_GRANT; // nilai awal / reset admin

/**
 * Reset kredit harian (jam 00.00 WIB, timezone Asia/Jakarta).
 * Berlaku utk role dgn entri di ROLE_DAILY_CREDITS. Bukan top-up:
 * saldo DI-SET ulang persis ke jumlah harian role tsb.
 * Mengembalikan true jika kredit baru saja di-reset.
 */
export function ensureDailyUserCredits(user) {
    const grant = user ? ROLE_DAILY_CREDITS[user.role] : null;
    if (!grant) return false;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    if (user.creditResetDate !== today) {
        user.credits = grant;
        user.creditResetDate = today;
        return true;
    }
    return false;
}
