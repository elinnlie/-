const STORAGE_KEY = "fitflow-data-v1";
function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
const today = localDateKey();

const exercises = [
  "深蹲", "杠铃卧推", "哑铃卧推", "硬拉", "罗马尼亚硬拉", "引体向上", "高位下拉",
  "坐姿划船", "杠铃划船", "哑铃肩推", "侧平举", "二头弯举", "绳索下压", "臀桥", "箭步蹲", "平板支撑", "卷腹"
];
const bodyParts = ["胸", "背", "肩", "手臂", "腿", "臀", "核心", "全身", "有氧"];
const commonFoods = {
  "鸡胸肉": 165, "鸡蛋": 144, "米饭": 116, "燕麦": 379, "全麦面包": 247, "牛奶": 61,
  "希腊酸奶": 97, "牛肉": 250, "三文鱼": 208, "豆腐": 76, "西兰花": 34, "香蕉": 89,
  "苹果": 52, "红薯": 86, "土豆": 77, "花生酱": 588, "乳清蛋白粉": 400
};
const factors = [
  ["salty", "吃得偏咸"], ["carbs", "碳水较多"], ["late", "较晚进食"], ["sore", "训练酸痛"],
  ["sleep", "睡眠不足"], ["period", "生理期附近"], ["bowel", "排便变化"], ["alcohol", "饮酒"]
];

const defaultData = {
  settings: { appName: "FitFlow" },
  profile: null,
  trainings: [],
  foods: [],
  weights: []
};

let data = loadData();
let editingTrainingId = null;
let editingFoodId = null;
let cloudReady = false;
let syncTimer = null;
let syncRevision = 0;

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...structuredClone(defaultData), ...saved, settings: { ...defaultData.settings, ...(saved?.settings || {}) } };
  } catch {
    return structuredClone(defaultData);
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  renderAll();
  queueCloudSave();
}

function normalizeState(value) {
  return {
    settings: { ...defaultData.settings, ...(value?.settings || {}) },
    profile: value?.profile || null,
    trainings: Array.isArray(value?.trainings) ? value.trainings : [],
    foods: Array.isArray(value?.foods) ? value.foods : [],
    weights: Array.isArray(value?.weights) ? value.weights : []
  };
}

function hasUserData(value) {
  return Boolean(
    value?.profile ||
    value?.trainings?.length ||
    value?.foods?.length ||
    value?.weights?.length ||
    (value?.settings?.appName && value.settings.appName !== "FitFlow")
  );
}

function setSyncStatus(label, state = "local", detail = "") {
  const node = $("#syncStatus");
  if (!node) return;
  node.textContent = label;
  node.dataset.state = state;
  node.title = detail || label;
}

function queueCloudSave() {
  if (!cloudReady || !window.fitflowCloud?.isConnected()) return;
  const revision = ++syncRevision;
  clearTimeout(syncTimer);
  setSyncStatus("同步中", "syncing", "数据正在写入云数据库");
  syncTimer = setTimeout(async () => {
    try {
      await window.fitflowCloud.save(data);
      if (revision === syncRevision) setSyncStatus("已同步", "synced", "数据已保存到云数据库");
    } catch (error) {
      console.warn("FitFlow sync failed:", error);
      if (revision === syncRevision) setSyncStatus("本机保存", "local", "云端暂时不可用，数据已保存在本机");
    }
  }, 450);
}

async function initializeCloud() {
  if (!window.fitflowCloud) {
    setSyncStatus("本机保存", "local", "当前版本未加载云端数据组件");
    return;
  }

  setSyncStatus("连接中", "syncing", "正在连接云数据库");
  const result = await window.fitflowCloud.initialize();
  if (!result.enabled) {
    setSyncStatus("本机保存", "local", result.reason || "云数据库尚未配置");
    return;
  }

  const remoteState = normalizeState(result.state);
  const remoteHasData = hasUserData(remoteState);
  const localHasData = hasUserData(data);
  cloudReady = true;

  try {
    if (remoteHasData) {
      data = remoteState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      hydrateProfile();
      renderAll();
    } else if (localHasData) {
      setSyncStatus("迁移中", "syncing", "正在把第一阶段的本机数据迁移到云数据库");
      await window.fitflowCloud.save(data);
    }
    setSyncStatus("已同步", "synced", "数据已保存到云数据库");
  } catch (error) {
    console.warn("FitFlow initial sync failed:", error);
    setSyncStatus("本机保存", "local", "首次云端同步失败，本机数据没有丢失");
  }
}

