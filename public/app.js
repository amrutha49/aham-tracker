const BACKEND_URL = "/api";
let USER_AUTH_TOKEN = localStorage.getItem('aham_jwt_access_token');

// Global Frontend Core State Manager Mapping
const state = {
    activeTraits: [],
    attainedTraits: [],
    isLocked: false,
    traitsLockedAt: null,
    morningSaved: false,
    morningData: { grateful: "", great: "", affirmations: ["", "", ""] },
    eveningData: { highlights: "", lessons: "" },
    aiAnalysisResult: null,
    history: []
};
window.state = state;
// --- DOM ELEMENTS HOOKS ---
const authOverlay = document.getElementById('auth-overlay');
const authTitle = document.getElementById('auth-title');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const authPrimaryBtn = document.getElementById('auth-primary-btn');
const authToggleLink = document.getElementById('auth-toggle-link');
const logoutBtn = document.getElementById('logout-btn');

const traitInput = document.getElementById('trait-input');
const addTraitBtn = document.getElementById('add-trait-btn');
const traitCountLabel = document.getElementById('trait-count');
const activeTraitsContainer = document.getElementById('active-blueprint-slots');
const attainedTraitsContainer = document.getElementById('attained-blueprint-slots');
const attainedTraitsCard = document.getElementById('attained-traits-card');
const activateGridBtn = document.getElementById('activate-grid-btn');

const saveMorningBtn = document.getElementById('save-morning-btn');
const submitJournalBtn = document.getElementById('submit-journal-btn');
const eveningLockOverlay = document.getElementById('evening-lock-overlay');
const eveningCard = document.getElementById('evening-card');

const analysisOutputCard = document.getElementById('analysis-output-card');
const traitsMetricsContainer = document.getElementById('traits-metrics-container');
const coachingText = document.getElementById('coaching-text');
const reportDateTitle = document.getElementById('report-date-title');
const systemStatusPill = document.getElementById('system-status-pill');

let isLoginMode = true;

// --- IDENTITY AUTHENTICATION ENGINE INTERFACES ---
authToggleLink.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    authTitle.textContent = isLoginMode ? "Welcome to AHAM" : "Create Matrix Account";
    authPrimaryBtn.textContent = isLoginMode ? "Log In" : "Register & Enter";
    document.querySelector('.auth-toggle-hint').innerHTML = isLoginMode 
        ? `Don't have an account? <span id="auth-toggle-link" onclick="toggleAuthMode()">Sign Up</span>`
        : `Already have an account? <span id="auth-toggle-link" onclick="toggleAuthMode()">Log In</span>`;
});
window.toggleAuthMode = () => authToggleLink.click();

authPrimaryBtn.addEventListener('click', async () => {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value.trim();
    if (!username || !password) return alert("Please fill out all identity credentials.");

    const endpoint = isLoginMode ? `${BACKEND_URL}/auth/login` : `${BACKEND_URL}/auth/signup`;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        localStorage.setItem('aham_jwt_access_token', data.token);
        USER_AUTH_TOKEN = data.token;
        syncStateFromServer();
    } catch (err) {
        alert(`Authentication Failed: ${err.message}`);
    }
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('aham_jwt_access_token');
    USER_AUTH_TOKEN = null;
    location.reload();
});

// --- CLIENT ROUTING TABS CONTROLLER ---
document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => {
        const targetViewId = button.getAttribute('data-target');
        document.querySelectorAll('.view-panel').forEach(view => {
            view.classList.toggle('active', view.id === targetViewId);
        });
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        button.classList.add('active');
    });
});

// --- OPTIMIZED LIVE EDIT SAVING ENGINE ---
function getMorningInputsData() {
    const affs = [];
    document.querySelectorAll('.affirmation-input').forEach(input => affs.push(input.value));
    return {
        grateful: document.getElementById('m-grateful').value,
        great: document.getElementById('m-great').value,
        affirmations: affs
    };
}

