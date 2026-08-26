"""
Canva Auth - 2 Mode Pendaftaran
================================
1. MANUAL  : pakai email lo sendiri, kode verifikasi diketik dari inbox lo
2. OTOMATIS: pakai email temporary dndone.my.id (Firebase), kode diambil
   otomatis. Fallback ke API azbry bila domain dnd diblok.
             Akun jadi tanpa sentuhan tangan. Credentials disimpan ke akun_canva.txt

  python canva_auth.py register   <- MANUAL (email sendiri)
  python canva_auth.py auto       <- OTOMATIS (tempmail dndone.my.id, fallback azbry)
  python canva_auth.py login      <- login akun existing (manual)
  python canva_auth.py status     <- cek session
  python canva_auth.py logout     <- hapus session
  python canva_auth.py paste      <- fallback: paste cookie manual

Session tersimpan di canva_session.json -> otomatis dipake canva_scraper.py
Catatan: window chromium muncul tersembunyi di taskbar ±1-2 menit.
"""

import json
import os
import re
import sys
import time
import random
import string
import getpass
import atexit
import shutil
import subprocess
import requests
from curl_cffi import requests as cf_requests
from patchright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
SESSION_FILE = os.path.join(BASE, "canva_session.json")
AKUN_FILE = os.path.join(BASE, "akun_canva.txt")
DEBUG_DIR = os.path.join(BASE, "debug")
CHECK_URL = "https://www.canva.com/settings"
AZBRY = "https://api.azbry.com/api/tools/tempmail"
# ==== Provider email temp ====
# Utama : dndone.my.id — mailbox ditulis ke Firebase publik, OTP dibaca dari
#         /emails/<username>.json (jalur yang sama dipakai ekstensi email.js).
# Fallback: azbry bila domain dnd diblok Canva / Firebase bermasalah.
MAIL_DB = os.environ.get("MAIL_DB", "https://dnd-mail-db-default-rtdb.asia-southeast1.firebasedatabase.app")
DND_DOMAINS = ["dndone.my.id", "dndonly.my.id"]


# ================================================================ util
def log(m):
    print(m, flush=True)


def load_session():
    if not os.path.exists(SESSION_FILE):
        return None
    try:
        with open(SESSION_FILE, encoding="utf-8") as f:
            ck = json.load(f).get("cookies", {})
        return {c["name"]: c["value"] for c in ck} if isinstance(ck, list) else ck
    except Exception:
        return None


def save_session_raw(cookie_list):
    with open(SESSION_FILE, "w", encoding="utf-8") as f:
        json.dump({"cookies": cookie_list}, f, indent=2)


def validate_session(cdict):
    try:
        s = cf_requests.Session(impersonate="chrome")
        for k, v in cdict.items():
            s.cookies.set(k, v, domain=".canva.com")
        return s.get(CHECK_URL, timeout=30, allow_redirects=False).status_code == 200
    except Exception:
        return False


def cookies_to_dict(cookie_list):
    return {c["name"]: c["value"] for c in cookie_list if "canva" in c.get("domain", "")}


def shot(page, tag):
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        page.screenshot(path=os.path.join(DEBUG_DIR, f"{tag}.png"))
    except Exception:
        pass


# ================================================================ tempmail
def _rand_str(chars, n):
    return "".join(random.choice(chars) for _ in range(n))


def _dnd_create_mailbox():
    user = _rand_str("abcdefghijklmnopqrstuvwxyz0123456789", 10)
    domain = random.choice(DND_DOMAINS)
    pin = _rand_str("0123456789", 4)
    r = requests.put(f"{MAIL_DB}/users/{user}.json",
                     data=json.dumps({"pin": pin, "domain": domain}), timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"dnd register HTTP {r.status_code}")
    return {"provider": "dnd", "key": user}


def _dnd_poll_code(user, max_wait=150):
    start = time.time()
    while time.time() - start < max_wait:
        try:
            box = requests.get(f"{MAIL_DB}/emails/{user}.json", timeout=30).json() or {}
            for m in box.values():
                m = m or {}
                blob = json.dumps(m)
                if "canva" in blob.lower():
                    src = m.get("body") or blob
                    codes = re.findall(r"\b(\d{6})\b", src)
                    if codes:
                        return codes[0]
        except Exception:
            pass
        time.sleep(4)
    return None