function $(selector, root = document) { return root.querySelector(selector); }
function $$(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function formatNumber(value) { return Math.round(Number(value || 0)).toLocaleString("zh-CN"); }
function formatDate(date) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
}

function init() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date());
  $("#trainingDate").value = today;
  $("#foodDate").value = today;
  $("#weightDate").value = today;

  $("#exerciseOptions").innerHTML = exercises.map(x => `<option value="${x}"></option>`).join("");
  $("#foodOptions").innerHTML = Object.entries(commonFoods).map(([name, kcal]) => `<option value="${name}">${kcal} kcal/100g</option>`).join("");
  $("#bodyPartChips").innerHTML = bodyParts.map(x => `<label class="choice-chip"><input type="checkbox" value="${x}"><span>${x}</span></label>`).join("");
  $("#factorGrid").innerHTML = factors.map(([value, label]) => `<label class="factor-chip"><input type="checkbox" value="${value}"><span>${label}</span></label>`).join("");

  bindEvents();
  hydrateProfile();
  addExerciseRow("深蹲", 3, 10, 0);
  addFoodRow();
  renderAll();
  initializeCloud();
}

function bindEvents() {
  $$('[data-go]').forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
  $("#openQuickWeight").addEventListener("click", openWeightModal);
  $("#showWeightModal").addEventListener("click", openWeightModal);
  $("#addExercise").addEventListener("click", () => addExerciseRow());
  $("#exerciseRows").addEventListener("input", updateVolumePreview);
  $("#trainingForm").addEventListener("submit", saveTraining);
  $("#cancelTrainingEdit").addEventListener("click", resetTrainingForm);
  $("#addFood").addEventListener("click", () => addFoodRow());
  $("#foodRows").addEventListener("input", handleFoodRowInput);
  $("#foodForm").addEventListener("submit", saveFood);
  $("#cancelFoodEdit").addEventListener("click", resetFoodForm);
  $("#foodDate").addEventListener("change", renderNutrition);
  $("#profileForm").addEventListener("submit", saveProfile);
  $("#weightForm").addEventListener("submit", saveWeight);
  $("#weightValue").addEventListener("input", previewFluctuation);
  $("#weightDate").addEventListener("change", previewFluctuation);
  $("#factorGrid").addEventListener("change", previewFluctuation);
  $("#exportData").addEventListener("click", exportData);
  $("#importData").addEventListener("change", importData);
  $("#clearData").addEventListener("click", clearData);
  $("#trainingHistory").addEventListener("click", handleRecordAction);
  $("#foodHistory").addEventListener("click", handleRecordAction);
}

function navigate(page) {
  $$(".page").forEach(p => p.classList.toggle("active", p.dataset.page === page));
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.go === page));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function addExerciseRow(name = "", sets = 3, reps = 10, weight = 0) {
  const fragment = $("#exerciseTemplate").content.cloneNode(true);
  $(".exercise-name", fragment).value = name;
  $(".exercise-sets", fragment).value = sets;
  $(".exercise-reps", fragment).value = reps;
  $(".exercise-weight", fragment).value = weight;
  $(".remove-row", fragment).addEventListener("click", event => {
    if ($$(".exercise-row", $("#exerciseRows")).length === 1) return toast("至少保留一个动作");
    event.currentTarget.closest(".exercise-row").remove();
    updateVolumePreview();
  });
  $("#exerciseRows").append(fragment);
  updateVolumePreview();
}

function collectExercises() {
  return $$(".exercise-row", $("#exerciseRows")).map(row => ({
    name: $(".exercise-name", row).value.trim(),
    sets: Number($(".exercise-sets", row).value),
    reps: Number($(".exercise-reps", row).value),
    weight: Number($(".exercise-weight", row).value)
  })).filter(item => item.name);
}

function updateVolumePreview() {
  const volume = collectExercises().reduce((sum, item) => sum + item.sets * item.reps * item.weight, 0);
  $("#totalVolume").textContent = formatNumber(volume);
}

