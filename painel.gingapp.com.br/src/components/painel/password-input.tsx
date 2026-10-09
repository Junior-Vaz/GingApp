import { forwardRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Campo de senha com botão mostrar/ocultar. `toggleLabel` nomeia o campo para leitores de tela. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<"input">, "type"> & { toggleLabel: string }
>(({ toggleLabel, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={visible ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={`${visible ? "Ocultar" : "Mostrar"} ${toggleLabel}`}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
