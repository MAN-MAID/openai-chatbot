import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ reply: "Missing message in request." });
    }

    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID,
    });

    let runStatus;
    do {
      await new Promise((r) => setTimeout(r, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    } while (runStatus.status !== "completed");

    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessage = messages.data.find((msg) => msg.role === "assistant");

    res.json({ reply: lastMessage.content[0].text.value });

  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ reply: "An error occurred." });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
