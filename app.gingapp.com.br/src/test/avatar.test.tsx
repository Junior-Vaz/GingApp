import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Avatar } from "@/components/gingapp/avatar";

/**
 * Avatar único: foto, fallback para iniciais se a imagem falhar (nada de ícone quebrado), cor estável das iniciais,
 * selo redondo do grupo (logo ou iniciais; ausente sem dado do grupo) e resolução de URL relativa de upload.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UPLOAD = "/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui: React.ReactElement) => act(() => root.render(ui));
const avatar = () => host.querySelector<HTMLElement>('[data-testid="avatar"]')!;
const badge = () => host.querySelector<HTMLElement>('[data-testid="avatar-group-badge"]');
const photo = () => host.querySelector<HTMLImageElement>(".gx-av-disc img");

describe("Avatar", () => {
  it("mostra a foto quando houver", () => {
    render(<Avatar name="Ana Souza" src="https://cdn.example.com/ana.jpg" />);
    expect(photo()?.getAttribute("src")).toBe("https://cdn.example.com/ana.jpg");
    expect(host.querySelector(".gx-av-ini")).toBeNull();
    expect(avatar().getAttribute("aria-label")).toBe("Foto de Ana Souza");
  });

  it("cai nas iniciais quando a imagem falha (404) e não deixa <img> quebrado", () => {
    render(<Avatar name="Ana Souza" src="https://cdn.example.com/404.jpg" />);
    act(() => {
      photo()!.dispatchEvent(new Event("error"));
    });
    expect(photo()).toBeNull();
    expect(host.querySelector(".gx-av-ini")?.textContent).toBe("AS");
  });

  it("sem foto usa iniciais com cor estável por nome", () => {
    render(<Avatar name="Ana Souza" />);
    expect(host.querySelector(".gx-av-ini")?.textContent).toBe("AS");
    const disc = host.querySelector<HTMLElement>(".gx-av-disc")!;
    const color = disc.style.background;
    expect(color).not.toBe("");
    render(<Avatar name="  ana souza " />);
    expect(host.querySelector<HTMLElement>(".gx-av-disc")!.style.background).toBe(color);
  });

  it("resolve o caminho relativo de upload com a origem da API", () => {
    render(<Avatar name="Ana" src={UPLOAD} />);
    const src = photo()?.getAttribute("src") ?? "";
    expect(src.endsWith(UPLOAD)).toBe(true);
    // em dev a API fica em outra origem: o src NÃO pode ser só o caminho relativo
    expect(src.length).toBeGreaterThanOrEqual(UPLOAD.length);
  });

  it("selo do grupo: logo quando houver, iniciais do grupo sem logo, ausente sem dado do grupo", () => {
    render(<Avatar name="Ana" groupName="Axé Capoeira" groupLogoUrl="https://cdn.example.com/logo.png" />);
    expect(badge()?.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/logo.png");
    expect(avatar().getAttribute("aria-label")).toBe("Ana, grupo Axé Capoeira");

    render(<Avatar name="Ana" groupName="Axé Capoeira" groupLogoUrl={null} />);
    expect(badge()?.querySelector("img")).toBeNull();
    expect(badge()?.textContent).toBe("A");

    render(<Avatar name="Ana" />);
    expect(badge()).toBeNull();
  });

  it("logo do grupo quebrada cai nas iniciais do grupo", () => {
    render(<Avatar name="Ana" groupName="Axé Capoeira" groupLogoUrl="https://cdn.example.com/x.png" />);
    act(() => {
      badge()!.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(badge()?.querySelector("img")).toBeNull();
    expect(badge()?.textContent).toBe("A");
  });

  it("rótulo combina foto e grupo; decorativo fica fora da acessibilidade", () => {
    render(<Avatar name="Ana" src="https://cdn.example.com/ana.jpg" groupName="Axé" />);
    expect(avatar().getAttribute("aria-label")).toBe("Foto de Ana, grupo Axé");
    render(<Avatar decorative name="Ana" />);
    expect(avatar().getAttribute("aria-hidden")).toBe("true");
    expect(avatar().getAttribute("aria-label")).toBeNull();
  });

  it("anel da liga e tamanho viram variáveis CSS", () => {
    render(<Avatar name="Ana" size={64} ringColor="#3B82F6" />);
    expect(avatar().className).toContain("has-ring");
    expect(avatar().style.getPropertyValue("--av")).toBe("64px");
    expect(avatar().style.getPropertyValue("--ring")).toBe("#3B82F6");
  });
});
