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
