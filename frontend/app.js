const tg = window.Telegram.WebApp;
tg.expand();
if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();

// Синхронизируем цвет шапки ТГ с фоном нашего приложения
const setTgColors = () => {
    const isDark = document.documentElement.classList.contains('dark');
    const bgColor = isDark ? '#09090b' : '#ffffff';
    try { tg.setHeaderColor(bgColor); } catch(e){}
    try { tg.setBackgroundColor(bgColor); } catch(e){}
};
tg.ready();

const userId = tg.initDataUnsafe?.user?.id;

// Блокировка входа вне Телеграма
if (!tg.initData) {
    document.body.innerHTML = `
        <div class="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-center p-8 z-[9999]">
            <div class="size-20 bg-primary/20 rounded-full flex items-center justify-center mb-6">
                <span class="material-symbols-outlined text-primary text-4xl">lock</span>
            </div>
            <h1 class="text-2xl font-bold text-white mb-2">Только через Telegram</h1>
            <p class="text-zinc-400 text-sm max-w-[240px] mb-8">
                Для работы с MyForma, пожалуйста, откройте приложение через официального бота.
            </p>
            <a href="https://t.me/your_bot_name" class="bg-primary text-black font-bold py-3 px-8 rounded-2xl active:scale-95 transition-transform">
                ОТКРЫТЬ БОТА
            </a>
        </div>
    `;
    window.stop(); // Останавливаем дальнейшую загрузку
}
const API_URL = ""; // Пустая строка для относительных путей (работает везде)

let currentDate = new Date().toISOString().split('T')[0];
let currentExercises = [];
let currentWeights = [];
let editingExerciseId = null;
let workoutsLoaded = false;
let weightsLoaded = false;
let todayExercises = []; // Всегда хранит тренировки за ТЕКУЩИЙ день для дашборда
let currentJournalPage = localStorage.getItem('lastJournalPage') || 'workouts';

// Новые переменные для каталога
let exerciseCatalog = [];
let userFavorites = [];
let selectedCategory = null;

// Переменные для свайпов
let touchStartX = 0;
let touchStartY = 0;
let currentSwipeEl = null;
let swipeStartOffset = 0;
let swipeStarted = false;
let isDraggingPage = false;
let sliderStartX = 0;
const SWIPE_LIMIT = 140;

// Onboarding State
let currentStoryIndex = 0;
let storyInterval = null;
let isStoryPaused = false;
const STORY_DURATION = 5000; // 5 секунд на слайд

// Инициализация
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
    initTheme();
    initCalendar();
    initProfile();
    initTouchEvents();
    
    // Показываем онбординг только первым пользователям
    if (!localStorage.getItem('onboarding_done')) {
        startOnboarding();
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // ОПТИМИЗАЦИЯ: Один запрос вместо пяти
    try {
        const timestamp = Date.now();
        const response = await fetch(`${API_URL}/init-app?telegram_id=${userId}&date=${today}&t=${timestamp}`);
        if (response.ok) {
            const data = await response.json();
            currentExercises = data.workouts || [];
            currentWeights = data.weights || [];
            exerciseCatalog = data.catalog || [];
            userFavorites = data.favorites || [];
            
            // Сохраняем стрик в глобальную переменную для дашборда
            window.lastStreakData = data.streak;
            
            todayExercises = [...currentExercises];
            workoutsLoaded = true;
            weightsLoaded = true;
        }
    } catch (error) {
        console.error("Init App error:", error);
    }
    
    showDashboard(); // Показывает дашборд при входе

    // Скрываем Splash Screen быстрее, так как данные уже есть
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('fade-out');
            setTimeout(() => splash.remove(), 800);
        }
    }, 600);
    
    // Глобальный хак для предотвращения стягивания ТГ (плавный)
    ['exercises-scroll-area', 'weight-scroll-area'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('touchstart', () => {
                if (el.scrollTop === 0) el.scrollTop = 1;
            });
        }
    });
}


function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        setTheme('dark');
    } else {
        setTheme('light');
    }
}

function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    }
    
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = (theme === 'dark');

    // Перерисовываем компоненты, зависящие от цвета
    if (currentWeights.length > 0) renderWeightChart(currentWeights);
}

function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'light' : 'dark');
}

function initProfile() {
    const user = tg.initDataUnsafe?.user;
    if (user) {
        document.getElementById('profile-username').textContent = user.username ? `@${user.username}` : `${user.first_name} ${user.last_name || ''}`;
        
        if (user.photo_url) {
            const imgEl = document.getElementById('profile-avatar-img');
            const iconEl = document.getElementById('profile-avatar-icon');
            if (imgEl && iconEl) {
                imgEl.src = user.photo_url;
                imgEl.classList.remove('hidden');
                iconEl.classList.add('hidden');
            }
        }
        
        // Синхронизация данных профиля с бэкендом
        fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: user.id,
                username: user.username,
                first_name: user.first_name,
                last_name: user.last_name,
                photo_url: user.photo_url
            })
        }).catch(err => console.error("Login failed:", err));
    }
    
    // Синхронизируем переключатель темы
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = document.documentElement.classList.contains('dark');
}

// Календарь
function initCalendar() {
    const calendarBar = document.getElementById('calendar-bar');
    if (!calendarBar) return;
    calendarBar.innerHTML = '';
    
    const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
    
    const centerDate = new Date(currentDate);
    
    // Генерируем 7 дней: 3 до, текущий, 3 после
    for (let i = -3; i <= 3; i++) {
        const date = new Date(centerDate);
        date.setDate(centerDate.getDate() + i);
        
        const isoDate = date.toISOString().split('T')[0];
        const isSelected = isoDate === currentDate;
        
        const dayDiv = document.createElement('div');
        dayDiv.className = `flex flex-col items-center w-[calc(14.28%-4px)] py-2 rounded-custom cursor-pointer transition-all ${
            isSelected 
            ? 'bg-primary text-white calendar-shadow' 
            : 'bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
        }`;
        
        dayDiv.onclick = () => selectDate(isoDate);

        dayDiv.innerHTML = `
            <span class="text-[8px] font-semibold ${isSelected ? 'opacity-80' : 'text-zinc-400 dark:text-zinc-500'} uppercase tracking-widest mb-1">
                ${days[date.getDay()]}
            </span>
            <span class="text-xs font-bold">${date.getDate()}</span>
            ${isSelected ? '<div class="mt-0.5 w-1 h-1 bg-white rounded-full"></div>' : ''}
        `;
        calendarBar.appendChild(dayDiv);
    }

    const todayIso = new Date().toISOString().split('T')[0];
    const titleMap = { [todayIso]: 'Сегодняшняя тренировка' };
    const titleEl = document.getElementById('workout-title');
    if (titleEl) titleEl.textContent = titleMap[currentDate] || `Тренировка ${currentDate}`;
}