def _azbry_poll_code(session, max_wait=150):
    start = time.time()
    while time.time() - start < max_wait:
        try:
            r = requests.get(AZBRY, params={"session": session}, timeout=30).json()
            for m in (r.get("result") or {}).get("messages") or []:
                blob = json.dumps(m)
                if "canva" in blob.lower():
                    codes = re.findall(r"\b(\d{6})\b", blob)
                    if codes:
                        return codes[0]
        except Exception:
            pass
        time.sleep(4)
    return None


def new_mailbox():
    """Utama: dndone.my.id via Firebase. Fallback: azbry."""
    try:
        meta = _dnd_create_mailbox()
        return f"{meta['key']}@dndone.my.id", meta
    except Exception as e:
        log(f"  [i] dndone ga available ({e}), fallback ke azbry ...")
        r = requests.get(AZBRY, timeout=30).json()
        res = r["result"]
        return res["mailbox"], {"provider": "azbry", "key": res["session"]}


def poll_code(meta, max_wait=150):
    if not meta:
        return None
    if meta["provider"] == "dnd":
        return _dnd_poll_code(meta["key"], max_wait)
    return _azbry_poll_code(meta["key"], max_wait)


# ================================================================ browser engine
SCREENS = {
    "nama":  "input[autocomplete='name']",
    "sandi": "input[type='password']",
    "kode":  "input[autocomplete='one-time-code']",
    "email": "input[name='username']",
}


def open_canva(page, url):
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    for _ in range(10):
        if "moment" not in page.title().lower():
            log("  [ok] lolos gerbang Cloudflare")
            return
        time.sleep(2.5)
    shot(page, "cf_stuck")
    raise RuntimeError("Cloudflare ga lolos, coba lagi")


def dismiss_cookies(page):
    try:
        page.get_by_text("Accept all cookies").first.click(timeout=2500)
        page.wait_for_timeout(800)
    except Exception:
        pass


def click_continue(page):
    try:
        page.get_by_role("button", name="Continue").first.click(timeout=8000)
    except Exception:
        pass  # tombol detach karena navigasi = tanda sukses
    page.wait_for_timeout(3000)


def detect_screen(page, timeout=14):
    start = time.time()
    while time.time() - start < timeout:
        for name, sel in SCREENS.items():
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=400):
                    return name, loc
            except Exception:
                pass
        time.sleep(0.8)
    return None, None


def skip_checkup(page):
    if "account-checkup" in (page.url or ""):
        for t in ["Skip", "Not now", "Maybe later", "Lewati", "Later"]:
            try:
                page.get_by_role("button", name=t).first.click(timeout=1500)
                break
            except Exception:
                continue
        page.wait_for_timeout(2000)


def wait_session(ctx, timeout=45):
    start = time.time()
    while time.time() - start < timeout:
        if validate_session(cookies_to_dict(ctx.cookies())):
            return True
        time.sleep(2.5)
    return False


def run_flow(ctx, page, email, name, password, start_url, get_code):
    """Engine adaptif. get_code(email) -> string kode verifikasi."""
    open_canva(page, start_url)
    dismiss_cookies(page)

    try:
        page.get_by_text("Continue with email").first.click(timeout=8000)
        page.wait_for_timeout(2500)
    except Exception:
        pass

    scr, loc = detect_screen(page, timeout=10)
    if scr == "email":
        loc.click()
        page.wait_for_timeout(250)
        loc.fill(email)
        log("  [ok] email terisi")
        click_continue(page)

    for step in range(8):
        scr, loc = detect_screen(page, timeout=14)
        if scr is None:
            log("  [i] ga ada form lagi (mungkin udah masuk)")
            break
        if scr == "email" and step > 0:
            continue
        log(f"  [>] layar terdeteksi: {scr}")

        if scr == "kode":
            log("  [*] nunggu kode verifikasi ...")
            code = get_code(email)
            if not code:
                shot(page, "no_code")
                raise RuntimeError("kode verifikasi ga dapet "
                                   "(domain email mungkin diblok Canva)")
            loc.click()
            loc.fill(code)
            click_continue(page)
        elif scr == "nama":
            loc.click()
            loc.fill(name)
            click_continue(page)
        elif scr == "sandi":
            loc.click()
            loc.fill(password)
            click_continue(page)
        elif scr == "email":
            loc.click()
            loc.fill(email)
            click_continue(page)

        skip_checkup(page)
        if validate_session(cookies_to_dict(ctx.cookies())):
            return True
        page.wait_for_timeout(1200)

    return wait_session(ctx, timeout=30)


