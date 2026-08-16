import { useEffect, useState } from "react";

import { supabase } from "../supabase/client";

// Abonniert messages_cache per Supabase Realtime (RLS-gefiltert - der Nutzer
// bekommt nur Aenderungen an eigenen Zeilen) und haelt einen live
// aktualisierten Zaehler ungelesener Nachrichten fuer den Tab-Badge.
// Setzt voraus, dass die Tabelle der `supabase_realtime`-Publication
// hinzugefuegt wurde (siehe Migration 0006).
export function useUnreadBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function refresh() {
      const { count: current } = await supabase
        .from("messages_cache")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false);
      if (isMounted) setCount(current ?? 0);
    }

    refresh();

    const channel = supabase
      .channel("messages_cache_unread_badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages_cache" }, () => {
        refresh();
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
