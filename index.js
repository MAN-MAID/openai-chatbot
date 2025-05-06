// index.js
import express from "express";
import cors   from "cors";
import dotenv from "dotenv";
import fetch  from "node-fetch";         // npm i node-fetch
import { OpenAI } from "openai";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const openai      = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = process.env.ASSISTANT_ID;
let   threadId    = null;

// Utility: ensure we have a thread
async function ensureThread() {
  if (!threadId) {
    const t = await openai.beta.threads.create();
    threadId = t.id;
  }
  return threadId;
}

app.post("/chat", async (req, res) => {
  try {
    let { message, fileUrl } = req.body;
    if (!message && !fileUrl) {
      return res.status(400).json({ error: "Need message or fileUrl." });
    }

    const tid = await ensureThread();

    // If there's a fileUrl, fetch + upload to OpenAI Files
    if (fileUrl) {
      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error("Couldn’t fetch file");
      const buffer = await resp.arrayBuffer();
      const up = await openai.files.create({
        file: Buffer.from(buffer),
        purpose: "vision"   // or "assistants" if your assistant is set up for files
      });

      // tell the thread a file arrived
      await openai.beta.threads.messages.create(tid, {
        role:    "user",
        content: "Here’s a file for you to analyse.",
        file_ids: [ up.id ],
      });
    }

    // Send any plain‐text user message
    if (message) {
      await openai.beta.threads.messages.create(tid, {
        role:    "user",
        content: message
      });
    }

    // Run the assistant
    const run = await openai.beta.threads.runs.create(tid, {
      assistant_id: assistantId
    });

    // Poll until done
    let status;
    do {
      await new Promise(r => setTimeout(r, 1000));
      status = await openai.beta.threads.runs.retrieve(tid, run.id);
    } while (status.status !== "completed");

    // Pull out the assistant’s last message
    const msgs  = await openai.beta.threads.messages.list(tid);
    const reply = msgs.data
      .filter(m => m.role === "assistant")
      .map(m => m.content[0].text.value)
      .join("\n");

    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT||3000, () =>
  console.log("🚀 Running on port", process.env.PORT||3000)
);
