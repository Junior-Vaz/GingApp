import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "./types";

/** Abre o editor do formulário (/formularios/:formId). */
export function useOpenForm(): (id: Id) => void {
  const navigate = useNavigate();
  return useCallback(
    (id: Id) => void navigate({ to: "/formularios/$formId", params: { formId: String(id) } }),
    [navigate],
  );
}

/** Volta para a lista (/formularios). */
export function useGoToList(): () => void {
  const navigate = useNavigate();
  return useCallback(() => void navigate({ to: "/formularios" }), [navigate]);
}
