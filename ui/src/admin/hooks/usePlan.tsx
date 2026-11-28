import { Download, ListPlus, Trash2, Upload } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { api, type Template } from "@/api";
import { NS } from "@/i18n";
import type { MenuItem } from "../MoreMenu";
import type { Notice } from "../NoticeLine";
import type { Run, Top } from "../types";

function download(yaml: string) {
  const url = URL.createObjectURL(
    new Blob([yaml], { type: "application/yaml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "voice-channels.yaml";
  link.click();
  URL.revokeObjectURL(url);
}

// The channel plan's actions behind the More menu: a template, import, export and removing every unit net. An
// import starts from the hidden file input fileInput points at, which calls onFile.
export function usePlan({
  templates,
  hasNets,
  fileInput,
  run,
  showNotice,
  fail,
  openTop,
  closeIfStill,
  onCleared,
}: {
  templates: Template[];
  hasNets: boolean;
  fileInput: RefObject<HTMLInputElement>;
  run: Run;
  showNotice: (notice: Notice | null) => void;
  fail: (error: unknown) => void;
  openTop: (panel: Exclude<Top, null>) => void;
  closeIfStill: (panel: Top) => void;
  onCleared: () => void;
}) {
  const { t } = useTranslation(NS);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((yaml) =>
        run(
          "import",
          () => api.importPlan(yaml),
          ({ created }) =>
            showNotice({
              kind: "ok",
              text: t("admin.imported", { count: created }),
            }),
        ),
      )
      .catch(fail)
      .finally(() => {
        input.value = "";
      });
  };

  const onExport = () => void api.exportPlan().then(download, fail);

  const applyTemplate = (template: Template) =>
    void run(
      `tpl:${template.id}`,
      () => api.applyTemplate(template.id),
      ({ created }) => {
        closeIfStill("templates");
        showNotice({
          kind: "ok",
          text: t("admin.applied", { count: created }),
        });
      },
    );

  const clearPlan = () =>
    void run("clear", api.clearChannels, ({ removed }) => {
      onCleared();
      closeIfStill("clear");
      showNotice({ kind: "ok", text: t("admin.cleared", { count: removed }) });
    });

  const menu: MenuItem[] = [
    ...(templates.length
      ? [
          {
            label: t("admin.useTemplate"),
            icon: <ListPlus />,
            action: () => openTop("templates"),
          },
        ]
      : []),
    {
      label: t("admin.importPlan"),
      icon: <Upload />,
      action: () => fileInput.current?.click(),
    },
    {
      label: t("admin.exportPlan"),
      icon: <Download />,
      action: onExport,
    },
    ...(hasNets
      ? [
          {
            label: t("admin.clearAll"),
            icon: <Trash2 className="text-destructive" />,
            action: () => openTop("clear"),
          },
        ]
      : []),
  ];

  return { menu, onFile, onExport, applyTemplate, clearPlan };
}
