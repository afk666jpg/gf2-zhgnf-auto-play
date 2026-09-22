// ==UserScript==
// @name         指挥官能飞！自动小游戏（每日 3 次）
// @namespace    local.gf2.zhgnf
// @version      1.4.0
// @description  自动运行小游戏并自动抽取普通奖励；每天最多运行 3 次，实物收货确认保留手动操作。
// @match        https://gf2.sunborngame.com/zhgnf/index*
// @match        https://gf2.sunborngame.com/zhgnf/game*
// @match        https://gf2.sunborngame.com/zhgnf/lottery*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MAX_DAILY_RUNS = 3;
  const CLICK_INTERVAL = 180; // 必须小于游戏要求的 500ms
  const START_DELAY = 3400; // 游戏有 3 秒倒计时，留出少量余量
  const RETRY_DELAY = 1200; // 等待结算画面稳定后再点“再试一次”
  const LOTTERY_POLL_INTERVAL = 700;
  const LOTTERY_RESULT_TIMEOUT = 12000;
  const STORAGE_PREFIX = 'gf2-zhgnf-auto-play:';

  const dateKey = new Date().toLocaleDateString('sv-SE');
  const storageKey = STORAGE_PREFIX + dateKey;
  let attempts = readAttempts();
  let state = '等待页面';
  let activeRun = false;
  let pumpTimer = null;
  let nextButtonTimer = null;
  let nextStartTimer = null;
  let nextButton = 0; // 0 = 左键，2 = 右键
  let stoppedByUser = false;
  let queuedManual = false;
  let manualRun = false;
  let lotteryTimer = null;
  let lotteryResultTimer = null;
  let lotteryWaitingResult = false;
  let lotteryState = '等待抽奖页';

  function readAttempts() {
    const value = Number.parseInt(localStorage.getItem(storageKey) || '0', 10);
    return Number.isFinite(value) && value >= 0 ? Math.min(value, MAX_DAILY_RUNS) : 0;
  }

  function saveAttempts() {
    localStorage.setItem(storageKey, String(attempts));
  }

  function isDesktopPointer() {
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;
    return !mobileUA.test(navigator.userAgent || '') &&
      !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function findStartButton() {
    return document.querySelector('img.start') ||
      document.querySelector('img[alt*="开始游戏"]');
  }

  function findRetryButton() {
    const byClass = document.querySelector('button.play-again');
    if (byClass) return byClass;
    return [...document.querySelectorAll('button, img')].find((node) => {
      const alt = node.getAttribute('alt') || '';
      const text = node.textContent || '';
      return alt.includes('PLAY AGAIN') || text.includes('再试一次');
    });
  }

  function isIndexRoute() {
    return /\/zhgnf\/index(?:\/|$)/.test(window.location.pathname);
  }

  function isLotteryRoute() {
    return /\/zhgnf\/lottery(?:\/|$)/.test(window.location.pathname);
  }

  function findHomeStartButton() {
    if (!isIndexRoute()) return null;
    // 首页模板中的第一个按钮图片就是“开始游戏”。登录弹窗打开时不要重复点击背景。
    if (document.querySelector('.login_box')) return null;
    return document.querySelector('.con .btns > img:first-child');
  }

  function findLotteryStartButton() {
    return document.querySelector('.lottery_center .btns > img:first-child');
  }

  function findLotteryRewardModal() {
    return document.querySelector('.lottery_popup.rewards_content');
  }

  function findLotteryVirtualConfirmButton() {
    const modal = findLotteryRewardModal();
    return modal && modal.querySelector('.modal_button.confirm');
  }

  function findLotteryPhysicalButton() {
    const modal = findLotteryRewardModal();
    return modal && modal.querySelector('.modal_button.fill_info');
  }

  function readLotteryAttempts() {
    const node = document.querySelector('.times-bg-num');
    const match = node && (node.textContent || '').match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  function setState(nextState) {
    state = nextState;
    updatePanel();
  }

  function clearTimers() {
    if (pumpTimer) window.clearInterval(pumpTimer);
    if (nextButtonTimer) window.clearTimeout(nextButtonTimer);
    if (nextStartTimer) window.clearTimeout(nextStartTimer);
    if (lotteryTimer) window.clearTimeout(lotteryTimer);
    if (lotteryResultTimer) window.clearTimeout(lotteryResultTimer);
    pumpTimer = null;
    nextButtonTimer = null;
    nextStartTimer = null;
    lotteryTimer = null;
    lotteryResultTimer = null;
    lotteryWaitingResult = false;
  }

  function stopAutomation(message) {
    clearTimers();
    activeRun = false;
    stoppedByUser = true;
    lotteryState = '已停止';
    setState(message || '已停止');
  }

  function setLotteryState(nextState) {
    lotteryState = nextState;
    updatePanel();
  }

  function scheduleLotteryLoop(delay = LOTTERY_POLL_INTERVAL) {
    if (stoppedByUser || !isLotteryRoute()) return;
    if (lotteryTimer) window.clearTimeout(lotteryTimer);
    lotteryTimer = window.setTimeout(() => {
      lotteryTimer = null;
      runLotteryLoop();
    }, delay);
  }

  function startLotteryAutomation() {
    if (!isLotteryRoute()) return;
    clearTimers();
    stoppedByUser = false;
    setLotteryState('准备自动抽奖');
    runLotteryLoop();
  }

  function runLotteryLoop() {
    if (stoppedByUser || !isLotteryRoute()) return;

    if (lotteryWaitingResult) {
      const virtualConfirm = findLotteryVirtualConfirmButton();
      if (virtualConfirm) {
        clickElement(virtualConfirm);
        lotteryWaitingResult = false;
        if (lotteryResultTimer) window.clearTimeout(lotteryResultTimer);
        lotteryResultTimer = null;
        setLotteryState('已确认普通奖励，检查下一次抽奖');
        scheduleLotteryLoop(900);
        return;
      }

      if (findLotteryPhysicalButton()) {
        lotteryWaitingResult = false;
        if (lotteryResultTimer) window.clearTimeout(lotteryResultTimer);
        lotteryResultTimer = null;
        setLotteryState('抽到实物奖励，请手动填写并确认收货信息');
        return;
      }

      scheduleLotteryLoop();
      return;
    }

    const remaining = readLotteryAttempts();
    if (remaining === null) {
      setLotteryState('读取剩余抽奖次数');
      scheduleLotteryLoop();
      return;
    }
    if (remaining === 0) {
      setLotteryState('没有剩余抽奖次数');
      return;
    }

    const startButton = findLotteryStartButton();
    if (!startButton) {
      setLotteryState('等待开始抽奖按钮');
      scheduleLotteryLoop();
      return;
    }

    if (!clickElement(startButton)) {
      setLotteryState('无法点击开始抽奖');
      scheduleLotteryLoop();
      return;
    }

    lotteryWaitingResult = true;
    setLotteryState(`抽奖中，剩余 ${remaining} 次`);
    lotteryResultTimer = window.setTimeout(() => {
      lotteryResultTimer = null;
      lotteryWaitingResult = false;
      setLotteryState('等待抽奖结果超时，请手动检查');
    }, LOTTERY_RESULT_TIMEOUT);
    scheduleLotteryLoop();
  }

  function manualStart() {
    if (activeRun) return;
    stoppedByUser = false;
    queuedManual = true;
    clearTimers();
    setState('手动再来一局：准备中（不计次）');
    orchestrate(true);
  }

  function clickElement(element) {
    if (!element || !document.contains(element)) return false;
    element.click();
    return true;
  }

  function beginClickPump() {
    if (!activeRun || stoppedByUser) return;
    const touchArea = document.querySelector('.touch-area');
    if (!touchArea) {
      activeRun = false;
      setState('等待游戏区域');
      nextButtonTimer = window.setTimeout(() => orchestrate(manualRun || queuedManual), 250);
      return;
    }

    nextButton = 0;
    setState(manualRun ? '手动测试：左右键交替中（不计次）' : `第 ${attempts}/${MAX_DAILY_RUNS} 次：左右键交替中`);
    pumpTimer = window.setInterval(() => {
      // 结算页出现时立即停止，避免事件落到下一页。
      if (findRetryButton() || !document.querySelector('.touch-area')) {
        window.clearInterval(pumpTimer);
        pumpTimer = null;
        activeRun = false;
        const finishedManualRun = manualRun;
        manualRun = false;
        setState(finishedManualRun ? '手动测试完成（不计次数）' : (attempts >= MAX_DAILY_RUNS ? '今日 3 次已完成' : '本次完成，准备下一次'));
        if (!finishedManualRun) nextButtonTimer = window.setTimeout(orchestrate, RETRY_DELAY);
        return;
      }

      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: nextButton,
        buttons: nextButton === 0 ? 1 : 2,
      });
      touchArea.dispatchEvent(event);
      nextButton = nextButton === 0 ? 2 : 0;
    }, CLICK_INTERVAL);
  }

  function startOneRun(isManual = false) {
    const startButton = findStartButton();
    if (!startButton || activeRun || (!isManual && attempts >= MAX_DAILY_RUNS) || stoppedByUser) return false;
    if (!clickElement(startButton)) return false;

    if (!isManual) {
      attempts += 1;
      saveAttempts();
    }
    queuedManual = false;
    manualRun = isManual;
    activeRun = true;
    setState(isManual ? '手动测试：倒计时中（不计次）' : `第 ${attempts}/${MAX_DAILY_RUNS} 次：倒计时中`);
    nextStartTimer = window.setTimeout(() => {
      nextStartTimer = null;
      beginClickPump();
    }, START_DELAY);
    return true;
  }

  function orchestrate(manual = queuedManual) {
    if (stoppedByUser || (!manual && attempts >= MAX_DAILY_RUNS)) {
      if (attempts >= MAX_DAILY_RUNS) setState('今日 3 次已完成');
      return;
    }
    if (activeRun) return;

    if (isIndexRoute()) {
      if (document.querySelector('.login_box')) {
        setState('首页：请先登录');
        return;
      }
      const homeStartButton = findHomeStartButton();
      if (homeStartButton) {
        clickElement(homeStartButton);
        setState('已点击首页开始游戏，等待进入游戏页');
      } else {
        setState('等待首页开始游戏按钮');
      }
      return;
    }

    // 重试按钮会回到 step=1；下一轮由下面的开始按钮检测完成。
    const retryButton = findRetryButton();
    if (retryButton) {
      clickElement(retryButton);
      setState('已点击再试一次，等待开始按钮');
      nextButtonTimer = window.setTimeout(() => orchestrate(manual), 350);
      return;
    }

    if (!startOneRun(manual)) setState('等待开始游戏按钮');
  }

  function installPanel() {
    const panel = document.createElement('div');
    panel.id = 'gf2-auto-play-panel';
    panel.innerHTML = isLotteryRoute() ? `
      <div class="gf2-auto-title">指挥官能飞 · 自动抽奖</div>
      <div class="gf2-auto-status"></div>
      <button type="button" class="gf2-lottery-start">开始自动抽奖</button>
      <button type="button" class="gf2-auto-stop">停止</button>
    ` : `
      <div class="gf2-auto-title">指挥官能飞 · 自动操作</div>
      <div class="gf2-auto-status"></div>
      <button type="button" class="gf2-auto-again">手动再来一局（不计次）</button>
      <button type="button" class="gf2-auto-stop">停止</button>
    `;
    document.body.appendChild(panel);
    const manualAgain = panel.querySelector('.gf2-auto-again');
    if (manualAgain) manualAgain.addEventListener('click', manualStart);
    const lotteryStart = panel.querySelector('.gf2-lottery-start');
    if (lotteryStart) lotteryStart.addEventListener('click', startLotteryAutomation);
    panel.querySelector('.gf2-auto-stop').addEventListener('click', () => stopAutomation('已手动停止'));
    return panel;
  }

  let panel;
  function updatePanel() {
    if (!panel) return;
    const status = panel.querySelector('.gf2-auto-status');
    if (status) status.textContent = isLotteryRoute()
      ? `剩余抽奖次数：${readLotteryAttempts() ?? '-'} · ${lotteryState}`
      : `今日次数：${attempts}/${MAX_DAILY_RUNS} · ${state}`;
    const stop = panel.querySelector('.gf2-auto-stop');
    if (stop) stop.disabled = isLotteryRoute()
      ? stoppedByUser || !lotteryWaitingResult && !lotteryTimer
      : stoppedByUser || (!activeRun && attempts >= MAX_DAILY_RUNS);
    const again = panel.querySelector('.gf2-auto-again');
    if (again) again.disabled = activeRun;
    const lotteryStart = panel.querySelector('.gf2-lottery-start');
    if (lotteryStart) lotteryStart.disabled = lotteryWaitingResult || Boolean(lotteryTimer);
  }

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #gf2-auto-play-panel { position: fixed; z-index: 2147483647; top: 12px; right: 12px;
        width: 220px; padding: 10px 12px; color: #eaf6ff; background: rgba(4, 31, 58, .88);
        border: 1px solid rgba(125, 205, 255, .75); border-radius: 8px; font: 13px/1.5 sans-serif;
        box-shadow: 0 3px 12px rgba(0,0,0,.3); }
      #gf2-auto-play-panel .gf2-auto-title { font-weight: 700; margin-bottom: 4px; }
      #gf2-auto-play-panel .gf2-auto-status { min-height: 20px; }
      #gf2-auto-play-panel button { margin-top: 6px; margin-right: 5px; padding: 3px 10px; cursor: pointer; }
      #gf2-auto-play-panel button:disabled { opacity: .55; cursor: default; }
    `;
    document.head.appendChild(style);
  }

  function startRouteWatcher() {
    let currentPath = window.location.pathname;
    window.setInterval(() => {
      if (window.location.pathname === currentPath) return;
      currentPath = window.location.pathname;
      clearTimers();
      activeRun = false;
      manualRun = false;
      queuedManual = false;
      stoppedByUser = false;
      if (panel) panel.remove();
      panel = installPanel();
      updatePanel();
      if (isLotteryRoute()) {
        startLotteryAutomation();
      } else if (isDesktopPointer()) {
        orchestrate();
      }
    }, 500);
  }

  function main() {
    addStyles();
    panel = installPanel();
    updatePanel();
    startRouteWatcher();

    if (isLotteryRoute()) {
      startLotteryAutomation();
    } else if (!isDesktopPointer()) {
      setState('请在桌面端使用鼠标运行');
      return;
    }
    if (!isLotteryRoute() && attempts >= MAX_DAILY_RUNS) setState('今日 3 次已完成；可手动测试（不计次）');

    const observer = new MutationObserver(() => {
      if (isLotteryRoute()) return;
      if (!activeRun && !nextButtonTimer && !nextStartTimer) orchestrate();
    });
    // 面板本身不纳入观察范围，避免更新状态文字时触发自循环。
    const appRoot = document.querySelector('#app') || document.body;
    observer.observe(appRoot, { childList: true, subtree: true });
    if (!isLotteryRoute()) orchestrate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true });
  } else {
    main();
  }
})();