# ================================================================ display otomatis
_xvfb_proc = None


def ensure_display():
    """Pastikan ada X server sebelum launch browser headed.
    Kalau $DISPLAY kosong (mis. VPS tanpa layar), nyalakan Xvfb otomatis
    sehingga cukup `python3 canva.py register` tanpa prefix xvfb-run."""
    global _xvfb_proc
    if os.environ.get("DISPLAY"):
        return
    if not shutil.which("Xvfb"):
        raise RuntimeError(
            "Butuh Xvfb untuk mode headed di server tanpa layar.\n"
            "       Install sekali saja: sudo apt install -y xvfb")
    for disp in (":99", ":98", ":97"):
        try:
            _xvfb_proc = subprocess.Popen(
                ["Xvfb", disp, "-screen", "0", "1280x800x24"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1.0)
            if _xvfb_proc.poll() is None:  # proses masih hidup = port display bebas
                os.environ["DISPLAY"] = disp
                log(f"[+] Xvfb {disp} jalan otomatis (headed virtual)")
                return
        except Exception:
            continue
    raise RuntimeError("Gagal menjalankan Xvfb otomatis.")


atexit.register(lambda: _xvfb_proc.terminate() if _xvfb_proc else None)


def launch_browser(p):
    return p.chromium.launch(
        headless=False,  # headless murni diblok Cloudflare
        args=["--disable-blink-features=AutomationControlled",
              "--window-position=-32000,-32000",
              "--window-size=1280,800"])


def finish(ctx, page, ok, email=None, password=None):
    if ok:
        save_session_raw(ctx.cookies())
        log("\n[OK] BERHASIL! Session tersimpan & terverifikasi.")
        log("     Jalankan scraper: python canva_scraper.py")
        if email:
            with open(AKUN_FILE, "a", encoding="utf-8") as f:
                f.write(f"{email} | {password}\n")
            log(f"     Credentials dicatat di: akun_canva.txt")
    else:
        shot(page, "flow_end")
        log("\n[X] Session ga kebentuk. Cek screenshot di debug/")


# ================================================================ commands
def cmd_register():
    """MANUAL: email sendiri, kode diketik dari inbox."""
    log("=" * 58)
    log("  CANVA REGISTER - MANUAL (email lo sendiri)")
    log("=" * 58)
    email = input("Email    : ").strip()
    if "@" not in email:
        log("[X] email ga valid")
        return
    default_name = re.sub(r"[^a-zA-Z ]", " ", email.split("@")[0]).title().strip()
    name = input(f"Nama [{default_name}]: ").strip() or default_name
    password = getpass.getpass("Password : ")
    if len(password) < 8:
        log("[X] password minimal 8 karakter")
        return

    def get_code(_):
        return input("\n>> Cek inbox email lo! Masukin kode verifikasi: ").strip()

    ensure_display()
    with sync_playwright() as p:
        browser = launch_browser(p)
        ctx = browser.new_context(locale="en-US",
                                  viewport={"width": 1280, "height": 800},
                                  timezone_id="Asia/Jakarta")
        page = ctx.new_page()
        try:
            ok = run_flow(ctx, page, email, name, password,
                          "https://www.canva.com/signup/", get_code)
            finish(ctx, page, ok)
        except Exception as e:
            shot(page, "register_error")
            log(f"\n[X] ERROR: {e}")
        finally:
            browser.close()


def cmd_auto(jumlah=1, max_coba=5):
    """OTOMATIS: tempmail azbry, semua kejadian sendiri.
    Kalau domain email keblok Canva, otomatis coba mailbox (domain) baru."""
    log("=" * 58)
    log(f"  CANVA REGISTER - OTOMATIS (tempmail dndone.my.id, fallback azbry) x{jumlah}")
    log("=" * 58)

    sukses = 0
    for i in range(jumlah):
        log(f"\n---------- AKUN {i + 1}/{jumlah} ----------")
        dibuat = False

        for coba in range(1, max_coba + 1):
            try:
                email, mail_sess = new_mailbox()
            except Exception as e:
                log(f"[X] gagal bikin email temp: {e}")
                continue
            password = ("Cv" + "".join(random.choices(string.ascii_letters, k=6))
                        + "".join(random.choices(string.digits, k=4)) + "!")
            name = re.sub(r"[^a-zA-Z ]", " ", email.split("@")[0]).title().strip()
            domain = email.split("@")[1]
            log(f"  [{coba}/{max_coba}] email temp: {email}")

            def get_code(_email, _sess=mail_sess):
                code = poll_code(_sess)
                if code:
                    log(f"  [ok] kode otomatis: {code}")
                return code

            ensure_display()
            with sync_playwright() as p:
                browser = launch_browser(p)
                ctx = browser.new_context(locale="en-US",
                                          viewport={"width": 1280, "height": 800},
                                          timezone_id="Asia/Jakarta")
                page = ctx.new_page()
                try:
                    ok = run_flow(ctx, page, email, name, password,
                                  "https://www.canva.com/signup/", get_code)
                    finish(ctx, page, ok, email, password)
                    if ok:
                        sukses += 1
                        dibuat = True
                        break
                    else:
                        log(f"  [!] domain {domain} gagal, coba domain lain ...")
                except Exception as e:
                    msg = str(e)
                    shot(page, "auto_error")
                    if "kode verifikasi ga dapet" in msg:
                        log(f"  [!] domain {domain} diblok Canva, ganti domain ...")
                    else:
                        log(f"\n[X] ERROR: {e}")
                finally:
                    browser.close()

        if not dibuat:
            log(f"[X] akun {i + 1} gagal setelah {max_coba} percobaan domain")

    log(f"\n===== SELESAI: {sukses}/{jumlah} akun sukses =====")


def cmd_login():
    log("=" * 58)
    log("  CANVA LOGIN - MANUAL")
    log("=" * 58)
    email = input("Email    : ").strip()
    if "@" not in email:
        log("[X] email ga valid")
        return
    password = getpass.getpass("Password : ")
    if len(password) < 8:
        log("[X] password minimal 8 karakter")
        return

    def get_code(_):
        return input("\n>> Masukin kode verifikasi/MFA: ").strip()

    ensure_display()
    with sync_playwright() as p:
        browser = launch_browser(p)
        ctx = browser.new_context(locale="en-US",
                                  viewport={"width": 1280, "height": 800},
                                  timezone_id="Asia/Jakarta")
        page = ctx.new_page()
        try:
            ok = run_flow(ctx, page, email, "User", password,
                          "https://www.canva.com/login", get_code)
            finish(ctx, page, ok)
        except Exception as e:
            shot(page, "login_error")
            log(f"\n[X] ERROR: {e}")
        finally:
            browser.close()


def cmd_status():
    ck = load_session()
    if not ck:
        log("[X] Belum ada session. Jalankan register/auto/login dulu.")
        return
    log(f"[*] {len(ck)} cookie ditemukan...")
    log("[OK] MASIH VALID." if validate_session(ck)
        else "[X] EXPIRED. Login ulang.")


def cmd_logout():
    if os.path.exists(SESSION_FILE):
        os.remove(SESSION_FILE)
        log("[OK] Session dihapus.")
    else:
        log("[i] Ga ada session.")


def cmd_paste():
    log("Paste header cookie dari F12 > Network:")
    raw = input("> ").strip()
    ck = {}
    for part in raw.replace("\n", "").split(";"):
        if "=" in part:
            n, _, v = part.partition("=")
            ck[n.strip()] = v.strip()
    if ck and validate_session(ck):
        save_session_raw([{"name": k, "value": v, "domain": ".canva.com"}
                          for k, v in ck.items()])
        log(f"[OK] {len(ck)} cookie valid, tersimpan!")
    else:
        log("[X] Ga valid.")


def main():
    cmd = sys.argv[1].lower() if len(sys.argv) > 1 else ""
    if cmd == "register":
        cmd_register()
    elif cmd == "auto":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        cmd_auto(n)
    elif cmd == "login":
        cmd_login()
    elif cmd == "status":
        cmd_status()
    elif cmd == "logout":
        cmd_logout()
    elif cmd == "paste":
        cmd_paste()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
