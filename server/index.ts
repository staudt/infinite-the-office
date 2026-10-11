// Tiny writer proxy: keeps the API key server-side. The browser POSTs its series state
// and gets back the next episode (written by the LLM, or read from the store).
import { createServer } from 'node:http';

try {
  process.loadEnvFile();
} catch {
  // no .env file; rely on the environment
}

const { createSeries, llmAvailable, model, planModel, writeEpisode } = await import('./writer');
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 2_000_000;

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return send(200, { ok: true, llm: llmAvailable(), model: model(), planModel: planModel() });
    }
    if (req.method === 'POST' && (req.url === '/api/episode' || req.url === '/api/series')) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return send(413, { error: 'request too large' });
      }
      const body = JSON.parse(raw);
      const t0 = Date.now();
      if (req.url === '/api/series') {
        const created = await createSeries(String(body.direction ?? '').slice(0, 2000), Number(body.seed) >>> 0, String(body.name ?? ''));
        if (!created.series) return send(503, { error: created.reason, message: created.message });
        console.error(`[server] series "${created.series.name}" (${created.series.id}) created in ${Date.now() - t0}ms`);
        return send(200, created);
      }
      const { series } = body;
      if (!series || series.version !== 1 || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(series.id ?? '')) return send(400, { error: 'missing or invalid series' });
      const written = await writeEpisode(series);
      if (!written.episode) {
        console.error(`[server] episode ${series.episode + 1} unavailable: ${written.message}`);
        return send(503, { error: written.reason, message: written.message });
      }
      console.error(`[server] episode ${series.episode + 1} written by ${written.source} in ${Date.now() - t0}ms`);
      return send(200, written);
    }
    send(404, { error: 'not found' });
  } catch (err) {
    console.error('[server]', err);
    send(500, { error: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.error(`[server] writer proxy on http://localhost:${PORT} — ${llmAvailable() ? `LLM: ${model()}` : 'no API key: stored shows only'}`);
});
