interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * FAA Delays MCP — live US airport operational status (FAA, free, no auth).
 *
 * The FAA's National Airspace System status feed (nasstatus.faa.gov): real-time
 * ground stops, ground delay programs, arrival/departure delays, and airport
 * closures. This is OPERATIONAL status ("is SFO delayed right now and why"),
 * distinct from the catalog's other aviation packs (flight tracking, METAR
 * weather, airport reference data) — nothing else exposed FAA delay programs.
 *
 * Source: https://nasstatus.faa.gov/api/airport-status-information (XML).
 *
 * Tools:
 * - airport_delays: current delays/ground stops/closures for one airport
 * - all_delays: nationwide snapshot of every active delay program right now
 */


const FAA_URL = 'https://nasstatus.faa.gov/api/airport-status-information';

const tools: McpToolExport['tools'] = [
  {
    name: 'airport_delays',
    description:
      'Live FAA operational delay status for ONE US airport. PREFER OVER WEB SEARCH for "are there delays at SFO", "is JFK on a ground stop", "why is my flight delayed at ORD". Returns any active ground stop, ground delay program (avg/max delay), general arrival/departure delays (with trend), and closures for that airport — with the FAA-stated reason (weather, volume, etc.). Pass a 3-letter airport code. Empty result = no FAA-reported delays right now.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        airport: { type: 'string', description: '3-letter airport code (e.g., "SFO", "JFK", "ORD", "ATL")' },
      },
      required: ['airport'],
    },
  },
  {
    name: 'all_delays',
    description:
      'Nationwide snapshot of ALL active FAA delay programs right now — every airport currently under a ground stop, ground delay, arrival/departure delay, or closure, each with its reason. Use for "which airports have delays today", "are there nationwide ground stops", "what airports are affected by weather".',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

// ── XML parsing (Workers have no DOMParser; the feed is small + regular) ──

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1].trim() : null;
}

function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// Each top-level <Delay_type> wraps one category; grab the one whose <Name> matches.
function section(xml: string, name: string): string {
  for (const b of blocks(xml, 'Delay_type')) {
    if (tag(b, 'Name') === name) return b;
  }
  return '';
}

interface GroundStop { airport: string | null; reason: string | null; end_time: string | null }
interface GroundDelay { airport: string | null; reason: string | null; avg_delay: string | null; max_delay: string | null }
interface ArrDepDelay { airport: string | null; reason: string | null; legs: Array<{ type: string | null; min: string | null; max: string | null; trend: string | null }> }
interface Closure { airport: string | null; reason: string | null; start: string | null; reopen: string | null }

interface ParsedStatus {
  update_time: string | null;
  ground_stops: GroundStop[];
  ground_delays: GroundDelay[];
  arrival_departure_delays: ArrDepDelay[];
  closures: Closure[];
}

function parseStatus(xml: string): ParsedStatus {
  const gs = blocks(section(xml, 'Ground Stop Programs'), 'Program').map((b) => ({
    airport: tag(b, 'ARPT'),
    reason: tag(b, 'Reason'),
    end_time: tag(b, 'End_Time'),
  }));
  const gd = blocks(section(xml, 'Ground Delay Programs'), 'Ground_Delay').map((b) => ({
    airport: tag(b, 'ARPT'),
    reason: tag(b, 'Reason'),
    avg_delay: tag(b, 'Avg'),
    max_delay: tag(b, 'Max'),
  }));
  const ad = blocks(section(xml, 'General Arrival/Departure Delay Info'), 'Delay').map((b) => {
    const legs: ArrDepDelay['legs'] = [];
    const re = /<Arrival_Departure\s+Type="([^"]*)">([\s\S]*?)<\/Arrival_Departure>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b)) !== null) {
      legs.push({ type: m[1], min: tag(m[2], 'Min'), max: tag(m[2], 'Max'), trend: tag(m[2], 'Trend') });
    }
    return { airport: tag(b, 'ARPT'), reason: tag(b, 'Reason'), legs };
  });
  const cl = blocks(section(xml, 'Airport Closures'), 'Airport').map((b) => ({
    airport: tag(b, 'ARPT'),
    reason: tag(b, 'Reason'),
    start: tag(b, 'Start'),
    reopen: tag(b, 'Reopen'),
  }));
  return {
    update_time: tag(xml, 'Update_Time'),
    ground_stops: gs,
    ground_delays: gd,
    arrival_departure_delays: ad,
    closures: cl,
  };
}

async function fetchStatus(): Promise<ParsedStatus> {
  const res = await fetch(FAA_URL, { headers: { Accept: 'application/xml', 'User-Agent': 'Pipeworx/1.0 (pipeworx.io)' } });
  if (!res.ok) throw new Error(`FAA status error: ${res.status}`);
  return parseStatus(await res.text());
}

// ── Tool implementations ─────────────────────────────────────────────

async function allDelays() {
  const s = await fetchStatus();
  const counts = {
    ground_stops: s.ground_stops.length,
    ground_delays: s.ground_delays.length,
    arrival_departure_delays: s.arrival_departure_delays.length,
    closures: s.closures.length,
  };
  return { summary: counts, ...s };
}

async function airportDelays(airport: string) {
  const code = String(airport ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(code)) {
    throw new Error('Pass a 3-letter US airport code, e.g. "SFO", "JFK", "ORD".');
  }
  const s = await fetchStatus();
  const ofAirport = (a: string | null) => (a ?? '').toUpperCase() === code;
  const ground_stops = s.ground_stops.filter((x) => ofAirport(x.airport));
  const ground_delays = s.ground_delays.filter((x) => ofAirport(x.airport));
  const arrival_departure_delays = s.arrival_departure_delays.filter((x) => ofAirport(x.airport));
  const closures = s.closures.filter((x) => ofAirport(x.airport));
  const has = ground_stops.length || ground_delays.length || arrival_departure_delays.length || closures.length;
  return {
    airport: code,
    update_time: s.update_time,
    has_delays: Boolean(has),
    note: has ? undefined : `No FAA-reported ground stops, delay programs, or closures at ${code} right now.`,
    ground_stops,
    ground_delays,
    arrival_departure_delays,
    closures,
  };
}

// ── Router ───────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'airport_delays':
      return airportDelays(args.airport as string);
    case 'all_delays':
      return allDelays();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
