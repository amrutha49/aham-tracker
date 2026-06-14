const BACKEND_URL = "/api";

// Initialize session tracking token from vault cache
let USER_AUTH_TOKEN = localStorage.getItem('aham_jwt_access_token');

const state = {
    activeTraits: [],
    attainedTraits: [],
    isLocked: false,
    morningSaved: false,
    morningData: { grateful: "", great: "", affirmations: [] },
    eveningData: { highlights: "", lessons: "" },
    aiAnalysisResult: null,
    history: []
};

// UI Elements Hooks
const authOverlay = document.getElementById('auth-overlay');
const authTitle = document.getElementById('auth-title');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const authPrimaryBtn = document.getElementById('auth-primary-btn');
const authToggleLink = document.getElementById('auth-toggle-link');
const logoutBtn = document.getElementById('logout-btn');

let isLoginMode = true;

// Auth Modal Form Controller Toggle
authToggleLink.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    authTitle.textContent = isLoginMode ? "Welcome to AHAM" : "Create Matrix Account";
    authPrimaryBtn.textContent = isLoginMode ? "Log In" : "Register & Enter";
    document.querySelector('.auth-toggle-hint').innerHTML = isLoginMode 
        ? `Don't have an account? <span id="auth-toggle-link" onclick="toggleAuthMode()">Sign Up</span>`
        : `Already have an account? <span id="auth-toggle-link" onclick="toggleAuthMode()">Log In</span>`;
});

window.toggleAuthMode = function() {
    authToggleLink.click();
};

// Submit Identity Sign-In / Registration Pipeline
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

        authOverlay.classList.add('hidden-auth');
        authUsernameInput.value = '';
        authPasswordInput.value = '';
        syncStateFromServer();

    } catch (err) {
        alert(`Authentication Failed: ${err.message}`);
    }
});

// Clean Log Out Engine Click Handler
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('aham_jwt_access_token');
    USER_AUTH_TOKEN = null;
    location.reload();
});

// Trait and Page Element DOM Hooks
const traitInput = document.getElementById('trait-input');
const addTraitBtn = document.getElementById('add-trait-btn');
const traitCountLabel = document.getElementById('trait-count');
const activeTraitsContainer = document.getElementById('active-blueprint-slots');
const attainedTraitsContainer = document.getElementById('attained-blueprint-slots');
const attainedTraitsCard = document.getElementById('attained-traits-card');
const activateGridBtn = document.getElementById('activate-grid-btn');
const submitJournalBtn = document.getElementById('submit-journal-btn');
const saveMorningBtn = document.getElementById('save-morning-btn');
const eveningLockOverlay = document.getElementById('evening-lock-overlay');
const eveningCard = document.getElementById('evening-card');
const analysisOutputCard = document.getElementById('analysis-output-card');
const traitsMetricsContainer = document.getElementById('traits-metrics-container');
const coachingText = document.getElementById('coaching-text');
const reportDateTitle = document.getElementById('report-date-title');
const systemStatusPill = document.getElementById('system-status-pill');

// Global Tab Panel Navigation Flow Controls
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

