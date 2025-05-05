import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const assistantId = process.env.ASSISTANT_ID;

let threadId = null; // Global thread ID to persist conversation

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  try {
    // Create thread if it's not already created
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      console.log("Created new thread:", threadId);
    }

    // Add user message to thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // Run the assistant on that thread
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    // Poll until run completes
    let runStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 1500));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    } while (runStatus.status !== "completed");

    // Get assistant's reply
    const messages = await openai.beta.threads.messages.list(threadId);
    const reply = messages.data
      .filter(m => m.role === "assistant")
      .map(m => m.content[0].text.value)
      .join("\n");

    res.json({ reply });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/", (req, res) => {
  res.send("Assistant is live");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
