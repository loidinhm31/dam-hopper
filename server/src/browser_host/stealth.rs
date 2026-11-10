use serde_json::{json, Value};

pub const DEFAULT_CHROME_VERSION: &str = "136.0.0.0";

/// Platform-coherent desktop Chrome identity and Client Hints metadata.
/// Adapted from aicoworker's `chrome-identity.ts` and `anti-detection-preload.cjs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChromeIdentity {
    pub full_version: String,
    pub major_version: String,
    pub user_agent: String,
    pub ua_platform: &'static str,
    pub ch_platform: &'static str,
    pub navigator_platform: &'static str,
    pub platform_version: &'static str,
    pub architecture: &'static str,
}

impl Default for ChromeIdentity {
    fn default() -> Self {
        Self::from_version_str(None)
    }
}

impl ChromeIdentity {
    pub fn from_version_str(raw: Option<&str>) -> Self {
        let full_version = raw
            .and_then(extract_version_token)
            .unwrap_or_else(|| DEFAULT_CHROME_VERSION.to_string());
        let major_version = full_version
            .split('.')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or("136")
            .to_string();
        let (ua_platform, ch_platform, navigator_platform, platform_version) =
            if cfg!(target_os = "windows") {
                ("Windows NT 10.0; Win64; x64", "Windows", "Win32", "15.0.0")
            } else if cfg!(target_os = "macos") {
                ("Macintosh; Intel Mac OS X 10_15_7", "macOS", "MacIntel", "15.3.0")
            } else {
                ("X11; Linux x86_64", "Linux", "Linux x86_64", "6.12.0")
            };
        let architecture = if cfg!(target_arch = "aarch64") { "arm" } else { "x86" };
        let user_agent = format!(
            "Mozilla/5.0 ({ua_platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major_version}.0.0.0 Safari/537.36"
        );
        Self {
            full_version,
            major_version,
            user_agent,
            ua_platform,
            ch_platform,
            navigator_platform,
            platform_version,
            architecture,
        }
    }

    pub fn user_agent_override_params(&self) -> Value {
        json!({
            "userAgent": self.user_agent,
            "acceptLanguage": "en-US,en;q=0.9",
            "platform": self.navigator_platform,
            "userAgentMetadata": {
                "brands": [
                    { "brand": "Not;A=Brand", "version": "8" },
                    { "brand": "Chromium", "version": self.major_version },
                    { "brand": "Google Chrome", "version": self.major_version }
                ],
                "fullVersionList": [
                    { "brand": "Not;A=Brand", "version": "8.0.0.0" },
                    { "brand": "Chromium", "version": self.full_version },
                    { "brand": "Google Chrome", "version": self.full_version }
                ],
                "fullVersion": self.full_version,
                "platform": self.ch_platform,
                "platformVersion": self.platform_version,
                "architecture": self.architecture,
                "model": "",
                "mobile": false,
                "bitness": "64",
                "wow64": false
            }
        })
    }
}

fn extract_version_token(raw: &str) -> Option<String> {
    let candidate = if let Some(idx) = raw.find("Chrome/") {
        raw[idx + "Chrome/".len()..].split_whitespace().next().unwrap_or("")
    } else {
        raw.trim().split('/').next_back().unwrap_or("")
    };
    if candidate.is_empty() || candidate.len() > 32 {
        return None;
    }
    let parts: Vec<&str> = candidate.split('.').collect();
    if parts.is_empty() || !parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    let major: u32 = parts[0].parse().ok()?;
    if major == 0 {
        return None;
    }
    Some(if parts.len() == 1 { format!("{major}.0.0.0") } else { candidate.to_string() })
}

pub fn estimate_headless_header_override_bytes(headers: Option<&Value>) -> Option<usize> {
    let map = headers?.as_object()?;
    if !map.values().any(|v| v.as_str().is_some_and(|s| s.contains("HeadlessChrome"))) {
        return None;
    }
    Some(map.iter().filter_map(|(k, v)| {
        Some(96usize.saturating_add(k.len().saturating_mul(6)).saturating_add(v.as_str()?.len().saturating_mul(6)))
    }).fold(16usize, usize::saturating_add))
}

pub fn sanitize_headless_request_headers(headers: Option<&Value>) -> Option<Vec<Value>> {
    let map = headers?.as_object()?;
    if !map.values().any(|v| v.as_str().is_some_and(|s| s.contains("HeadlessChrome"))) {
        return None;
    }
    Some(
        map.iter()
            .filter_map(|(name, val)| {
                let s = val.as_str()?;
                let lower = name.to_ascii_lowercase();
                let clean = if lower == "user-agent" && s.contains("HeadlessChrome") {
                    freeze_ua_version(&s.replace("HeadlessChrome/", "Chrome/"))
                } else if lower.starts_with("sec-ch-ua") && s.contains("HeadlessChrome") {
                    s.replace("HeadlessChrome", "Google Chrome")
                } else {
                    s.to_string()
                };
                Some(json!({ "name": name, "value": clean }))
            })
            .collect(),
    )
}