function evaluateMorningButtonState() {
    // Prevent button changes if the entire day cycle is closed out and finalized
    const todayStr = new Date().toLocaleDateString('en-CA');
    if (state.history.some(log => log.date === todayStr)) return;

    const currentInputs = getMorningInputsData();
    const hasChanges = currentInputs.grateful !== state.morningData.grateful ||
                       currentInputs.great !== state.morningData.great ||
                       JSON.stringify(currentInputs.affirmations) !== JSON.stringify(state.morningData.affirmations);

    if (hasChanges) {
        saveMorningBtn.textContent = "Save Changes";
        saveMorningBtn.removeAttribute('disabled');
    } else {
        saveMorningBtn.textContent = "Morning Saved (Up to date)";
        saveMorningBtn.setAttribute('disabled', 'true');
    }
}

function bindMorningChangeListeners() {
    const targets = [document.getElementById('m-grateful'), document.getElementById('m-great'), ...document.querySelectorAll('.affirmation-input')];
    targets.forEach(el => {
        el.removeEventListener('input', evaluateMorningButtonState);
        el.addEventListener('input', evaluateMorningButtonState);
    });
}

// --- CLOUD DATABASING SYNCHRONIZATION ---
async function syncStateFromServer() {
    if (!USER_AUTH_TOKEN) return authOverlay.classList.remove('hidden-auth');
    authOverlay.classList.add('hidden-auth');

    try {
        // 1. Establish the precise date string for the user's current local session
        const todayStr = new Date().toLocaleDateString('en-CA');
        
        // 2. Fetch the latest user document using the local date as a verification query
        const response = await fetch(`${BACKEND_URL}/state?localDate=${todayStr}`, {
            headers: { 'Authorization': `Bearer ${USER_AUTH_TOKEN}` }
        });
        if (!response.ok) throw new Error("Session invalid");

        const serverData = await response.json();
        
        // 3. Update global memory mapping
        state.activeTraits = serverData.activeTraits || [];
        state.attainedTraits = serverData.attainedTraits || [];
        state.history = serverData.history || [];
        state.traitsLockedAt = serverData.traitsLockedAt || null;

        // 4. Evaluate the 21-day behavioral lock status
        if (state.traitsLockedAt) {
            const elapsedDays = (new Date() - new Date(state.traitsLockedAt)) / (1000 * 60 * 60 * 24);
            state.isLocked = elapsedDays < 21;
        } else {
            state.isLocked = false;
        }

        // 5. DATA CLEANING: Check if a cycle is already finished for TODAY
        const todaysLog = state.history.find(log => log.date === todayStr);
        
        // Global Pre-Reset: Default release all input blockers before evaluating specific scenarios
        toggleInputsLock(false);

        if (todaysLog) {
            /** 
             * SCENARIO A: Cycle Completed for TODAY 
             * Action: Fetch analysis from history, display it, and lock everything down.
             */
            console.log("🔒 Scenario A: Entry cycle complete for today.");
            state.morningSaved = true;
            state.aiAnalysisResult = todaysLog.aiAnalysisResult;
            renderAnalyticsOutput();
            
            // Populate fields with the completed data
            document.getElementById('m-grateful').value = todaysLog.morningData?.grateful || "";
            document.getElementById('m-great').value = todaysLog.morningData?.great || "";
            document.querySelectorAll('.affirmation-input').forEach((input, i) => {
                input.value = todaysLog.morningData?.affirmations?.[i] || "";
            });
            document.getElementById('e-highlights').value = todaysLog.eveningData?.highlights || "";
            document.getElementById('e-lessons').value = todaysLog.eveningData?.lessons || "";
            
            // Lock UI controls
            saveMorningBtn.textContent = "Today's Entry Complete";
            saveMorningBtn.setAttribute('disabled', 'true');
            submitJournalBtn.textContent = "Today's Analysis Complete";
            submitJournalBtn.setAttribute('disabled', 'true');
            
            if(eveningLockOverlay) eveningLockOverlay.style.display = 'none';
            if(eveningCard) eveningCard.classList.remove('locked-state');
            
            toggleInputsLock(true); 
        } 
        else if (serverData.currentMorningLog && serverData.currentMorningLog.date === todayStr) {
            /** 
             * SCENARIO B: Morning Entry Exists for TODAY
             * Action: Populate morning data, allow editing/saving changes, unlock evening section.
             */
            console.log("☀️ Scenario B: Morning data active for today.");
            state.morningSaved = true;
            state.aiAnalysisResult = null; // Flush any ghost analysis from yesterday
            state.morningData = {
                grateful: serverData.currentMorningLog.grateful || "",
                great: serverData.currentMorningLog.great || "",
                affirmations: serverData.currentMorningLog.affirmations || ["", "", ""]
            };

            document.getElementById('m-grateful').value = state.morningData.grateful;
            document.getElementById('m-great').value = state.morningData.great;
            document.querySelectorAll('.affirmation-input').forEach((input, i) => {
                input.value = state.morningData.affirmations[i] || "";
            });

            // Ensure evening is clean for fresh input
            document.getElementById('e-highlights').value = "";
            document.getElementById('e-lessons').value = "";
            if (analysisOutputCard) analysisOutputCard.classList.add('hidden');

            saveMorningBtn.textContent = "Morning Saved (Up to date)";
            saveMorningBtn.setAttribute('disabled', 'true');
            if(eveningLockOverlay) eveningLockOverlay.style.display = 'none';
            if(eveningCard) eveningCard.classList.remove('locked-state');
            
            submitJournalBtn.removeAttribute('disabled');
            submitJournalBtn.textContent = "Analyze My Day";
        } 
        else {
            /** 
             * SCENARIO C: CLEAN SLATE (New Day or No Entry Found)
             * Action: Wipe all fields, reset buttons, and ensure all inputs are unlocked.
             */
            console.log("✨ Scenario C: Starting fresh day cycle.");
            state.morningSaved = false;
            state.aiAnalysisResult = null; 
            state.morningData = { grateful: "", great: "", affirmations: ["", "", ""] };
            state.eveningData = { highlights: "", lessons: "" };
            
            // UI Scrubbing
            document.getElementById('m-grateful').value = "";
            document.getElementById('m-great').value = "";
            document.querySelectorAll('.affirmation-input').forEach(input => input.value = "");
            document.getElementById('e-highlights').value = "";
            document.getElementById('e-lessons').value = "";
            if (analysisOutputCard) analysisOutputCard.classList.add('hidden');

            // Reset Controls
            saveMorningBtn.textContent = "Save Morning Entry";
            saveMorningBtn.removeAttribute('disabled');
            submitJournalBtn.textContent = "Analyze My Day";
            submitJournalBtn.removeAttribute('disabled');
            
            if(eveningLockOverlay) eveningLockOverlay.style.display = 'flex';
            if(eveningCard) eveningCard.classList.add('locked-state');
        }

        // Initialize listeners and UI grid components
        bindMorningChangeListeners();
        renderIdentityGrids();
        systemStatusPill.textContent = "💚 Synced";
        
    } catch (err) {
        console.error("Sync Error:", err);
        systemStatusPill.textContent = "❌ Offline";
    }
}