// Synchronize User Profile Records and Locks via Vault Encryption Headers
async function syncStateFromServer() {
    if (!USER_AUTH_TOKEN) {
        authOverlay.classList.remove('hidden-auth');
        return;
    }
    
    authOverlay.classList.add('hidden-auth');

    try {
        const response = await fetch(`${BACKEND_URL}/state`, {
            headers: { 'Authorization': `Bearer ${USER_AUTH_TOKEN}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('aham_jwt_access_token');
            authOverlay.classList.remove('hidden-auth');
            return;
        }

        const serverData = await response.json();
        
        state.activeTraits = serverData.activeTraits || [];
        state.attainedTraits = serverData.attainedTraits || [];
        state.history = serverData.history || [];

        const todayStr = new Date().toISOString().split('T')[0];
        const todaysLog = state.history.find(log => log.date === todayStr);

        if (todaysLog) {
            state.morningSaved = true;
            state.aiAnalysisResult = todaysLog.aiAnalysisResult;
            renderAnalyticsOutput();
            
            saveMorningBtn.textContent = "Morning Saved";
            saveMorningBtn.setAttribute('disabled', 'true');
            if(eveningLockOverlay) eveningLockOverlay.style.display = 'none';
            if(eveningCard) eveningCard.classList.remove('locked-state');
        }

        state.isLocked = state.activeTraits.length > 0;
        renderIdentityGrids();
        if (systemStatusPill) systemStatusPill.textContent = "💚 Synced";
    } catch (err) {
        console.error(err);
        if (systemStatusPill) systemStatusPill.textContent = "❌ Offline";
    }
}

async function saveTraitsToServer() {
    await fetch(`${BACKEND_URL}/traits`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${USER_AUTH_TOKEN}`
        },
        body: JSON.stringify({ activeTraits: state.activeTraits, attainedTraits: state.attainedTraits })
    });
}

function addTrait() {
    const value = traitInput.value.trim().toLowerCase();
    if (!value) return;
    if (state.activeTraits.length >= 5) return alert("Maximum 5 traits tracking limit reached.");
    if (state.activeTraits.some(t => t.name === value) || state.attainedTraits.includes(value)) return alert("Trait tracking item already active.");
    
    state.activeTraits.push({ name: value, score: 0 });
    traitInput.value = '';
    renderIdentityGrids();
}

window.removeTrait = function(index) {
    if (state.isLocked) return;
    state.activeTraits.splice(index, 1);
    renderIdentityGrids();
};

function renderIdentityGrids() {
    activeTraitsContainer.innerHTML = '';
    state.activeTraits.forEach((trait, index) => {
        const li = document.createElement('li');
        li.className = 'trait-item';
        li.innerHTML = state.isLocked 
            ? `<span class="trait-name">${trait.name}</span><span class="trait-score-lbl">${trait.score}%</span>`
            : `<span class="trait-name">${trait.name}</span><button class="remove-trait-btn" onclick="removeTrait(${index})">Delete</button>`;
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
    activateGridBtn.toggleAttribute('disabled', state.activeTraits.length === 0 || state.isLocked);
    
    if (state.isLocked) {
        activateGridBtn.textContent = "Identity Grid Active";
        const rowElement = document.getElementById('trait-input-row');
        if (rowElement) rowElement.style.display = 'none';
    } else {
        activateGridBtn.textContent = "Save & Start Day";
        const rowElement = document.getElementById('trait-input-row');
        if (rowElement) rowElement.style.display = 'flex';
    }
}

addTraitBtn.addEventListener('click', addTrait);
traitInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addTrait(); });

activateGridBtn.addEventListener('click', async () => {
    if (state.activeTraits.length === 0) return;
    state.isLocked = true;
    await saveTraitsToServer();
    renderIdentityGrids();
    document.getElementById('nav-morning-btn').click();
});

saveMorningBtn.addEventListener('click', () => {
    state.morningSaved = true;
    let affs = [];
    document.querySelectorAll('.affirmation-input').forEach(input => affs.push(input.value));
    
    state.morningData = {
        grateful: document.getElementById('m-grateful').value,
        great: document.getElementById('m-great').value,
        affirmations: affs
    };
    
    if(eveningLockOverlay) eveningLockOverlay.style.display = 'none';
    if(eveningCard) eveningCard.classList.remove('locked-state');
    
    saveMorningBtn.textContent = "Morning Saved";
    saveMorningBtn.setAttribute('disabled', 'true');
});

submitJournalBtn.addEventListener('click', async () => {
    if (!state.morningSaved) return;

    submitJournalBtn.textContent = "⏳ Securely Analyzing...";
    submitJournalBtn.setAttribute('disabled', 'true');

    state.eveningData = {
        highlights: document.getElementById('e-highlights').value,
        lessons: document.getElementById('e-lessons').value
    };

    const payload = {
        date: new Date().toISOString().split('T')[0],
        morningData: state.morningData,
        eveningData: state.eveningData
    };

    try {
        const response = await fetch(`${BACKEND_URL}/analyze-day`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${USER_AUTH_TOKEN}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if(result.error) throw new Error(result.error);

        state.activeTraits = result.stateUpdate.activeTraits;
        state.attainedTraits = result.stateUpdate.attainedTraits;
        state.aiAnalysisResult = result.newLog.aiAnalysisResult;

        renderAnalyticsOutput();
        renderIdentityGrids();

    } catch (err) {
        alert(`Server Error: ${err.message}`);
    } finally {
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

// Initial Sync Execution Core Trigger
syncStateFromServer();