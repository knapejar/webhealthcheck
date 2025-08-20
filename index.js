const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');

// Configuration
const config = {
  domains: process.env.DOMAINS ? process.env.DOMAINS.split(';').map(d => d.trim()) : [],
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  port: process.env.PORT || 3000,
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES) || 1
};

// Health check state
const healthState = new Map();

// Initialize health state for all domains
config.domains.forEach(domain => {
  healthState.set(domain, {
    status: 'unknown',
    lastCheck: null,
    lastError: null,
    consecutiveErrors: 0,
    consecutiveSuccesses: 0,
    responseTime: null
  });
});

let nextCheckTime = new Date(Date.now() + config.checkIntervalMinutes * 60 * 1000);

// Health check function
async function checkDomain(domain) {
  const startTime = Date.now();
  const state = healthState.get(domain);
  
  try {
    const response = await makeHttpRequest(domain);
    const responseTime = Date.now() - startTime;
    
    // Check response status
    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}`);
    }
    
    // Check response time
    if (responseTime > 5000) {
      throw new Error(`Response time ${responseTime}ms exceeds 5000ms`);
    }
    
    // Check for PHP errors in content
    if (response.body.includes('A PHP Error was encountered')) {
      throw new Error('PHP Error detected in page content');
    }
    
    // Success
    state.status = 'healthy';
    state.lastCheck = new Date();
    state.lastError = null;
    state.consecutiveErrors = 0;
    state.consecutiveSuccesses++;
    state.responseTime = responseTime;
    
    // Notify if error is resolved (after 10 successful checks)
    if (state.consecutiveSuccesses === 10) {
      await sendSlackNotification(`✅ ${domain} is now healthy after 10 consecutive successful checks`);
    }
    
  } catch (error) {
    // Error occurred
    state.status = 'unhealthy';
    state.lastCheck = new Date();
    state.lastError = error.message;
    state.consecutiveErrors++;
    state.consecutiveSuccesses = 0;
    state.responseTime = Date.now() - startTime;
    
    // Notify on first error
    if (state.consecutiveErrors === 1) {
      await sendSlackNotification(`🔴 ${domain} is unhealthy: ${error.message}`);
    }
    
    // Notify if error continues for 5 minutes (5 consecutive checks)
    if (state.consecutiveErrors === 5) {
      await sendSlackNotification(`⚠️ ${domain} has been unhealthy for 5 minutes: ${error.message}`);
    }
  }
}

// HTTP request helper
function makeHttpRequest(domain) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(domain);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: 10000, // 10 second connection timeout, we'll check response time separately
      headers: {
        'User-Agent': 'WebHealthCheck/1.0'
      }
    };
    
    const req = client.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: body
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

// Slack notification
async function sendSlackNotification(message) {
  // Use process.env directly to allow for dynamic updates in tests
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || config.slackWebhookUrl;
  
  if (!slackWebhookUrl) {
    console.log('Slack notification:', message);
    return;
  }
  
  try {
    const payload = JSON.stringify({ text: message });
    const parsedUrl = new URL(slackWebhookUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = client.request(options, (res) => {
        console.log(`Slack notification sent: ${res.statusCode}`);
        resolve();
      });
      
      req.on('error', (error) => {
        console.error('Failed to send Slack notification:', error.message);
        reject(error);
      });
      
      req.write(payload);
      req.end();
    });
    
  } catch (error) {
    console.error('Failed to send Slack notification:', error.message);
    throw error;
  }
}

// Run health checks
async function runHealthChecks() {
  console.log(`Running health checks for ${config.domains.length} domains...`);
  
  for (const domain of config.domains) {
    await checkDomain(domain);
  }
  
  nextCheckTime = new Date(Date.now() + config.checkIntervalMinutes * 60 * 1000);
  console.log(`Next check scheduled for: ${nextCheckTime.toISOString()}`);
}

// Web server for status page
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/') {
    // Serve status page
    const statusData = {
      config: {
        domains: config.domains,
        checkIntervalMinutes: config.checkIntervalMinutes,
        slackConfigured: !!config.slackWebhookUrl
      },
      nextCheckTime: nextCheckTime.toISOString(),
      status: Object.fromEntries(
        Array.from(healthState.entries()).map(([domain, state]) => [
          domain,
          {
            status: state.status,
            lastCheck: state.lastCheck ? state.lastCheck.toISOString() : null,
            lastError: state.lastError,
            consecutiveErrors: state.consecutiveErrors,
            consecutiveSuccesses: state.consecutiveSuccesses,
            responseTime: state.responseTime
          }
        ])
      )
    };
    
    const html = generateStatusPage(statusData);
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    
  } else if (parsedUrl.pathname === '/api/status') {
    // API endpoint for status data
    const statusData = {
      nextCheckTime: nextCheckTime.toISOString(),
      status: Object.fromEntries(
        Array.from(healthState.entries()).map(([domain, state]) => [
          domain,
          {
            status: state.status,
            lastCheck: state.lastCheck ? state.lastCheck.toISOString() : null,
            lastError: state.lastError,
            consecutiveErrors: state.consecutiveErrors,
            consecutiveSuccesses: state.consecutiveSuccesses,
            responseTime: state.responseTime
          }
        ])
      )
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statusData, null, 2));
    
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// Generate HTML status page
function generateStatusPage(data) {
  const statusEmoji = (status) => {
    switch (status) {
      case 'healthy': return '✅';
      case 'unhealthy': return '🔴';
      default: return '⚪';
    }
  };
  
  const formatTime = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Web Health Check Dashboard</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
    .config { background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    .domains { display: grid; gap: 20px; }
    .domain { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
    .domain.healthy { border-left: 4px solid #28a745; }
    .domain.unhealthy { border-left: 4px solid #dc3545; }
    .domain.unknown { border-left: 4px solid #6c757d; }
    .status { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
    .details { font-size: 14px; color: #666; }
    .error { color: #dc3545; background: #f8d7da; padding: 10px; border-radius: 4px; margin-top: 10px; }
    .refresh { position: fixed; bottom: 20px; right: 20px; background: #007acc; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Web Health Check Dashboard</h1>
    
    <div class="config">
      <h3>Configuration</h3>
      <p><strong>Domains:</strong> ${data.config.domains.length} configured</p>
      <p><strong>Check interval:</strong> ${data.config.checkIntervalMinutes} minute(s)</p>
      <p><strong>Slack notifications:</strong> ${data.config.slackConfigured ? 'Enabled' : 'Disabled'}</p>
      <p><strong>Next check:</strong> ${formatTime(data.nextCheckTime)}</p>
    </div>
    
    <div class="domains">
      ${Object.entries(data.status).map(([domain, status]) => `
        <div class="domain ${status.status}">
          <div class="status">
            ${statusEmoji(status.status)} ${domain}
          </div>
          <div class="details">
            <p><strong>Status:</strong> ${status.status}</p>
            <p><strong>Last check:</strong> ${formatTime(status.lastCheck)}</p>
            <p><strong>Response time:</strong> ${status.responseTime ? status.responseTime + 'ms' : 'N/A'}</p>
            <p><strong>Consecutive errors:</strong> ${status.consecutiveErrors}</p>
            <p><strong>Consecutive successes:</strong> ${status.consecutiveSuccesses}</p>
            ${status.lastError ? `<div class="error"><strong>Last error:</strong> ${status.lastError}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  </div>
  
  <button class="refresh" onclick="location.reload()">Refresh</button>
  
  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>
  `.trim();
}

// Start the application
function start() {
  if (config.domains.length === 0) {
    console.error('No domains configured. Set the DOMAINS environment variable.');
    process.exit(1);
  }
  
  console.log('Starting Web Health Check System...');
  console.log(`Monitoring ${config.domains.length} domains: ${config.domains.join(', ')}`);
  console.log(`Check interval: ${config.checkIntervalMinutes} minute(s)`);
  console.log(`Slack notifications: ${config.slackWebhookUrl ? 'Enabled' : 'Disabled'}`);
  
  // Start web server
  server.listen(config.port, () => {
    console.log(`Dashboard available at http://localhost:${config.port}`);
  });
  
  // Run initial health check
  runHealthChecks();
  
  // Schedule periodic health checks
  setInterval(runHealthChecks, config.checkIntervalMinutes * 60 * 1000);
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});

// Start the application if this file is run directly
if (require.main === module) {
  start();
}

module.exports = {
  config,
  healthState,
  checkDomain,
  makeHttpRequest,
  sendSlackNotification
};