// --- ENFORCED INPUT GATEKEEPER LOCK MECHANISM ---
function toggleInputsLock(shouldLock) {
    const fields = [
        document.getElementById('m-grateful'), 
        document.getElementById('m-great'),
        document.getElementById('e-highlights'), 
        document.getElementById('e-lessons'),
        ...document.querySelectorAll('.affirmation-input')
    ];
    
    fields.forEach(f => {
        if (!f) return;
        if (shouldLock) {
            f.setAttribute('disabled', 'true');
        } else {
            // THE FIX: Completely delete the disabled property from the HTML markup
            f.removeAttribute('disabled'); 
        }
    });
}

// --- TRAIT MANAGEMENT GRID COUNTDOWN LOGIC ---
async function saveTraitsToServer() {
    await fetch(`${BACKEND_URL}/traits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER_AUTH_TOKEN}` },
        body: JSON.stringify({ activeTraits: state.activeTraits, attainedTraits: state.attainedTraits })
    });
}

// --- FIXED IMMEDIATE RESPONSIVE ADD TRAIT TRAP ---
function addTrait() {
    const value = traitInput.value.trim().toLowerCase();
    if (!value) return;
    if (state.activeTraits.length >= 5) return alert("Maximum 5 traits tracking limit reached.");
    if (state.activeTraits.some(t => t.name === value) || state.attainedTraits.includes(value)) {
        return alert("Trait tracking item already active.");
    }
    
    // Push the element immediately into memory so it can't be dropped during async saves
    state.activeTraits.push({ name: value, score: 0 });
    traitInput.value = '';
    
    renderIdentityGrids();

    // FIXED OPTIMIZATION: If the user is adding traits *after* the initial 21-day lock was already active,
    // we auto-trigger a background sync to keep MongoDB up to date immediately
    if (state.traitsLockedAt && state.isLocked) {
        saveTraitsToServer();
    }
}

