# SOSphere Drone Agent

Bridges one drone to the SOSphere control plane. Watches `drone_missions`
for an `approved` mission, flies the drone to the target, and streams
`drone_telemetry` every second (the dashboard draws it live on the map).

The platform stores **only light control data** — never video. Video stays
on the client's own media server (see the feature brief, section 8).

## Run (demo / simulator)

```bash
npm i @supabase/supabase-js
cp .env.example .env   # fill SUPABASE_SERVICE_KEY + DRONE_ID
node --env-file=.env drone-agent.mjs
```

1. In the dashboard: Drones → Add Drone (creates a row in `public.drones`, gives you its id).
2. Put that id in `DRONE_ID`, add your service key, run the command above.
3. Push an incident + an `approved` drone_mission → watch the drone move live.

## Switch to a real drone (later)

Set `DRONE_SOURCE=mavlink` and fill in `MavlinkDroneSource` with a MAVLink
library (e.g. node-mavlink). **No platform changes needed** — same tables,
same telemetry shape.
