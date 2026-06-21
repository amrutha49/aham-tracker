// --- BIRD'S EYE VIEW STREAM CONTROLLER ---
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : 'https://aham-tracker.onrender.com/api';

// 🎯 Secured active authentication session token
const USER_AUTH_TOKEN = localStorage.getItem('aham_jwt_access_token'); 

console.log("🦅 Timeline Engine Initializing...");

// Clean Security Redirect Layer
if (!USER_AUTH_TOKEN) {
    console.warn("⚠️ Security Alert: No authorization token found. Redirecting to login...");
    window.location.href = 'index.html'; 
}

// Pagination Tracking State
let currentSkip = 0;
const entriesPerPage = 15; // Sequentially stream 15 entries per page scroll trigger
let isPageLoading = false;
let hasMoreEntries = true;

// DOM Targets
const streamWrapper = document.getElementById('timeline-stream-wrapper');
const scrollSentinel = document.getElementById('infinite-scroll-sentinel');
const loaderText = document.getElementById('sentinel-loader-text');

async function fetchAndRenderTimelinePage() {
    // Escape condition if a fetch is active or there are no more records in the database
    if (isPageLoading || !hasMoreEntries) return;
    
    isPageLoading = true;
    if (loaderText) loaderText.style.display = 'block';

    try {
        console.log(`📡 Streaming page chunk - Skip pointer: ${currentSkip}, Limit: ${entriesPerPage}`);
        
        const response = await fetch(`${BACKEND_URL}/timeline-stream?limit=${entriesPerPage}&skip=${currentSkip}`, {
            headers: { 'Authorization': `Bearer ${USER_AUTH_TOKEN}` }
        });
        
        if (!response.ok) throw new Error("Timeline stream segment database rejection");
        const data = await response.json();
        
        const chunk = data.history || [];
        hasMoreEntries = data.hasMore;

        // Clear out the static "Loading your life timeline..." layout string on initial chunk pass
        if (currentSkip === 0) {
            streamWrapper.innerHTML = "";
        }

        // Defensive layout: If the entire user account history array is completely blank
        if (currentSkip === 0 && chunk.length === 0) {
            streamWrapper.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <p style="color: #94a3b8; font-style: italic; font-size: 1rem; margin-bottom: 15px;">No historical snapshots generated yet.</p>
                    <a href="index.html" style="color: #f472b6; font-weight: 600; text-decoration: none;">Complete your first daily entry to start your stream →</a>
                </div>`;
            if (loaderText) loaderText.style.display = 'none';
            return;
        }

        // Dynamically iterate and append items to our page wrapper view
        chunk.forEach(log => {
            const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
            const displayDate = new Date(log.date + 'T00:00:00').toLocaleDateString('en-US', options);
            const textSnapshot = log.aiAnalysisResult?.keyEvent || "Completed daily entry cycle and synchronized active identity traits.";

            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                flex-direction: column;
                padding: 16px 20px;
                background: rgba(16, 22, 42, 0.7);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-left: 4px solid #f472b6;
                border-radius: 16px;
                margin-bottom: 16px;
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
            `;

            row.innerHTML = `
                <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 6px;">
                    ${displayDate}
                </span>
                <span style="font-size: 1rem; line-height: 1.6; color: #f3f4f6; font-weight: 500;">
                    "${textSnapshot}"
                </span>
            `;
            streamWrapper.appendChild(row);
        });

        // Increment pagination step cursor coordinates
        currentSkip += entriesPerPage;

    } catch (err) {
        console.error("❌ Errors loading timeline block stream slice:", err);
        if (currentSkip === 0) {
            streamWrapper.innerHTML = `<p style="color: #f87171; font-weight: bold; text-align: center; margin-top: 20px;">⚠️ Failed to load timeline data.</p>`;
        }
    } finally {
        isPageLoading = false;
        if (loaderText) loaderText.style.display = 'none';
    }
}

// --- INITIALIZE MODERN INTERSECTION OBSERVER TRIPWIRE ---
const observer = new IntersectionObserver((entries) => {
    const tripwire = entries[0];
    // Trigger only if the element enters our scrolling window and data remains to parse
    if (tripwire.isIntersecting && hasMoreEntries && !isPageLoading) {
        fetchAndRenderTimelinePage();
    }
}, {
    root: null, // Scans visibility boundaries relative to the main viewport window
    rootMargin: '100px', // Prefetches next chunk 100px before reaching page edge for zero load lag
    threshold: 0.1
});

// Fast lock tripwire initialization pass
if (scrollSentinel) {
    observer.observe(scrollSentinel);
}