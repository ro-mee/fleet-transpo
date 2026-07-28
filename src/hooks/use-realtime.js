"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useRealtime(channel, event, callback) {
  const [isConnected, setIsConnected] = useState(false);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const supabase = createClient();
    const subscription = supabase
      .channel(channel)
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        callbackRef.current?.(payload);
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
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const vehicleIdString = vehicleIds?.join(",");

  useEffect(() => {
    if (!vehicleIdString) return;

    const supabase = createClient();
    const subscription = supabase
      .channel("tracking-updates")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "gpstracking",
          filter: `vehicle_id=in.(${vehicleIdString})`,
        },
        (payload) => {
          callbackRef.current?.(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [vehicleIdString]);
}