function saveTraining(event) {
  event.preventDefault();
  const parts = $$("#bodyPartChips input:checked").map(input => input.value);
  const entries = collectExercises();
  if (!parts.length) return toast("请至少选择一个训练部位");
  if (!entries.length) return toast("请至少填写一个训练动作");
  const existing = editingTrainingId ? data.trainings.find(item => item.id === editingTrainingId) : null;
  const training = {
    id: existing?.id || crypto.randomUUID(),
    date: $("#trainingDate").value,
    parts,
    exercises: entries,
    note: $("#trainingNote").value.trim(),
    volume: entries.reduce((sum, item) => sum + item.sets * item.reps * item.weight, 0),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  if (existing) Object.assign(existing, training);
  else data.trainings.push(training);
  saveData();
  const wasEditing = Boolean(editingTrainingId);
  resetTrainingForm();
  toast(wasEditing ? "训练记录已更新" : "训练已保存");
}

function resetTrainingForm() {
  editingTrainingId = null;
  $("#trainingDate").value = today;
  $$("#bodyPartChips input").forEach(input => input.checked = false);
  $("#trainingNote").value = "";
  $("#exerciseRows").innerHTML = "";
  addExerciseRow();
  $("#saveTrainingButton").textContent = "保存训练";
  $("#cancelTrainingEdit").hidden = true;
}

function editTraining(id) {
  const item = data.trainings.find(entry => entry.id === id);
  if (!item) return toast("找不到这条训练记录");
  editingTrainingId = id;
  $("#trainingDate").value = item.date;
  $$("#bodyPartChips input").forEach(input => input.checked = item.parts.includes(input.value));
  $("#trainingNote").value = item.note || "";
  $("#exerciseRows").innerHTML = "";
  item.exercises.forEach(exercise => addExerciseRow(exercise.name, exercise.sets, exercise.reps, exercise.weight));
  $("#saveTrainingButton").textContent = "更新训练";
  $("#cancelTrainingEdit").hidden = false;
  navigate("training");
  toast("已载入训练记录，可以修改");
}

function renderTrainings() {
  const list = $("#trainingHistory");
  const entries = [...data.trainings].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">第一次训练记录会出现在这里</div>';
    return;
  }
  list.innerHTML = entries.slice(0, 12).map(item => `
    <article class="history-item card">
      <div class="history-date">${formatDate(item.date).replace("月", "月<br>")}</div>
      <div class="history-content">
        <strong>${escapeHtml(item.parts.join(" · "))}</strong>
        <p>${item.exercises.map(x => `${escapeHtml(x.name)} ${x.sets}×${x.reps}${x.weight ? ` @${x.weight}kg` : ""}`).join("；")}</p>
        ${item.note ? `<p>“${escapeHtml(item.note)}”</p>` : ""}
      </div>
      <div class="history-meta">
        <strong>${formatNumber(item.volume)} kg</strong>
        <div class="record-actions">
          <button class="edit-item" data-edit="training" data-id="${item.id}" type="button">修改</button>
          <button class="delete-item" data-delete="training" data-id="${item.id}" type="button">删除</button>
        </div>
      </div>
    </article>`).join("");
}

function normalizeFoodRecord(record) {
  const items = Array.isArray(record.items) ? record.items : [{
    name: record.name || "未命名食物",
    grams: Number(record.grams || 0),
    per100: Number(record.per100 || 0),
    calories: Number(record.calories || 0)
  }];
  return {
    ...record,
    meal: record.meal || "未分类",
    items: items.map(item => ({
      ...item,
      grams: Number(item.grams || 0),
      per100: Number(item.per100 || 0),
      calories: Number(item.calories ?? (Number(item.grams || 0) * Number(item.per100 || 0) / 100))
    })),
    calories: items.reduce((sum, item) => sum + Number(item.calories ?? (Number(item.grams || 0) * Number(item.per100 || 0) / 100)), 0)
  };
}

function getFoodCalories(record) {
  return normalizeFoodRecord(record).calories;
}

function addFoodRow(item = {}) {
  const fragment = $("#foodRowTemplate").content.cloneNode(true);
  const row = $(".food-row", fragment);
  $(".food-name", fragment).value = item.name || "";
  $(".food-grams", fragment).value = item.grams || "";
  $(".food-kcal", fragment).value = item.per100 || "";
  $(".remove-food-row", fragment).addEventListener("click", event => {
    if ($$(".food-row", $("#foodRows")).length === 1) return toast("一餐至少保留一种食物");
    event.currentTarget.closest(".food-row").remove();
    updateMealTotal();
  });
  $("#foodRows").append(fragment);
  updateFoodRow(row);
}

