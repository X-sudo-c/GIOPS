import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

interface TelemetryPayload {
  meter_mrid: string;
  active_energy_kwh: number;
}

const TIMESCALE_URI = Deno.env.get("TIMESCALE_URI");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: TelemetryPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.meter_mrid || body.active_energy_kwh === undefined || body.active_energy_kwh === null) {
    return new Response(
      JSON.stringify({ error: "meter_mrid and active_energy_kwh are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (typeof body.active_energy_kwh !== "number" || body.active_energy_kwh <= 0) {
    return new Response(
      JSON.stringify({ error: "active_energy_kwh must be a positive number" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!TIMESCALE_URI) {
    return new Response(JSON.stringify({ error: "TIMESCALE_URI not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Client(TIMESCALE_URI);
  try {
    await client.connect();
    await client.queryObject(
      `INSERT INTO public.meter_readings (meter_mrid, reading_timestamp, active_energy_kwh)
       VALUES ($1, NOW(), $2)`,
      [body.meter_mrid, body.active_energy_kwh],
    );
    return new Response(JSON.stringify({ status: "ingested" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await client.end();
  }
});
