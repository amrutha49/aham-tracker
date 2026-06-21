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

// --- MONGOOSE ATLAS CONNECTION ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("Hooked into Cloud MongoDB safely!"))
    .catch(err => console.error("Database connection failure:", err));

// --- USER DATABASE SCHEMA ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    activeTraits: { type: Array, default: [] },
    attainedTraits: { type: Array, default: [] },
    traitsLockedAt: { type: Date, default: null }, 
    currentMorningLog: {
        date: { type: String, default: "" },
        grateful: { type: String, default: "" },
        great: { type: String, default: "" },
        affirmations: { type: Array, default: [] }
    },
    history: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);

// Initialize Gemini Core Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });


const CRISP_SUMMARY_PROMPT_INSTRUCTIONS = 
    "Identify the SINGLE most important, memorable, or defining real-world event or activity of the user's day from this text. " +
    "Distill it into a ultra-short, simple, objective one-sentence log starting with a dynamic past-tense verb. " +
    "🎯 MAXIMUM LENGTH CONSTRAINT: Keep the summary under 6 to 10 words total (e.g., 'Visited Half Moon Bay with my husband' or 'Completed Week 3 MIT course'). " +
    "❌ CRITICAL RESTRICTION: Absolutely avoid flowery, dramatic, or generic AI meta-language. " +
    "Do NOT use words like: 'joyfully', 'reveling', 'profound', 'embarked', 'testament', 'journey', 'significance', 'concluded a significant academic milestone', 'including its essay'. " +
    "Keep it entirely factual, minimal, and grounded—exactly how a human would write a quick calendar note. " +
    "Return your response strictly as a clean JSON object structure with no markdown formatting: " +
    "{\"keyEvent\": \"Your clean summary string here\"}";

// --- JWT AUTHENTICATION MIDDLEWARE ---
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

// --- GATEWAY AUTHENTICATION CONTROLLERS ---
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

        const newUser = await User.create({ username, password: hashedPassword });
        const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ success: true, token });
    } catch (err) { 
        res.status(500).json({ error: "Account registration failed." }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: "Invalid username or password." });
        }

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token });
    } catch (err) { 
        res.status(500).json({ error: "Login authentication processing failure." }); 
    }
});

// --- MAIN CONTENT GATEWAY ROUTERS ---

app.get('/api/state', authenticateToken, async (req, res) => {
    try {
        const db = req.userSandbox;
        const todayStr = req.query.localDate;

        if (!todayStr) {
            return res.status(400).json({ error: "Missing localDate query parameter string." });
        }
        
        if (db.currentMorningLog && db.currentMorningLog.date && db.currentMorningLog.date !== todayStr) {
            console.log(`New day detected (${todayStr}). Clearing outdated morning log database buffers...`);
            const resetPayload = { date: "", grateful: "", great: "", affirmations: ["", "", ""] };
            
            const updatedUser = await User.findOneAndUpdate(
                { _id: db._id },
                { $set: { currentMorningLog: resetPayload } },
                { returnDocument: 'after' }
            );
            return res.json(updatedUser);
        }
        
        res.json(db);
    } catch (err) {
        console.error("State gateway sync crash:", err);
        res.status(500).json({ error: "State evaluation failure." });
    }
});

app.post('/api/traits', authenticateToken, async (req, res) => {
    const { activeTraits, attainedTraits, lockAction } = req.body;
    try {
        const db = req.userSandbox;
        const updatePayload = {};
        
        if (db.traitsLockedAt && !lockAction) {
            const daysElapsed = (new Date() - new Date(db.traitsLockedAt)) / (1000 * 60 * 60 * 24);
            if (daysElapsed < 21 && activeTraits && activeTraits.length < db.activeTraits.length) {
                return res.status(403).json({ error: "Identity Matrix is structurally locked for 21 days." });
            }
        }

        if (activeTraits) updatePayload.activeTraits = activeTraits;
        if (attainedTraits) updatePayload.attainedTraits = attainedTraits;
        if (lockAction) updatePayload.traitsLockedAt = new Date();

        const updatedUser = await User.findOneAndUpdate(
            { _id: db._id },
            { $set: updatePayload },
            { returnDocument: 'after', runValidators: true }
        );

        res.json({ 
            success: true, 
            traitsLockedAt: updatedUser.traitsLockedAt, 
            activeTraits: updatedUser.activeTraits 
        });
    } catch (err) {
        console.error("Trait synchronization crash logic:", err);
        res.status(500).json({ error: "Failed to update trait structures." });
    }
});

app.post('/api/morning-entry', authenticateToken, async (req, res) => {
    const { grateful, great, affirmations } = req.body;
    const todayStr = new Date().toLocaleDateString('en-CA');
    try {
        const db = req.userSandbox;
        db.currentMorningLog = {
            date: todayStr,
            grateful: grateful || "",
            great: great || "",
            affirmations: affirmations || []
        };
        await db.save();
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: "Failed to save cloud morning log entry buffers." }); 
    }
});

