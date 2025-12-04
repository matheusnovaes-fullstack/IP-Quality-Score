let ipHistory = JSON.parse(localStorage.getItem('ipHistory')) || [];

document.addEventListener('DOMContentLoaded', function() {
    const ipInput = document.getElementById('ipInput');
    const checkBtn = document.getElementById('checkBtn');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');

    const fileInput = document.getElementById('fileInput');
    const fileLabelText = document.getElementById('fileLabelText');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadResult = document.getElementById('uploadResult');

    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    // Renderizar histórico ao carregar
    renderHistory();

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            fileLabelText.textContent = fileInput.files[0].name;
        } else {
            fileLabelText.textContent = 'Escolha arquivo (.txt, .csv ou .json)';
        }
    });

    ipInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') checkBtn.click();
    });

    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Tem certeza que quer limpar o histórico?')) {
            ipHistory = [];
            localStorage.removeItem('ipHistory');
            renderHistory();
        }
    });

    checkBtn.addEventListener('click', async function() {
        const ip = ipInput.value.trim();
        if (!ip) {
            showError('Digite um IP válido.');
            return;
        }

        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(ip)) {
            showError('Formato de IP inválido. Use: 192.168.1.1');
            return;
        }

        showLoading(true);

        try {
            const response = await fetch('/check-ip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: ip })
            });
            const data = await response.json();
            showLoading(false);

            if (data.error) {
                showError(data.error);
                return;
            }

            // Adicionar ao histórico
            addToHistory(data);
            displaySingleResult(data);
            ipInput.value = '';
        } catch (error) {
            showLoading(false);
            showError('Erro de conexão.');
        }
    });

    uploadBtn.addEventListener('click', async () => {
        if (!fileInput.files.length) {
            uploadResult.innerHTML = '<p style="color:red;">Selecione um arquivo</p>';
            return;
        }

        uploadResult.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Processando IPs...</div>';

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const response = await fetch('/upload-ips', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.error) {
                uploadResult.innerHTML = `<p style="color:red;">Erro: ${data.error}</p>`;
                return;
            }

            displayUploadResults(data);
        } catch (err) {
            uploadResult.innerHTML = '<p style="color:red;">Erro ao processar arquivo</p>';
        }
    });

    function showLoading(show) {
        loading.style.display = show ? 'flex' : 'none';
        if (show) results.innerHTML = '';
    }

    function showError(message) {
        results.innerHTML = `
            <div class="result-card error">
                <strong>Erro:</strong> ${message}
            </div>
        `;
    }

    function parseFraudScore(value) {
        if (typeof value === 'number') return value;
        if (value === null || value === undefined) return 0;
        const n = parseInt(value, 10);
        return isNaN(n) ? 0 : n;
    }

    function formatDate(dateString) {
        if (!dateString || dateString === 'N/A') return 'N/A';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR');
        } catch (e) {
            return dateString;
        }
    }

    function getRiskClass(score) {
        if (score > 75) return 'high-risk';
        if (score > 50) return 'medium-risk';
        return 'low-risk';
    }

    function addToHistory(data) {
        const fraudScore = parseFraudScore(data.fraud_score);
        
        // Remover se já existe (evita duplicatas)
        ipHistory = ipHistory.filter(item => item.ip !== data.ip);
        
        // Adicionar no início
        ipHistory.unshift({
            ip: data.ip,
            fraud_score: fraudScore,
            country: data.country,
            is_tor: data.is_tor,
            total_reports: data.total_reports,
            timestamp: new Date().toISOString(),
            fullData: data
        });
        
        // Manter apenas últimos 50
        ipHistory = ipHistory.slice(0, 50);
        
        // Salvar no localStorage
        localStorage.setItem('ipHistory', JSON.stringify(ipHistory));
        renderHistory();
    }

    function renderHistory() {
        if (ipHistory.length === 0) {
            historyList.innerHTML = '<p class="empty-message">Nenhum IP analisado</p>';
            return;
        }

        historyList.innerHTML = ipHistory.map((item, index) => {
            const riskClass = getRiskClass(item.fraud_score);
            const torBadge = item.is_tor ? '<span class="history-item-badge">🔴 Tor</span>' : '';
            
            return `
                <div class="history-item" onclick="selectFromHistory(${index})">
                    <div class="history-item-ip">${item.ip}</div>
                    <div class="history-item-score">
                        <span class="history-item-risk risk-${riskClass === 'high-risk' ? 'high' : riskClass === 'medium-risk' ? 'medium' : 'low'}">
                            ${item.fraud_score}
                        </span>
                        ${torBadge}
                    </div>
                    <div style="font-size:0.75rem;opacity:0.8;">
                        <i class="fas fa-map-pin"></i> ${item.country || 'N/A'} | ${item.total_reports} reports
                    </div>
                    <span class="history-item-remove" onclick="removeFromHistory(event, ${index})">
                        <i class="fas fa-times"></i> Remover
                    </span>
                </div>
            `;
        }).join('');
    }

    window.selectFromHistory = function(index) {
        const item = ipHistory[index];
        displaySingleResult(item.fullData);
        document.querySelector('.history-item').classList.add('selected');
    };

    window.removeFromHistory = function(event, index) {
        event.stopPropagation();
        ipHistory.splice(index, 1);
        localStorage.setItem('ipHistory', JSON.stringify(ipHistory));
        renderHistory();
    };

    function displaySingleResult(data) {
        const fraudScore = parseFraudScore(data.fraud_score);
        let riskClass = getRiskClass(fraudScore);

        const commentsHtml = data.report_comments && data.report_comments.length
            ? `<div style="margin-top:12px;padding:10px;background:#f5f5f5;border-radius:8px;border-left:3px solid #e53e3e;">
                <strong style="color:#c53030;">Últimos Reports:</strong>
                <ul style="margin:8px 0 0 20px;padding:0;">
                    ${data.report_comments.map(comment => 
                        `<li style="font-size:0.85rem;margin:4px 0;color:#555;">${comment || '(sem comentário)'}</li>`
                    ).join('')}
                </ul>
              </div>`
            : '';

        results.innerHTML = `
            <div class="result-card ${riskClass}">
                <h3 style="margin-bottom:15px;">Abuse Score: <span class="result-value">${fraudScore}/100</span></h3>
                
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:15px;font-size:0.9rem;">
                    <div style="background:#f9f9f9;padding:10px;border-radius:8px;">
                        <strong>Total Reports:</strong> <span style="color:#e53e3e;font-weight:600;">${data.total_reports || 0}</span>
                    </div>
                    <div style="background:#f9f9f9;padding:10px;border-radius:8px;">
                        <strong>Usuários Distintos:</strong> <span style="color:#2d3748;font-weight:600;">${data.num_distinct_users || 0}</span>
                    </div>
                    <div style="background:#f9f9f9;padding:10px;border-radius:8px;">
                        <strong>É Tor:</strong> <span style="color:#${data.is_tor === true ? 'e53e3e' : '38a169'};font-weight:600;">${data.is_tor === true ? 'SIM ⚠️' : 'NÃO'}</span>
                    </div>
                    <div style="background:#f9f9f9;padding:10px;border-radius:8px;">
                        <strong>Whitelisted:</strong> <span style="color:#${data.is_whitelisted === true ? '38a169' : '2d3748'};font-weight:600;">${data.is_whitelisted === true ? 'SIM ✓' : 'NÃO'}</span>
                    </div>
                </div>

                <div style="background:#f5f5f5;padding:12px;border-radius:8px;margin-bottom:15px;font-size:0.9rem;">
                    <strong>Informações Geográficas & ISP:</strong>
                    <p style="margin:8px 0 0 0;">
                        <strong>ISP:</strong> ${data.ISP || 'N/A'}<br>
                        <strong>País:</strong> ${data.country || 'N/A'}<br>
                        <strong>Tipo de Uso:</strong> ${data.region || 'N/A'}<br>
                        <strong>Domínio:</strong> ${data.city || 'N/A'}
                    </p>
                </div>

                <div style="background:#f5f5f5;padding:12px;border-radius:8px;margin-bottom:15px;font-size:0.85rem;color:#666;">
                    <strong>Último Report:</strong> ${formatDate(data.last_reported)}<br>
                    <strong>IP Público:</strong> ${data.is_public === true ? 'SIM' : 'NÃO'}
                </div>

                ${commentsHtml}
            </div>
        `;
    }

    function displayUploadResults(data) {
        const FRAUD_THRESHOLD = 25;

        const fraudulentList = (data.details || []).filter(item =>
            parseFraudScore(item.fraud_score) >= FRAUD_THRESHOLD
        );

        let macHtml = '';
        if (data.macs_detected && data.macs_detected.length) {
            macHtml = `
                <div style="margin-top:18px;font-size:0.9rem;background:#f9f9f9;padding:12px;border-radius:8px;">
                    <strong>MACs encontrados (${data.macs_detected.length}):</strong><br>
                    <span style="word-break:break-all;font-family:monospace;">${data.macs_detected.join(', ')}</span>
                </div>
            `;
        }

        let fraudHtml = '';
        if (fraudulentList.length) {
            fraudHtml = `
                <div class="fraud-sidebar">
                    <h4>IPs Abusivos (${fraudulentList.length})</h4>
                    <ul>
                        ${fraudulentList.map(item => {
                            const fs = parseFraudScore(item.fraud_score);
                            const torLabel = item.is_tor ? ' 🔴 Tor' : '';
                            return `
                                <li>
                                    <span class="fraud-ip">${item.ip}${torLabel}</span>
                                    <span class="fraud-score" title="Abuse Score">${fs}</span>
                                    ${item.total_reports ? `<span style="font-size:0.75rem;color:#999;margin-left:5px;">${item.total_reports} reports</span>` : ''}
                                </li>
                            `;
                        }).join('')}
                    </ul>
                </div>
            `;
        }

        uploadResult.innerHTML = `
            <div class="upload-result-layout">
                <div class="upload-main">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number">${data.total_ips}</div>
                            <div>Total IPs</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number danger">${data.fraudulent_percent}%</div>
                            <div class="danger">Potencialmente Abusivos</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number success">${data.clean_percent}%</div>
                            <div class="success">Limpos</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${data.error_percent}%</div>
                            <div>Erros</div>
                        </div>
                    </div>
                    ${macHtml}
                </div>
                ${fraudHtml}
            </div>
        `;
    }
});
