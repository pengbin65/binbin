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
    rejected: "已拒绝",
    skipped: "已跳过"
  };

  const reasonLabels = {
    CURRENT_PRICE_ABOVE_70_PERCENT: "当前售价高于 70% 阈值",
    OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8: "官方建议价至少 8",
    FAILED_BOTH_RULES: "未满足核价规则"
  };

  const state = {
    snapshot: undefined,
    pendingAction: undefined,
    socketConnected: false,
    fetchLoaded: false
  };

  const elements = {
    connectionText: document.getElementById("connectionText"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    stopButton: document.getElementById("stopButton"),
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

  fetchState();
  connectWebSocket();
  render();

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
      renderConnection();
      window.setTimeout(connectWebSocket, 2000);
    });

    socket.addEventListener("error", () => {
      state.socketConnected = false;
      showError("WebSocket 连接异常，正在重试");
      renderConnection();
    });
  }

  async function postAction(action) {
    state.pendingAction = action;
    clearError();
    renderButtons();

    try {
      const response = await fetch(`/api/${action}`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const payload = await readJsonOrEmpty(response);

      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : `${action} failed: ${response.status}`);
      }

      if (payload && payload.status) {
        applySnapshot(payload);
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
    return text ? JSON.parse(text) : undefined;
  }

  function applySnapshot(snapshot) {
    state.snapshot = normalizeSnapshot(snapshot);
    render();
  }

  function normalizeSnapshot(snapshot) {
    return {
      status: typeof snapshot.status === "string" ? snapshot.status : "idle",
      pauseRequested: Boolean(snapshot.pauseRequested),
      stopRequested: Boolean(snapshot.stopRequested),
      logs: Array.isArray(snapshot.logs) ? snapshot.logs : [],
      results: Array.isArray(snapshot.results) ? snapshot.results : []
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

    elements.startButton.disabled = isBusy || isActive || snapshot.status === "paused";
    elements.pauseButton.disabled = isBusy || !isActive || snapshot.pauseRequested || snapshot.stopRequested;
    elements.stopButton.disabled = isBusy || snapshot.status === "stopped";

    elements.startButton.textContent = state.pendingAction === "start" ? "开始中" : "开始";
    elements.pauseButton.textContent = state.pendingAction === "pause" ? "暂停中" : "暂停";
    elements.stopButton.textContent = state.pendingAction === "stop" ? "停止中" : "停止";
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
      appendBadgeCell(row, result.passed ? "通过" : "未通过", result.passed ? "ok" : "error");
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
    if (action === "recorded") {
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