window.removeTrait = async (index) => {
    if (state.isLocked) return alert("Cannot delete traits during active habit window cycles.");
    state.activeTraits.splice(index, 1);
    await saveTraitsToServer();
    renderIdentityGrids();
};

function renderIdentityGrids() {
    activeTraitsContainer.innerHTML = '';
    state.activeTraits.forEach((trait, index) => {
        const li = document.createElement('li');
        li.className = 'trait-item';
        li.innerHTML = state.isLocked 
            ? `<span class="trait-name">${trait.name}</span><span class="trait-score-lbl">${trait.score}%</span>`
            : `<span class="trait-name">${trait.name}</span><div style="display:flex; gap:10px; align-items:center;"><span class="trait-score-lbl">${trait.score}%</span><button class="remove-trait-btn" onclick="removeTrait(${index})">Delete</button></div>`;
        activeTraitsContainer.appendChild(li);
    });

    attainedTraitsContainer.innerHTML = '';
    if (state.attainedTraits.length > 0) {
        attainedTraitsCard.classList.remove('hidden');
        state.attainedTraits.forEach(name => {
            const li = document.createElement('li');
            li.className = 'trait-item';
            li.innerHTML = `<span class="trait-name" style="text-decoration: line-through; opacity: 0.5;">${name}</span><span class="attained-badge">Completed</span>`;
            attainedTraitsContainer.appendChild(li);
        });
    } else {
        attainedTraitsCard.classList.add('hidden');
    }

    traitCountLabel.textContent = state.activeTraits.length;
    
    const rowElement = document.getElementById('trait-input-row');
    const countdownBanner = document.getElementById('lock-countdown-banner');
    const countdownText = document.getElementById('lock-countdown-text');

    if (state.traitsLockedAt && state.isLocked) {
        const elapsedDays = (new Date() - new Date(state.traitsLockedAt)) / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.max(0, Math.ceil(21 - elapsedDays));

        countdownText.textContent = `Identity Matrix Locked. ${daysRemaining} days left until modification window opens.`;
        countdownBanner.classList.remove('hidden');
        
        // Allow adding incremental upgrades only if slots are open under the 5 cap limit
        if (state.activeTraits.length < 5) {
            if (rowElement) rowElement.style.display = 'flex';
            activateGridBtn.textContent = "Lock Additional Traits";
            activateGridBtn.removeAttribute('disabled');
        } else {
            if (rowElement) rowElement.style.display = 'none';
            activateGridBtn.textContent = "Identity Matrix Active (Fully Locked)";
            activateGridBtn.setAttribute('disabled', 'true');
        }
    } else {
        countdownBanner.classList.add('hidden');
        if (rowElement) rowElement.style.display = 'flex';
        activateGridBtn.textContent = "Lock & Activate 21-Day Cycle";
        activateGridBtn.toggleAttribute('disabled', state.activeTraits.length === 0);
    }
}

addTraitBtn.addEventListener('click', addTrait);
traitInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addTrait(); });

