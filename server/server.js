import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI || '';
if (!mongoUri) {
  console.error('Missing MONGODB_URI in environment');
}

mongoose
  .connect(mongoUri, { dbName: process.env.MONGODB_DB || undefined })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Mongoose Schema & Model
const SavedTipSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    icon_keyword: { type: String, required: true },
    explanation_long: { type: String, required: true },
    steps: { type: [String], required: true },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    age: { type: Number, required: true },
    gender: { type: String, required: true },
    goal: { type: String, required: true },
    saved_tips: { type: [SavedTipSchema], default: [] },
  },
  { timestamps: true }
);

const User = mongoose.model('User', UserSchema);

// Gemini Client
const geminiApiKey = process.env.GEMINI_API_KEY || '';
if (!geminiApiKey) {
  console.error('Missing GEMINI_API_KEY in environment');
}
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Helpers: Schema-constrained generation
async function generateTips({ age, gender, goal }) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `You are an engaging, highly-personalized wellness coach. Generate exactly 5 distinct, actionable health tips for a user who is a ${gender} of ${age} years old, with the primary goal of ${goal}. For each tip, provide a concise title (max 5 words) and a single keyword suitable for fetching a related icon (e.g., 'sleep', 'water', 'weights'). Ensure the titles are engaging and fit a scrollable card.`;

  const schema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        tip_id: { type: 'integer', description: 'A unique, sequential ID (1 to 5) for this set of tips.' },
        title: { type: 'string', description: 'A concise, engaging title for the card (5 words max).' },
        icon_keyword: { type: 'string', description: "A single noun or verb to represent the tip visually (e.g., 'run', 'apple', 'book')." }
      },
      required: ['tip_id', 'title', 'icon_keyword']
    }
  };

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  });

  const text = result.response.text();
  return JSON.parse(text);
}

async function generateTipDetail({ age, gender, goal, tipTitle }) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `The user, a ${gender} of ${age} years old aiming for ${goal}, has selected the tip: '${tipTitle}'. Provide a longer explanation (2-3 detailed paragraphs) on the 'why' and 'how' of this tip, followed by 5 clear, numbered, step-by-step instructions the user can immediately implement today. Focus on practical, beginner-friendly advice.`;

  const schema = {
    type: 'object',
    properties: {
      explanation_long: { type: 'string', description: 'The detailed explanation of the tip (2-3 paragraphs).' },
      steps: { type: 'array', description: 'An array of 5 clear, numbered, actionable instructions.', items: { type: 'string' } }
    },
    required: ['explanation_long', 'steps']
  };

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  });

  const text = result.response.text();
  return JSON.parse(text);
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Routes
// 1) Save initial profile
app.post('/api/profile', async (req, res) => {
  try {
    const { age, gender, goal } = req.body || {};
    if (typeof age !== 'number' || !gender || !goal) {
      return res.status(400).json({ error: 'Missing or invalid fields: age (number), gender, goal' });
    }

    const user = await User.create({ age, gender, goal });
    return res.json({ userId: user._id.toString() });
  } catch (err) {
    console.error('POST /api/profile error:', err);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

// 2) Generate tips
app.post('/api/tips/generate', async (req, res) => {
  try {
    const { age, gender, goal } = req.body || {};
    if (typeof age !== 'number' || !gender || !goal) {
      return res.status(400).json({ error: 'Missing or invalid fields: age (number), gender, goal' });
    }
    const tips = await generateTips({ age, gender, goal });
    return res.json({ tips });
  } catch (err) {
    console.error('POST /api/tips/generate error:', err);
    return res.status(500).json({ error: 'Failed to generate tips' });
  }
});

// 3) Tip detail
app.post('/api/tips/detail', async (req, res) => {
  try {
    const { age, gender, goal, tip_title } = req.body || {};
    if (typeof age !== 'number' || !gender || !goal || !tip_title) {
      return res.status(400).json({ error: 'Missing or invalid fields: age (number), gender, goal, tip_title' });
    }
    const detail = await generateTipDetail({ age, gender, goal, tipTitle: tip_title });
    return res.json(detail);
  } catch (err) {
    console.error('POST /api/tips/detail error:', err);
    return res.status(500).json({ error: 'Failed to generate tip detail' });
  }
});

// 4) Save a favorite tip
app.post('/api/tips/save', async (req, res) => {
  try {
    const { userId, tip } = req.body || {};
    if (!userId || !tip) {
      return res.status(400).json({ error: 'Missing userId or tip' });
    }

    const { title, icon_keyword, explanation_long, steps } = tip;
    if (!title || !icon_keyword || !explanation_long || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'Invalid tip payload' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.saved_tips.push({ title, icon_keyword, explanation_long, steps });
    await user.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/tips/save error:', err);
    return res.status(500).json({ error: 'Failed to save tip' });
  }
});

// 5) Load saved tips
app.get('/api/tips/saved/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ saved_tips: user.saved_tips || [] });
  } catch (err) {
    console.error('GET /api/tips/saved/:userId error:', err);
    return res.status(500).json({ error: 'Failed to load saved tips' });
  }
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

export { app, User };

