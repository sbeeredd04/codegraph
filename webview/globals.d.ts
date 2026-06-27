// VS Code injects this into every webview.
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// The vendored Mermaid global build (Epic 7) is loaded via a <script> tag before
// the webview bundle. It is an esbuild ESM-global build, so its module namespace
// hangs off this generated global; `.default` is the Mermaid API. We use only the
// two methods we need, rendering agent-written source with strict security.
interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

interface Window {
  __esbuild_esm_mermaid_nm?: { mermaid?: { default?: MermaidApi } };
  mermaid?: MermaidApi;
}
