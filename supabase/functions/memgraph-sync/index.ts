// memgraph-sync — sync Postgres grid changes to Memgraph
//
// Register as a Database Webhook in Supabase Dashboard:
//   1. Database → Webhooks → Create a new hook
//   2. Table: connectivity_nodes (and separately ac_line_segments)
//   3. Events: INSERT, UPDATE, DELETE
//   4. Type: HTTP Request → POST
//   5. URL: https://<project-ref>.supabase.co/functions/v1/memgraph-sync
//      Local: http://127.0.0.1:54321/functions/v1/memgraph-sync
//   6. HTTP Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//
// For ac_line_segments, phases/voltage live on conducting_equipment; this function
// looks them up via SUPABASE_DB_URI when handling segment events.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import neo4j from "npm:neo4j-driver@5.17.0";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

const MEMGRAPH_URI = Deno.env.get("MEMGRAPH_URI") ?? "bolt://localhost:7687";
const SUPABASE_DB_URI =
  Deno.env.get("SUPABASE_DB_URI") ?? Deno.env.get("SUPABASE_DB_URL");

async function fetchEquipment(
  mrid: string,
): Promise<{ phases: string; voltage: string } | null> {
  if (!SUPABASE_DB_URI) return null;
  const client = new Client(SUPABASE_DB_URI);
  await client.connect();
  try {
    const result = await client.queryObject<{ phases: string; nominal_voltage: string }>(
      `SELECT phases, nominal_voltage::text AS nominal_voltage
       FROM conducting_equipment WHERE mrid = $1`,
      [mrid],
    );
    if (result.rows.length === 0) return null;
    return { phases: result.rows[0].phases, voltage: result.rows[0].nominal_voltage };
  } finally {
    await client.end();
  }
}

async function handleConnectivityNode(
  session: ReturnType<ReturnType<typeof neo4j.driver>["session"]>,
  payload: WebhookPayload,
) {
  const mrid = (payload.record?.mrid ?? payload.old_record?.mrid) as string;

  if (payload.type === "DELETE") {
    await session.run(
      "MATCH (c:ConnectivityNode {mrid: $mrid}) DETACH DELETE c",
      { mrid },
    );
    return;
  }

  const name = payload.record?.name as string | undefined;
  if (!mrid) throw new Error("connectivity_nodes event missing mrid");

  // Webhook payload may not include name; fetch from identified_objects if needed
  let nodeName = name;
  if (!nodeName && SUPABASE_DB_URI) {
    const client = new Client(SUPABASE_DB_URI);
    await client.connect();
    try {
      const result = await client.queryObject<{ name: string }>(
        `SELECT name FROM identified_objects WHERE mrid = $1`,
        [mrid],
      );
      nodeName = result.rows[0]?.name;
    } finally {
      await client.end();
    }
  }

  await session.run(
    `MERGE (c:ConnectivityNode {mrid: $mrid})
     SET c.name = $name`,
    { mrid, name: nodeName ?? mrid },
  );
}

async function handleAcLineSegment(
  session: ReturnType<ReturnType<typeof neo4j.driver>["session"]>,
  payload: WebhookPayload,
) {
  const mrid = (payload.record?.mrid ?? payload.old_record?.mrid) as string;

  if (payload.type === "DELETE") {
    await session.run(
      "MATCH ()-[r:AC_LINE_SEGMENT {mrid: $mrid}]->() DELETE r",
      { mrid },
    );
    return;
  }

  const rec = payload.record;
  if (!rec) throw new Error("ac_line_segments INSERT/UPDATE missing record");

  const sourceId = rec.source_node_id as string;
  const targetId = rec.target_node_id as string;
  const direction = rec.direction_downstream as boolean;

  const equipment = await fetchEquipment(mrid);
  const phases = equipment?.phases ?? "ABC";
  const voltage = equipment?.voltage ?? "UNKNOWN";

  await session.run(
    `MATCH (src:ConnectivityNode {mrid: $source_mrid})
     MATCH (tgt:ConnectivityNode {mrid: $target_mrid})
     MERGE (src)-[r:AC_LINE_SEGMENT {mrid: $mrid}]->(tgt)
     SET r.phases = $phases,
         r.voltage = $voltage,
         r.direction_downstream = $direction_downstream`,
    {
      mrid,
      source_mrid: sourceId,
      target_mrid: targetId,
      phases,
      voltage,
      direction_downstream: direction,
    },
  );
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const driver = neo4j.driver(MEMGRAPH_URI);
  const session = driver.session();

  try {
    const payload: WebhookPayload = await req.json();

    if (payload.table === "connectivity_nodes") {
      await handleConnectivityNode(session, payload);
    } else if (payload.table === "ac_line_segments") {
      await handleAcLineSegment(session, payload);
    } else {
      return new Response(
        JSON.stringify({ status: "ignored", table: payload.table }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ status: "synced" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await session.close();
    await driver.close();
  }
});
