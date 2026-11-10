/** EventSource controlável (jsdom não tem EventSource): o teste decide quando abre, manda snapshot, cai ou fecha. */
export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Array<(event: Event) => void>>();
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
  }
  /** Dispara um evento do servidor (ignora se já foi fechado, como um EventSource de verdade). */
  emit(type: string, data?: string): void {
    if (this.closed) return;
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export const lastSource = (): MockEventSource => MockEventSource.instances[MockEventSource.instances.length - 1]!;
