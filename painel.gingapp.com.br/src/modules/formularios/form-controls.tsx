import { useId, type ComponentProps, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/rodas/native-select";

interface WrapProps {
  label: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  className?: string;
}

function Wrap({
  label,
  hint,
  error,
  className,
  id,
  children,
}: WrapProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (
  id: string,
  hint: ReactNode,
  error: string | null | undefined,
): string | undefined => {
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return ids || undefined;
};

export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: WrapProps & Omit<ComponentProps<"input">, "id" | "className">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error} {...(className ? { className } : {})}>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </Wrap>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...props
}: WrapProps & Omit<ComponentProps<"textarea">, "id" | "className">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error} {...(className ? { className } : {})}>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </Wrap>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: WrapProps & Omit<ComponentProps<"select">, "id" | "className">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error} {...(className ? { className } : {})}>
      <NativeSelect
        id={id}
        className="h-11 md:h-9"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      >
        {children}
      </NativeSelect>
    </Wrap>
  );
}

/** Linha com rótulo + interruptor (área de toque >= 44px). O interruptor é nomeado pelo rótulo. */
export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        {description && (
          <p id={`${id}-desc`} className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? `${id}-desc` : undefined}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