function handleFoodRowInput(event) {
  const row = event.target.closest(".food-row");
  if (!row) return;
  if (event.target.classList.contains("food-name")) {
    const kcal = commonFoods[event.target.value.trim()];
    if (kcal) $(".food-kcal", row).value = kcal;
  }
  updateFoodRow(row);
  updateMealTotal();
}

function updateFoodRow(row) {
  if (!row) return;
  const grams = Number($(".food-grams", row).value || 0);
  const per100 = Number($(".food-kcal", row).value || 0);
  $(".food-row-calories strong", row).textContent = `${formatNumber(grams * per100 / 100)} kcal`;
}

function collectFoodItems() {
  return $$(".food-row", $("#foodRows")).map(row => {
    const grams = Number($(".food-grams", row).value);
    const per100 = Number($(".food-kcal", row).value);
    return {
      name: $(".food-name", row).value.trim(),
      grams,
      per100,
      calories: grams * per100 / 100
    };
  }).filter(item => item.name);
}

function updateMealTotal() {
  const total = collectFoodItems().reduce((sum, item) => sum + item.calories, 0);
  $("#mealTotalCalories").textContent = formatNumber(total);
}

function saveFood(event) {
  event.preventDefault();
  const items = collectFoodItems();
  if (!items.length) return toast("请至少填写一种食物");
  const existing = editingFoodId ? data.foods.find(item => item.id === editingFoodId) : null;
  const record = {
    id: existing?.id || crypto.randomUUID(),
    date: $("#foodDate").value || today,
    meal: $("#foodMeal").value,
    items,
    calories: items.reduce((sum, item) => sum + item.calories, 0),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  if (existing) Object.assign(existing, record);
  else data.foods.push(record);
  const wasEditing = Boolean(editingFoodId);
  saveData();
  resetFoodForm();
  toast(wasEditing ? "本餐记录已更新" : "本餐已保存");
}

function resetFoodForm() {
  editingFoodId = null;
  $("#foodMeal").value = "";
  $("#foodRows").innerHTML = "";
  addFoodRow();
  updateMealTotal();
  $("#saveFoodButton").textContent = "保存本餐";
  $("#cancelFoodEdit").hidden = true;
}

function editFood(id) {
  const raw = data.foods.find(item => item.id === id);
  if (!raw) return toast("找不到这条饮食记录");
  const record = normalizeFoodRecord(raw);
  editingFoodId = id;
  $("#foodDate").value = record.date;
  $("#foodMeal").value = ["第一餐", "第二餐", "第三餐", "加餐"].includes(record.meal) ? record.meal : "";
  $("#foodRows").innerHTML = "";
  record.items.forEach(item => addFoodRow(item));
  updateMealTotal();
  $("#saveFoodButton").textContent = "更新本餐";
  $("#cancelFoodEdit").hidden = false;
  navigate("nutrition");
  renderNutrition();
  toast("已载入本餐，可以修改");
}

function renderNutrition() {
  const selected = $("#foodDate").value || today;
  const meals = data.foods.filter(item => item.date === selected).map(normalizeFoodRecord).sort((a, b) => b.createdAt - a.createdAt);
  const eaten = meals.reduce((sum, item) => sum + item.calories, 0);
  const target = calculateTargets(data.profile)?.calories || 0;
  $("#eatenCalories").textContent = formatNumber(eaten);
  $("#remainingCalories").textContent = target ? formatNumber(target - eaten) : "--";
  $("#foodProgress").style.width = target ? `${Math.min(100, eaten / target * 100)}%` : "0%";
  $("#foodProgress").style.background = eaten > target ? "#cfd7ca" : "";
  const targets = calculateTargets(data.profile);
  $("#proteinTarget").textContent = targets ? `${targets.protein} g` : "-- g";
  $("#fatTarget").textContent = targets ? `${targets.fat} g` : "-- g";
  $("#carbTarget").textContent = targets ? `${targets.carbs} g` : "-- g";
  $("#foodHistory").innerHTML = meals.length ? meals.map(item => `
    <article class="history-item card">
      <div class="history-date meal-label">${escapeHtml(item.meal)}</div>
      <div class="history-content">
        <strong>${escapeHtml(item.meal)} · ${item.items.length} 种食物</strong>
        <div class="meal-food-list">${item.items.map(food => `<span>${escapeHtml(food.name)} ${formatNumber(food.grams)}g</span>`).join("")}</div>
      </div>
      <div class="history-meta">
        <strong>${formatNumber(item.calories)} kcal</strong>
        <div class="record-actions">
          <button class="edit-item" data-edit="food" data-id="${item.id}" type="button">修改</button>
          <button class="delete-item" data-delete="food" data-id="${item.id}" type="button">删除</button>
        </div>
      </div>
    </article>`).join("") : '<div class="empty-state">这一天还没有记录餐次</div>';
}

function calculateTargets(profile) {
  if (!profile || !profile.weight || !profile.height || !profile.age || !profile.sex || !profile.activity || !profile.goal) return null;
  const { weight, height, age, sex, bodyFat, activity, goal } = profile;
  let bmr;
  let formula;
  if (bodyFat >= 3 && bodyFat <= 60) {
    const leanMass = weight * (1 - bodyFat / 100);
    bmr = 370 + 21.6 * leanMass;
    formula = "Katch–McArdle（基于去脂体重）";
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age + (sex === "male" ? 5 : -161);
    formula = "Mifflin–St Jeor（基于身高体重）";
  }
  const tdee = bmr * Number(activity);
  const multiplier = goal === "lose" ? 0.85 : goal === "gain" ? 1.1 : 1;
  const rawCalories = Math.round(tdee * multiplier / 10) * 10;
  const safetyFloor = sex === "male" ? 1500 : 1200;
  const calories = Math.max(safetyFloor, rawCalories);
  const proteinRate = goal === "lose" ? 2 : goal === "gain" ? 1.8 : 1.6;
  const protein = Math.round(weight * proteinRate);
  const fat = Math.round(weight * 0.8);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const pace = goal === "lose" ? `-${(weight * 0.003).toFixed(1)}～${(weight * 0.007).toFixed(1)} kg/周` : goal === "gain" ? `+${(weight * 0.001).toFixed(1)}～${(weight * 0.003).toFixed(1)} kg/周` : "基本稳定";
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), calories, protein, fat, carbs, pace, formula, adjustedToFloor: rawCalories < safetyFloor, safetyFloor };
}

