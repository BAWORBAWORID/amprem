import crypto from "crypto";

/**
 * Alight Motion Premium — NATIVE service (tanpa axios, tanpa API perantara).
 * Port langsung dari /root/am/am.js (AlightMotionAuth): tembak langsung ke
 *
 *   SEND   : Google Identity Toolkit (createAuthUri + getOobConfirmationCode)
 *   VERIFY : emailLinkSignin + getAccountInfo
 *   PREMIUM: us-central1-alight-creative.cloudfunctions.net/verifyPurchase
 *
 * Semua request pakai fetch bawaan Node (>=18) dengan AbortSignal.timeout.
 * Signature method dipertahankan identik agar seluruh pemanggil lama
 * (src/utils/am.js, services/bulk.js, worker CJS) tidak perlu berubah.
 */

class AlightMotionService {
  /**
   * @param {string} [orderId] Order ID custom utk aktivasi premium.
   *                            Prioritas: argumen > format GPA acak.
   */
  constructor(orderId) {
    this.ORDER_ID = String(orderId || "").trim() || this.defaultOrderId();
    this.API_KEY = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";
    this.PRODUCT_ID = "am.full.sub.annual.19q4";
    this.TOKEN = "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw";
    this.SKU_TYPE = "subs";
    this.FIREBASE_INSTANCE_ID_TOKEN = "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI";
    this.HEADERS = {
      "Content-Type": "application/json",
      "X-Android-Package": "com.alightcreative.motion",
      "X-Android-Cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)",
    };
  }

  /** Default order id gaya Google Play: GPA.<4>.<4>.<4>.<5> */
  defaultOrderId() {
    const digit = (length) =>
      Math.floor(Math.random() * 9 + 1) +
      Array.from({ length: length - 1 }, () => Math.floor(Math.random() * 10)).join('');
    return `GPA.${digit(4)}.${digit(4)}.${digit(4)}.${digit(5)}`;
  }

  /** Native fetch POST dengan timeout; melempar { response: { status, data } } saat gagal. */
  async _post(url, body, headers, timeoutMs = 30000) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* body bukan JSON */ }
    if (!res.ok) {
      throw { response: { status: res.status, data: data ?? ("HTTP " + res.status) } };
    }
    return { data };
  }

  _errText(error) {
    if (error && error.response && error.response.data !== undefined) {
      const d = error.response.data;
      return typeof d === "object" ? JSON.stringify(d) : String(d);
    }
    return (error && error.message) || "Unknown error";
  }

  generateCodeOrder() {
    return crypto.randomInt(10000, 99999).toString();
  }

  extractOobCode(fullUrl) {
    if (!fullUrl) return null;
    try {
      let cleanUrl = fullUrl.replace(/&amp;/g, "&");
      try { cleanUrl = decodeURIComponent(cleanUrl); } catch (e) {}

      try {
        const urlObj = new URL(cleanUrl);
        let oobCode = urlObj.searchParams.get("oobCode");
        if (!oobCode) {
          const nestedLink = urlObj.searchParams.get("link") || urlObj.searchParams.get("q") || urlObj.searchParams.get("url");
          if (nestedLink) {
            try {
              const innerUrlObj = new URL(nestedLink);
              oobCode = innerUrlObj.searchParams.get("oobCode");
            } catch (e) {}
          }
        }
        if (oobCode) return oobCode.replace(/[^a-zA-Z0-9_-]/g, "");
      } catch (e) {}

      const match = cleanUrl.match(/[?&]oobCode=([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/oobCode=([a-zA-Z0-9_-]+)/i);
      if (match && match[1]) return match[1];
      return null;
    } catch (e) {
      return null;
    }
  }

  async sendMagicLink(email) {
    try {
      // Langkah 1: createAuthUri (validasi identifier)
      await this._post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/createAuthUri?key=${this.API_KEY}`,
        { identifier: email, continueUri: "http://localhost" },
        this.HEADERS
      );
      // Langkah 2: kirim magic link ke inbox email target
      await this._post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getOobConfirmationCode?key=${this.API_KEY}`,
        {
          requestType: 6,
          email: email,
          androidInstallApp: true,
          canHandleCodeInApp: true,
          continueUrl: "https://alightcreative.com?ui_sid=0366624874&ui_sd=0",
          iosBundleId: "com.alightcreative.motion",
          androidPackageName: "com.alightcreative.motion",
          androidMinimumVersion: "585",
          clientType: "CLIENT_TYPE_ANDROID",
        },
        this.HEADERS
      );
      return { success: true, message: "Link berhasil dikirim." };
    } catch (error) {
      return { success: false, error: this._errText(error) };
    }
  }

  async verifyAndFetchProfile(email, rawLink) {
    try {
      const oobCode = this.extractOobCode(rawLink);
      if (!oobCode) throw new Error("Gagal mengekstrak oobCode.");

      // Tukar oobCode -> idToken (sign-in via email link)
      const signinRes = await this._post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/emailLinkSignin?key=${this.API_KEY}`,
        {
          email: email,
          oobCode: oobCode,
          clientType: "CLIENT_TYPE_ANDROID",
        },
        this.HEADERS
      );

      // Ambil profil akun
      const accountRes = await this._post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${this.API_KEY}`,
        { idToken: signinRes.data.idToken },
        this.HEADERS
      );

      return { success: true, idToken: signinRes.data.idToken, user: accountRes.data.users[0] };
    } catch (error) {
      return { success: false, error: this._errText(error) };
    }
  }

  async applyPremium(idToken) {
    try {
      const codeorder = this.generateCodeOrder();
      const url = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";
      const headers = {
        authorization: "Bearer " + idToken,
        "firebase-instance-id-token": this.FIREBASE_INSTANCE_ID_TOKEN,
        "content-type": "application/json; charset=utf-8",
        "accept-encoding": "gzip",
        "user-agent": "okhttp/3.12.1",
      };
      const response = await this._post(url, {
        data: {
          productId: this.PRODUCT_ID,
          token: this.TOKEN,
          skuType: this.SKU_TYPE,
          orderId: this.ORDER_ID,
        },
      }, headers, 45000);
      return { success: true, data: response.data, codeorder: codeorder };
    } catch (error) {
      return { success: false, error: this._errText(error) };
    }
  }
}

export default AlightMotionService;
