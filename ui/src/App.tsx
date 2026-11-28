import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { addTranslations, NS } from "@/i18n";
import { MISSIONS, pathLabel } from "@/paths";
import { Admin } from "./admin/Admin";
import { OnboardingHandler } from "./guide/OnboardingHandler";
import { Talk } from "./voice/Talk";

// What mumblermapi's /api/v2/clients/data returns for the signed-in user, by way of rmapi
export interface ClientData {
  admin?: boolean;
  voice?: boolean;
  nets?: string[];
}

// What rmui passes every remote about the signed-in user besides data
export interface Meta {
  callsign?: string;
  // Whether guides may open by themselves, and the way to turn that off for every product
  autoOpenGuides?: boolean;
  onDisableGuides?: () => void;
}

interface Props {
  data?: ClientData;
  meta?: Meta;
}

function YouLine({ data }: { data: ClientData }) {
  const { t } = useTranslation(NS);
  const nets = data.nets ?? [];
  return (
    <div className="space-y-1" data-testid="you">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {data.voice === true && (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot state="on" />
            {t("voiceOn")}
          </span>
        )}
        {data.voice === false && (
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <StatusDot state="alert" />
            {t("voiceOff")}
          </span>
        )}
        {data.voice === false ? null : nets.length ? (
          nets.map((net) => (
            <span
              key={net}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
            >
              {net.startsWith(MISSIONS) && (
                <Flag className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              {pathLabel(net)}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("openNetsOnly")}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("atakHint")}</p>
    </div>
  );
}

function VoicePage({ data, meta }: { data: ClientData; meta: Meta }) {
  const { t } = useTranslation(NS);
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {/* rmui passes {} until rmapi answers, and the guide decides on mount whether it opens */}
        {data.voice !== undefined && (
          <OnboardingHandler
            meta={meta}
            voice={data.voice}
            admin={!!data.admin}
          />
        )}
      </div>
      <YouLine data={data} />
      {data.voice !== false && <Talk />}
      {data.admin && <Admin />}
    </div>
  );
}

export default function MumbleApp({ data = {}, meta = {} }: Props) {
  const { i18n } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void addTranslations(i18n).then(() => setReady(true));
  }, [i18n]);

  return ready ? <VoicePage data={data} meta={meta} /> : null;
}
