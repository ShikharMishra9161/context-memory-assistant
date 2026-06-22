import React, { useEffect, useState } from "react";

const API_URL = "http://localhost:4000";

function App() {
  const [memories, setMemories] = useState([]);

  async function fetchMemories() {
    try {
      const res = await fetch(`${API_URL}/memory`);
      const data = await res.json();
      setMemories(data);
    } catch (err) {
      console.error("Failed to load memories", err);
    }
  }

  useEffect(() => {
    fetchMemories();
  }, []);

  return (
    <div style={{ padding: "20px" }}>
      <h1>Context Memory Dashboard</h1>

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