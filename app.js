/* ================================================================
   CHRONOS — FRONT-END CONTROLLER
   Separation of concerns: behavior layer (JS)
   Principles: Clean Code (short functions, meaningful names),
               GEB (timestamp as single source of truth via API)
   ================================================================ */

const app = (() => {
  'use strict';

  /* --------------------------------------------------------------
     CONFIGURATION
     -------------------------------------------------------------- */
  const API_BASE = 'http://localhost:3000/api';

  /* --------------------------------------------------------------
     STATE
     -------------------------------------------------------------- */
  let sessions = [];
  let selectedSessions = new Set();
  let jobs = [];
  let currentFile = null;
  const pollIntervals = {};

  /* --------------------------------------------------------------
     DOM REFERENCES
     -------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const elements = {
    uploadZone: $('uploadZone'),
    fileInput: $('fileInput'),
    uploadBtn: $('uploadBtn'),
    uploadSpinner: $('uploadSpinner'),
    uploadBtnText: $('uploadBtnText'),
    baseFolder: $('baseFolder'),
    sessionsTable: $('sessionsTable'),
    selectionCount: $('selectionCount'),
    selectAllBtn: $('selectAllBtn'),
    batchTimelapseBtn: $('batchTimelapseBtn'),
    batchGifBtn: $('batchGifBtn'),
    deleteProjectBtn: $('deleteProjectBtn'),
    jobsList: $('jobsList'),
    apiStatus: $('apiStatus'),
    apiStatusText: $('apiStatusText'),
    themeToggle: $('themeToggle'),
    errorModal: $('errorModal'),
    errorMessage: $('errorMessage'),
    errorStack: $('errorStack'),
    copyErrorBtn: $('copyErrorBtn'),
    toastContainer: $('toastContainer'),
  };

  /* --------------------------------------------------------------
     THEME MANAGEMENT
     -------------------------------------------------------------- */
  function initTheme() {
    const saved = localStorage.getItem('chronos-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    elements.themeToggle.textContent = saved === 'dark' ? '🌙' : '☀️';

    elements.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      elements.themeToggle.textContent = next === 'dark' ? '🌙' : '☀️';
      localStorage.setItem('chronos-theme', next);
    });
  }

  /* --------------------------------------------------------------
     API HEALTH CHECK
     -------------------------------------------------------------- */
  async function checkApi() {
    try {
      elements.apiStatus.className = 'api-status checking';
      elements.apiStatusText.textContent = 'Verificando API...';
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        elements.apiStatus.className = 'api-status online';
        elements.apiStatusText.textContent = 'API Online';
      } else {
        throw new Error('API respondeu com erro');
      }
    } catch {
      elements.apiStatus.className = 'api-status offline';
      elements.apiStatusText.textContent = 'API Offline';
    }
  }

  /* --------------------------------------------------------------
     UPLOAD HANDLING
     -------------------------------------------------------------- */
  function initUpload() {
    elements.uploadZone.addEventListener('click', () => elements.fileInput.click());

    elements.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.uploadZone.classList.add('dragover');
    });

    elements.uploadZone.addEventListener('dragleave', () => {
      elements.uploadZone.classList.remove('dragover');
    });

    elements.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      elements.uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    elements.fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    elements.uploadBtn.addEventListener('click', executeUpload);
  }

  function handleFile(file) {
    const valid = ['.csv', '.xlsx', '.json'];
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!valid.includes(ext)) {
      showToast('Formato inválido. Use CSV, XLSX ou JSON.', 'error');
      return;
    }
    currentFile = file;
    elements.uploadBtn.disabled = false;
    elements.uploadZone.querySelector('h3').textContent = file.name;
    elements.uploadZone.querySelector('p').textContent = formatBytes(file.size);
  }

  async function executeUpload() {
    if (!currentFile) return;
    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append('report', currentFile);
      if (elements.baseFolder.value) {
        formData.append('baseFolder', elements.baseFolder.value);
      }

      const res = await fetch(`${API_BASE}/reports/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      sessions = data.sessions || [];
      renderSessions();
      showToast(`${sessions.length} sessão(ões) importada(s)`, 'success');
      resetUpload();
    } catch (err) {
      showError(err, 'Falha ao importar relatório');
    } finally {
      setUploadLoading(false);
    }
  }

  function setUploadLoading(loading) {
    elements.uploadBtn.disabled = loading;
    elements.uploadSpinner.style.display = loading ? 'inline-block' : 'none';
    elements.uploadBtnText.textContent = loading ? 'Importando...' : 'Importar Sessões';
  }

  function resetUpload() {
    currentFile = null;
    elements.uploadBtn.disabled = true;
    elements.fileInput.value = '';
    elements.uploadZone.querySelector('h3').textContent = 'Solte o relatório aqui';
    elements.uploadZone.querySelector('p').textContent = 'ou clique para selecionar';
  }

  /* --------------------------------------------------------------
     SESSIONS RENDERING & SELECTION
     -------------------------------------------------------------- */
  function renderSessions() {
    if (sessions.length === 0) {
      elements.sessionsTable.innerHTML = renderEmptySessions();
      return;
    }

    elements.sessionsTable.innerHTML = sessions
      .map((s) => renderSessionRow(s))
      .join('');

    updateSelectionUI();
  }

  function renderEmptySessions() {
    return `
      <tr><td colspan="6">
        <div class="empty-state">
          <div class="empty-state-icon">📂</div>
          <p>Nenhuma sessão importada</p>
          <p style="font-size: var(--text-xs); margin-top: var(--space-2);">Faça upload de um relatório para começar</p>
        </div>
      </td></tr>`;
  }

  function renderSessionRow(s) {
    const isSelected = selectedSessions.has(s.id);
    return `
      <tr data-id="${s.id}" class="${isSelected ? 'selected' : ''}" onclick="app.toggleRow('${s.id}')">
        <td onclick="event.stopPropagation(); app.toggleSelect('${s.id}')">
          <div class="checkbox ${isSelected ? 'checked' : ''}">${isSelected ? '✓' : ''}</div>
        </td>
        <td>${escapeHtml(s.data)}</td>
        <td>${escapeHtml(s.inicio)}</td>
        <td>${escapeHtml(s.fim)}</td>
        <td>${s.capturas}</td>
        <td>
          <div class="row-actions" onclick="event.stopPropagation()">
            <button class="btn-row" onclick="app.generateMedia('${s.id}', 'timelapse')" title="Timelapse">▶</button>
            <button class="btn-row" onclick="app.generateMedia('${s.id}', 'gif')" title="GIF">🎞</button>
          </div>
        </td>
      </tr>`;
  }

  function toggleSelect(id) {
    if (selectedSessions.has(id)) {
      selectedSessions.delete(id);
    } else {
      selectedSessions.add(id);
    }
    renderSessions();
  }

  function toggleRow(id) {
    toggleSelect(id);
  }

  function initSelectionControls() {
    elements.selectAllBtn.addEventListener('click', () => {
      if (selectedSessions.size === sessions.length) {
        selectedSessions.clear();
      } else {
        sessions.forEach((s) => selectedSessions.add(s.id));
      }
      renderSessions();
    });

    elements.batchTimelapseBtn.addEventListener('click', () => {
      selectedSessions.forEach((id) => generateMedia(id, 'timelapse'));
    });

    elements.batchGifBtn.addEventListener('click', () => {
      selectedSessions.forEach((id) => generateMedia(id, 'gif'));
    });

    elements.deleteProjectBtn.addEventListener('click', deleteSelectedProjects);
  }

  function updateSelectionUI() {
    const count = selectedSessions.size;
    elements.selectionCount.textContent = count;
    elements.selectionCount.style.display = count > 0 ? 'inline-block' : 'none';
    elements.batchTimelapseBtn.disabled = count === 0;
    elements.batchGifBtn.disabled = count === 0;
    elements.deleteProjectBtn.disabled = count === 0;
    elements.selectAllBtn.textContent =
      count === sessions.length ? 'Limpar' : 'Selecionar Todos';
  }

  async function deleteSelectedProjects() {
    if (!confirm(`Remover ${selectedSessions.size} projeto(s)?`)) return;
    for (const id of selectedSessions) {
      try {
        const res = await fetch(`${API_BASE}/projects/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Falha ao remover');
      } catch (err) {
        showError(err, `Falha ao remover projeto ${id}`);
      }
    }
    sessions = sessions.filter((s) => !selectedSessions.has(s.id));
    selectedSessions.clear();
    renderSessions();
    showToast('Projetos removidos', 'success');
  }

  /* --------------------------------------------------------------
     MEDIA GENERATION & JOB POLLING
     -------------------------------------------------------------- */
  async function generateMedia(sessionId, type) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const job = createJobStub(sessionId, type);
    jobs.unshift(job);
    renderJobs();

    try {
      const body =
        type === 'timelapse'
          ? { sessionId, fps: 24, format: 'mp4' }
          : { sessionId, loopMode: 'infinite' };

      const res = await fetch(`${API_BASE}/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      job.id = data.jobId;
      job.status = 'processing';
      renderJobs();
      startPolling(job.id);
    } catch (err) {
      job.status = 'failed';
      job.error_message = err.message;
      renderJobs();
      showError(err, `Falha ao iniciar ${type}`);
    }
  }

  function createJobStub(sessionId, type) {
    return {
      id: crypto.randomUUID(),
      session_id: sessionId,
      type,
      status: 'pending',
      output_path: null,
      fps: type === 'timelapse' ? 24 : null,
      format: type === 'timelapse' ? 'mp4' : null,
      loop_mode: type === 'gif' ? 'infinite' : null,
      error_message: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
  }

  function startPolling(jobId) {
    if (pollIntervals[jobId]) clearInterval(pollIntervals[jobId]);

    pollIntervals[jobId] = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const job = jobs.find((j) => j.id === jobId);
        if (!job) return;

        Object.assign(job, data);
        renderJobs();

        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollIntervals[jobId]);
          delete pollIntervals[jobId];
          if (data.status === 'completed') {
            showToast(
              `${job.type === 'timelapse' ? 'Timelapse' : 'GIF'} pronto!`,
              'success'
            );
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1500);
  }

  /* --------------------------------------------------------------
     JOBS RENDERING
     -------------------------------------------------------------- */
  function renderJobs() {
    if (jobs.length === 0) {
      elements.jobsList.innerHTML = renderEmptyJobs();
      return;
    }

    elements.jobsList.innerHTML = jobs.map((job) => renderJobCard(job)).join('');
  }

  function renderEmptyJobs() {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">⚡</div>
        <p>Nenhum job em andamento</p>
        <p style="font-size: var(--text-xs); margin-top: var(--space-2);">Selecione uma sessão e gere um timelapse ou GIF</p>
      </div>`;
  }

  function renderJobCard(job) {
    const session = sessions.find((s) => s.id === job.session_id);
    const sessionLabel = session
      ? `${session.data} ${session.inicio}`
      : job.session_id.slice(0, 8);

    const preview = renderJobPreview(job);
    const progress =
      job.status === 'processing'
        ? '<div class="progress-bar"><div class="progress-bar-fill indeterminate"></div></div>'
        : '';
    const errorMsg =
      job.status === 'failed' && job.error_message
        ? `<div style="font-size: var(--text-xs); color: var(--danger); margin-top: var(--space-2);">${escapeHtml(job.error_message)}</div>`
        : '';

    return `
      <div class="job-card status-${job.status}">
        <div class="job-header">
          <span class="job-type ${job.type}">${job.type === 'timelapse' ? '▶ Timelapse' : '🎞 GIF'}</span>
          <span class="job-status">
            <span class="status-dot"></span>
            ${translateStatus(job.status)}
          </span>
        </div>
        <div class="job-meta">${sessionLabel} · ${job.fps ? job.fps + 'fps' : ''} ${job.loop_mode ? '· ' + job.loop_mode : ''}</div>
        ${progress}
        ${errorMsg}
        ${preview}
      </div>`;
  }

  function renderJobPreview(job) {
    if (job.status !== 'completed' || !job.output_path) return '';

    const filename = job.output_path.split(/[\\/]/).pop();
    const url = `${API_BASE}/outputs/${filename}`;
    const downloadBtn = `
      <div class="job-actions" style="margin-top: var(--space-3);">
        <a href="${url}" download class="btn btn-primary btn-sm" style="text-decoration: none;">⬇ Download</a>
      </div>`;

    if (job.type === 'timelapse') {
      return `
        <div class="preview-area">
          <video controls preload="metadata">
            <source src="${url}" type="video/mp4">
          </video>
        </div>
        ${downloadBtn}`;
    }

    return `
      <div class="preview-area">
        <img src="${url}" alt="GIF">
      </div>
      ${downloadBtn}`;
  }

  function translateStatus(status) {
    const map = {
      pending: 'Pendente',
      processing: 'Processando...',
      completed: 'Concluído',
      failed: 'Falhou',
    };
    return map[status] || status;
  }

  /* --------------------------------------------------------------
     ERROR HANDLING — MODAL
     -------------------------------------------------------------- */
  function showError(error, context) {
    const message = error.message || String(error);
    const stack = error.stack || 'Sem stack trace disponível';

    elements.errorMessage.textContent = context || 'Ocorreu um erro inesperado.';
    elements.errorStack.textContent = formatErrorForClipboard(
      context,
      message,
      stack
    );
    elements.errorModal.classList.add('active');
  }

  function closeModal() {
    elements.errorModal.classList.remove('active');
  }

  function initErrorModal() {
    elements.copyErrorBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(elements.errorStack.textContent).then(() => {
        showToast('Erro copiado para a área de transferência', 'success');
        closeModal();
      });
    });

    elements.errorModal.addEventListener('click', (e) => {
      if (e.target === elements.errorModal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  function formatErrorForClipboard(context, message, stack) {
    return (
      `[Contexto] ${context || 'N/A'}\n\n` +
      `[Mensagem] ${message}\n\n` +
      `[Stack]\n${stack}\n\n` +
      `[Timestamp] ${new Date().toISOString()}\n` +
      `[User-Agent] ${navigator.userAgent}\n` +
      `[API Base] ${API_BASE}`
    );
  }

  /* --------------------------------------------------------------
     TOAST SYSTEM
     -------------------------------------------------------------- */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `
      <div class="toast-icon">${icons[type]}</div>
      <div class="toast-content">
        <h4>${type === 'success' ? 'Sucesso' : type === 'error' ? 'Erro' : 'Info'}</h4>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /* --------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------- */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /* --------------------------------------------------------------
     INITIALIZATION
     -------------------------------------------------------------- */
  function init() {
    initTheme();
    initUpload();
    initSelectionControls();
    initErrorModal();
    checkApi();
    setInterval(checkApi, 10000);
  }

  // Expose public API for inline handlers
  return {
    init,
    toggleSelect,
    toggleRow,
    generateMedia,
    closeModal,
  };
})();

// Bootstrap
document.addEventListener('DOMContentLoaded', app.init);