async function selectDate(isoDate) {
    currentDate = isoDate;
    workoutsLoaded = false;
    weightsLoaded = false;
    initCalendar();
    await loadWorkouts();
}

async function loadWorkouts() {
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = currentDate === todayStr;
    
    workoutsLoaded = true;
    const container = document.getElementById('exercises-container');
    if (!container) return;
    container.style.opacity = '0.5';
    
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        if (currentDate === todayStr) {
            todayExercises = []; 
            updateDashboard();
        }
        
        const timestamp = Date.now();
        const response = await fetch(`${API_URL}/workouts?date=${currentDate}&telegram_id=${userId}&t=${timestamp}`, {
            headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (response.ok) {
            currentExercises = await response.json();
            console.log("DEBUG: Loaded exercises for", currentDate, currentExercises);
        } else {
            console.error("Server error:", response.status);
            currentExercises = [];
        }
    } catch (error) {
        console.error("Load error:", error);
        currentExercises = [];
    } finally {
        if (isToday) {
            todayExercises = [...currentExercises];
            updateDashboard();
        }
        renderJournal();
        container.style.opacity = '1';
    }
}

function renderJournal() {
    const container = document.getElementById('exercises-container');
    const countLabel = document.getElementById('exercises-count');
    if (!container) return;
    container.innerHTML = '';
    container.classList.remove('stagger-children');
    void container.offsetWidth;
    container.classList.add('stagger-children');
    countLabel.textContent = `${currentExercises.length} Упражнения`;

    currentExercises.forEach(ex => {
        const totalVolume = ex.sets.reduce((sum, s) => sum + (s.weight * s.reps), 0);
        const setsSummary = ex.sets.length > 0 
            ? `<div class="flex items-center gap-3">
                 <span class="flex items-center gap-1 text-[10px]"><span class="material-symbols-outlined" style="font-size: 14px;">format_list_numbered</span>${ex.sets.length} подх.</span>
                 <span class="flex items-center gap-1 text-[10px]"><span class="material-symbols-outlined" style="font-size: 14px;">fitness_center</span>${totalVolume.toLocaleString('ru-RU')} кг</span>
               </div>` 
            : "Нет подходов";

        const swipeContainer = document.createElement('div');
        swipeContainer.className = "swipe-container mb-3 transition-opacity duration-300";
        swipeContainer.id = `exercise-card-${ex.id}`;
        
        swipeContainer.innerHTML = `
            <div class="swipe-actions">
                <button onclick="editExercise(${ex.id}, event)" class="action-btn action-edit">
                    <span class="material-symbols-outlined" style="font-size: 24px;">edit</span>
                </button>
                <button onclick="deleteExerciseWithConfirm(${ex.id}, event)" class="action-btn action-delete">
                    <span class="material-symbols-outlined" style="font-size: 24px;">delete</span>
                </button>
            </div>
            <div class="swipe-content border border-zinc-100 dark:border-zinc-800 rounded-custom dark:bg-zinc-800 transition-colors">
                <div class="p-4 flex items-center justify-between cursor-pointer" onclick="toggleExpand(this)">
                    <div class="flex items-center space-x-4">
                        <div class="w-12 h-12 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center rounded-custom text-primary dark:text-blue-400 font-bold transition-colors">
                            ${ex.name[0].toUpperCase()}
                        </div>
                        <div>
                            <h3 class="font-bold text-zinc-800 dark:text-zinc-100 text-sm leading-snug transition-colors">${ex.name}</h3>
                            <div class="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium mt-0.5 transition-colors">${setsSummary}</div>
                        </div>
                    </div>
                    <span class="material-symbols-outlined text-zinc-300 dark:text-zinc-600 chevron-icon transition-all duration-300">expand_more</span>
                </div>
                <div class="expandable-wrapper bg-zinc-50/50 dark:bg-zinc-900/30">
                    <div class="expandable-content">
                        <div class="px-4 pb-4 space-y-2">
                        ${ex.sets.map((s, i) => `
                            <div class="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                                <span class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Подход ${i+1}</span>
                                <div class="flex space-x-4">
                                    <span class="text-xs font-bold text-zinc-700 dark:text-zinc-200">${s.weight} кг</span>
                                    <span class="text-xs font-bold text-zinc-400 dark:text-zinc-500">${s.reps} повт.</span>
                                </div>
                            </div>
                        `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(swipeContainer);
    });
}

// Журнал веса
async function showWeightJournal() {
    currentJournalPage = 'weight';
    localStorage.setItem('lastJournalPage', 'weight');
    const slider = document.getElementById('journal-slider');
    if (slider) {
        slider.style.transition = 'transform 0.3s ease-out';
        slider.style.transform = `translateX(-50%)`;
    }
    updateNav('journal');
    updateJournalHeader();
    if (!weightsLoaded) await loadWeights();
}

async function showWorkoutJournal() {
    currentJournalPage = 'workouts';
    localStorage.setItem('lastJournalPage', 'workouts');
    const slider = document.getElementById('journal-slider');
    if (slider) {
        slider.style.transition = 'transform 0.3s ease-out';
        slider.style.transform = `translateX(0)`;
    }
    updateNav('journal');
    updateJournalHeader();
    if (!workoutsLoaded) await loadWorkouts();
}

/**
 * Обновляет содержимое общего фиксированного заголовка в зависимости от активного журнала.
 */
function updateJournalHeader() {
    const titleEl = document.getElementById('journal-header-title');
    const leftEl = document.getElementById('journal-header-left');
    const rightEl = document.getElementById('journal-header-right');
    if (!titleEl || !leftEl || !rightEl) return;

    if (currentJournalPage === 'workouts') {
        titleEl.textContent = 'Журнал тренировок';
        leftEl.innerHTML = `
            <label for="date-picker-input" class="flex items-center justify-center size-10 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 active:scale-95 transition-all cursor-pointer">
                <span class="material-symbols-outlined" style="font-size: 20px;">calendar_today</span>
            </label>
        `;
        rightEl.innerHTML = `
            <button onclick="promptNewExercise()" aria-label="Add Exercise" class="size-10 flex items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20 active:scale-95 transition-transform">
                <span class="material-symbols-outlined" style="font-size: 20px;">add</span>
            </button>
        `;
    } else {
        titleEl.textContent = 'Журнал веса';
        leftEl.innerHTML = `
            <div class="size-10 flex items-center justify-center text-zinc-400">
                <span class="material-symbols-outlined" style="font-size: 22px;">monitor_weight</span>
            </div>
        `; 
        rightEl.innerHTML = `
            <button onclick="showAddWeightModal()" class="flex items-center justify-center size-10 rounded-full bg-primary text-white shadow-lg shadow-primary/20 active:scale-95 transition-all">
                <span class="material-symbols-outlined">add</span>
            </button>
        `;
    }
}

async function loadWeights() {
    weightsLoaded = true;
    try {
        const timestamp = Date.now();
        const res = await fetch(`${API_URL}/weights?telegram_id=${userId}&t=${timestamp}`);
        if (!res.ok) return;
        const weights = await res.json();
        if (Array.isArray(weights)) {
            currentWeights = weights;
            renderWeightHistory(weights.slice(0, 3));
            renderWeightChart(weights);
            
            const seeAllBtn = document.getElementById('btn-see-all-weights');
            if (seeAllBtn) {
                if (weights.length > 3) seeAllBtn.classList.remove('hidden');
                else seeAllBtn.classList.add('hidden');
            }
            
            if (weights.length > 0) {
                const currentWeight = weights[0].weight;
                const display = document.getElementById('current-weight-display');
                if (display) display.textContent = currentWeight.toFixed(1);
                
                const trendContainer = document.getElementById('weight-trend-container');
                if (trendContainer) {
                    if (weights.length > 1) {
                        const prevWeight = weights[1].weight;
                        const diff = currentWeight - prevWeight;
                        const percent = ((diff / prevWeight) * 100).toFixed(1);
                        const isDown = diff <= 0;
                        trendContainer.className = `flex items-center gap-1 font-bold text-sm ${isDown ? 'text-green-500' : 'text-red-500'}`;
                        trendContainer.innerHTML = `
                            <span class="material-symbols-outlined text-sm">${isDown ? 'trending_down' : 'trending_up'}</span>
                            ${isDown ? '' : '+'}${percent}% за всё время
                        `;
                    } else {
                        trendContainer.innerHTML = '<span class="text-slate-300 font-medium">Первая запись</span>';
                    }
                }
            } else {
                const display = document.getElementById('current-weight-display');
                if (display) display.textContent = "--";
                const trendContainer = document.getElementById('weight-trend-container');
                if (trendContainer) trendContainer.innerHTML = '';
            }
        }
    } catch (err) {
        console.error("Load weights error:", err);
    }
}

function renderWeightHistory(weights) {
    const container = document.getElementById('weight-history-container');
    if (!container) return;
    container.innerHTML = '';
    container.classList.remove('stagger-children');
    void container.offsetWidth;
    container.classList.add('stagger-children');
    
    if (weights.length === 0) {
        container.innerHTML = `<div class="py-8 text-center text-slate-400 text-sm">История пока пуста</div>`;
        return;
    }

    weights.forEach(w => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-4 bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-100 dark:border-zinc-700 transition-colors";
        item.innerHTML = `
            <div>
                <p class="font-bold text-zinc-900 dark:text-zinc-100">${w.weight} кг</p>
                <p class="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-tighter">${w.timestamp}</p>
            </div>
            <button onclick="deleteWeight(${w.id})" class="text-zinc-300 dark:text-zinc-600 hover:text-red-500 transition-colors p-1">
                <span class="material-symbols-outlined text-[20px]">delete</span>
            </button>
        `;
        container.appendChild(item);
    });
}

function renderWeightChart(weights) {
    const container = document.getElementById('weight-chart-container');
    if (!container) return;
    
    if (weights.length === 0) {
        container.innerHTML = `
            <div class="bg-slate-50 dark:bg-slate-800/50 rounded-[32px] p-3 min-h-[140px] flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500 transition-colors">
                <div class="size-10 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-3">
                    <span class="material-symbols-outlined text-xl">Auto_Graph</span>
                </div>
                <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Время прийти в форму</h2>
                <p class="text-slate-500 dark:text-slate-400 text-[10px] leading-relaxed max-w-[160px]">Запишите свой первый вес, чтобы начать отслеживать прогресс</p>
            </div>
        `;
        return;
    }

    if (weights.length === 1) {
        container.innerHTML = `
            <div class="bg-slate-50 dark:bg-slate-800/50 rounded-[32px] p-3 min-h-[140px] flex flex-col items-center justify-center text-center transition-colors">
                <div class="size-10 bg-green-50 dark:bg-green-900/20 text-green-500 rounded-full flex items-center justify-center mb-3">
                    <span class="material-symbols-outlined text-xl">Flag</span>
                </div>
                <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Точка старта: ${weights[0].weight} кг</h2>
                <p class="text-slate-500 dark:text-slate-400 text-[10px] leading-relaxed max-w-[160px]">Отличное начало! Взвесьтесь через пару дней, чтобы увидеть изменения.</p>
            </div>
        `;
        return;
    }

    const reversedWeights = [...weights].reverse();
    const data = reversedWeights.map(w => w.weight);
    const dates = reversedWeights.map(w => {
        const parts = w.timestamp.split(' ');
        return parts[0] + ' ' + (parts[1] ? parts[1].replace(',', '') : '');
    });

    const minWeight = Math.min(...data);
    const maxWeight = Math.max(...data);
    const paddingVal = (maxWeight - minWeight) * 0.2 || 1;
    const min = minWeight - paddingVal;
    const max = maxWeight + paddingVal;
    const range = max - min;
    
    const width = 380;
    const height = 160;
    const paddingX = 15;
    const paddingY = 35;

    const points = data.map((val, i) => ({
        x: paddingX + (i * (width - 2 * paddingX) / (data.length - 1)),
        y: height - paddingY - ((val - min) * (height - 2 * paddingY) / range)
    }));

    const getCurvePath = (pts) => {
        if (pts.length < 2) return "";
        let path = `M ${pts[0].x},${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const cp1x = p0.x + (p1.x - p0.x) / 2;
            const cp2x = p0.x + (p1.x - p0.x) / 2;
            path += ` C ${cp1x},${p0.y} ${cp2x},${p1.y} ${p1.x},${p1.y}`;
        }
        return path;
    };

    const curvePath = getCurvePath(points);
    const fillPath = `${curvePath} L ${points[points.length-1].x},${height-10} L ${points[0].x},${height-10} Z`;

    const isDark = document.documentElement.classList.contains('dark');
    const accentColor = isDark ? '#3b82f6' : '#3b82f6'; // Можно уточнить для zinc
    const textColor = isDark ? '#71717a' : '#64748b'; // zinc-400
    const gridColor = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';

    container.innerHTML = `
        <div class="bg-white dark:bg-zinc-800 rounded-[32px] p-3 overflow-hidden relative border border-zinc-100 dark:border-zinc-700 transition-colors shadow-sm">
            <div class="h-[140px] w-full mt-2">
                <svg viewBox="0 0 ${width} ${height}" class="w-full h-full overflow-visible">
                    <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.2"/>
                            <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.01"/>
                        </linearGradient>
                    </defs>
                    <path d="${fillPath}" fill="url(#chartGradient)" />
                    <path d="${curvePath}" fill="none" stroke="${accentColor}" stroke-width="3.5" stroke-linecap="round" class="chart-line-anim" />
                    ${points.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${isDark ? '#27272a' : 'white'}" stroke="${accentColor}" stroke-width="2.5" />`).join('')}
                    ${[0, Math.floor(points.length/2), points.length-1].map(i => {
                        const p = points[i];
                        const isLast = i === points.length - 1;
                        return `<text x="${p.x}" y="${height - 10}" text-anchor="${i === 0 ? 'start' : (isLast ? 'end' : 'middle')}" fill="${isLast ? accentColor : textColor}" class="text-[11px] font-bold">${isLast ? 'Сегодня' : dates[i]}</text>`;
                    }).join('')}
                </svg>
            </div>
        </div>
    `;
}

async function deleteWeight(id) {
    const modalId = 'custom-confirm';
    const modal = document.getElementById(modalId);
    const title = modal.querySelector('h3');
    const p = modal.querySelector('p');
    
    const originalTitle = title.textContent;
    const originalP = p.textContent;
    
    title.textContent = 'Удалить вес?';
    p.textContent = 'Вы уверены, что хотите удалить эту запись о весе?';
    
    openModal(modalId);
    
    document.getElementById('confirm-cancel').onclick = () => {
        closeModal(modalId);
        setTimeout(() => {
            title.textContent = originalTitle;
            p.textContent = originalP;
        }, 400);
    };
    
    document.getElementById('confirm-ok').onclick = async () => {
        try {
            const res = await fetch(`${API_URL}/weights/${id}`, { method: 'DELETE' });
            if (res.ok) {
                closeModal(modalId);
                setTimeout(() => {
                    title.textContent = originalTitle;
                    p.textContent = originalP;
                }, 400);
                await loadWeights();
                if (!document.getElementById('modal-weight-history').classList.contains('hidden')) {
                    renderFullWeightHistory();
                }
            }
        } catch (err) {
            console.error("Delete weight error:", err);
            closeModal(modalId);
        }
    };
}

function showFullWeightHistory() {
    renderFullWeightHistory();
    openModal('modal-weight-history');
}

function renderFullWeightHistory() {
    const container = document.getElementById('full-weight-history-container');
    if (!container) return;
    container.innerHTML = '';
    currentWeights.forEach(w => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-4 bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-100 dark:border-zinc-700 mb-3 transition-colors";
        item.innerHTML = `
            <div>
                <p class="font-bold text-zinc-900 dark:text-zinc-100">${w.weight} кг</p>
                <p class="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-tighter">${w.timestamp}</p>
            </div>
            <button onclick="deleteWeight(${w.id})" class="text-zinc-300 dark:text-zinc-600 hover:text-red-500 transition-colors p-1">
                <span class="material-symbols-outlined text-[20px]">delete</span>
            </button>
        `;
        container.appendChild(item);
    });
}

function closeWeightHistoryModal() {
    closeModal('modal-weight-history');
}

function showAddWeightModal() {
    openModal('modal-weight');
}

function closeWeightModal() {
    closeModal('modal-weight');
}

async function saveWeight() {
    const btn = document.getElementById('btn-save-weight');
    if (btn && btn.disabled) return;
    
    const input = document.getElementById('input-weight');
    const val = parseFloat(input.value);
    if (isNaN(val) || val <= 0) return;

    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-not-allowed');
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm mr-2">sync</span> СОХРАНЕНИЕ...';
    }

    try {
        const now = new Date();
        const timestamp = now.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const date = now.toISOString().split('T')[0];
        const res = await fetch(`${API_URL}/weights?telegram_id=${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weight: val, date: date, timestamp: timestamp })
        });
        if (res.ok) {
            closeWeightModal();
            input.value = '';
            weightsLoaded = false;
            await loadWeights();
        }
    } catch (err) {
        console.error("Save weight error:", err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
            btn.innerHTML = 'СОХРАНИТЬ ВЕС';
        }
    }
}