function saveProfile(event) {
  event.preventDefault();
  const selectedGoal = $('input[name="goal"]:checked');
  if (!selectedGoal) return toast("请选择当前目标");
  const profile = {
    sex: $("#sex").value, age: Number($("#age").value), height: Number($("#height").value),
    weight: Number($("#weight").value), bodyFat: Number($("#bodyFat").value) || null,
    activity: Number($("#activity").value), goal: selectedGoal.value
  };
  const targets = calculateTargets(profile);
  if (targets.adjustedToFloor) toast(`公式结果偏低，已采用 ${targets.safetyFloor} kcal 安全下限`);
  data.profile = profile;
  data.settings.appName = $("#appName").value.trim() || "FitFlow";
  if (!data.weights.some(item => item.date === today)) {
    data.weights.push({ id: crypto.randomUUID(), date: today, value: profile.weight, factors: [], createdAt: Date.now() });
  }
  saveData();
  toast("目标已更新");
}

function hydrateProfile() {
  $("#appName").value = data.settings.appName || "FitFlow";
  $("#sex").value = "";
  $("#age").value = "";
  $("#height").value = "";
  $("#weight").value = "";
  $("#bodyFat").value = "";
  $("#activity").value = "";
  $$('input[name="goal"]').forEach(input => input.checked = false);
  if (!data.profile) return;
  const p = data.profile;
  $("#sex").value = p.sex;
  $("#age").value = p.age;
  $("#height").value = p.height;
  $("#weight").value = p.weight;
  $("#bodyFat").value = p.bodyFat || "";
  $("#activity").value = String(p.activity);
  const goal = $(`input[name="goal"][value="${p.goal}"]`);
  if (goal) goal.checked = true;
}

