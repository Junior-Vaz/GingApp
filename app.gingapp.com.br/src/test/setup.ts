import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom não implementa <canvas>: sem isto `getContext` imprime "Not implemented" (o telão trata `null` como "sem confete").
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  writable: true,
  configurable: true,
  value: () => null,
});
