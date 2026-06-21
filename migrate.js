import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

if (!process.env.MONGODB_URI || !process.env.GEMINI_API_KEY) {
    console.error("❌ Migration failed: Missing MONGODB_URI or GEMINI_API_KEY in .env");
    process.exit(1);
}

// Re-declare schema locally for isolation
const userSchema = new mongoose.Schema({
    username: String,
    history: { type: Array, default: [] }
});
const User = mongoose.model('User', userSchema);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CRISP_SUMMARY_PROMPT_INSTRUCTIONS = 
    "Identify the SINGLE most important, memorable, or defining real-world event or activity of the user's day from this text. " +
    "Distill it into a ultra-short, simple, objective one-sentence log starting with a dynamic past-tense verb. " +
    "🎯 MAXIMUM LENGTH CONSTRAINT: Keep the summary under 6 to 10 words total (e.g., 'Visited Half Moon Bay with my husband'). " +
    "❌ CRITICAL RESTRICTION: Absolutely avoid flowery, dramatic, or generic AI meta-language. " +
    "Keep it entirely factual, minimal, and grounded. " +
    "Return your response strictly as a clean JSON object structure with no markdown formatting: " +
    "{\"keyEvent\": \"Your clean summary string here\"}";

async function runOneTimeMigration() {
    console.log("🚀 Connecting to Cloud MongoDB Atlas for manual migration script execution...");
    await mongoose.connect(process.env.MONGODB_URI);
    
    try {
        const users = await User.find({});
        console.log(` Auditing ${users.length} production user profiles...`);
        let globalMigrationCount = 0;

        for (let user of users) {
            let userNeedsSaving = false;

            for (let log of user.history) {
                const currentSummaryText = log.aiAnalysisResult?.keyEvent || "";
                const wordCount = currentSummaryText.split(/\s+/).filter(Boolean).length;
                
                const isMissing = !log.aiAnalysisResult?.keyEvent;
                const isTooLong = wordCount > 10;

                if (isMissing || isTooLong) {
                    console.log(`⚠️  Flagged long summary (${wordCount} words) for ${user.username} on ${log.date}. Cleaning...`);
                    
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
                    userNeedsSaving = true;
                    globalMigrationCount++;
                    console.log(`   ✨ Success -> "${parsedResult.keyEvent}"`);
                }
            }

            if (userNeedsSaving) {
                user.markModified('history');
                await user.save();
                console.log(`💾 Persisted structural updates cleanly to: ${user.username}`);
            }
        }
        console.log(`\n🎉 Data migration pipeline ran flawlessly. Fixed ${globalMigrationCount} historical log streams total.`);
    } catch (err) {
        console.error("❌ Critical fault during isolated migration script run:", err);
    } finally {
        console.log("🔌 Disconnecting from database safely...");
        await mongoose.disconnect();
        console.log("🏁 Process complete. Exiting thread.");
        process.exit(0);
    }
}

runOneTimeMigration();