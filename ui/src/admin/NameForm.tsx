import { Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NS } from "@/i18n";

// Adds are keyed per name, so several can be in flight; the form only shows that one is
export function adding(pending: Set<string>, parent: number): boolean {
  return [...pending].some((key) => key.startsWith(`add:${parent}:`));
}

// A new top-level net or sub-net. Stays open after a success so the next squad is one more Enter.
export function NameForm({
  placeholder,
  busy,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  busy: boolean;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation(NS);
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ready = name.trim() !== "";
  // The field empties at once, so the next squad can be typed while this one is still being saved;
  // a failed name comes back unless something new has been typed meanwhile.
  const submit = () => {
    const sent = name.trim();
    if (!sent) return;
    setName("");
    input.current?.focus();
    void onSubmit(sent).then((ok) => {
      if (!ok) setName((current) => (current === "" ? sent : current));
    });
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        ref={input}
        autoFocus
        type="text"
        className="h-10 sm:max-w-sm"
        value={name}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        aria-disabled={!ready || undefined}
        onClick={submit}
      >
        {busy && <Loader2 className="animate-spin" />}
        {t("admin.add")}
      </Button>
      <Button
        type="button"
        variant="muted"
        size="icon"
        aria-label={t("admin.cancel")}
        onClick={onCancel}
      >
        <X />
      </Button>
    </div>
  );
}