// NAVIGATION
function switchView(viewId) {
    const views = ['view-dashboard', 'journal-wrapper', 'view-profile'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (id === viewId) {
            el.classList.remove('hidden', 'hidden-pane');
            setTimeout(() => el.classList.add('active-pane'), 10);
        } else {
            el.classList.remove('active-pane');
            el.classList.add('hidden-pane');
            setTimeout(() => el.classList.add('hidden'), 400);
        }
    });
}

async function showJournal() {
    const today = new Date().toISOString().split('T')[0];
    if (currentDate !== today) {
        await selectDate(today);
    }

    // Обработка закрытия деталей
    const details = document.getElementById('view-details');
    if (!details.classList.contains('hidden')) {
        details.classList.remove('active-pane');
        details.classList.add('hidden-pane');
        setTimeout(() => details.classList.add('hidden'), 500);
    }

    switchView('journal-wrapper');
    
    document.getElementById('nav-pill').classList.remove('hidden');
    
    editingExerciseId = null;
    if (currentJournalPage === 'workouts') showWorkoutJournal();
    else showWeightJournal();
    updateNav('journal');
    updateJournalHeader();
}

function showDashboard() {
    // Обработка закрытия деталей если они открыты
    const details = document.getElementById('view-details');
    if (!details.classList.contains('hidden')) {
        details.classList.remove('active-pane');
        details.classList.add('hidden-pane');
        setTimeout(() => details.classList.add('hidden'), 500);
    }

    switchView('view-dashboard');
    document.getElementById('nav-pill').classList.remove('hidden');
    updateNav('dashboard');
    updateDashboard();
}

