(function () {
  "use strict";

  const statusLabels = {
    idle: "空闲",
    connecting: "连接中",
    starting_profile: "启动浏览器",
    logging_in: "登录中",
    navigating: "导航中",
    pricing: "核价中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止"
  };

  const actionLabels = {
    recorded: "已记录",
    confirmed: "已确认",
    rejected: "已拒绝",
    skipped: "已跳过"
  };

  const reasonLabels = {
    CURRENT_PRICE_ABOVE_70_PERCENT: "当前售价高于 70% 阈值",
    OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8: "官方建议价至少 8",
    OFFICIAL_SUGGESTED_PRICE_AT_LEAST_LOW_PRICE_THRESHOLD: "官方建议价达到低价阈值",
    OFFICIAL_SUGGESTED_PRICE_BELOW_LOW_PRICE_THRESHOLD: "官方建议价低于低价阈值",
    FAILED_BOTH_RULES: "未满足核价规则"
  };

  const state = {
    snapshot: undefined,
    pendingAction: undefined,
    socketConnected: false,
    fetchLoaded: false,
    pollingTimer: undefined,
    profileNames: []
  };

  const elements = {
    connectionText: document.getElementById("connectionText"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    stopButton: document.getElementById("stopButton"),
    selectAllShopsButton: document.getElementById("selectAllShopsButton"),
    clearAllShopsButton: document.getElementById("clearAllShopsButton"),
    shopPicker: document.getElementById("shopPicker"),
    rulePicker: document.getElementById("rulePicker"),
    lowPriceThresholdInput: document.getElementById("lowPriceThresholdInput"),
    statusValue: document.getElementById("statusValue"),
    resultCount: document.getElementById("resultCount"),
    pauseValue: document.getElementById("pauseValue"),
    stopValue: document.getElementById("stopValue"),
    errorNotice: document.getElementById("errorNotice"),
    updatedAt: document.getElementById("updatedAt"),
    resultsBody: document.getElementById("resultsBody"),
    emptyResults: document.getElementById("emptyResults"),
    logCount: document.getElementById("logCount"),
    logsOutput: document.getElementById("logsOutput")
  };

  elements.startButton.addEventListener("click", () => postAction("start"));
  elements.pauseButton.addEventListener("click", () => postAction("pause"));
  elements.stopButton.addEventListener("click", () => postAction("stop"));
  elements.selectAllShopsButton.addEventListener("click", () => setAllShopsSelected(true));
  elements.clearAllShopsButton.addEventListener("click", () => setAllShopsSelected(false));

  fetchProfiles();
  fetchState();
  startStatePolling();
  connectWebSocket();
  render();

  async function fetchProfiles() {
    try {
      const response = await fetch("/api/profiles", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`GET /api/profiles failed: ${response.status}`);
      }
      const payload = await response.json();
      state.profileNames = Array.isArray(payload.profileNames) ? payload.profileNames.filter((name) => typeof name === "string") : [];
      renderShopPicker();
      clearError();
    } catch (error) {
      showError(formatError(error));
    }
  }

  async function fetchState() {
    try {
      const response = await fetch("/api/state", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`GET /api/state failed: ${response.status}`);
      }
      const snapshot = await response.json();
      state.fetchLoaded = true;
      applySnapshot(snapshot);
      clearError();
    } catch (error) {
      state.fetchLoaded = false;
      showError(formatError(error));
      render();
    }
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.addEventListener("open", () => {
      state.socketConnected = true;
      stopStatePolling();
      clearError();
      renderConnection();
    });

    socket.addEventListener("message", (event) => {
      try {
        applySnapshot(JSON.parse(event.data));
        clearError();
      } catch (error) {
        showError(`无法解析 WebSocket 数据: ${formatError(error)}`);
      }
    });

    socket.addEventListener("close", () => {
      state.socketConnected = false;
      startStatePolling();
      renderConnection();
      window.setTimeout(connectWebSocket, 2000);
    });

    socket.addEventListener("error", () => {
      state.socketConnected = false;
      startStatePolling();
      showError("WebSocket 连接异常，正在重试");
      renderConnection();
    });
  }

  function startStatePolling() {
    if (state.pollingTimer) {
      return;
    }
    state.pollingTimer = window.setInterval(fetchState, 2000);
  }

  function stopStatePolling() {
    if (!state.pollingTimer) {
      return;
    }
    window.clearInterval(state.pollingTimer);
    state.pollingTimer = undefined;
  }

  async function postAction(action) {
    state.pendingAction = action;
    clearError();
    renderButtons();

    try {
      const body = action === "start"
        ? { profileNames: selectedProfileNames(), pricingRule: selectedPricingRule(), pricingOptions: selectedPricingOptions() }
        : undefined;
      const response = await fetch(`/api/${action}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await readJsonOrEmpty(response);

      if (!response.ok) {
        throw new Error(actionErrorMessage(action, response, payload));
      }

      if (isSnapshot(payload)) {
        applySnapshot(payload);
      } else {
        await fetchState();
      }
    } catch (error) {
      showError(formatError(error));
    } finally {
      state.pendingAction = undefined;
      renderButtons();
    }
  }

  async function readJsonOrEmpty(response) {
    const text = await response.text();
    if (!text) {
      return undefined;
    }

    const contentType = response.headers.get("content-type") || "";
    const trimmed = text.trim();
    const shouldParseJson = contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
    if (!shouldParseJson) {
      return text;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      if (response.ok) {
        throw error;
      }
      return text;
    }
  }

  function applySnapshot(snapshot) {
    state.snapshot = normalizeSnapshot(snapshot);
    render();
  }

  function normalizeSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    return {
      status: typeof source.status === "string" ? source.status : "idle",
      pauseRequested: Boolean(source.pauseRequested),
      stopRequested: Boolean(source.stopRequested),
      logs: Array.isArray(source.logs) ? source.logs : [],
      results: Array.isArray(source.results) ? source.results : []
    };
  }

  function render() {
    const snapshot = state.snapshot || normalizeSnapshot({});
    const statusText = statusLabels[snapshot.status] || snapshot.status || "未知";

    elements.statusValue.textContent = statusText;
    elements.statusValue.className = `metric-value ${statusClass(snapshot.status)}`;
    elements.resultCount.textContent = String(snapshot.results.length);
    elements.pauseValue.textContent = snapshot.pauseRequested ? "是" : "否";
    elements.stopValue.textContent = snapshot.stopRequested ? "是" : "否";
    elements.pauseValue.className = `metric-value ${snapshot.pauseRequested ? "warn" : ""}`;
    elements.stopValue.className = `metric-value ${snapshot.stopRequested ? "warn" : ""}`;
    elements.updatedAt.textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;

    renderConnection();
    renderButtons();
    renderResults(snapshot.results);
    renderLogs(snapshot.logs);
  }

  function renderConnection() {
    if (state.socketConnected) {
      elements.connectionText.textContent = "WebSocket 已连接";
      return;
    }

    elements.connectionText.textContent = state.fetchLoaded
      ? "WebSocket 未连接，正在重试"
      : "正在加载状态...";
  }

  function renderButtons() {
    const snapshot = state.snapshot || normalizeSnapshot({});
    const isBusy = Boolean(state.pendingAction);
    const isActive = ["connecting", "starting_profile", "logging_in", "navigating", "pricing"].includes(snapshot.status);
    const hasSelectedShop = selectedProfileNames().length > 0;

    elements.startButton.disabled = isBusy || isActive || snapshot.status === "paused" || !hasSelectedShop;
    elements.pauseButton.disabled = isBusy || !isActive || snapshot.pauseRequested || snapshot.stopRequested;
    elements.stopButton.disabled = isBusy || snapshot.status === "stopped";
    elements.selectAllShopsButton.disabled = isBusy || isActive;
    elements.clearAllShopsButton.disabled = isBusy || isActive;

    elements.startButton.textContent = state.pendingAction === "start" ? "开始中" : "开始";
    elements.pauseButton.textContent = state.pendingAction === "pause" ? "暂停中" : "暂停";
    elements.stopButton.textContent = state.pendingAction === "stop" ? "停止中" : "停止";
  }

  function renderShopPicker() {
    elements.shopPicker.replaceChildren();
    if (!state.profileNames.length) {
      const empty = document.createElement("span");
      empty.className = "subtle";
      empty.textContent = "未配置店铺";
      elements.shopPicker.appendChild(empty);
      return;
    }

    for (const profileName of state.profileNames) {
      const label = document.createElement("label");
      label.className = "shop-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "profileName";
      input.value = profileName;
      input.checked = true;
      input.addEventListener("change", renderButtons);
      label.append(input, document.createTextNode(profileName));
      elements.shopPicker.appendChild(label);
    }
    renderButtons();
  }

  function selectedProfileNames() {
    return Array.from(elements.shopPicker.querySelectorAll("input[name='profileName']:checked"))
      .map((input) => input.value)
      .filter(Boolean);
  }

  function setAllShopsSelected(selected) {
    elements.shopPicker.querySelectorAll("input[name='profileName']").forEach((input) => {
      input.checked = selected;
    });
    renderButtons();
  }

  function selectedPricingRule() {
    const selected = elements.rulePicker.querySelector("input[name='pricingRule']:checked");
    return selected ? selected.value : "low_price";
  }

  function selectedPricingOptions() {
    const threshold = Number(elements.lowPriceThresholdInput.value);
    return {
      lowPriceThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 0.7
    };
  }

  function renderResults(results) {
    elements.resultsBody.replaceChildren();
    elements.emptyResults.style.display = results.length ? "none" : "block";

    const fragment = document.createDocumentFragment();
    for (const result of results) {
      const row = document.createElement("tr");
      appendCell(row, result.productId || "-");
      appendCell(row, formatPrice(result.quotedPrice), "number");
      appendCell(row, formatPrice(result.originalPrice), "number");
      appendCell(row, formatPrice(result.threshold70Percent), "number");
      appendCell(row, formatPrice(result.currentSellingPrice), "number");
      appendCell(row, formatPrice(result.officialSuggestedPrice), "number");
      appendBadgeCell(row, passedLabel(result.passed), passedClass(result.passed));
      appendBadgeCell(row, actionLabels[result.action] || result.action || "-", actionClass(result.action));
      appendCell(row, result.error || reasonLabels[result.reason] || result.reason || "-");
      fragment.appendChild(row);
    }

    elements.resultsBody.appendChild(fragment);
  }

  function renderLogs(logs) {
    elements.logCount.textContent = `${logs.length} 条`;

    if (!logs.length) {
      elements.logsOutput.textContent = "暂无日志";
      return;
    }

    elements.logsOutput.replaceChildren();
    const fragment = document.createDocumentFragment();
    logs.forEach((log, index) => {
      const line = document.createElement("span");
      line.className = log.level === "error" ? "log-error" : log.level === "warn" ? "log-warn" : "";
      line.textContent = `${formatTime(log.at)} [${log.level || "info"}] ${log.phase || "-"} ${log.message || ""}`;
      fragment.appendChild(line);
      if (index < logs.length - 1) {
        fragment.appendChild(document.createTextNode("\n"));
      }
    });
    elements.logsOutput.appendChild(fragment);
    elements.logsOutput.scrollTop = elements.logsOutput.scrollHeight;
  }

  function appendCell(row, text, className) {
    const cell = document.createElement("td");
    if (className) {
      cell.className = className;
    }
    cell.textContent = text;
    row.appendChild(cell);
  }

  function appendBadgeCell(row, text, className) {
    const cell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${className || ""}`;
    badge.textContent = text;
    cell.appendChild(badge);
    row.appendChild(cell);
  }

  function formatPrice(value) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "-";
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "--:--:--";
    }
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  }

  function statusClass(status) {
    if (status === "completed") {
      return "ok";
    }
    if (status === "failed") {
      return "error";
    }
    if (["paused", "stopped"].includes(status)) {
      return "warn";
    }
    return "";
  }

  function actionClass(action) {
    if (action === "recorded" || action === "confirmed") {
      return "ok";
    }
    if (action === "rejected") {
      return "error";
    }
    if (action === "skipped") {
      return "warn";
    }
    return "";
  }

  function passedLabel(passed) {
    if (passed === true) {
      return "通过";
    }
    if (passed === false) {
      return "未通过";
    }
    return "-";
  }

  function passedClass(passed) {
    if (passed === true) {
      return "ok";
    }
    if (passed === false) {
      return "error";
    }
    return "";
  }

  function isSnapshot(payload) {
    return Boolean(payload && typeof payload === "object" && typeof payload.status === "string");
  }

  function actionErrorMessage(action, response, payload) {
    if (payload && typeof payload === "object" && typeof payload.error === "string" && payload.error) {
      return payload.error;
    }
    if (typeof payload === "string" && payload.trim()) {
      return payload.trim();
    }
    return `${action} failed: ${response.status}`;
  }

  function showError(message) {
    elements.errorNotice.textContent = message;
    elements.errorNotice.classList.add("show");
  }

  function clearError() {
    elements.errorNotice.textContent = "";
    elements.errorNotice.classList.remove("show");
  }

  function formatError(error) {
    return error instanceof Error ? error.message : String(error);
  }
})();
