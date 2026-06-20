import React, { useEffect, useState } from "react";

function App() {
  const [memories, setMemories] = useState([]);

  useEffect(() => {
    setMemories([
      {
        id: "1",
        url: "https://example.com",
        text: "Sample memory note",
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  return (
    <div className="app-container">
      <header>
        <h1>Context Memory Dashboard</h1>
      </header>
      <main>
        <section>
          <h2>Recent Memories</h2>
          <ul>
            {memories.map((memory) => (
              <li key={memory.id}>
                <strong>{memory.url}</strong>
                <p>{memory.text}</p>
                <time>{new Date(memory.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default App;