function showProfile() {
    switchView('view-profile');
    updateNav('profile');
    
    // Prevent Telegram swipe-down-to-close by keeping 1px scroll offset (smooth)
    const profile = document.getElementById('view-profile');
    profile.addEventListener('touchstart', () => {
        if (profile.scrollTop === 0) profile.scrollTop = 1;
    });
}

function updateNav(view) {
    const navDash = document.getElementById('nav-dashboard');
    const navJournal = document.getElementById('nav-journal');
    const navProfile = document.getElementById('nav-profile');
    if (!navDash || !navJournal || !navProfile) return;

    const activeClasses = ['bg-white', 'text-zinc-900', 'shadow-sm'];
    const inactiveClasses = ['text-zinc-400', 'hover:text-white'];

    [navDash, navJournal, navProfile].forEach(btn => {
        btn.classList.remove(...activeClasses);
        btn.classList.add(...inactiveClasses);
        btn.querySelector('span').style.fontVariationSettings = "'FILL' 0, 'wght' 500";
    });

    let activeBtn = navDash;
    if (view === 'journal') activeBtn = navJournal;
    if (view === 'profile') activeBtn = navProfile;

    activeBtn.classList.add(...activeClasses);
    activeBtn.classList.remove(...inactiveClasses);
    activeBtn.querySelector('span').style.fontVariationSettings = "'FILL' 1, 'wght' 600";
}

