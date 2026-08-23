import fs from "fs"
import path from "path"
import os from "os"
import axios from "axios"
import { fileURLToPath } from "url"

class Web2ApkService {
  constructor({ apiUrl = "https://webappcreator.amethystlab.org/api/build-apk", baseUrl = "https://webappcreator.amethystlab.org" } = {}) {
    this.apiUrl = apiUrl
    this.baseUrl = baseUrl
  }

  isValidUrl(url) {
    return /^https?:\/\//i.test(url)
  }

  buildPackageName(appName) {
    const cleaned = appName.toLowerCase().replace(/[^a-z0-9]/g, "")
    return `com.${cleaned || "app"}.web2apk`
  }

  async fetchIcon(iconUrl) {
    const res = await axios.get(iconUrl, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
      },
    })
    return Buffer.from(res.data)
  }

  saveIconBuffer(buffer) {
    const tempDir = path.join(os.tmpdir(), "web2apk")
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const iconPath = path.join(tempDir, `icon_${Date.now()}.png`)
    fs.writeFileSync(iconPath, buffer)
    return iconPath
  }

  async build({ url, appName, iconBuffer, packageName, versionName = "1.0.0", versionCode = 1 }) {
    if (!this.isValidUrl(url)) throw new Error("URL harus diawali http:// atau https://")
    if (!appName) throw new Error("Nama aplikasi tidak boleh kosong")
    if (!iconBuffer) throw new Error("Icon aplikasi wajib disertakan")

    const pkg = packageName || this.buildPackageName(appName)
    const iconPath = this.saveIconBuffer(iconBuffer)

    try {
      const { default: FormData } = await import("form-data")
      const form = new FormData()
      form.append("websiteUrl", url)
      form.append("appName", appName)
      form.append("icon", fs.createReadStream(iconPath))
      form.append("packageName", pkg)
      form.append("versionName", versionName)
      form.append("versionCode", versionCode)

      const response = await axios.post(this.apiUrl, form, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Origin: this.baseUrl,
          Referer: `${this.baseUrl}/`,
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000,
      })

      const data = response.data
      if (!data.success) throw new Error(data.message || "Gagal build APK")

      return {
        success: true,
        appName,
        packageName: pkg,
        downloadUrl: `${this.baseUrl}${data.downloadUrl}`,
      }
    } finally {
      if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath)
    }
  }
}

export default {
  name: "Web2Apk",
  description: "Konversi website menjadi APK Android via webappcreator.amethystlab.org",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["url", "appName", "icon", "packageName"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      example: "https://google.com",
      description: "URL website yang akan dijadikan APK",
    },
    appName: {
      type: "string",
      required: true,
      example: "Google App",
      description: "Nama aplikasi Android",
    },
    icon: {
      type: "string",
      required: true,
      example: "https://example.com/icon.png",
      description: "URL gambar icon aplikasi (png/jpg)",
    },
    versionName: {
      type: "string",
      required: false,
      default: "1.0.0",
      description: "Versi aplikasi",
    },
    packageName: {
      type: "string",
      required: false,
      example: "com.custom.app",
      description: "Package name Android (otomatis dari appName jika kosong)",
    },
  },

  async run(req, res) {
    try {
      const { url, appName, icon, versionName, packageName } = { ...req.query, ...req.body }

      if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      if (!appName) return res.status(400).json({ status: false, message: "Parameter 'appName' wajib diisi" })
      if (!icon) return res.status(400).json({ status: false, message: "Parameter 'icon' wajib diisi (URL gambar)" })

      const service = new Web2ApkService()
      const iconBuffer = await service.fetchIcon(icon)
      const result = await service.build({ url, appName, iconBuffer, packageName, versionName: versionName || "1.0.0" })

      return res.json({ status: true, result })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message })
    }
  },
}

// ---- CLI mode: node apk.js <url> <appName> <iconUrlOrPath> <packageName> [versionName=1.0.0] ----
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [, , url, appName, iconArg, packageName, versionName = "1.0.0"] = process.argv

  if (!url || !appName || !iconArg || !packageName) {
    console.error("Usage: node apk.js <url> <appName> <iconUrlOrPath> <packageName> [versionName=1.0.0]")
    process.exit(1)
  }

  const service = new Web2ApkService()

  const main = async () => {
    console.log("> Reading icon:", iconArg)
    let iconBuffer
    if (fs.existsSync(iconArg)) {
      iconBuffer = fs.readFileSync(iconArg)
      console.log("  icon loaded from local file:", iconBuffer.length, "bytes")
    } else {
      iconBuffer = await service.fetchIcon(iconArg)
      console.log("  icon fetched:", iconBuffer.length, "bytes")
    }

    console.log("> Building APK (this may take a few minutes)...")
    const result = await service.build({ url, appName, iconBuffer, packageName, versionName })
    console.log("  build ok:", result)

    console.log("> Downloading APK from:", result.downloadUrl)
    const apkRes = await axios.get(result.downloadUrl, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      timeout: 600000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })
    const apkBuffer = Buffer.from(apkRes.data)
    console.log("  downloaded:", apkBuffer.length, "bytes")

    const outPath = path.resolve("public/alwayscodex.apk")
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, apkBuffer)
    console.log("> Saved APK ->", outPath)

    const archivePath = path.resolve("src/apk/alwayscodex.apk")
    fs.mkdirSync(path.dirname(archivePath), { recursive: true })
    fs.copyFileSync(outPath, archivePath)
    console.log("> Archive copy ->", archivePath)

    console.log("DONE")
  }

  main().catch((err) => {
    console.error("ERROR:", err.message)
    process.exit(1)
  })
}
