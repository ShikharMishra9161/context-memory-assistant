import { useState, useEffect } from "react";
import MemoryList from "./components/MemoryList";
import AddForm from "./components/AddForm";

export default function App() {
  const [memories, setMemories] = useState([]);
  const [view, setView] = useState("list");
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadMemories();
  }, []);
  async function sendMessage(msg) {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.sendMessage
    ) {
      return chrome.runtime.sendMessage(msg);
    }
    // Dev fallback to backend HTTP endpoints
    if (msg.type === "GET_MEMORIES") {
      const res = await fetch("http://localhost:4000/memory");
      return res.json();
    }
    if (msg.type === "SAVE_MEMORY") {
      const res = await fetch("http://localhost:4000/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload),
      });
      return res.json();
    }
    if (msg.type === "DELETE_MEMORY") {
      const res = await fetch(`http://localhost:4000/memory/${msg.id}`, {
        method: "DELETE",
      });
      return res.json();
    }
    if (msg.type === "SYNC_MEMORIES") {
      const res = await fetch("http://localhost:4000/memory/sync");
      return res.json();
    }
    return {};
  }

  async function loadMemories() {
    const { memories } = await sendMessage({ type: "GET_MEMORIES" });
    setMemories(memories || []);
  }

  async function sync() {
    setSyncing(true);
    const { memories } = await sendMessage({ type: "SYNC_MEMORIES" });
    setMemories(memories || []);
    setSyncing(false);
  }

  async function handleAdd(data) {
    await sendMessage({ type: "SAVE_MEMORY", payload: data });
    setView("list");
    await loadMemories();
  }

  async function handleDelete(id) {
    await sendMessage({ type: "DELETE_MEMORY", id });
    setMemories((prev) => prev.filter((m) => m._id !== id));
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-indigo-400 font-bold text-base">
          🧠 Context Memory
        </h1>
        <div className="flex gap-2">
          <button
            onClick={sync}
            className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-md transition-colors"
          >
            {syncing ? "⟳" : "↺"} Sync
          </button>
          <button
            onClick={() => setView(view === "add" ? "list" : "add")}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-md transition-colors"
          >
            {view === "add" ? "← Back" : "+ Add"}
          </button>
        </div>
      </div>

      {view === "add" ? (
        <AddForm onSave={handleAdd} />
      ) : (
        <MemoryList
          memories={memories}
          filter={filter}
          setFilter={setFilter}
          onDelete={handleDelete}
        />
      )}

      <p className="text-[10px] text-slate-600 text-center">
        {memories.length} memories saved
      </p>
    </div>
  );
}
