import React, { useEffect, useState } from "react";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:4000";
const TOKEN_KEY = "cma.dashboardToken";

// The backend scopes data to the extension's access token
// (extension popup → Settings → Access token → Copy).
function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [memories, setMemories] = useState([]);
  const [handoffs, setHandoffs] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^[a-f0-9]{64}$/i.test(token)) return;
    const headers = { Authorization: `Bearer ${token}` };
    async function load() {
      try {
        setError("");
        const [m, h] = await Promise.all([
          fetch(`${API_URL}/memory`, { headers }),
          fetch(`${API_URL}/handoffs`, { headers }),
        ]);
        if (!m.ok && !h.ok) throw new Error(`HTTP ${m.status}`);
        setMemories(m.ok ? await m.json() : []);
        setHandoffs(h.ok ? (await h.json()).items : []);
      } catch (err) {
        setError(`Failed to load data: ${err.message}`);
      }
    }
    load();
  }, [token]);

  function saveToken(value) {
    setToken(value.trim());
    localStorage.setItem(TOKEN_KEY, value.trim());
  }

  return (
    <div style={{ padding: "20px" }}>
      <h1>Context Memory Dashboard</h1>

      <label>
        Access token (from the extension's Settings):{" "}
        <input type="password" value={token} onChange={(e) => saveToken(e.target.value)} style={{ width: 420 }} />
      </label>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h2>Saved handoffs</h2>
      {handoffs.length === 0 ? (
        <p>No synced handoffs found</p>
      ) : (
        <ul>
          {handoffs.map((h) => (
            <li key={h.id} style={{ marginBottom: "12px" }}>
              <strong>{h.title}</strong> {h.projectName && <em>({h.projectName})</em>}
              <br />
              <small>
                {h.messageCount} messages · {h.complete ? "no gaps detected" : "partial"} · updated {new Date(h.updatedAt).toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      )}

      <h2>Recent Memories</h2>

      {memories.length === 0 ? (
        <p>No memories found</p>
      ) : (
        <ul>
          {memories.map((memory) => (
            <li key={memory._id} style={{ marginBottom: "16px" }}>
              <strong>{memory.title}</strong>
              <p>{memory.content}</p>
              <small>Category: {memory.category}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;
