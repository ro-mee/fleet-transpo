"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useRealtime(channel, event, callback) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const subscription = supabase
      .channel(channel)
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        callback(payload);
      })
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [channel]);

  return { isConnected };
}

export function useTrackingRealtime(vehicleIds, callback) {
  const supabase = createClient();

  useEffect(() => {
    if (!vehicleIds?.length) return;

    const subscription = supabase
      .channel("tracking-updates")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "gpstracking",
          filter: `vehicle_id=in.(${vehicleIds.join(",")})`,
        },
        (payload) => {
          callback(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [vehicleIds?.join(",")]);
}
