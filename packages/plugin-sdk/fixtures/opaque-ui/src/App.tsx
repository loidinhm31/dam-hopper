import React, { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    __FRAME_SESSION__?: string;
    __CANARY_RESULTS__?: Record<string, string>;
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'config' | 'evaluations'>('overview');
  const [handshakeState, setHandshakeState] = useState<'initial' | 'ready_sent' | 'bootstrapped' | 'acked'>('initial');
  const [pluginId, setPluginId] = useState<string>('');
  const [canaryResults, setCanaryResults] = useState<Record<string, string>>({});
  const portRef = useRef<MessagePort | null>(null);

  useEffect(() => {
    // 1. Send frame.ready to parent
    const frameSession = window.__FRAME_SESSION__ || 'session-initial';
    window.parent.postMessage(
      {
        type: 'frame.ready',
        bridgeVersion: '1.0.0',
        frameSession,
        activationGeneration: 1,
      },
      '*'
    );
    setHandshakeState('ready_sent');

    // 2. Listen for host.bootstrap with transferred MessagePort
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === 'host.bootstrap' && event.ports && event.ports[0]) {
        const port = event.ports[0];
        portRef.current = port;
        setHandshakeState('bootstrapped');
        setPluginId(data.pluginId || 'evcrate.advisor');

        // 3. Send frame.portAck through transferred port
        port.postMessage({
          type: 'frame.portAck',
          bridgeVersion: '1.0.0',
          frameSession: data.frameSession,
          activationGeneration: data.activationGeneration,
          nonce: data.nonce,
        });
        setHandshakeState('acked');

        // Listen for requests over port
        port.onmessage = (portEvent: MessageEvent) => {
          const req = portEvent.data;
          if (req && req.type === 'request') {
            port.postMessage({
              type: 'response',
              bridgeVersion: '1.0.0',
              frameSession: data.frameSession,
              activationGeneration: data.activationGeneration,
              requestId: req.requestId,
              result: { acknowledged: true, operation: req.operation, timestamp: Date.now() },
            });
          }
        };
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Canary probes demonstrating sandbox containment
  const runCanaryProbes = async () => {
    const results: Record<string, string> = {};

    // Probe 1: fetch must fail
    try {
      await fetch('/api/canary-probe');
      results.fetch = 'UNEXPECTED_SUCCESS';
    } catch (err) {
      results.fetch = `BLOCKED: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Probe 2: localStorage access in opaque iframe
    try {
      localStorage.setItem('canary', '1');
      results.storage = 'UNEXPECTED_SUCCESS';
    } catch (err) {
      results.storage = `BLOCKED: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Probe 3: parent DOM access
    try {
      const parentLoc = window.parent.location.href;
      results.parentAccess = `UNEXPECTED_SUCCESS: ${parentLoc}`;
    } catch (err) {
      results.parentAccess = `BLOCKED: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Probe 4: cookie access
    try {
      const cookie = document.cookie;
      results.cookie = cookie.length === 0 ? 'BLOCKED_EMPTY' : 'HAS_COOKIE';
    } catch (err) {
      results.cookie = `BLOCKED: ${err instanceof Error ? err.message : String(err)}`;
    }

    setCanaryResults(results);
    window.__CANARY_RESULTS__ = results;
  };

  return (
    <div className="plugin-container">
      <header className="plugin-header">
        <h1 className="plugin-title">Plugin: {pluginId || 'Loading...'}</h1>
        <div className="handshake-badge" data-handshake={handshakeState}>
          Handshake: {handshakeState}
        </div>
      </header>

      <nav className="plugin-nav">
        <button
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
        <button
          className={activeTab === 'config' ? 'active' : ''}
          onClick={() => setActiveTab('config')}
        >
          Configuration
        </button>
        <button
          className={activeTab === 'evaluations' ? 'active' : ''}
          onClick={() => setActiveTab('evaluations')}
        >
          Evaluations
        </button>
      </nav>

      <main className="plugin-body" data-active-tab={activeTab}>
        {activeTab === 'overview' && (
          <section className="view-panel">
            <h2>Overview View</h2>
            <p>Generic trusted plugin host overview.</p>
            <button id="run-canaries-btn" onClick={runCanaryProbes}>
              Run Security Canaries
            </button>
            {Object.keys(canaryResults).length > 0 && (
              <pre id="canary-results">{JSON.stringify(canaryResults, null, 2)}</pre>
            )}
          </section>
        )}
        {activeTab === 'history' && (
          <section className="view-panel">
            <h2>History View</h2>
            <p>Project historical runs and records.</p>
          </section>
        )}
        {activeTab === 'config' && (
          <section className="view-panel">
            <h2>Configuration View</h2>
            <p>Target bindings and policy configuration.</p>
          </section>
        )}
        {activeTab === 'evaluations' && (
          <section className="view-panel">
            <h2>Evaluations View</h2>
            <p>Advisor evaluation suites and comparisons.</p>
          </section>
        )}
      </main>
    </div>
  );
}