fn freeze_ua_version(ua: &str) -> String {
    let Some(idx) = ua.find("Chrome/") else { return ua.to_string(); };
    let start = idx + "Chrome/".len();
    let rest = &ua[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let major = rest[..end].split('.').next().unwrap_or("136");
    if !major.is_empty() && major.bytes().all(|b| b.is_ascii_digit()) {
        format!("{}{major}.0.0.0{}", &ua[..start], &rest[end..])
    } else {
        ua.to_string()
    }
}

pub const ANTI_DETECTION_SCRIPT: &str = r#"(() => {
  try { const p = EventTarget.prototype; if (Object.getOwnPropertySymbols(p).some((s) => s.description === 'l')) return; Object.defineProperty(p, Symbol('l'), { value: true, enumerable: false, configurable: true }); } catch (_) {}
  try { if (Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')) delete Navigator.prototype.webdriver; if (Object.getOwnPropertyDescriptor(navigator, 'webdriver')) delete navigator.webdriver; } catch (_) {}
  const m = navigator.userAgent.match(/(?:Headless)?Chrome\/([\d.]+)/); const fullVer = m ? m[1] : '136.0.0.0'; const major = fullVer.split('.')[0] || '136';
  const isMob = /\bMobile\b|Android/.test(navigator.userAgent); const plat = isMob ? 'Android' : /Windows/.test(navigator.userAgent) ? 'Windows' : /Linux|X11/.test(navigator.userAgent) ? 'Linux' : 'macOS';
  try {
    if (!navigator.userAgentData || (navigator.userAgentData.brands || []).some((b) => /Headless/i.test(b.brand))) {
      const brands = [{ brand: 'Not;A=Brand', version: '8' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }];
      const uaData = { brands, mobile: isMob, platform: plat, getHighEntropyValues: () => Promise.resolve({ brands, mobile: isMob, platform: plat, platformVersion: plat === 'macOS' ? '15.3.0' : plat === 'Windows' ? '15.0.0' : plat === 'Android' ? '10' : '6.12.0', architecture: isMob ? '' : 'x86', bitness: isMob ? '' : '64', model: isMob ? 'K' : '', uaFullVersion: fullVer, fullVersionList: [{ brand: 'Not;A=Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: fullVer }, { brand: 'Google Chrome', version: fullVer }], wow64: false }), toJSON: () => ({ brands, mobile: isMob, platform: plat }) };
      Object.defineProperty(navigator, 'userAgentData', { get: () => uaData, configurable: true });
    }
  } catch (_) {}
  try { Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => true, configurable: true }); } catch (_) {}
  try {
    if (!navigator.plugins || navigator.plugins.length < 5) {
      const mimes = [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }, { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }];
      const mkMime = (x) => { const o = { ...x }; if (typeof MimeType !== 'undefined') Object.setPrototypeOf(o, MimeType.prototype); return o; };
      const mkPlug = (name) => { const p = { name, filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 2, 0: mkMime(mimes[0]), 1: mkMime(mimes[1]) }; if (typeof Plugin !== 'undefined') Object.setPrototypeOf(p, Plugin.prototype); return p; };
      const names = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'];
      const plugs = { length: 5, item(i) { return this[i] || null; }, namedItem(n) { return names.indexOf(n) >= 0 ? this[names.indexOf(n)] : null; }, refresh() {}, *[Symbol.iterator]() { for (let i = 0; i < 5; i++) yield this[i]; } };
      names.forEach((n, i) => { plugs[i] = mkPlug(n); }); if (typeof PluginArray !== 'undefined') Object.setPrototypeOf(plugs, PluginArray.prototype);
      Object.defineProperty(navigator, 'plugins', { get: () => plugs, configurable: true });
    }
  } catch (_) {}
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.app) window.chrome.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }, getDetails: () => null, getIsInstalled: () => false, installState: () => 'not_installed', runningState: () => 'cannot_run' };
    if (!window.chrome.runtime) window.chrome.runtime = { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }, connect: () => ({ onMessage: { addListener() {}, removeListener() {} }, onDisconnect: { addListener() {}, removeListener() {} }, postMessage() {} }), sendMessage() {}, id: undefined };
    if (!window.chrome.csi) window.chrome.csi = () => ({ onloadT: Date.now(), startE: Date.now(), pageT: performance.now(), tran: 15 });
    if (!window.chrome.loadTimes) window.chrome.loadTimes = () => ({ commitLoadTime: Date.now() / 1000, connectionInfo: 'h2', finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000, navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true });
  } catch (_) {}
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
    const origQ = window.Permissions?.prototype?.query;
    if (origQ) window.Permissions.prototype.query = function(p) {
      if (p && p.name === 'notifications' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        return origQ.call(this, p).then((res) => { if (res && res.state === 'denied') { try { Object.defineProperty(res, 'state', { get: () => 'prompt', configurable: true }); } catch (_) {} } return res; });
      }
      return origQ.call(this, p);
    };
  } catch (_) {}
  try { if (window.outerWidth === 0 || window.outerHeight === 0) { Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth || 1280, configurable: true }); Object.defineProperty(window, 'outerHeight', { get: () => (window.innerHeight || 900) + 85, configurable: true }); } Document.prototype.hasFocus = () => true; } catch (_) {}
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (desc && desc.get) Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { get: function() { const cw = desc.get.call(this); if (cw) { try { if (!cw.chrome && window.chrome) cw.chrome = window.chrome; if (cw.Navigator?.prototype && Object.getOwnPropertyDescriptor(cw.Navigator.prototype, 'webdriver')) delete cw.Navigator.prototype.webdriver; } catch (_) {} } return cw; }, configurable: true });
  } catch (_) {}
  try { for (const k of ['__playwright', '__puppeteer', 'domAutomation', 'domAutomationController', '_phantom', 'callPhantom']) delete window[k]; for (const p of Object.getOwnPropertyNames(window)) if (p.startsWith('cdc_') || p.startsWith('__cdc_')) delete window[p]; } catch (_) {}
})();"#;