function renderProfileResult() {
  const result = calculateTargets(data.profile);
  if (!result) {
    $("#resultCalories").textContent = "--";
    $("#resultBmr").textContent = "--";
    $("#resultTdee").textContent = "--";
    $("#resultPace").textContent = "--";
    $("#formulaNote").textContent = "请先填写身体资料。";
    return;
  }
  $("#resultCalories").textContent = formatNumber(result.calories);
  $("#resultBmr").textContent = `${formatNumber(result.bmr)} kcal`;
  $("#resultTdee").textContent = `${formatNumber(result.tdee)} kcal`;
  $("#resultPace").textContent = result.pace;
  const floorNote = result.adjustedToFloor ? ` 原始结果过低，已采用 ${result.safetyFloor} kcal 的保守下限。` : "";
  $("#formulaNote").textContent = `采用 ${result.formula} 估算。${floorNote} 目标值用于起步；连续执行 2–3 周后，按 7 日平均体重趋势每次微调 100–150 kcal。`;
}

function openWeightModal() {
  const last = [...data.weights].sort((a, b) => b.date.localeCompare(a.date))[0];
  $("#weightDate").value = today;
  $("#weightValue").value = last?.value || data.profile?.weight || "";
  $$("#factorGrid input").forEach(input => input.checked = false);
  previewFluctuation();
  $("#weightModal").showModal();
}

function getFluctuationExplanation(value, selectedFactors, referenceValue = null) {
  const weights = [...data.weights].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const last = weights[0];
  const baseline = referenceValue ?? last?.value;
  if (baseline == null || !value) return "这是你的第一条基线记录。明天开始会结合变化给出解释。";
  const delta = value - baseline;
  const abs = Math.abs(delta);
  const direction = delta > 0 ? "上升" : delta < 0 ? "下降" : "没有变化";
  const explanations = [];
  const factorMap = {
    salty: "盐分会让身体短期留水", carbs: "碳水会补充糖原，而每克糖原会伴随约 3 克水",
    late: "较晚进食会增加消化道内食物重量", sore: "训练后的炎症修复可能带来暂时性水分滞留",
    sleep: "睡眠不足可能影响压力激素和水分平衡", period: "生理周期常造成明显的水分波动",
    bowel: "排便与消化道内容物会直接影响秤上数字", alcohol: "饮酒会扰动水分、睡眠和次日饮食"
  };
  selectedFactors.forEach(key => explanations.push(factorMap[key]));
  let lead = `较上次${direction} ${abs.toFixed(1)} kg。`;
  if (delta === 0) lead = "体重与上次相同。";
  if (abs >= 0.3) lead += " 单日变化大多来自水分、糖原和消化道内容物，不等于同等脂肪变化。";
  else lead += " 这属于很常见的日常波动。";
  if (explanations.length) lead += ` 你勾选的因素中，${explanations.join("；")}。`;
  return `${lead} 更建议观察至少 7 天平均值；约 1 kg 脂肪对应长期累计约 7700 kcal 的能量差。`;
}

function previewFluctuation() {
  const value = Number($("#weightValue").value);
  const selected = $$("#factorGrid input:checked").map(input => input.value);
  const entryDate = $("#weightDate").value;
  const previous = [...data.weights]
    .filter(item => item.date < entryDate)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
  $("#fluctuationBox").textContent = getFluctuationExplanation(value, selected, previous?.value ?? null);
}

function saveWeight(event) {
  event.preventDefault();
  const date = $("#weightDate").value;
  const value = Number($("#weightValue").value);
  const selected = $$("#factorGrid input:checked").map(input => input.value);
  const existing = data.weights.find(item => item.date === date);
  if (existing) {
    existing.value = value; existing.factors = selected; existing.createdAt = Date.now();
  } else {
    data.weights.push({ id: crypto.randomUUID(), date, value, factors: selected, createdAt: Date.now() });
  }
  saveData();
  $("#weightModal").close();
  toast("体重已记录");
}

function renderWeights() {
  const sorted = [...data.weights].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const recent = sorted.slice(-7);
  const latest = recent.at(-1);
  const previous = recent.at(-2);
  $("#latestWeight").textContent = latest ? `${latest.value.toFixed(1)} kg` : "-- kg";
  $("#weightDelta").textContent = latest && previous ? `${latest.value - previous.value >= 0 ? "+" : ""}${(latest.value - previous.value).toFixed(1)} kg` : "--";
  $("#weightDelta").style.color = latest && previous && latest.value > previous.value ? "#687264" : "";
  $("#weightAverage").textContent = recent.length ? `${(recent.reduce((sum, x) => sum + x.value, 0) / recent.length).toFixed(1)} kg` : "--";
  const chart = $("#weightChart");
  if (recent.length < 2) {
    chart.innerHTML = ""; $("#weightEmpty").hidden = false; return;
  }
  $("#weightEmpty").hidden = true;
  const min = Math.min(...recent.map(x => x.value));
  const max = Math.max(...recent.map(x => x.value));
  const range = Math.max(.5, max - min);
  chart.innerHTML = recent.map(item => {
    const height = 22 + ((item.value - min) / range) * 70;
    return `<div class="chart-column" style="--bar:${height}%" title="${item.date}: ${item.value}kg"><span>${item.date.slice(5).replace("-", "/")}</span></div>`;
  }).join("");
}

