import type { IncomingMessage, ServerResponse } from "node:http";

/** Real HTTP/worker fixtures; all requests still pass through the production browser policy. */
export function serveBrowserJourney(
  request: IncomingMessage,
  response: ServerResponse,
  deniedOrigin: string,
): boolean {
  const url = new URL(request.url ?? "/", "http://fixture.invalid");
  const send = (type: string, body: string) => {
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  };
  if (url.pathname === "/worker-data" || url.pathname === "/burst-data") {
    send("text/plain", "allowed-worker-data");
  } else if (url.pathname === "/worker-redirect-denied") {
    response.writeHead(302, { Location: `${deniedOrigin}/redirect-destination` });
    response.end();
  } else if (url.pathname === "/journey-nested-worker.js") {
    send("application/javascript", `
      onmessage = async () => {
        const allowed = await fetch('/worker-data').then(r => r.text());
        let denied = false;
        try { await fetch(${JSON.stringify(`${deniedOrigin}/nested-denied`)}); }
        catch { denied = true; }
        postMessage({ allowed, denied });
      };
    `);
  } else if (url.pathname === "/journey-worker.js") {
    send("application/javascript", `
      onmessage = async () => {
        const nested = new Worker('/journey-nested-worker.js');
        const nestedResult = Promise.withResolvers();
        nested.onmessage = event => nestedResult.resolve(event.data);
        nested.onerror = event => nestedResult.reject(new Error(event.message));
        nested.postMessage('start');
        const denied = async url => {
          try { await fetch(url); return false; } catch { return true; }
        };
        const [allowed, directDenied, redirectDenied, child] = await Promise.all([
          fetch('/worker-data').then(r => r.text()),
          denied(${JSON.stringify(`${deniedOrigin}/worker-denied`)}),
          denied('/worker-redirect-denied'),
          nestedResult.promise,
        ]);
        postMessage({ allowed, directDenied, redirectDenied, child });
        nested.terminate();
      };
    `);
  } else if (url.pathname === "/sec-sw.js") {
    response.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    });
    response.end(`
      const SW_ID = 'sec-sw-' + Math.random().toString(36).slice(2);
      let swCount = 0;
      let heldPort = null;
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
      self.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'initHeld' && e.ports && e.ports[0]) {
          heldPort = e.ports[0];
          heldPort.onmessage = () => {
            swCount += 1;
            heldPort.postMessage({ instanceId: SW_ID, count: swCount });
          };
          heldPort.postMessage({ instanceId: SW_ID, count: swCount, ready: true });
        }
      });
    `);
  } else if (url.pathname === "/sec-worker.js") {
    send("application/javascript; charset=utf-8", `self.__secWorkerTag = 'sec-worker-ok';`);
  } else if (url.pathname === "/sec-network-probe") {
    send("application/json", JSON.stringify({ probe: "sec-network-ok" }));
  } else if (url.pathname === "/sec-payload.bin") {
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="sec-http.bin"',
      "Cache-Control": "no-store",
    });
    response.end("bytes-sec-http");
  } else if (url.pathname === "/sec-oopif-payload.bin") {
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="sec-oopif.bin"',
      "Cache-Control": "no-store",
    });
    response.end("bytes-sec-oopif");
  } else if (url.pathname === "/sec-oopif") {
    send("text/html; charset=utf-8", `<!doctype html>
      <html><body>
        <div id="oopif-marker">oopif-ok</div>
        <a id="oopif-dl" href="/sec-oopif-payload.bin" download="sec-oopif.bin">OOPIF Download</a>
      </body></html>`);
  } else if (url.pathname === "/devtools-sec") {
    send("text/html; charset=utf-8", `<!doctype html>
      <html><head><title>DevTools Security Target</title></head>
      <body style="margin:0;padding:24px;font:18px sans-serif;background:#f8fafc;color:#0f172a">
        <h1 id="sec-title">DevTools Security Target</h1>
        <div id="dom-marker">initial</div>
        <div style="margin:16px 0">
          <input id="sec-input" type="text" placeholder="Type here..." style="width:340px;height:40px;font-size:16px;padding:4px 8px" />
          <button id="sec-btn" style="height:40px;padding:0 16px;margin-left:8px" onclick="window.__btnClicks=(window.__btnClicks||0)+1;this.textContent='Clicked '+window.__btnClicks">Click me</button>
        </div>
        <div style="margin:12px 0">
          <a id="sec-dl-http" href="/sec-payload.bin" download="sec-http.bin">Download HTTP</a>
        </div>
        <div style="height:2200px">Scrollable area</div>
        <script>
          window.__evLog = [];
          for (const t of ['keydown', 'keyup', 'mousedown', 'mouseup']) {
            window.addEventListener(t, e => {
              window.__evLog.push({ type: t, key: e.key ?? null, code: e.code ?? null, button: e.button ?? null, buttons: e.buttons ?? 0, shiftKey: Boolean(e.shiftKey) });
            }, true);
          }
          console.info('sec-target-console-ready');
          fetch('/sec-network-probe').catch(() => {});
          window.initSecSw = async () => {
            document.cookie = 'sec_cookie=live; path=/';
            localStorage.setItem('sec_ls', 'live');
            const reg = await navigator.serviceWorker.register('/sec-sw.js', { scope: '/' });
            await new Promise((resolve, reject) => {
              const dl = Date.now() + 5000;
              const check = () => {
                if (reg.active) return resolve(reg.active);
                if (Date.now() > dl) return reject(new Error('sw active timeout'));
                setTimeout(check, 25);
              };
              check();
            });
            const mc = new MessageChannel();
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('held init timeout')), 3000);
              mc.port1.onmessage = ev => { if (ev.data?.ready) { clearTimeout(timer); resolve(ev.data); } };
              reg.active.postMessage({ type: 'initHeld' }, [mc.port2]);
            });
            window.__secHeldPort = mc.port1;
            window.pingSecSw = () => new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('held ping timeout')), 3000);
              mc.port1.onmessage = ev => { clearTimeout(timer); resolve(ev.data); };
              mc.port1.postMessage({ type: 'ping' });
            });
            return await window.pingSecSw();
          };
          window.spawnSecChildren = (crossOrigin) => {
            window.__secWorker = new Worker('/sec-worker.js');
            const f = document.createElement('iframe');
            f.id = 'sec-oopif-frame';
            f.src = crossOrigin + '/sec-oopif';
            document.body.appendChild(f);
            return true;
          };
        </script>
      </body></html>`);
  } else if (url.pathname === "/journey") {
    const requested = url.searchParams.get("page") ?? "a";
    const label = ["a", "b", "c"].includes(requested) ? requested : "a";
    send("text/html; charset=utf-8", `<!doctype html>
      <html><head><title>Browser journey ${label}</title></head>
      <body style="margin:0;background:#edf2fa;color:#102030;font:24px sans-serif">
        <main style="padding:36px">
          <h1 id="journey-page">Page ${label}</h1>
          <form action="/journey">
            <input type="hidden" name="page" value="c">
            <input id="journey-input" name="text" placeholder="Click, then type"
              style="font:24px sans-serif;width:520px;height:48px">
          </form>
          <a id="journey-link" href="/journey?page=b" style="display:block;margin:30px 0">Go to page B</a>
          <button id="journey-counter" style="font:24px sans-serif" onclick="this.textContent='Count '+(++window.counter)">Count 0</button>
          <p id="worker-state">Worker starting</p>
        </main>
        <script>
          window.counter = 0;
          window.documentIdentity = crypto.randomUUID();
          const worker = new Worker('/journey-worker.js');
          worker.onmessage = event => {
            window.workerReport = event.data;
            document.getElementById('worker-state').textContent = 'Worker ready';
          };
          worker.onerror = event => { window.workerFailure = event.message; };
          worker.postMessage('start');
        </script>
      </body></html>`);
  } else {
    return false;
  }
  return true;
}