function updateDashboard() {
    // 0. Date
    const dashDate = document.getElementById('dash-date');
    if (dashDate) {
        const now = new Date();
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        let dateStr = now.toLocaleDateString('ru-RU', options);
        // Делаем первую букву заглавной
        dashDate.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    }

    // 1. Weight
    const dashWeight = document.getElementById('dash-weight');
    if (dashWeight) {
        if (currentWeights.length > 0) dashWeight.textContent = currentWeights[0].weight.toFixed(1);
        else dashWeight.textContent = '--';
    }

    // 2. Volume
    const dashVolume = document.getElementById('dash-volume');
    if (dashVolume) {
        const totalVolume = todayExercises.reduce((sum, ex) => {
            const exVolume = (ex.sets || []).reduce((sSum, set) => {
                return sSum + (Number(set.weight || 0) * Number(set.reps || 0));
            }, 0);
            return sum + exVolume;
        }, 0);
        dashVolume.textContent = Math.round(totalVolume).toLocaleString('ru-RU');
    }

    // 3. AI Insights
    updateAIInsights();
    
    // 4. Activity Dots
    updateActivityDots();
}

async function updateAIInsights() {
    const textEl = document.getElementById('ai-insight-text');
    if (!textEl) return;

    textEl.innerHTML = '<span class="animate-pulse opacity-50">AI анализирует данные...</span>';

    try {
        const response = await fetch(`${API_URL}/ai/insight?telegram_id=${userId}`);
        if (response.ok) {
            const data = await response.json();
            textEl.textContent = data.insight;
        } else {
            throw new Error("API error");
        }
    } catch (err) {
        console.error("AI Insight error:", err);
        textEl.textContent = "Тренируйся регулярно — и результат не заставит себя ждать!";
    }
}

async function updateActivityDots() {
    const container = document.getElementById('dash-streak-dots');
    const countEl = document.getElementById('dash-streak-count');
    if (!container || !countEl) return;

    try {
        let data = window.lastStreakData;
        
        // Если данных в кэше нет (например, обновили страницу), запрашиваем
        if (!data) {
            const response = await fetch(`${API_URL}/user/streak?telegram_id=${userId}`);
            if (response.ok) {
                data = await response.json();
            }
        }
        
        if (data) {
            // Обновляем счетчик
            countEl.textContent = data.streak;
            
            // Обновляем точки
            container.innerHTML = '';
            (data.last_7_days || []).forEach(active => {
                const dot = document.createElement('div');
                dot.className = `size-1.5 rounded-full ${active ? 'bg-primary' : 'bg-zinc-200 dark:bg-zinc-800'}`;
                container.appendChild(dot);
            });
        }
    } catch (err) {
        console.error("Streak sync error:", err);
    }
}

let isIgnoringTouch = false;

// TOUCH EVENTS
function initTouchEvents() {
    const slider = document.getElementById('journal-slider');
    if (!slider) return;

    document.addEventListener('touchstart', (e) => {
        // Игнорируем элементы, которые не должны мешать свайпу
        isIgnoringTouch = !!e.target.closest('#calendar-bar') || 
                          !!e.target.closest('#nav-pill') || 
                          !!e.target.closest('#custom-confirm') ||
                          !!e.target.closest('#modal-exercise-name') ||
                          !!e.target.closest('.swipe-actions') ||
                          !!e.target.closest('.action-btn');
                          
        if (isIgnoringTouch) return;
        
        const content = e.target.closest('.swipe-content');
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeDirection = null;
        isDraggingPage = false;

        if (content) {
            if (currentSwipeEl && currentSwipeEl !== content) closeSwipe(currentSwipeEl);
            currentSwipeEl = content;
            const matrix = new WebKitCSSMatrix(window.getComputedStyle(content).transform);
            swipeStartOffset = matrix.m41;
            content.style.transition = 'none';
            swipeStarted = true;
        } else {
            if (currentSwipeEl) closeSwipe(currentSwipeEl);
            swipeStarted = false;
            if (!editingExerciseId && !document.getElementById('journal-wrapper').classList.contains('hidden')) {
                const sliderMatrix = new WebKitCSSMatrix(window.getComputedStyle(slider).transform);
                sliderStartX = sliderMatrix.m41;
                slider.style.transition = 'none';
            }
        }
    }, {passive: true});

    document.addEventListener('touchmove', (e) => {
        if (isIgnoringTouch) return;
        const diffX = e.touches[0].clientX - touchStartX;
        const diffY = e.touches[0].clientY - touchStartY;
        if (!swipeDirection) {
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) swipeDirection = 'horizontal';
            else if (Math.abs(diffY) > 10) swipeDirection = 'vertical';
        }
        if (swipeDirection === 'horizontal') {
            if (swipeStarted && currentSwipeEl) {
                let move = swipeStartOffset + diffX;
                if (move > 0) move *= 0.2;
                else if (move < -SWIPE_LIMIT) move = -SWIPE_LIMIT + (move + SWIPE_LIMIT) * 0.2;
                currentSwipeEl.style.transform = `translateX(${move}px)`;
            } else if (!editingExerciseId && !document.getElementById('journal-wrapper').classList.contains('hidden')) {
                let move = sliderStartX + diffX;
                const min = -window.innerWidth;
                if (move > 0) move *= 0.2;
                if (move < min) move = min + (move - min) * 0.2;
                slider.style.transform = `translateX(${move}px)`;
                isDraggingPage = true;
            }
        }
    }, {passive: true});

    document.addEventListener('touchend', (e) => {
        if (swipeStarted && currentSwipeEl) {
            swipeStarted = false;
            currentSwipeEl.style.transition = 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
            const matrix = new WebKitCSSMatrix(window.getComputedStyle(currentSwipeEl).transform);
            if (matrix.m41 < -SWIPE_LIMIT / 2) currentSwipeEl.style.transform = `translateX(-${SWIPE_LIMIT}px)`;
            else closeSwipe(currentSwipeEl);
            return;
        }
        if (isDraggingPage) {
            isDraggingPage = false;
            const diffX = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(diffX) > 100) {
                if (diffX < 0 && currentJournalPage === 'workouts') showWeightJournal();
                else if (diffX > 0 && currentJournalPage === 'weight') showWorkoutJournal();
                else snapSlider();
            } else snapSlider();
        }
    });
}