// --- FIXED FRONTEND ACTIVATE ENGINE ---
activateGridBtn.addEventListener('click', async () => {
    if (state.activeTraits.length === 0) return;
    
    activateGridBtn.textContent = "⏳ Securing Lock Patterns...";
    activateGridBtn.setAttribute('disabled', 'true');
    
    try {
        // Explicitly stringify the state arrays to guarantee accuracy over the network pipeline
        const payload = {
            activeTraits: [...state.activeTraits],
            attainedTraits: [...state.attainedTraits],
            lockAction: true
        };

        const response = await fetch(`${BACKEND_URL}/traits`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${USER_AUTH_TOKEN}` 
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (data.success) {
            // Update the global frontend memory mapping with the true server data response
            state.traitsLockedAt = data.traitsLockedAt;
            state.activeTraits = data.activeTraits;
            state.isLocked = true;
            
            renderIdentityGrids();
            
            // Ux Navigation Transition: Automatically skip over to the morning entry tab view
            document.getElementById('nav-morning-btn').click();
        } else {
            throw new Error(data.error || "Action restriction fault.");
        }
    } catch (err) {
        alert(`Failed to activate grid locks: ${err.message}`);
        renderIdentityGrids();
    }
});
// --- DATA PROCESSING TRANSMISSIONS ---
saveMorningBtn.addEventListener('click', async () => {
    const payload = getMorningInputsData();
    saveMorningBtn.textContent = "⏳ Saving Changes...";
    saveMorningBtn.setAttribute('disabled', 'true');

    try {
        const response = await fetch(`${BACKEND_URL}/morning-entry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER_AUTH_TOKEN}` },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error("Network save fault");

        state.morningSaved = true;
        state.morningData = payload;

        if (eveningLockOverlay) eveningLockOverlay.style.display = 'none';
        if (eveningCard) eveningCard.classList.remove('locked-state');
        
        saveMorningBtn.textContent = "Morning Saved (Up to date)";
    } catch(err) {
        alert(`Failed to save changes: ${err.message}`);
        evaluateMorningButtonState();
    }
});

// --- UPDATED API ANALYZE TRIGGER EVENT ---
submitJournalBtn.addEventListener('click', async () => {
    if (!state.morningSaved) return;

    submitJournalBtn.textContent = "⏳ Securely Analyzing...";
    submitJournalBtn.setAttribute('disabled', 'true');

    state.eveningData = {
        highlights: document.getElementById('e-highlights').value,
        lessons: document.getElementById('e-lessons').value
    };

    // Grab your current local browser calendar date representation string
    const strictLocalDate = new Date().toLocaleDateString('en-CA');

    try {
        const response = await fetch(`${BACKEND_URL}/analyze-day`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER_AUTH_TOKEN}` },
            body: JSON.stringify({ 
                morningData: state.morningData, 
                eveningData: state.eveningData,
                localDate: strictLocalDate // 🔥 FIXED: Pass the local date string to the server payload
            })
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);

        state.activeTraits = result.stateUpdate.activeTraits;
        state.attainedTraits = result.stateUpdate.attainedTraits;
        state.aiAnalysisResult = result.newLog.aiAnalysisResult;

        renderAnalyticsOutput();
        renderIdentityGrids();
        
        submitJournalBtn.textContent = "Today's Analysis Complete";
        toggleInputsLock(true); 
    } catch (err) {
        alert(`Server Analysis Error: ${err.message}`);
        submitJournalBtn.textContent = "Analyze My Day";
        submitJournalBtn.removeAttribute('disabled');
    }
});

function renderAnalyticsOutput() {
    if (!state.aiAnalysisResult) return;
    const aiResult = state.aiAnalysisResult;

    traitsMetricsContainer.innerHTML = '';
    reportDateTitle.textContent = "📍 Today's Growth Analysis";

    let htmlBuffer = '';
    state.activeTraits.forEach(trait => {
        const aiData = aiResult.scores[trait.name] || aiResult.scores[trait.name.toLowerCase()] || { delta: 0, rationale: "Tracked cleanly." };
        htmlBuffer += `
            <div class="trait-metric-row">
                <div class="metric-header">
                    <span class="metric-name" style="text-transform: capitalize;">${trait.name}</span>
                    <span class="metric-score">${trait.score}%</span>
                </div>
                <div class="track-bar"><div class="track-fill" style="width: ${trait.score}%;"></div></div>
                <div class="semantic-context-lbl">${aiData.rationale}</div>
            </div>`;
    });

    traitsMetricsContainer.innerHTML = htmlBuffer;
    coachingText.innerHTML = `${aiResult.directive}`;
    analysisOutputCard.classList.remove('hidden');
}

syncStateFromServer();
window.syncStateFromServer = syncStateFromServer;