app.post('/api/analyze-day', authenticateToken, async (req, res) => {
    const { morningData, eveningData, localDate } = req.body;
    const todayStr = localDate || new Date().toLocaleDateString('en-CA');
    
    try {
        const db = req.userSandbox;
        if (!db.activeTraits || db.activeTraits.length === 0) {
            return res.status(400).json({ error: "No active traits configured to analyze." });
        }

        const activeTraitsList = db.activeTraits.map(t => t.name).join(', ');
        
        const systemPrompt = "You are a personal tracking assistant. Read the user's morning and evening journal reflections. " +
            "1. Evaluate how well they demonstrated these traits today: [" + activeTraitsList + "]. Calculate a score change between -10 and +20 points. " +
            "2. Extract an overall practical coaching advice tip for tomorrow starting with an action verb. " +
            "3. " + CRISP_SUMMARY_PROMPT_INSTRUCTIONS + " " +
            "Return your response strictly as a clean JSON object structure with no markdown formatting: " +
            "{" +
              "\"scores\": {\"trait_name\": {\"delta\": 10, \"rationale\": \"Your short explanation\"}}," +
              "\"directive\": \"Your advice statement\"," +
              "\"keyEvent\": \"Your one-sentence summary string here\"" +
            "}";

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: systemPrompt + "\n\nUser Data:\n" + JSON.stringify({ activeTraits: db.activeTraits, morningData, eveningData }),
            config: { responseMimeType: "application/json" }
        });

        let textResponse = response.text.trim();
        if (textResponse.startsWith("```json")) textResponse = textResponse.substring(7, textResponse.length - 3).trim();
        const aiResult = JSON.parse(textResponse);

        db.activeTraits.forEach(trait => {
            const aiData = aiResult.scores[trait.name] || aiResult.scores[trait.name.toLowerCase()] || { delta: 0 };
            trait.score = Math.max(0, Math.min(100, trait.score + aiData.delta));
        });

        const newHistoryLog = {
            date: todayStr,
            morningData,
            eveningData,
            aiAnalysisResult: aiResult,
            snapshotScores: [...db.activeTraits]
        };

        db.history = db.history.filter(item => item.date !== todayStr);
        db.history.push(newHistoryLog);
        db.currentMorningLog = { date: "", grateful: "", great: "", affirmations: [] };

        db.markModified('activeTraits');
        db.markModified('history');

        await db.save();
        res.json({ success: true, stateUpdate: db, newLog: newHistoryLog });
    } catch (error) { 
        console.error(error);
        res.status(500).json({ error: "Failed to compile semantic snapshot overview." }); 
    }
});

// --- RE-INDEXER ---
app.post('/api/migrate-timeline', authenticateToken, async (req, res) => {
    try {
        const db = req.userSandbox;
        if (!db.history || db.history.length === 0) return res.json({ message: "No historical logs found to migrate." });

        console.log("Starting timeline summary migration check for " + db.history.length + " logs...");

        for (let log of db.history) {
            const oldSummaryText = log.aiAnalysisResult?.keyEvent || "";
            const isOverlyDramatic = BANNED_AI_WORDS_REGEX.test(oldSummaryText);
            const isMissing = !log.aiAnalysisResult?.keyEvent;

            if (isMissing || isOverlyDramatic) {
                const morningText = JSON.stringify(log.morningData || {});
                const eveningText = JSON.stringify(log.eveningData || {});

                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: CRISP_SUMMARY_PROMPT_INSTRUCTIONS + "\n\nJournal Content:\nMorning: " + morningText + "\nEvening: " + eveningText,
                    config: { responseMimeType: "application/json" }
                });

                let textResponse = response.text.trim();
                if (textResponse.startsWith("```json")) textResponse = textResponse.substring(7, textResponse.length - 3).trim();
                
                const parsedResult = JSON.parse(textResponse);
                if (!log.aiAnalysisResult) log.aiAnalysisResult = {};
                log.aiAnalysisResult.keyEvent = parsedResult.keyEvent;
                console.log("✨ Re-indexed manual row for " + log.date + ": " + parsedResult.keyEvent);
            }
        }

        db.markModified('history');
        await db.save();
        res.json({ success: true, message: "All history metrics aligned smoothly." });
    } catch (err) {
        console.error("Migration Route Error:", err);
        res.status(500).json({ error: "Failed to backfill historical milestones." });
    }
});

// --- 💎 HIGH-PERFORMANCE INFINITE SCROLL TIMELINE STREAM ---
app.get('/api/timeline-stream', authenticateToken, async (req, res) => {
    try {
        const db = req.userSandbox;
        
        const limit = parseInt(req.query.limit) || 15;
        const skip = parseInt(req.query.skip) || 0;

        const sortedHistory = [...db.history].sort((a, b) => new Date(b.date) - new Date(a.date));
        const historyPageSlice = sortedHistory.slice(skip, skip + limit);
        const hasMore = skip + limit < db.history.length;

        res.json({
            history: historyPageSlice,
            hasMore
        });
    } catch (err) {
        console.error("❌ Timeline stream server breakdown:", err);
        res.status(500).json({ error: "Failed to stream timeline chunk." });
    }
});

// --- SERVER INITIALIZATION ---
app.listen(PORT, () => console.log("AHAM Engine Processing cleanly on port " + PORT));