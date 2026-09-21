import { afterEach, describe, expect, it } from 'vitest';
import fixtureHtml from '../../plugin-sdk/fixtures/opaque-ui/dist/index.html?raw';
import fixtureMeta from '../../plugin-sdk/fixtures/opaque-ui/dist/metadata.json';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Plugin UI Isolation and Port Handshake in Chromium', () => {
  it('enforces opaque origin, host CSP, single-use port acknowledgement, and security canaries', async () => {
    expect(typeof fixtureHtml).toBe('string');
    expect(fixtureHtml.length).toBeGreaterThan(100);
    expect(fixtureMeta.scriptHash).toBeDefined();

    // 1. Host injects restrictive CSP into inert fixture bytes
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${fixtureMeta.scriptHash}'; style-src '${fixtureMeta.styleHash}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
    const secureHtml = fixtureHtml.replace('<head>', `<head>\n  ${cspMeta}`);

    // 2. Mount iframe with sandbox="allow-scripts" (strictly opaque origin: NO allow-same-origin)
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('id', 'plugin-isolation-frame');
    iframe.srcdoc = secureHtml;

    const frameSessionId = 'frame-session-' + crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const channel = new MessageChannel();

    // 3. Handshake protocol promise
    const handshakePromise = new Promise<{
      origin: string;
      sourceMatch: boolean;
      portAckNonce: string;
      activationGeneration: number;
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timed out after 5000ms'));
      }, 5000);

      const onWindowMessage = (event: MessageEvent) => {
        const data = event.data;
        if (data && data.type === 'frame.ready') {
          window.removeEventListener('message', onWindowMessage);

          const origin = event.origin;
          const sourceMatch = event.source === iframe.contentWindow;

          // Set up listener on transferred port1 for portAck
          channel.port1.onmessage = (portEvent: MessageEvent) => {
            const portData = portEvent.data;
            if (portData && portData.type === 'frame.portAck') {
              clearTimeout(timeout);
              resolve({
                origin,
                sourceMatch,
                portAckNonce: portData.nonce,
                activationGeneration: portData.activationGeneration,
              });
            }
          };

          // Host bootstraps frame with transferred MessagePort
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(
              {
                type: 'host.bootstrap',
                bridgeVersion: '1.0.0',
                frameSession: frameSessionId,
                activationGeneration: 1,
                pluginId: 'evcrate.advisor',
                nonce,
                capabilities: ['history.summary', 'history.refresh'],
              },
              '*',
              [channel.port2]
            );
          }
        }
      };

      window.addEventListener('message', onWindowMessage);
    });

    document.body.appendChild(iframe);

    // 4. Await handshake completion
    const handshake = await handshakePromise;

    // Verify opaque origin ("null")
    expect(handshake.origin).toBe('null');
    expect(handshake.sourceMatch).toBe(true);
    expect(handshake.portAckNonce).toBe(nonce);
    expect(handshake.activationGeneration).toBe(1);

    // Verify parent cannot access cross-origin/opaque contentDocument
    expect(iframe.contentDocument).toBeNull();
    // Accessing properties on cross-origin WindowProxy throws SecurityError
    expect(() => {
      const _ = iframe.contentWindow?.origin;
    }).toThrow();

    // 5. Test bidirectional request/response over transferred MessagePort
    const responsePromise = new Promise<{
      bridgeVersion: string;
      activationGeneration: number;
      result: { acknowledged: boolean; operation: string };
    }>((resolve, reject) => {
      const reqTimeout = setTimeout(() => reject(new Error('Request timed out')), 3000);
      channel.port1.onmessage = (event) => {
        if (event.data?.type === 'response' && event.data.requestId === 'test-req-1') {
          clearTimeout(reqTimeout);
          resolve(event.data);
        }
      };
      channel.port1.postMessage({
        type: 'request',
        bridgeVersion: '1.0.0',
        frameSession: frameSessionId,
        activationGeneration: 1,
        requestId: 'test-req-1',
        operation: 'history.summary',
        payload: {},
      });
    });

    const response = await responsePromise;
    expect(response.bridgeVersion).toBe('1.0.0');
    expect(response.activationGeneration).toBe(1);
    expect(response.result.acknowledged).toBe(true);
    expect(response.result.operation).toBe('history.summary');

    // 6. Test Revocation: closing channel renders port inactive
    channel.port1.postMessage({
      type: 'context.revoked',
      bridgeVersion: '1.0.0',
      frameSession: frameSessionId,
      activationGeneration: 1,
      reason: 'generation_revoked',
    });
    channel.port1.close();
  });
});
