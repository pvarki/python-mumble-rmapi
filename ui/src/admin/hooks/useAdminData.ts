import { useCallback, useEffect, useRef, useState } from "react";

import { api, type Template } from "@/api";
import type { Data } from "../types";

const REFRESH_MS = 10_000;

// Nets, users and missions, polled while the page is visible; templates ship with the image, so fetched once
export function useAdminData(
  fail: (error: unknown) => void,
  onLoad: (data: Data) => void,
) {
  const [data, setData] = useState<Data | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const loads = useRef(0);
  const latestOnLoad = useRef(onLoad);

  useEffect(() => {
    latestOnLoad.current = onLoad;
  });

  const load = useCallback(() => {
    const seq = ++loads.current;
    return Promise.all([api.channels(), api.users(), api.missions()]).then(
      ([channels, users, missions]) => {
        if (seq !== loads.current) return; // a newer fetch has started
        const next = { channels, users, missions };
        latestOnLoad.current(next);
        setData(next);
      },
      fail,
    );
  }, [fail]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void load();
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    api.templates().then(setTemplates, fail);
  }, [fail]);

  return { data, templates, load };
}
