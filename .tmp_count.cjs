const fs = require('fs');
const p = '\\\\?\\C:\\Users\\user\\AppData\\Roaming\\Claude\\local-agent-mode-sessions\\83a55e99-e409-4d5c-9ae0-27ba353837fd\\3beb8ff8-32fd-4e2b-954a-5e883c169bc6\\local_66b2b360-ea87-4365-90d3-c73280a17af8\\.claude\\projects\\C--Users-user-AppData-Roaming-Claude-local-agent-mode-sessions-83a55e99-e409-4d5c-9ae0-27ba353837fd-3beb8ff8-32fd-4e2b-954a-5e883c169bc6-local-66b2b360-ea87-4365-90d3-c73280a17af8-outputs\\96db861b-d736-4120-ab49-a4cd8646ae1e\\tool-results\\mcp-8ea9ee37-7825-4b52-b6f1-96aa75f31b39-get_edge_function-1777027550070.txt';
try {
  const s = fs.readFileSync(p, 'utf8');
  const m = s.match(/log_sos_audit/g);
  console.log('count=' + (m ? m.length : 0));
} catch (e) {
  console.log('err=' + e.message);
}
