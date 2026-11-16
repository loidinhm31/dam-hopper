//! Synthetic fixture pages for the adaptive-media qualification mode. No real data:
//! every string is generated placeholder code or prose.

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

/// Optional continuous WebAudio tone (`?audio=1`), tapped by the production PCM bridge.
const AUDIO_JS: &str = r#"
if (new URLSearchParams(location.search).get('audio') === '1') {
  const ctx = new AudioContext({ sampleRate: 24000 });
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = 440; gain.gain.value = 0.05;
  osc.connect(gain); gain.connect(ctx.destination); osc.start();
  const resume = () => ctx.state === 'suspended' && ctx.resume();
  resume(); setInterval(resume, 500);
}"#;

const STYLE: &str = "body{margin:0;background:#fff;color:#1b1f23;font:16px/1.5 sans-serif}\
h1{font-size:24px;margin:16px 24px 8px}p{margin:8px 24px;max-width:900px}\
pre{margin:12px 24px;padding:12px;border:1px solid #d0d7de;background:#f6f8fa;\
font:12px/1.45 monospace}.k{color:#cf222e}.s{color:#0a3069}.c{color:#6e7781}\
.f{color:#8250df}.n{color:#0550ae}";

/// Builds the synthetic highlighted listing shared by the static and scrolling pages.
const LISTING_JS: &str = r#"
function listing(n, salt) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const v = (i * 7919 + salt * 104729) % 9973;
    rows.push(
      `<span class="c">// step ${v}</span>\n` +
      `<span class="k">function</span> <span class="f">compute${i}</span>(a, b) {\n` +
      `  <span class="k">const</span> total = a * <span class="n">${v % 97}</span> + b;\n` +
      `  <span class="k">return</span> <span class="s">"item-${v}"</span> + total;\n}\n`);
  }
  return rows.join('\n');
}"#;

fn page(title: &str, body: &str, script: &str) -> Response {
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
<style>{STYLE}</style></head><body>{body}<script>{AUDIO_JS}{LISTING_JS}{script}</script></body></html>"
    );
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        html,
    )
        .into_response()
}

const PROSE: &str = "<p>Synthetic fixture page. This paragraph is placeholder prose used to \
judge body text legibility at sixteen pixels. Nothing here is real data.</p>";

pub async fn static_text() -> Response {
    page(
        "static",
        &format!("<h1>Static text</h1>{PROSE}<pre id=\"code\"></pre>{PROSE}"),
        "document.getElementById('code').innerHTML = listing(14, 1);",
    )
}

pub async fn code_scroll() -> Response {
    let script = "const el = document.getElementById('code'); let y = 0, tick = 0;\
el.innerHTML = listing(160, 2); el.style.position = 'relative';\
const h = el.scrollHeight - 700;\
function frame() { y = (y + 3) % h; el.style.transform = `translateY(-${y}px)`;\
if (++tick % 6 === 0) document.getElementById('ctr').textContent = 'tick ' + tick;\
requestAnimationFrame(frame); } requestAnimationFrame(frame);";
    page(
        "code-scroll",
        &format!("<h1>Scrolling code <span id=\"ctr\">tick 0</span></h1>{PROSE}<div style=\"height:700px;overflow:hidden\"><pre id=\"code\"></pre></div>"),
        script,
    )
}

pub async fn motion() -> Response {
    let script = "const c = document.getElementById('cv'), g = c.getContext('2d'); let t = 0;\
function frame() { t++; for (let i = 0; i < 24; i++) { \
const x = (i * 53 + t * (2 + i % 5)) % c.width, y = (i * 29 + t * (1 + i % 3)) % c.height;\
const grad = g.createRadialGradient(x, y, 4, x, y, 90);\
grad.addColorStop(0, `hsl(${(t * 3 + i * 40) % 360},90%,55%)`); grad.addColorStop(1, 'rgba(0,0,0,0)');\
g.fillStyle = grad; g.fillRect(x - 90, y - 90, 180, 180); }\
const bar = document.getElementById('bar'); bar.style.transform = `translateX(${(t * 6) % 900}px)`;\
requestAnimationFrame(frame); } requestAnimationFrame(frame);";
    page(
        "motion",
        "<h1>Motion</h1><style>@keyframes g{0%{background-position:0 0}100%{background-position:400px 0}}\
#bg{height:120px;margin:8px 24px;background:linear-gradient(90deg,#f97316,#06b6d4,#8b5cf6,#f97316);\
background-size:400px 100%;animation:g 2s linear infinite}\
#bar{width:120px;height:68px;margin:8px 24px;background:#111;border:2px solid #fff;box-shadow:0 0 0 2px #888}</style>\
<div id=\"bg\"></div><div style=\"overflow:hidden;height:84px\"><div id=\"bar\"></div></div>\
<canvas id=\"cv\" width=\"1000\" height=\"520\" style=\"margin:8px 24px\"></canvas>",
        script,
    )
}
