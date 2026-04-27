import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { WebviewHelper } from '../../src/presentation/webview/WebviewHelper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal webview double that satisfies WebviewHelper's usage */
function makeFakeWebview() {
  return {
    html: '',
    options: {} as vscode.WebviewOptions,
    cspSource: 'vscode-resource://test',
    asWebviewUri: (uri: vscode.Uri) => uri,
    postMessage: vi.fn(async () => true),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebviewHelper', () => {
  let fakeWebview: ReturnType<typeof makeFakeWebview>;
  let extensionUri: vscode.Uri;

  beforeEach(() => {
    fakeWebview = makeFakeWebview();
    extensionUri = vscode.Uri.file('/fake/extension');
  });

  // =========================================================================
  // getNonce()
  // =========================================================================

  describe('getNonce()', () => {
    it('returns exactly 32 characters', () => {
      const nonce = WebviewHelper.getNonce();
      expect(nonce).toHaveLength(32);
    });

    it('contains only [A-Za-z0-9] characters', () => {
      const nonce = WebviewHelper.getNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
    });

    it('returns different values on consecutive calls (aleatoriedade)', () => {
      const nonce1 = WebviewHelper.getNonce();
      const nonce2 = WebviewHelper.getNonce();
      // Probability of collision is (1/62)^32 ≈ 0, so this is deterministically safe
      expect(nonce1).not.toBe(nonce2);
    });
  });

  // =========================================================================
  // buildHtml()
  // =========================================================================

  describe('buildHtml()', () => {
    it('starts with <!DOCTYPE html>', () => {
      const html = WebviewHelper.buildHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        bodyContent: '',
      });
      expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    });

    it('contains <title> with the title passed', () => {
      const html = WebviewHelper.buildHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'My Extension Panel',
        bodyContent: '',
      });
      expect(html).toContain('<title>My Extension Panel</title>');
    });

    it('contains the nonce inside the Content-Security-Policy meta tag', () => {
      const html = WebviewHelper.buildHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        bodyContent: '',
      });
      // The nonce appears as 'nonce-XXXXXXXX' inside the CSP content attribute
      expect(html).toMatch(/nonce-[A-Za-z0-9]{32}/);
    });

    it('contains bodyContent in the HTML body', () => {
      const bodyContent = '<div id="my-content">corpo da página</div>';
      const html = WebviewHelper.buildHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        bodyContent,
      });
      expect(html).toContain(bodyContent);
    });

    it('contains scriptContent when provided', () => {
      const html = WebviewHelper.buildHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        bodyContent: '',
        scriptContent: 'console.log("hello from script");',
      });
      expect(html).toContain('console.log("hello from script");');
    });

    it('renders a <script> tag even when scriptContent is omitted (uses empty string fallback)', () => {
      const html = WebviewHelper.buildHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        bodyContent: '',
        // scriptContent intentionally omitted
      });
      expect(html).toContain('<script nonce=');
      expect(html).not.toContain('undefined');
    });
  });

  // =========================================================================
  // buildStatefulHtml()
  // =========================================================================

  describe('buildStatefulHtml()', () => {
    const sampleState = { count: 42, name: 'test', items: [1, 2, 3] };

    it('starts with <!DOCTYPE html>', () => {
      const html = WebviewHelper.buildStatefulHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Stateful Panel',
        initialState: sampleState,
        scriptContent: '',
      });
      expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    });

    it('contains the data-state attribute on #app-root', () => {
      const html = WebviewHelper.buildStatefulHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Stateful Panel',
        initialState: sampleState,
        scriptContent: '',
      });
      expect(html).toMatch(/id="app-root"[^>]*data-state=/);
    });

    it('the data-state value is valid base64', () => {
      const html = WebviewHelper.buildStatefulHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Stateful Panel',
        initialState: sampleState,
        scriptContent: '',
      });
      const match = html.match(/data-state="([^"]+)"/);
      expect(match).not.toBeNull();
      const base64Value = match![1];
      expect(base64Value).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('decoding data-state (base64 → decodeURIComponent → JSON.parse) reproduces the original state', () => {
      const html = WebviewHelper.buildStatefulHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Stateful Panel',
        initialState: sampleState,
        scriptContent: '',
      });
      const match = html.match(/data-state="([^"]+)"/);
      const base64Value = match![1];
      const decoded = JSON.parse(decodeURIComponent(Buffer.from(base64Value, 'base64').toString()));
      expect(decoded).toEqual(sampleState);
    });

    it('applies bodyClassName to the <body> element', () => {
      const html = WebviewHelper.buildStatefulHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        initialState: {},
        scriptContent: '',
        bodyClassName: 'my-custom-class',
      });
      expect(html).toContain('my-custom-class');
    });

    it('uses empty string for body class when bodyClassName is omitted', () => {
      const html = WebviewHelper.buildStatefulHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        initialState: {},
        scriptContent: '',
      });
      expect(html).toContain('class=""');
    });

    it('does not throw when initialState is null', () => {
      expect(() =>
        WebviewHelper.buildStatefulHtml({
          webview: fakeWebview as unknown as vscode.Webview,
          extensionUri,
          title: 'Test',
          initialState: null,
          scriptContent: '',
        })
      ).not.toThrow();
    });

    it('does not throw when initialState is undefined', () => {
      expect(() =>
        WebviewHelper.buildStatefulHtml({
          webview: fakeWebview as unknown as vscode.Webview,
          extensionUri,
          title: 'Test',
          initialState: undefined,
          scriptContent: '',
        })
      ).not.toThrow();
    });

    it('encodes null/undefined initialState as empty object {}', () => {
      const html = WebviewHelper.buildStatefulHtml({
        webview: fakeWebview as unknown as vscode.Webview,
        extensionUri,
        title: 'Test',
        initialState: null,
        scriptContent: '',
      });
      const match = html.match(/data-state="([^"]+)"/);
      const base64Value = match![1];
      const decoded = JSON.parse(decodeURIComponent(Buffer.from(base64Value, 'base64').toString()));
      expect(decoded).toEqual({});
    });
  });

  // =========================================================================
  // postState()
  // =========================================================================

  describe('postState()', () => {
    it('calls webview.postMessage exactly once', () => {
      WebviewHelper.postState(fakeWebview as unknown as vscode.Webview, { count: 1 });
      expect(fakeWebview.postMessage).toHaveBeenCalledTimes(1);
    });

    it('sends a message with type "setState" (not "command")', () => {
      WebviewHelper.postState(fakeWebview as unknown as vscode.Webview, { count: 1 });
      expect(fakeWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'setState' })
      );
    });

    it('sends the state under the "state" property', () => {
      const statePayload = { foo: 'bar', num: 99 };
      WebviewHelper.postState(fakeWebview as unknown as vscode.Webview, statePayload);
      expect(fakeWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ state: statePayload })
      );
    });

    it('sends both type and state in a single message object', () => {
      const statePayload = { x: 'hello' };
      WebviewHelper.postState(fakeWebview as unknown as vscode.Webview, statePayload);
      expect(fakeWebview.postMessage).toHaveBeenCalledWith({
        type: 'setState',
        state: statePayload,
      });
    });

    it('uses type "replaceState" when replace=true is passed', () => {
      WebviewHelper.postState(fakeWebview as unknown as vscode.Webview, { x: 1 }, true);
      expect(fakeWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'replaceState' })
      );
    });
  });
});
