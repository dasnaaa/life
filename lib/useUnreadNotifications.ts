import { useEffect, useState } from "react";

import { supabase } from "../supabase/client";

// Analog zu useUnreadBadge.ts (messages_cache), nur fuer die
// notifications-Tabelle - treibt den Badge auf der Glocke im Header.
// Setzt voraus, dass notifications der supabase_realtime-Publication
// hinzugefuegt wurde (siehe Migration 0008).
export function useUnreadNotifications(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function refresh() {
      const { count: current } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false);
      if (isMounted) setCount(current ?? 0);
    }

    refresh();

    const channel = supabase
      .channel("notifications_unread_badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
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
