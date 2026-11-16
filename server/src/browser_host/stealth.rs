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
    const permDefaults = { 'accelerometer': 'granted', 'ambient-light-sensor': 'granted', 'background-fetch': 'granted', 'background-sync': 'granted', 'bluetooth': 'prompt', 'camera': 'prompt', 'clipboard-read': 'prompt', 'clipboard-write': 'granted', 'display-capture': 'prompt', 'geolocation': 'prompt', 'gyroscope': 'granted', 'idle-detection': 'prompt', 'local-fonts': 'prompt', 'magnetometer': 'granted', 'microphone': 'prompt', 'midi': 'prompt', 'nfc': 'prompt', 'payment-handler': 'granted', 'periodic-background-sync': 'denied', 'persistent-storage': 'prompt', 'push': 'prompt', 'screen-wake-lock': 'granted', 'storage-access': 'prompt', 'system-wake-lock': 'prompt', 'usb': 'prompt', 'window-management': 'prompt', 'xr-spatial-tracking': 'prompt' };
    const origQ = window.Permissions?.prototype?.query;
    if (origQ) window.Permissions.prototype.query = function(p) {
      const name = p?.name;
      if (name === 'notifications') return Promise.resolve({ state: (typeof Notification !== 'undefined' && Notification.permission === 'granted') ? 'granted' : 'prompt', onchange: null });
      if (name && Object.prototype.hasOwnProperty.call(permDefaults, name)) return Promise.resolve({ state: permDefaults[name], onchange: null });
      return origQ.call(this, p);
    };
  } catch (_) {}
  try {
    const origEnum = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
    if (origEnum) navigator.mediaDevices.enumerateDevices = async function() {
      const devs = await origEnum();
      return Array.isArray(devs) ? devs.map((d) => ({ deviceId: '', kind: d.kind, label: '', groupId: '', toJSON() { return { deviceId: '', kind: this.kind, label: '', groupId: '' }; } })) : [];
    };
  } catch (_) {}
  try {
    const ALLOWED_CODECS = {
      'video/mp4': /^(?:avc1|avc3|mp4a|av01|vp09|opus|flac)(?:\.[0-9a-f.]+)?$/,
      'audio/mp4': /^(?:mp4a|opus|flac)(?:\.[0-9a-f.]+)?$/,
      'audio/x-m4a': /^(?:mp4a|opus|flac)(?:\.[0-9a-f.]+)?$/,
      'audio/aac': /^(?:mp4a)(?:\.[0-9a-f.]+)?$/,
      'video/webm': /^(?:vp8|vp9|vp09|av01|opus|vorbis)(?:\.[0-9a-f.]+)?$/,
      'audio/webm': /^(?:opus|vorbis)(?:\.[0-9a-f.]+)?$/,
      'video/ogg': /^(?:theora|vorbis|opus|flac)$/,
      'audio/ogg': /^(?:opus|vorbis|flac)$/,
      'application/ogg': /^(?:theora|vorbis|opus|flac)$/,
      'audio/mpeg': /^(?:mp3)$/,
      'audio/mp3': /^(?:mp3)$/,
      'audio/wav': /^(?:1|pcm)$/,
      'audio/x-wav': /^(?:1|pcm)$/,
      'audio/wave': /^(?:1|pcm)$/,
      'audio/flac': /^(?:flac)$/,
    };
    const MSE_CONTAINERS = {
      'video/mp4': ALLOWED_CODECS['video/mp4'],
      'audio/mp4': ALLOWED_CODECS['audio/mp4'],
      'video/webm': ALLOWED_CODECS['video/webm'],
      'audio/webm': ALLOWED_CODECS['audio/webm'],
    };
    const checkMediaType = (type, forMse) => {
      if (typeof type !== 'string') return null;
      const t = type.trim().toLowerCase();
      const semi = t.indexOf(';');
      const mime = (semi >= 0 ? t.slice(0, semi) : t).trim();
      const table = forMse ? MSE_CONTAINERS : ALLOWED_CODECS;
      const codecRe = table[mime];
      if (!codecRe) return null;
      const rest = semi >= 0 ? t.slice(semi + 1).trim() : '';
      if (!rest) return forMse ? 'probably' : 'maybe';
      const m = rest.match(/^codecs\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))\s*$/);
      if (!m) return null;
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!raw) return null;
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return null;
      for (let i = 0; i < parts.length; i++) {
        if (!codecRe.test(parts[i])) return null;
      }
      return 'probably';
    };
    const origCanPlay = HTMLMediaElement?.prototype?.canPlayType;
    if (origCanPlay) HTMLMediaElement.prototype.canPlayType = function(type) {
      const nativeRes = origCanPlay.call(this, type);
      if (nativeRes === 'probably') return 'probably';
      const res = checkMediaType(type, false);
      if (res === 'probably') return 'probably';
      return nativeRes || (res === 'maybe' ? 'maybe' : '');
    };
    if (typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function') {
      const origMse = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function(type) {
        if (origMse(type)) return true;
        return checkMediaType(type, true) === 'probably';
      };
    }
  } catch (_) {}
  const sym = Symbol.for('dh.a');
  const installBridge = (w) => {
    try {
      if (!w || !w.EventTarget?.prototype || typeof w.EventTarget.prototype[sym] === 'function') return;
      const docId = Math.random().toString(36).slice(2) + ':' + Date.now().toString(36);
      let subDocGen = 1;
      const RING_LEN = 24000;
      const mixRing = new Int32Array(RING_LEN);
      let activeRun = '', lastStartedToken = '', gen = 0, childSeq = 0, leaseUntil = 0, runStartMs = 0, readPos = 0, maxWritePos = 0, ringEndCaptureAt = 0, queue = [], mixCtx = null;
      const sources = new Set(), tappedEls = new Map(), graphEls = new WeakSet(), internalCtxs = new WeakSet(), tappedCtxs = new WeakMap(), knownCtxs = new Set(), childSrcs = new Map();
      const nowMs = () => (w.performance && typeof w.performance.now === 'function' ? w.performance.now() : Date.now());
      const clearRing = () => { mixRing.fill(0); readPos = 0; maxWritePos = 0; ringEndCaptureAt = 0; runStartMs = nowMs(); };
      const stopAll = () => {
        const prevRun = activeRun;
        gen++; childSeq = 0; activeRun = ''; leaseUntil = 0; queue.length = 0; clearRing();
        for (const s of Array.from(sources)) { try { s.kill?.(); } catch (_) {} }
        sources.clear(); tappedEls.clear(); childSrcs.clear();
        if (mixCtx) { try { mixCtx.close?.().catch(() => {}); } catch (_) {} mixCtx = null; }
        try {
          const n = Math.min(w.frames ? w.frames.length : 0, 8);
          for (let i = 0; i < n; i++) {
            const cw = w.frames[i];
            if (!cw || cw === w) continue;
            try {
              const cf = cw.EventTarget?.prototype?.[sym];
              if (typeof cf === 'function') { cf('stop', ''); continue; }
            } catch (_) {}
            try { cw.postMessage({ __dhCmd: 'stop', runToken: prevRun }, '*'); } catch (_) {}
          }
        } catch (_) {}
      };
      const makeSrc = (killFn) => {
        if (sources.size >= 16) return null;
        const s = { writePos: -1, carry: 0, gen, docId: '', lastSeq: 0, retiredDocs: null, kill: () => { sources.delete(s); try { killFn?.(); } catch (_) {} } };
        sources.add(s); return s;
      };
      const writeSamplesToRing = (s, int16Samples, ageMs) => {
        if (!activeRun || s.gen !== gen || !int16Samples || !int16Samples.length) return;
        if (ageMs !== undefined && ageMs !== null) {
          if (typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 500) return;
        }
        const validAge = typeof ageMs === 'number' ? ageMs : 0;
        const n = int16Samples.length;
        const now = nowMs();
        const captureEndMs = now - validAge;
        if (readPos === maxWritePos) {
          runStartMs = captureEndMs - (readPos + n) / 24;
        }
        const rawClockPos = Math.floor((captureEndMs - runStartMs) * 24);
        if (validAge > 0 && readPos > 0 && rawClockPos <= readPos) return;
        const clockPos = Math.max(readPos, rawClockPos);
        const rawStart = clockPos - n;
        const rawTarget = Math.max(readPos, rawStart);
        const targetStart = rawTarget - readPos < 240 ? readPos : rawTarget;
        if (s.writePos < readPos || Math.abs(targetStart - s.writePos) > 2400) {
          s.writePos = targetStart;
        }
        if (s.writePos + n - readPos > 12000) {
          const newRead = s.writePos + n - 12000;
          if (newRead - readPos >= RING_LEN) {
            mixRing.fill(0);
          } else {
            for (let p = readPos; p < newRead; p++) mixRing[p % RING_LEN] = 0;
          }
          readPos = newRead;
        }
        for (let i = 0; i < n; i++) {
          mixRing[(s.writePos + i) % RING_LEN] += int16Samples[i];
        }
        s.writePos += n;
        if (s.writePos >= maxWritePos) {
          maxWritePos = s.writePos;
          ringEndCaptureAt = Math.round(Date.now() - validAge);
        }
      };
      const pushSrc = (s, buf, rate) => {
        if (!activeRun || s.gen !== gen || !buf || !buf.length) return;
        if (Date.now() > leaseUntil) { stopAll(); return; }
        let energy = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (Number.isFinite(v)) energy += v * v; }
        if (Math.sqrt(energy / buf.length) < 0.0002) { s.writePos = -1; return; }
        const step = (rate > 0 ? rate : 24000) / 24000;
        let idx = s.carry;
        const resampled = [];
        while (idx < buf.length) {
          const v = buf[Math.floor(idx)];
          resampled.push(Math.max(-32768, Math.min(32767, Math.round((Number.isFinite(v) ? v : 0) * 32767))));
          idx += step;
        }
        s.carry = idx - buf.length;
        writeSamplesToRing(s, resampled, 0);
      };
      const encodeChunk = (samples) => {
        const bytes = new Uint8Array(samples.length * 2);
        for (let i = 0; i < samples.length; i++) { const v = samples[i]; bytes[i * 2] = v & 255; bytes[i * 2 + 1] = (v >> 8) & 255; }
        let bin = ''; for (let i = 0; i < bytes.length; i += 1024) bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(1024, bytes.length - i) + i));
        if (queue.length >= 5) queue.shift();
        queue.push({ t: activeRun, g: subDocGen, d: btoa(bin) });
      };
      const mixSamples = (minLen, asRawSamples) => {
        const rawOut = [];
        let sliceCaptureAt = ringEndCaptureAt || Date.now();
        for (;;) {
          const avail = maxWritePos - readPos;
          const take = avail >= 2400 ? 2400 : (minLen > 0 && avail >= minLen ? avail : 0);
          if (!take) break;
          const mixed = new Int16Array(take);
          let energy = 0;
          for (let i = 0; i < take; i++) {
            const slot = (readPos + i) % RING_LEN;
            const sum = mixRing[slot];
            mixRing[slot] = 0;
            const clamped = sum > 32767 ? 32767 : (sum < -32768 ? -32768 : sum);
            mixed[i] = clamped;
            const norm = clamped / 32768;
            energy += norm * norm;
          }
          readPos += take;
          const remSamples = Math.max(0, maxWritePos - readPos);
          sliceCaptureAt = ringEndCaptureAt > 0 ? Math.round(ringEndCaptureAt - remSamples / 24) : Date.now();
          if (Math.sqrt(energy / take) >= 0.0002) {
            if (asRawSamples) {
              for (let i = 0; i < take && rawOut.length < 4800; i++) rawOut.push(mixed[i]);
            } else {
              encodeChunk(mixed);
            }
          }
          if (take < 2400) break;
        }
        return asRawSamples ? { pcm: rawOut, captureAt: sliceCaptureAt } : rawOut;
      };
      const ensureMixCtx = () => {
        if (mixCtx && mixCtx.state !== 'closed') { if (mixCtx.state === 'suspended') mixCtx.resume?.().catch(() => {}); return mixCtx; }
        const AC = w.AudioContext || w.webkitAudioContext;
        if (!AC) return null;
        try { mixCtx = new AC({ sampleRate: 24000 }); } catch (_) { try { mixCtx = new AC(); } catch (_) { return null; } }
        if (mixCtx.state === 'suspended') mixCtx.resume?.().catch(() => {});
        internalCtxs.add(mixCtx); return mixCtx;
      };
      const tapEl = (el) => {
        if (!el || graphEls.has(el) || tappedEls.has(el) || sources.size >= 16) return;
        try {
          const stream = typeof el.captureStream === 'function' ? el.captureStream() : typeof el.mozCaptureStream === 'function' ? el.mozCaptureStream() : null;
          if (!stream || (stream.getAudioTracks && stream.getAudioTracks().length === 0)) return;
          const ctx = ensureMixCtx(); if (!ctx) return;
          const mediaSrc = ctx.createMediaStreamSource(stream);
          const proc = ctx.createScriptProcessor(1024, 2, 1);
          const zero = ctx.createGain(); zero.gain.value = 0;
          let onEnd = null;
          const srcState = makeSrc(() => {
            tappedEls.delete(el);
            if (onEnd) { el.removeEventListener?.('ended', onEnd); el.removeEventListener?.('emptied', onEnd); }
            try { proc.onaudioprocess = null; mediaSrc.disconnect(); proc.disconnect(); zero.disconnect(); } catch (_) {}
          });
          if (!srcState) return;
          onEnd = () => { srcState.kill(); };
          proc.onaudioprocess = (ev) => {
            if (!el || el.muted) { srcState.writePos = -1; return; }
            const v = typeof el.volume === 'number' && Number.isFinite(el.volume) ? Math.max(0, Math.min(1, el.volume)) : 1;
            if (v <= 0.0001) { srcState.writePos = -1; return; }
            const ib = ev.inputBuffer; const ch0 = ib.getChannelData(0);
            if (ib.numberOfChannels > 1) {
              const ch1 = ib.getChannelData(1); const mono = new Float32Array(ch0.length);
              const factor = v * 0.5;
              for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * factor;
              pushSrc(srcState, mono, ctx.sampleRate || 24000);
            } else if (Math.abs(v - 1) > 0.001) {
              const scaled = new Float32Array(ch0.length);
              for (let i = 0; i < ch0.length; i++) scaled[i] = ch0[i] * v;
              pushSrc(srcState, scaled, ctx.sampleRate || 24000);
            } else {
              pushSrc(srcState, ch0, ctx.sampleRate || 24000);
            }
          };
          mediaSrc.connect(proc); proc.connect(zero); zero.connect(ctx.destination);
          el.addEventListener?.('ended', onEnd, { once: true });
          el.addEventListener?.('emptied', onEnd, { once: true });
          tappedEls.set(el, srcState);
        } catch (_) {}
      };
      const ensureCtxTap = (ctx) => {
        if (!ctx || ctx.state === 'closed') { knownCtxs.delete(ctx); return null; }
        let tap = tappedCtxs.get(ctx);
        if (!tap || tap.nodes.size === 0) return null;
        const origConn = w.AudioNode?.prototype?.__dhOrigConn || w.AudioNode?.prototype?.connect;
        const origDisc = w.AudioNode?.prototype?.__dhOrigDisc || w.AudioNode?.prototype?.disconnect;
        if (tap.srcState && sources.has(tap.srcState) && tap.srcState.gen === gen && tap.inGain) {
          for (const [node, outs] of Array.from(tap.nodes.entries())) {
            let wSet = tap.wired.get(node); if (!wSet) { wSet = new Set(); tap.wired.set(node, wSet); }
            for (const outIdx of outs) {
              if (!wSet.has(outIdx)) { try { origConn.call(node, tap.inGain, outIdx, 0); wSet.add(outIdx); } catch (_) { outs.delete(outIdx); } }
            }
          }
          return tap;
        }
        if (typeof ctx.createScriptProcessor !== 'function') return null;
        const inGain = ctx.createGain();
        const proc = ctx.createScriptProcessor(1024, 2, 1);
        const zero = ctx.createGain(); zero.gain.value = 0;
        const nodes = tap.nodes;
        const wired = new Map();
        const srcState = makeSrc(() => {
          for (const [node] of Array.from(wired.entries())) { try { origDisc.call(node, inGain); } catch (_) {} }
          wired.clear();
          try { proc.onaudioprocess = null; inGain.disconnect(); proc.disconnect(); zero.disconnect(); } catch (_) {}
        });
        if (!srcState) return null;
        proc.onaudioprocess = (ev) => {
          const ib = ev.inputBuffer; const ch0 = ib.getChannelData(0);
          if (ib.numberOfChannels > 1) {
            const ch1 = ib.getChannelData(1); const mono = new Float32Array(ch0.length);
            for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
            pushSrc(srcState, mono, ctx.sampleRate || 24000);
          } else { pushSrc(srcState, ch0, ctx.sampleRate || 24000); }
        };
        origConn.call(inGain, proc); origConn.call(proc, zero); origConn.call(zero, ctx.destination);
        for (const [node, outs] of Array.from(nodes.entries())) {
          const wSet = new Set(); wired.set(node, wSet);
          for (const outIdx of outs) { try { origConn.call(node, inGain, outIdx, 0); wSet.add(outIdx); } catch (_) { outs.delete(outIdx); } }
        }
        tap = { inGain, proc, zero, nodes, wired, srcState, origDisc };
        tappedCtxs.set(ctx, tap);
        return tap;
      };
      const scanMedia = () => {
        for (const [el, s] of Array.from(tappedEls.entries())) { if (!el.isConnected || el.ended || graphEls.has(el)) s.kill(); }
        try { const els = w.document?.querySelectorAll?.('video,audio'); if (els) for (let i = 0; i < els.length; i++) if (!els[i].paused && !els[i].muted) tapEl(els[i]); } catch (_) {}
        for (const ctx of Array.from(knownCtxs)) {
          const tap = ctx ? tappedCtxs.get(ctx) : null;
          if (!ctx || ctx.state === 'closed') {
            if (tap?.srcState) { tap.srcState.kill(); tap.srcState = null; }
            knownCtxs.delete(ctx);
            continue;
          }
          if (tap && tap.nodes.size > 0) ensureCtxTap(ctx);
          else if (tap?.srcState) { tap.srcState.kill(); tap.srcState = null; }
        }
      };
      w.addEventListener('play', (e) => { if (activeRun && e?.target) tapEl(e.target); }, { capture: true, passive: true });
      w.addEventListener('playing', (e) => { if (activeRun && e?.target) tapEl(e.target); }, { capture: true, passive: true });
      w.addEventListener('volumechange', (e) => {
        if (activeRun && e?.target) {
          const el = e.target;
          if (el && !el.paused && !el.muted && !tappedEls.has(el)) tapEl(el);
        }
      }, { capture: true, passive: true });
      w.addEventListener('pagehide', () => { stopAll(); }, { capture: true, passive: true });
      const onSameDocNav = () => {
        subDocGen += 1;
        queue.length = 0;
        clearRing();
        try {
          const n = Math.min(w.frames ? w.frames.length : 0, 8);
          for (let i = 0; i < n; i++) {
            const cw = w.frames[i];
            if (!cw || cw === w) continue;
            try { cw.EventTarget?.prototype?.[sym]?.('stop', ''); continue; } catch (_) {}
            try { cw.postMessage({ __dhCmd: 'stop', runToken: activeRun }, '*'); } catch (_) {}
          }
        } catch (_) {}
      };
      w.addEventListener('hashchange', onSameDocNav, { capture: true, passive: true });
      w.addEventListener('popstate', onSameDocNav, { capture: true, passive: true });
      try {
        const hp = w.History && w.History.prototype;
        if (hp) {
          for (const m of ['pushState', 'replaceState']) {
            const orig = hp[m];
            if (typeof orig === 'function') {
              Object.defineProperty(hp, m, {
                value: function() {
                  const r = Reflect.apply(orig, this, arguments);
                  try { onSameDocNav(); } catch (_) {}
                  return r;
                },
                configurable: true,
                writable: true
              });
            }
          }
        }
      } catch (_) {}
      w.addEventListener('message', (ev) => {
        try {
          const d = ev?.data;
          if (!d || typeof d !== 'object') return;
          if (typeof d.__dhCmd === 'string' && w.top && w.top !== w) {
            if (!ev.source || ev.source !== w.parent) return;
            const fn = w.EventTarget?.prototype?.[sym];
            if (typeof fn !== 'function') return;
            if (d.__dhCmd === 'stop') { fn('stop', d.runToken || ''); return; }
            if (d.__dhCmd === 'start' && typeof d.runToken === 'string') { fn('start', d.runToken); return; }
            if (d.__dhCmd === 'drain' && typeof d.runToken === 'string') {
              const res = fn('drainPcm', d.runToken);
              if (res && Array.isArray(res.pcm) && res.pcm.length > 0 && typeof res.captureAt === 'number') {
                try { w.parent.postMessage({ __dhAudio: d.runToken, docId: res.docId || docId, seq: ++childSeq, captureAt: res.captureAt, pcm: res.pcm }, '*'); } catch (_) {}
              }
            }
            return;
          }
          if (!activeRun || Date.now() > leaseUntil) { if (activeRun) stopAll(); return; }
          if (d.__dhAudio !== activeRun || typeof d.docId !== 'string' || !d.docId || d.docId.length > 64 || !Number.isInteger(d.seq) || d.seq <= 0 || typeof d.captureAt !== 'number' || !Number.isFinite(d.captureAt) || !Array.isArray(d.pcm) || d.pcm.length === 0 || d.pcm.length > 4800) return;
          let validChild = false;
          const fnLen = Math.min(w.frames ? w.frames.length : 0, 8);
          for (let i = 0; i < fnLen; i++) {
            try { if (w.frames[i] === ev.source) { validChild = true; break; } } catch (_) {}
          }
          if (!validChild || !ev.source) return;
          let cs = childSrcs.get(ev.source);
          if (cs && cs.docId !== d.docId) {
            const retired = cs.retiredDocs || new Set();
            if (retired.has(d.docId) || d.seq !== 1) return;
            if (retired.size >= 16) retired.delete(retired.values().next().value);
            retired.add(cs.docId);
            cs.kill();
            cs = makeSrc(() => { childSrcs.delete(ev.source); });
            if (cs) { cs.docId = d.docId; cs.lastSeq = 0; cs.retiredDocs = retired; childSrcs.set(ev.source, cs); }
          } else if (!cs || cs.gen !== gen || !sources.has(cs)) {
            if (d.seq !== 1 && cs) return;
            cs = makeSrc(() => { childSrcs.delete(ev.source); });
            if (cs) { cs.docId = d.docId; cs.lastSeq = 0; cs.retiredDocs = new Set(); childSrcs.set(ev.source, cs); }
          }
          if (!cs || d.seq <= cs.lastSeq) return;
          cs.lastSeq = d.seq;
          const validPcm = new Int16Array(d.pcm.length);
          for (let i = 0; i < d.pcm.length; i++) {
            const v = Number(d.pcm[i]);
            validPcm[i] = Number.isFinite(v) ? Math.max(-32768, Math.min(32767, Math.round(v))) : 0;
          }
          const ageMs = Date.now() - d.captureAt;
          writeSamplesToRing(cs, validPcm, ageMs);
        } catch (_) {}
      });
      const ACProto = (w.AudioContext || w.webkitAudioContext)?.prototype;
      if (ACProto && typeof ACProto.createMediaElementSource === 'function') {
        const origCreateMES = ACProto.createMediaElementSource;
        ACProto.createMediaElementSource = function(el) {
          if (el) { graphEls.add(el); const prev = tappedEls.get(el); if (prev) prev.kill(); }
          return origCreateMES.apply(this, arguments);
        };
      }
      if (typeof w.AudioNode !== 'undefined' && w.AudioNode.prototype?.connect) {
        const origConn = w.AudioNode.prototype.connect;
        const origDisc = w.AudioNode.prototype.disconnect;
        Object.defineProperty(w.AudioNode.prototype, '__dhOrigConn', { value: origConn, enumerable: false, configurable: true });
        Object.defineProperty(w.AudioNode.prototype, '__dhOrigDisc', { value: origDisc, enumerable: false, configurable: true });
        w.AudioNode.prototype.connect = function(dest, output) {
          const ret = origConn.apply(this, arguments);
          try {
            const ctx = dest?.context;
            if (ctx && !internalCtxs.has(ctx) && dest === ctx.destination) {
              if (knownCtxs.size < 16) knownCtxs.add(ctx);
              const outIdx = typeof output === 'number' ? output : 0;
              let tap = tappedCtxs.get(ctx);
              if (!tap) { tap = { inGain: null, proc: null, zero: null, nodes: new Map(), wired: new Map(), srcState: null, origDisc }; tappedCtxs.set(ctx, tap); }
              if (tap.nodes.size < 32 || tap.nodes.has(this)) {
                let set = tap.nodes.get(this); if (!set) { set = new Set(); tap.nodes.set(this, set); }
                if (set.size < 8) set.add(outIdx);
                if (activeRun) ensureCtxTap(ctx);
              }
            }
          } catch (_) {}
          return ret;
        };
        if (typeof origDisc === 'function') {
          w.AudioNode.prototype.disconnect = function(destOrOut, output) {
            const ret = origDisc.apply(this, arguments);
            try {
              const ctx = this?.context;
              const tap = ctx ? tappedCtxs.get(ctx) : null;
              if (tap && tap.nodes.has(this)) {
                const set = tap.nodes.get(this);
                const wSet = tap.wired?.get(this);
                const removeOut = (idx) => {
                  set?.delete(idx); wSet?.delete(idx);
                  if (tap.inGain) {
                    try { origDisc.call(this, tap.inGain); } catch (_) {}
                    if (set && set.size > 0) {
                      for (const remIdx of set) { try { origConn.call(this, tap.inGain, remIdx, 0); wSet?.add(remIdx); } catch (_) {} }
                    }
                  }
                  if (!set || set.size === 0) {
                    tap.nodes.delete(this); tap.wired?.delete(this);
                    if (tap.nodes.size === 0 && tap.srcState) { tap.srcState.kill(); tap.srcState = null; }
                  }
                };
                if (arguments.length === 0) {
                  tap.nodes.delete(this); tap.wired?.delete(this);
                  if (tap.inGain) { try { origDisc.call(this, tap.inGain); } catch (_) {} }
                  if (tap.nodes.size === 0 && tap.srcState) { tap.srcState.kill(); tap.srcState = null; }
                } else if (typeof destOrOut === 'number') {
                  removeOut(destOrOut);
                } else if (destOrOut === ctx.destination) {
                  if (typeof output === 'number') removeOut(output);
                  else {
                    tap.nodes.delete(this); tap.wired?.delete(this);
                    if (tap.inGain) { try { origDisc.call(this, tap.inGain); } catch (_) {} }
                    if (tap.nodes.size === 0 && tap.srcState) { tap.srcState.kill(); tap.srcState = null; }
                  }
                }
              }
            } catch (_) {}
            return ret;
          };
        }
      }
      const drainChildren = (runToken) => {
        try {
          const n = Math.min(w.frames ? w.frames.length : 0, 8);
          const seen = new Set();
          for (let i = 0; i < n; i++) {
            const cw = w.frames[i];
            if (!cw || cw === w) continue;
            seen.add(cw);
            let sameOrigin = false;
            try {
              installBridge(cw);
              const cf = cw.EventTarget?.prototype?.[sym];
              if (typeof cf === 'function') {
                sameOrigin = true;
                const res = cf('drainPcm', runToken);
                const pcm = res && Array.isArray(res.pcm) ? res.pcm : null;
                const cDoc = res && typeof res.docId === 'string' ? res.docId : 'same';
                const capAt = res && typeof res.captureAt === 'number' && Number.isFinite(res.captureAt) ? res.captureAt : Date.now();
                if (pcm && pcm.length > 0) {
                  let cs = childSrcs.get(cw);
                  if (cs && cs.docId !== cDoc) {
                    const retired = cs.retiredDocs || new Set();
                    if (retired.has(cDoc)) continue;
                    if (retired.size >= 16) retired.delete(retired.values().next().value);
                    retired.add(cs.docId);
                    cs.kill(); cs = null;
                    cs = makeSrc(() => { childSrcs.delete(cw); });
                    if (cs) { cs.docId = cDoc; cs.retiredDocs = retired; childSrcs.set(cw, cs); }
                  } else if (!cs || cs.gen !== gen || !sources.has(cs)) {
                    cs = makeSrc(() => { childSrcs.delete(cw); });
                    if (cs) { cs.docId = cDoc; cs.retiredDocs = new Set(); childSrcs.set(cw, cs); }
                  }
                  if (cs) writeSamplesToRing(cs, pcm, Math.max(0, Date.now() - capAt));
                }
              }
            } catch (_) {}
            if (!sameOrigin) {
              try { cw.postMessage({ __dhCmd: 'drain', runToken }, '*'); } catch (_) {}
            }
          }
          for (const [cw, cs] of Array.from(childSrcs.entries())) { if (typeof cw === 'object' && cw !== null && !seen.has(cw)) cs.kill(); }
        } catch (_) {}
      };
      Object.defineProperty(w.EventTarget.prototype, sym, {
        value: function(op, runToken) {
          if (op === 'start' || op === 'drain' || op === 'drainDoc' || op === 'drainPcm') {
            if (typeof runToken !== 'string' || !runToken) return [];
            if (activeRun !== runToken) { if (lastStartedToken && lastStartedToken !== runToken) subDocGen += 1; lastStartedToken = runToken; stopAll(); activeRun = runToken; runStartMs = nowMs(); }
            leaseUntil = Date.now() + 3000;
            scanMedia();
            if (op === 'start') {
              try {
                const n = Math.min(w.frames ? w.frames.length : 0, 8);
                for (let i = 0; i < n; i++) {
                  const cw = w.frames[i];
                  if (!cw || cw === w) continue;
                  try { installBridge(cw); cw.EventTarget?.prototype?.[sym]?.('start', runToken); continue; } catch (_) {}
                  try { cw.postMessage({ __dhCmd: 'start', runToken }, '*'); } catch (_) {}
                }
              } catch (_) {}
              return [];
            }
            drainChildren(runToken);
            if (op === 'drainPcm') { const m = mixSamples(240, true); return { docId, captureAt: m.captureAt, pcm: m.pcm }; }
            mixSamples(480, false);
            const rawItems = queue.splice(0, 2);
            const chunks = [];
            for (let i = 0; i < rawItems.length; i++) {
              const it = rawItems[i];
              if (it && it.t === runToken && it.g === subDocGen && typeof it.d === 'string') chunks.push(it.d);
            }
            if (op === 'drainDoc') return { docId, subDocGen, chunks };
            return chunks;
          }
          if (op === 'stop' || op === 'stopDoc') {
            if (!runToken || activeRun === runToken) stopAll();
            return op === 'stopDoc' ? docId : [];
          }
          return [];
        },
        enumerable: false,
        configurable: true,
      });
    } catch (_) {}
  };
  installBridge(window);
  try { if (window.outerWidth === 0 || window.outerHeight === 0) { Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth || 1280, configurable: true }); Object.defineProperty(window, 'outerHeight', { get: () => (window.innerHeight || 900) + 85, configurable: true }); } Document.prototype.hasFocus = () => true; } catch (_) {}
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (desc && desc.get) Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { get: function() { const cw = desc.get.call(this); if (cw) { try { if (!cw.chrome && window.chrome) cw.chrome = window.chrome; if (cw.Navigator?.prototype && Object.getOwnPropertyDescriptor(cw.Navigator.prototype, 'webdriver')) delete cw.Navigator.prototype.webdriver; installBridge(cw); } catch (_) {} } return cw; }, configurable: true });
  } catch (_) {}
  try { for (const k of ['__playwright', '__puppeteer', 'domAutomation', 'domAutomationController', '_phantom', 'callPhantom']) delete window[k]; for (const p of Object.getOwnPropertyNames(window)) if (p.startsWith('cdc_') || p.startsWith('__cdc_')) delete window[p]; } catch (_) {}
})();"#;