function renderHome() {
  const target = calculateTargets(data.profile);
  const eaten = data.foods.filter(item => item.date === today).reduce((sum, item) => sum + getFoodCalories(item), 0);
  const todayTraining = data.trainings.filter(item => item.date === today);
  $("#brandName").textContent = data.settings.appName || "FitFlow";
  document.title = data.settings.appName || "FitFlow";
  $("#homeTarget").textContent = target ? formatNumber(target.calories) : "--";
  $("#homeRemaining").textContent = target ? formatNumber(target.calories - eaten) : "--";
  $("#calorieRing").style.setProperty("--progress", target ? `${Math.min(100, eaten / target.calories * 100)}%` : "0%");
  const goalNames = { lose: "减脂", maintain: "维持", gain: "增肌" };
  $("#homeGoalCopy").textContent = target ? `${goalNames[data.profile.goal]}目标 · 维持热量约 ${formatNumber(target.tdee)} kcal` : "完善身体资料后生成个性化目标";
  $("#homeFoodStatus").textContent = `今日已记录 ${formatNumber(eaten)} kcal`;
  $("#homeTrainingStatus").textContent = todayTraining.length ? `已完成 ${todayTraining.length} 次记录` : "还没有训练记录";

  const weights = [...data.weights].sort((a, b) => b.date.localeCompare(a.date));
  if (weights.length >= 2) {
    const explanation = getFluctuationExplanation(weights[0].value, weights[0].factors || [], weights[1].value);
    $("#dailyInsightTitle").textContent = "体重波动不等于脂肪变化";
    $("#dailyInsightText").textContent = explanation;
  } else if (target) {
    $("#dailyInsightTitle").textContent = "你的起步目标已生成";
    $("#dailyInsightText").textContent = `先执行 ${formatNumber(target.calories)} kcal/天并连续记录体重。2–3 周后再按趋势调整，不要频繁修改。`;
  }
}

function handleRecordAction(event) {
  const editButton = event.target.closest("[data-edit]");
  if (editButton) {
    if (editButton.dataset.edit === "training") editTraining(editButton.dataset.id);
    else editFood(editButton.dataset.id);
    return;
  }
  const deleteButton = event.target.closest("[data-delete]");
  if (!deleteButton) return;
  const type = deleteButton.dataset.delete;
  if (!confirm(type === "training" ? "确定删除这条训练记录吗？" : "确定删除这餐记录吗？")) return;
  const key = type === "training" ? "trainings" : "foods";
  data[key] = data[key].filter(item => item.id !== deleteButton.dataset.id);
  if (type === "training" && editingTrainingId === deleteButton.dataset.id) resetTrainingForm();
  if (type === "food" && editingFoodId === deleteButton.dataset.id) resetFoodForm();
  saveData();
  toast(type === "training" ? "训练记录已删除" : "本餐记录已删除");
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `fitflow-backup-${today}.json`; anchor.click();
  URL.revokeObjectURL(url);
  toast("备份已导出");
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.trainings) || !Array.isArray(parsed.foods) || !Array.isArray(parsed.weights)) throw new Error();
      data = { ...structuredClone(defaultData), ...parsed };
      saveData(); hydrateProfile(); toast("备份已导入");
    } catch { toast("文件格式不正确"); }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function clearData() {
  if (!confirm("这会删除全部训练、饮食、体重和个人资料，且无法撤销。确定继续吗？")) return;
  data = structuredClone(defaultData);
  localStorage.removeItem(STORAGE_KEY);
  hydrateProfile();
  resetTrainingForm();
  resetFoodForm();
  saveData();
  toast("全部数据已清空");
}

function renderAll() {
  renderTrainings();
  renderNutrition();
  renderProfileResult();
  renderWeights();
  renderHome();
}

init();