function snapSlider() {
    const slider = document.getElementById('journal-slider');
    if (!slider) return;
    slider.style.transition = 'transform 0.3s ease-out';
    slider.style.transform = currentJournalPage === 'workouts' ? 'translateX(0)' : 'translateX(-50%)';
    updateJournalHeader();
}

function closeSwipe(el) { if (el) el.style.transform = 'translateX(0)'; if (currentSwipeEl === el) currentSwipeEl = null; }
function toggleExpand(el) {
    const content = el.closest('.swipe-content');
    if (new WebKitCSSMatrix(window.getComputedStyle(content).transform).m41 < -10) { closeSwipe(content); return; }
    el.parentElement.classList.toggle('expanded');
}

// WORKOUTS
function editExercise(id, event) {
    if (event) event.stopPropagation();
    editingExerciseId = id;
    const ex = currentExercises.find(e => e.id === id);
    if (!ex) return;
    document.getElementById('edit-exercise-name-input').value = ex.name;
    
    const details = document.getElementById('view-details');
    details.classList.remove('hidden', 'hidden-pane');
    setTimeout(() => details.classList.add('active-pane'), 10);
    
    document.getElementById('nav-pill').classList.add('hidden');
    document.getElementById('btn-delete-exercise').classList.remove('hidden');
    renderEditSets(ex.sets);
    
    // Scroll lock hack (smooth)
    details.addEventListener('touchstart', () => {
        if (details.scrollTop === 0) details.scrollTop = 1;
    });
}

function renderEditSets(sets) {
    const container = document.getElementById('sets-edit-container');
    container.innerHTML = '';
    sets.forEach(s => addSetRow(s.weight, s.reps, s.id));
    if (sets.length === 0) addSetRow();
}

function addSetRow(weight = '', reps = '', id = null) {
    const container = document.getElementById('sets-edit-container');
    const row = document.createElement('div');
    row.className = "set-row grid grid-cols-12 gap-2 items-center bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-theme border border-zinc-100 dark:border-zinc-800 transition-colors";
    row.dataset.id = id || `new-${Date.now()}-${Math.random()}`;
    row.innerHTML = `
        <div class="col-span-2 text-center font-bold text-zinc-400 dark:text-zinc-500 text-sm set-num">${container.children.length + 1}</div>
        <div class="col-span-4"><input class="w-full text-center bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 rounded-theme focus:ring-primary font-semibold text-zinc-800 dark:text-zinc-100 weight-input transition-colors" type="number" step="0.1" inputmode="decimal" value="${weight}"></div>
        <div class="col-span-4"><input class="w-full text-center bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 rounded-theme focus:ring-primary font-semibold text-zinc-800 dark:text-zinc-100 reps-input transition-colors" type="number" inputmode="numeric" value="${reps}"></div>
        <div class="col-span-2 flex justify-center"><button onclick="removeRow(this)" class="p-2 text-zinc-300 dark:text-zinc-600 hover:text-red-500 transition-colors"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button></div>
    `;
    container.appendChild(row);
}

function addNewSetRow() {
    const container = document.getElementById('sets-edit-container');
    const lastRow = container.lastElementChild;
    let weight = '';
    let reps = '';
    
    if (lastRow) {
        weight = lastRow.querySelector('.weight-input').value;
        reps = lastRow.querySelector('.reps-input').value;
    }
    
    addSetRow(weight, reps);
}
function removeRow(btn) {
    const container = document.getElementById('sets-edit-container');
    if (container.children.length > 1) {
        btn.closest('.set-row').remove();
        Array.from(container.children).forEach((row, i) => row.querySelector('.set-num').textContent = i + 1);
    }
}

