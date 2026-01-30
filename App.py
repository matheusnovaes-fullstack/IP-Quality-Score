from flask import Flask, request, jsonify, render_template
import requests
import os
import re
import csv
import json

app = Flask(__name__)
API_KEY_ABUSEIPDB = ''

# Regex para encontrar IPs e MACs em qualquer texto
IP_REGEX = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
MAC_REGEX = re.compile(r'\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b')

consultas_historico = []


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/check-ip', methods=['POST'])
def check_ip():
    data = request.get_json()
    ip = data.get('ip')

    if not ip:
        return jsonify({'error': 'IP não fornecido'}), 400

    url = 'https://api.abuseipdb.com/api/v2/check'
    headers = {
        'Key': API_KEY_ABUSEIPDB,
        'Accept': 'application/json'
    }
    params = {
        'ipAddress': ip,
        'maxAgeInDays': 90,
        'verbose': ''  # Retorna detalhes completos dos reports
    }

    try:
        response = requests.get(url, headers=headers, params=params, timeout=15)

        print('STATUS HTTP:', response.status_code)
        print('URL CHAMADA:', response.url)
        print('CORPO BRUTO:', response.text)

        if response.status_code != 200:
            return jsonify({'error': f'API Error: {response.status_code}'}), 502

        resp_json = response.json()
        print('JSON PARSEADO:', resp_json)

        # AbuseIPDB retorna os dados dentro de "data"
        data_obj = resp_json.get('data', {})
        abuse_score = data_obj.get('abuseConfidenceScore', 0)
        
        # Pega detalhes dos reports
        reports = data_obj.get('reports', [])
        report_comments = [r.get('comment', '') for r in reports[:3]]  # primeiros 3 comentários
        report_categories = []
        if reports:
            for r in reports[:3]:
                cats = r.get('categories', [])
                report_categories.extend(cats)
            report_categories = list(set(report_categories))  # remove duplicatas

        resultado = {
            'ip': ip,
            'fraud_score': abuse_score,
            'proxy': False,
            'vpn': False,
            'bot_status': False,
            'recent_abuse': data_obj.get('totalReports', 0) > 0,
            'ISP': data_obj.get('isp') or 'N/A',
            'country': data_obj.get('countryCode') or 'N/A',
            'city': data_obj.get('domain') or 'N/A',
            'region': data_obj.get('usageType') or 'N/A',
            'total_reports': data_obj.get('totalReports', 0),
            'is_whitelisted': data_obj.get('isWhitelisted', False),
            'num_distinct_users': data_obj.get('numDistinctUsers', 0),
            'last_reported': data_obj.get('lastReportedAt') or 'N/A',
            'is_public': data_obj.get('isPublic', False),
            'is_tor': data_obj.get('isTor', False),
            'report_comments': report_comments,
            'report_categories': report_categories
        }

        consultas_historico.append(resultado)

        return jsonify({'success': True, **resultado})

    except Exception as e:
        print('ERRO EXCEÇÃO:', str(e))
        return jsonify({'error': f'Erro: {str(e)}'}), 500


@app.route('/history', methods=['GET'])
def history():
    return jsonify(consultas_historico)


@app.route('/upload-ips', methods=['POST'])
def upload_ips():
    if 'file' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Arquivo sem nome'}), 400

    filename = file.filename.lower()

    raw_ips = []
    macs = []

    try:
        content = file.stream.read().decode('utf-8', errors='ignore')

        if filename.endswith('.txt'):
            for line in content.splitlines():
                raw_ips.extend(IP_REGEX.findall(line))
                macs.extend(MAC_REGEX.findall(line))

        elif filename.endswith('.csv'):
            reader = csv.reader(content.splitlines())
            for row in reader:
                line = ' '.join(row)
                raw_ips.extend(IP_REGEX.findall(line))
                macs.extend(MAC_REGEX.findall(line))

        elif filename.endswith('.json'):
            data = json.loads(content)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, str):
                        line = item
                    elif isinstance(item, dict):
                        line = ' '.join(str(v) for v in item.values())
                    else:
                        continue
                    raw_ips.extend(IP_REGEX.findall(line))
                    macs.extend(MAC_REGEX.findall(line))
            else:
                return jsonify({'error': 'JSON deve ser uma lista (strings ou objetos)'}), 400
        else:
            for line in content.splitlines():
                raw_ips.extend(IP_REGEX.findall(line))
                macs.extend(MAC_REGEX.findall(line))

    except Exception as e:
        return jsonify({'error': f'Erro ao ler arquivo: {str(e)}'}), 400

    seen_ips = set()
    ips = []
    for ip in raw_ips:
        if ip not in seen_ips:
            seen_ips.add(ip)
            ips.append(ip)

    seen_macs = set()
    unique_macs = []
    for m in macs:
        if m not in seen_macs:
            seen_macs.add(m)
            unique_macs.append(m)

    resultados = []
    fraud_count = 0
    clean_count = 0
    error_count = 0
    CLEAN_THRESHOLD = 25
    MAX_IPS = 50

    if len(ips) > MAX_IPS:
        return jsonify({'error': f'Máximo {MAX_IPS} IPs por vez'}), 400

    headers = {
        'Key': API_KEY_ABUSEIPDB,
        'Accept': 'application/json'
    }

    for ip in ips:
        try:
            url = 'https://api.abuseipdb.com/api/v2/check'
            params = {
                'ipAddress': ip,
                'maxAgeInDays': 90,
                'verbose': ''
            }
            resp = requests.get(url, headers=headers, params=params, timeout=15)

            print('STATUS HTTP LOTE:', resp.status_code, 'IP:', ip)
            print('URL LOTE:', resp.url)
            print('CORPO BRUTO LOTE:', resp.text)

            if resp.status_code == 200:
                data_obj = resp.json().get('data', {})
                abuse_score = data_obj.get('abuseConfidenceScore', 0)
                resultados.append({
                    'ip': ip,
                    'fraud_score': abuse_score,
                    'total_reports': data_obj.get('totalReports', 0),
                    'is_tor': data_obj.get('isTor', False)
                })
                if abuse_score >= CLEAN_THRESHOLD:
                    fraud_count += 1
                else:
                    clean_count += 1
            else:
                resultados.append({'ip': ip, 'fraud_score': 'Erro', 'total_reports': 0})
                error_count += 1
        except Exception as e:
            print('ERRO LOTE PARA', ip, ':', str(e))
            resultados.append({'ip': ip, 'fraud_score': 'Erro', 'total_reports': 0})
            error_count += 1

    total = len(resultados)
    fraud_percent = round((fraud_count / total * 100), 2) if total > 0 else 0
    clean_percent = round((clean_count / total * 100), 2) if total > 0 else 0
    error_percent = round((error_count / total * 100), 2) if total > 0 else 0

    return jsonify({
        'total_ips': total,
        'fraudulent_percent': fraud_percent,
        'fraud_count': fraud_count,
        'clean_percent': clean_percent,
        'clean_count': clean_count,
        'error_percent': error_percent,
        'error_count': error_count,
        'details': resultados,
        'macs_detected': unique_macs
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)

