import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Connect to Cloud MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("🍃 Hooked into Cloud MongoDB safely!"))
    .catch(err => console.error("Database connection failure:", err));

// --- SECURE USER SCHEMA ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    activeTraits: { type: Array, default: [] },
    attainedTraits: { type: Array, default: [] },
    history: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);

// Initialize Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- SECURITY MIDDLEWARE: Token Verification ---
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Access denied. Login required." });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(404).json({ error: "User profile no longer exists." });
        
        req.userSandbox = user;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Session expired or invalid token." });
    }
}

// --- AUTHENTICATION ENDPOINTS ---

// Secure Registration (Signup)
app.post('/api/auth/signup', async (req, res) => {
    const { username, password } = req.body;
    try {
        if (!username || !password || password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters long." });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: "Username is already taken." });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create({
            username,
            password: hashedPassword
        });

        const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: "Account registration failed." });
    }
});

// Secure Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: "Invalid username or password." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid username or password." });

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: "Login authentication processing failure." });
    }
});

// --- CORE APPLICATION ENDPOINTS ---

app.get('/api/state', authenticateToken, (req, res) => {
    res.json(req.userSandbox);
});

app.post('/api/traits', authenticateToken, async (req, res) => {
    const { activeTraits, attainedTraits } = req.body;
    try {
        const db = req.userSandbox;
        if (activeTraits) db.activeTraits = activeTraits;
        if (attainedTraits) db.attainedTraits = attainedTraits;
        
        await db.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to update trait structures." });
    }
});

app.post('/api/analyze-day', authenticateToken, async (req, res) => {
    const { date, morningData, eveningData } = req.body;
    try {
        const db = req.userSandbox;

        if (!db.activeTraits || db.activeTraits.length === 0) {
            return res.status(400).json({ error: "No traits configured to analyze." });
        }

        const activeTraitsList = db.activeTraits.map(t => t.name).join(', ');

        const systemPrompt = `You are a helpful personal tracking assistant. Read the user's morning and evening journal entries. Evaluate how well they demonstrated or embodied these traits today: [${activeTraitsList}]. 
        For each trait, calculate a score change between -10 and +20 points. Provide a short 1-sentence friendly explanation of the change in plain English.
        Then, add an overall practical coaching advice tip for tomorrow starting with an action verb.
        Return your response strictly as a clean JSON object structure with no markdown formatting:
        {"scores":{"trait_name":{"delta":10,"rationale":"Your short explanation"}},"directive":"Your advice statement"}`;

        const payloadContext = { activeTraits: db.activeTraits, morningData, eveningData };

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `${systemPrompt}\n\nUser Data:\n${JSON.stringify(payloadContext)}`,
            config: { responseMimeType: "application/json" }
        });

        let textResponse = response.text.trim();
        if (textResponse.startsWith("```json")) {
            textResponse = textResponse.substring(7, textResponse.length - 3).trim();
        }
        
        const aiResult = JSON.parse(textResponse);

        let fullyAttainedTraitsThisTurn = [];
        db.activeTraits.forEach(trait => {
            const aiData = aiResult.scores[trait.name] || aiResult.scores[trait.name.toLowerCase()] || { delta: 0, rationale: "Tracked smoothly." };
            trait.score = Math.max(0, Math.min(100, trait.score + aiData.delta));
            if (trait.score >= 100) fullyAttainedTraitsThisTurn.push(trait.name);
        });

        if (fullyAttainedTraitsThisTurn.length > 0) {
            fullyAttainedTraitsThisTurn.forEach(name => {
                if (!db.attainedTraits.includes(name)) db.attainedTraits.push(name);
                db.activeTraits = db.activeTraits.filter(t => t.name !== name);
            });
        }

        const newHistoryLog = {
            date: date || new Date().toISOString().split('T')[0],
            morningData,
            eveningData,
            aiAnalysisResult: aiResult,
            snapshotScores: [...db.activeTraits]
        };

        db.history = db.history.filter(item => item.date !== newHistoryLog.date);
        db.history.push(newHistoryLog);

        db.markModified('activeTraits');
        db.markModified('attainedTraits');
        db.markModified('history');

        await db.save();
        res.json({ success: true, stateUpdate: db, newLog: newHistoryLog });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to handle backend AI analysis lifecycle." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 AHAM Secure Server running cleanly on http://localhost:${PORT}`);
});