async function saveChanges() {
    const btn = document.getElementById('btn-save-exercise');
    if (btn && btn.disabled) return;

    const name = document.getElementById('edit-exercise-name-input').value.trim();
    if (!name) {
        alert("Введите название упражнения");
        return;
    }
    const sets = Array.from(document.querySelectorAll('.set-row')).map(row => ({
        weight: parseFloat(row.querySelector('.weight-input').value) || 0,
        reps: parseInt(row.querySelector('.reps-input').value) || 0
    }));

    const originalText = btn ? btn.innerHTML : 'СОХРАНИТЬ ИЗМЕНЕНИЯ';
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-not-allowed');
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm mr-2 align-middle">sync</span> СОХРАНЕНИЕ...';
    }

    try {
        let res;
        if (editingExerciseId) {
            // Редактирование существующего
            res = await fetch(`${API_URL}/exercises/${editingExerciseId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, sets })
            });
        } else {
            // Создание нового
            res = await fetch(`${API_URL}/exercises?telegram_id=${userId}&date=${currentDate}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }) // Это соответствует Body(..., embed=True)
            });
            
            if (res.ok) {
                const newEx = await res.json();
                // После создания упражнения обновляем его подходы (так как PUT умеет это делать)
                await fetch(`${API_URL}/exercises/${newEx.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, sets })
                });
            }
        }
        
        if (res.ok) {
            workoutsLoaded = false;
            await loadWorkouts(); // Сначала загружаем данные
            showJournal(); // Затем переключаем экран
        }
    } catch (err) { console.error(err); } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
            btn.innerHTML = originalText;
        }
    }
}

// HELPERS
function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.add('modal-active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('modal-active');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 400);
}

async function deleteExerciseWithConfirm(id, event) {
    if (event) event.stopPropagation();
    const modalId = 'custom-confirm';
    openModal(modalId);
    
    document.getElementById('confirm-cancel').onclick = () => closeModal(modalId);
    document.getElementById('confirm-ok').onclick = async () => {
        try {
            const res = await fetch(`${API_URL}/exercises/${id}`, { method: 'DELETE' });
            if (res.ok) { 
                closeModal(modalId);
                workoutsLoaded = false;
                await loadWorkouts(); 
            }
        } catch (err) { console.error(err); }
    };
}

function promptNewExercise() {
    editingExerciseId = null;
    showCategoryModal();
}

function showExerciseNameModal() {
    const input = document.getElementById('modal-exercise-name-input');
    input.value = '';
    openModal('modal-exercise-name');
    setTimeout(() => input.focus(), 400);
}

function closeExerciseNameModal(save) {
    const input = document.getElementById('modal-exercise-name-input');
    
    if (save) {
        const val = input.value.trim();
        if (!val) return;
        
        // Переходим к деталям с новым именем
        document.getElementById('edit-exercise-name-input').value = val;
        editExerciseWithName(val);
    }

    closeModal('modal-exercise-name');
}

function editExerciseWithName(name) {
    editingExerciseId = null;
    const details = document.getElementById('view-details');
    details.classList.remove('hidden', 'hidden-pane');
    void details.offsetWidth;
    details.classList.add('active-pane');
    document.getElementById('nav-pill').classList.add('hidden');
    document.getElementById('btn-delete-exercise').classList.add('hidden');
    renderEditSets([]);
}

function deleteCurrentExercise() {
    if (editingExerciseId) deleteExerciseWithConfirm(editingExerciseId).then(() => showJournal());
}

/* --- ONBOARDING LOGIC --- */
const STORY_DURATIONS = [5000, 10330, 5790, 6000];
const DEFAULT_STORY_DURATION = 5000;

function startOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    overlay.classList.remove('hidden');
    
    let touchStartT = 0;
    
    const handleStart = (e) => {
        if (e.target.tagName !== 'BUTTON') {
            isStoryPaused = true;
            touchStartT = Date.now();
        }
    };
    
    const handleEnd = (e) => {
        if (touchStartT === 0) return;
        isStoryPaused = false;
        const duration = Date.now() - touchStartT;
        
        // Если это был короткий тап (меньше 300мс) — перелистываем
        if (duration < 300) {
            const rect = overlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width / 3) {
                prevStory();
            } else {
                nextStory();
            }
        }
        touchStartT = 0;
    };

    overlay.addEventListener('pointerdown', handleStart);
    overlay.addEventListener('pointerup', handleEnd);
    overlay.addEventListener('pointercancel', () => {
        isStoryPaused = false;
        touchStartT = 0;
    });
    
    currentStoryIndex = 0;
    showStory(0);
}

function showStory(index) {
    if (storyInterval) clearInterval(storyInterval);
    console.log(`Showing story slide: ${index}`);
    
    // Скрываем абсолютно все слайды перед показом нужного
    document.querySelectorAll('.story-slide').forEach(s => {
        s.classList.remove('active');
    });

    document.querySelectorAll('.story-progress').forEach((p, i) => {
        p.style.width = i < index ? '100%' : '0%';
    });

    const activeSlide = document.getElementById(`slide-${index}`);
    
    if (activeSlide) {
        activeSlide.classList.add('active');
        console.log(`Slide ${index} is now active.`);
        
        // Сбрасываем видео в начало при переключении
        const video = activeSlide.querySelector('video');
        if (video) {
            video.currentTime = 0;
            video.play();
        }
    } else {
        console.error(`Slide element slide-${index} NOT FOUND!`);
    }

    const duration = STORY_DURATIONS[index] || DEFAULT_STORY_DURATION;
    const activeProgress = document.getElementById(`p-${index}`);
    let elapsed = 0;
    
    storyInterval = setInterval(() => {
        if (!isStoryPaused) {
            elapsed += 50;
            let percent = (elapsed / duration) * 100;
            if (percent >= 100) {
                percent = 100;
                clearInterval(storyInterval);
                nextStory();
            }
            if (activeProgress) activeProgress.style.width = percent + '%';
        }
    }, 50);
}

function nextStory() {
    if (storyInterval) clearInterval(storyInterval);
    if (currentStoryIndex < 3) {
        currentStoryIndex++;
        showStory(currentStoryIndex);
    }
}

function prevStory() {
    if (currentStoryIndex > 0) {
        currentStoryIndex--;
        showStory(currentStoryIndex);
    }
}

function finishOnboarding() {
    if (storyInterval) clearInterval(storyInterval);
    console.log("Finishing onboarding with transition...");
    const overlay = document.getElementById('onboarding-overlay');
    
    // Добавляем класс для плавной анимации закрытия
    overlay.classList.add('closing');
    
    // Ждем окончания CSS анимации (0.8s в нашем случае)
    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('closing');
        localStorage.setItem('onboarding_done', 'true');
        showDashboard();
    }, 800);
}

async function loadCatalog() {
    try {
        const res = await fetch(`${API_URL}/exercise-catalog`);
        exerciseCatalog = await res.json();
    } catch(e) { console.error("Ошибка загрузки каталога", e); }
}

async function loadFavorites() {
    if (!userId) return;
    try {
        const res = await fetch(`${API_URL}/user/favorites?telegram_id=${userId}`);
        userFavorites = await res.json();
    } catch(e) { console.error("Ошибка загрузки избранного", e); }
}

const CATEGORY_ICONS = {
    "СПИНА": "back_hand",
    "ПЛЕЧИ": "vertical_align_top",
    "БИЦЕПС, ПРЕДПЛЕЧЬЯ": "fitness_center",
    "ТРИЦЕПС": "reorder",
    "ПРЕСС": "border_inner",
    "ГРУДЬ": "width_normal",
    "НОГИ": "directions_walk"
};

function showCategoryModal() {
    const searchInput = document.getElementById('global-exercise-search');
    if (searchInput) searchInput.value = '';
    
    const results = document.getElementById('global-search-results');
    const grid = document.getElementById('category-grid');
    const customBtn = document.getElementById('btn-custom-exercise');
    
    if (results) results.classList.add('hidden');
    if (grid) grid.classList.remove('hidden');
    if (customBtn) customBtn.classList.remove('hidden');

    grid.innerHTML = '';
    const categories = [...new Set(exerciseCatalog.map(ex => ex.category))];
    
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = "flex flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-800 rounded-[24px] border border-zinc-100 dark:border-zinc-700 active:scale-95 transition-all gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-750 group";
        btn.onclick = () => showExerciseSelectModal(cat);
        const icon = CATEGORY_ICONS[cat] || "fitness_center";
        btn.innerHTML = `
            <span class="material-symbols-outlined text-3xl text-zinc-400 group-hover:text-primary transition-colors">${icon}</span>
            <span class="text-[13px] font-bold text-zinc-700 dark:text-zinc-200 tracking-tight text-center leading-tight">${cat}</span>
        `;
        grid.appendChild(btn);
    });

    openModal('modal-category-select');
}

function closeCategoryModal() {
    closeModal('modal-category-select');
}

// closeExerciseSelectModal уже определена ниже

function openCustomExerciseModal() {
    closeCategoryModal();
    showExerciseNameModal();
}

function showExerciseSelectModal(category) {
    selectedCategory = category;
    closeCategoryModal();
    
    const title = document.getElementById('selected-category-title');
    document.getElementById('exercise-search-input').value = '';
    title.textContent = category;
    renderExercisesList(exerciseCatalog.filter(ex => ex.category === category));

    openModal('modal-exercise-select');
}

function renderExercisesList(list) {
    const container = document.getElementById('exercise-list-container');
    container.innerHTML = '';

    const sorted = [...list].sort((a,b) => {
        const isAFav = userFavorites.includes(a.name);
        const isBFav = userFavorites.includes(b.name);
        if (isAFav && !isBFav) return -1;
        if (!isAFav && isBFav) return 1;
        return a.name.localeCompare(b.name);
    });

    sorted.forEach(ex => {
        const isFav = userFavorites.includes(ex.name);
        const row = document.createElement('div');
        row.className = "flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors mb-2";
        
        row.innerHTML = `
            <div class="flex-1 cursor-pointer" onclick="selectExerciseFromList('${ex.name}')">
                <p class="text-[14px] font-bold text-zinc-800 dark:text-zinc-200">${ex.name}</p>
            </div>
            <button onclick="toggleFavorite('${ex.name}', event)" class="p-2 -mr-2">
                <span class="material-symbols-outlined text-[20px] ${isFav ? 'text-yellow-400' : 'text-zinc-300'}" 
                    style="${isFav ? 'font-variation-settings: \'FILL\' 1' : ''}">star</span>
            </button>
        `;
        container.appendChild(row);
    });
}

function filterExercisesList() {
    const q = document.getElementById('exercise-search-input').value.toLowerCase();
    let filtered;
    if (!q) {
        filtered = exerciseCatalog.filter(ex => ex.category === selectedCategory);
    } else {
        filtered = exerciseCatalog.filter(ex => ex.name.toLowerCase().includes(q));
    }
    renderExercisesList(filtered);
}

async function toggleFavorite(name, event) {
    if (event) event.stopPropagation();
    const isFav = userFavorites.includes(name);
    
    try {
        if (isFav) {
            await fetch(`${API_URL}/user/favorites?telegram_id=${userId}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
            userFavorites = userFavorites.filter(f => f !== name);
        } else {
            await fetch(`${API_URL}/user/favorites?telegram_id=${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            userFavorites.push(name);
        }
        filterExercisesList(); 
    } catch(e) { console.error("Ошибка избранного", e); }
}

function selectExerciseFromList(name) {
    document.getElementById('modal-exercise-name-input').value = name;
    closeExerciseSelectModal();
    closeExerciseNameModal(true);
}

function closeExerciseSelectModal() {
    closeModal('modal-exercise-select');
    // Сбрасываем глобальный поиск проекта если закрываем выбор
    const q = document.getElementById('global-exercise-search');
    if (q) q.value = '';
}

function filterGlobalExercises() {
    const q = document.getElementById('global-exercise-search').value.toLowerCase();
    const grid = document.getElementById('category-grid');
    const results = document.getElementById('global-search-results');
    const customBtn = document.getElementById('btn-custom-exercise');

    if (!q) {
        grid.classList.remove('hidden');
        results.classList.add('hidden');
        customBtn.classList.remove('hidden');
        return;
    }

    grid.classList.add('hidden');
    results.classList.remove('hidden');
    customBtn.classList.add('hidden');

    const filtered = exerciseCatalog.filter(ex => ex.name.toLowerCase().includes(q));
    
    results.innerHTML = '';
    if (filtered.length === 0) {
        results.innerHTML = '<div class="p-8 text-center text-zinc-500 text-sm italic">Ничего не найдено</div>';
        return;
    }

    const sorted = [...filtered].sort((a,b) => {
        const isAFav = userFavorites.includes(a.name);
        const isBFav = userFavorites.includes(b.name);
        if (isAFav && !isBFav) return -1;
        if (!isAFav && isBFav) return 1;
        return a.name.localeCompare(b.name);
    });

    sorted.forEach(ex => {
        const isFav = userFavorites.includes(ex.name);
        const row = document.createElement('div');
        row.className = "flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300";
        
        row.innerHTML = `
            <div class="flex-1 cursor-pointer" onclick="selectExerciseFromList('${ex.name}')">
                <p class="text-[14px] font-bold text-zinc-800 dark:text-zinc-200">${ex.name}</p>
                <p class="text-[10px] text-zinc-500 uppercase font-medium mt-0.5">${ex.category}</p>
            </div>
            <button onclick="toggleFavorite('${ex.name}', event)" class="p-2 -mr-2">
                <span class="material-symbols-outlined text-[20px] ${isFav ? 'text-yellow-400' : 'text-zinc-300'}" 
                    style="${isFav ? 'font-variation-settings: \'FILL\' 1' : ''}">star</span>
            </button>
        `;
        results.appendChild(row);
    });
}

function backToCategories() {
    closeExerciseSelectModal();
    setTimeout(showCategoryModal, 310);
}

