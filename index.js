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
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES) || 1,
  timeoutSeconds: parseInt(process.env.TIMEOUT_SECONDS) || 10,
  persistDataDir: process.env.PERSIST_DATA_DIR || './data'
};

// Health check state
const healthState = new Map();
const healthHistory = new Map(); // Store history data: domain -> array of {timestamp, status}

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
  healthHistory.set(domain, []);
});

// Persistence functions
function ensureDataDir() {
  try {
    if (!fs.existsSync(config.persistDataDir)) {
      // Create directory with proper permissions
      fs.mkdirSync(config.persistDataDir, { 
        recursive: true, 
        mode: 0o755 // rwxr-xr-x - readable/writable by owner, readable by others
      });
      console.log(`Created data directory: ${config.persistDataDir}`);
    } else {
      // Directory exists, check if we can write to it by testing with a temp file
      try {
        const testFile = path.join(config.persistDataDir, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch (writeError) {
        // Try to fix permissions if possible
        try {
          fs.chmodSync(config.persistDataDir, 0o755);
          console.log(`Fixed permissions for data directory: ${config.persistDataDir}`);
          
          // Test write again
          const testFile = path.join(config.persistDataDir, '.write-test');
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
        } catch (fixError) {
          console.warn(`Data directory exists but is not writable: ${config.persistDataDir}`);
          console.warn('Persistence will be disabled. Please check directory permissions.');
          throw fixError;
        }
      }
    }
  } catch (error) {
    console.warn('Failed to create or access data directory:', error.message);
    console.warn('Health check data will only be stored in memory.');
  }
}

function getDomainFileName(domain) {
  // Replace unsafe characters for filename
  return domain.replace(/[^a-zA-Z0-9.-]/g, '_') + '.json';
}

function saveDomainHistory(domain, history) {
  try {
    ensureDataDir();
    const fileName = getDomainFileName(domain);
    const filePath = path.join(config.persistDataDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.warn(`Failed to save history for ${domain}:`, error.message);
  }
}

function loadDomainHistory(domain) {
  try {
    const fileName = getDomainFileName(domain);
    const filePath = path.join(config.persistDataDir, fileName);
    
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const history = JSON.parse(data);
      
      // Validate and filter data to last 1 month
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return history.filter(entry => 
        entry.timestamp && entry.status && 
        new Date(entry.timestamp) >= oneMonthAgo
      );
    }
  } catch (error) {
    console.warn(`Failed to load history for ${domain}:`, error.message);
  }
  return [];
}

function loadAllPersistedData() {
  console.log('Loading persisted health data...');
  config.domains.forEach(domain => {
    const history = loadDomainHistory(domain);
    if (history.length > 0) {
      healthHistory.set(domain, history);
      console.log(`Loaded ${history.length} historical entries for ${domain}`);
    }
  });
}

let nextCheckTime = new Date(Date.now() + config.checkIntervalMinutes * 60 * 1000);

// Health check function
async function checkDomain(domain) {
  const startTime = Date.now();
  const state = healthState.get(domain);
  
  try {
    const response = await makeHttpRequest(domain);
    const responseTime = Date.now() - startTime;
    
    // Check response status (2xx success and 3xx redirects are healthy)
    if (response.statusCode < 200 || response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode}`);
    }
    
    // Check response time
    if (responseTime > config.timeoutSeconds * 1000) {
      throw new Error(`Response time ${responseTime}ms exceeds ${config.timeoutSeconds * 1000}ms`);
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
    
    // Add to history
    addToHistory(domain, 'healthy');
    
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
    
    // Add to history
    addToHistory(domain, 'unhealthy');
    
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

// Add to history (keep last 1 month)
function addToHistory(domain, status) {
  if (!healthHistory.has(domain)) {
    healthHistory.set(domain, []);
  }
  
  const history = healthHistory.get(domain);
  const now = new Date();
  
  // Add current status
  history.push({
    timestamp: now.toISOString(),
    status: status
  });
  
  // Keep only last 1 month of data
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const filteredHistory = history.filter(entry => 
    new Date(entry.timestamp) >= oneMonthAgo
  );
  
  healthHistory.set(domain, filteredHistory);
  
  // Persist the history data
  saveDomainHistory(domain, filteredHistory);
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
      timeout: (config.timeoutSeconds + 5) * 1000, // Connection timeout: response timeout + 5 seconds buffer
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
    
  } else if (parsedUrl.pathname.startsWith('/history/')) {
    // History page for specific domain
    const domain = decodeURIComponent(parsedUrl.pathname.substring(9)); // Remove '/history/'
    
    if (healthHistory.has(domain)) {
      const html = generateHistoryPage(domain, healthHistory.get(domain));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Domain not found');
    }
    
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
    .domain { border: 1px solid #ddd; padding: 20px; border-radius: 8px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; text-decoration: none; color: inherit; display: block; }
    .domain:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
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
        <a href="/history/${encodeURIComponent(domain)}" class="domain ${status.status}">
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
            <p style="margin-top: 10px; font-style: italic; color: #007acc;">Click to view history →</p>
          </div>
        </a>
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

// Generate history page with 24-hour availability grid
function generateHistoryPage(domain, history) {
  const formatTime = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };
  
  // Create 24-hour grid data (24 hours, 60 minutes each = 1440 minutes)
  const now = new Date();
  const minutesInDay = 24 * 60;
  const grid = [];
  
  // Initialize grid with 'unknown' status
  for (let i = 0; i < minutesInDay; i++) {
    const minuteTime = new Date(now.getTime() - (minutesInDay - i - 1) * 60 * 1000);
    grid.push({
      time: minuteTime,
      status: 'unknown',
      hour: minuteTime.getHours(),
      minute: minuteTime.getMinutes()
    });
  }
  
  // Fill grid with actual history data
  history.forEach(entry => {
    const entryTime = new Date(entry.timestamp);
    // Calculate raw minutes with more precision
    const rawMinutes = (entryTime.getTime() - (now.getTime() - minutesInDay * 60 * 1000)) / (60 * 1000);
    // Clamp to valid range and round to nearest minute
    const minutesFromStart = Math.max(0, Math.min(minutesInDay - 1, Math.round(rawMinutes)));
    
    // Additional safety check (should not be needed with clamping, but good practice)
    if (minutesFromStart >= 0 && minutesFromStart < minutesInDay) {
      grid[minutesFromStart].status = entry.status;
    }
  });
  
  // Group by hours for display
  const hourGroups = [];
  for (let hour = 0; hour < 24; hour++) {
    const hourData = grid.filter(minute => minute.hour === hour);
    hourGroups.push({
      hour: hour,
      minutes: hourData
    });
  }
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Availability History - ${domain}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
    .back-link { display: inline-block; margin-bottom: 20px; padding: 8px 16px; background: #007acc; color: white; text-decoration: none; border-radius: 4px; }
    .back-link:hover { background: #005999; }
    .legend { display: flex; gap: 20px; margin-bottom: 20px; align-items: center; }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-square { width: 12px; height: 12px; border: 1px solid #ddd; }
    .history-grid { border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
    .grid-header { background: #f8f9fa; padding: 10px; font-weight: bold; border-bottom: 1px solid #ddd; }
    .hour-row { display: flex; border-bottom: 1px solid #eee; }
    .hour-row:last-child { border-bottom: none; }
    .hour-label { width: 60px; padding: 5px; font-size: 12px; font-weight: bold; background: #f8f9fa; border-right: 1px solid #eee; display: flex; align-items: center; justify-content: center; }
    .minutes-container { display: flex; flex: 1; }
    .minute-square { width: 8px; height: 20px; border-right: 1px solid #f0f0f0; cursor: pointer; }
    .minute-square:last-child { border-right: none; }
    .minute-square.healthy { background: #28a745; }
    .minute-square.unhealthy { background: #dc3545; }
    .minute-square.unknown { background: #e9ecef; }
    .minute-square:hover { opacity: 0.8; transform: scale(1.1); z-index: 1; position: relative; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-top: 20px; }
    .stat-card { background: #f8f9fa; padding: 15px; border-radius: 4px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #007acc; }
    
    @media (max-width: 768px) {
      .container { margin: 10px; padding: 15px; }
      .minute-square { width: 6px; height: 15px; }
      .hour-label { width: 45px; font-size: 10px; }
      .legend { flex-wrap: wrap; }
    }
    
    @media (max-width: 480px) {
      .minute-square { width: 4px; height: 12px; }
      .hour-label { width: 35px; font-size: 9px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to Dashboard</a>
    
    <h1>24-Hour Availability History</h1>
    <h2 style="color: #666; margin-top: 0;">${domain}</h2>
    
    <div class="legend">
      <div class="legend-item">
        <div class="legend-square healthy"></div>
        <span>Healthy</span>
      </div>
      <div class="legend-item">
        <div class="legend-square unhealthy"></div>
        <span>Unhealthy</span>
      </div>
      <div class="legend-item">
        <div class="legend-square unknown"></div>
        <span>No Data</span>
      </div>
    </div>
    
    <div class="history-grid">
      <div class="grid-header">
        Last 24 Hours (Each square = 1 minute, Rows = Hours, Latest on right)
      </div>
      ${hourGroups.map(hourGroup => `
        <div class="hour-row">
          <div class="hour-label">${hourGroup.hour.toString().padStart(2, '0')}:00</div>
          <div class="minutes-container">
            ${hourGroup.minutes.map(minute => `
              <div class="minute-square ${minute.status}" 
                   title="${minute.time.toLocaleTimeString()} - ${minute.status}"></div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value">${Math.round((grid.filter(m => m.status === 'healthy').length / grid.length) * 100)}%</div>
        <div>Uptime (24h)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${grid.filter(m => m.status === 'unhealthy').length}</div>
        <div>Minutes Down</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${history.length}</div>
        <div>Total Checks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatTime(history.length > 0 ? history[history.length - 1].timestamp : null)}</div>
        <div>Last Check</div>
      </div>
    </div>
    
    <script>
      // Auto-refresh every 30 seconds
      setTimeout(() => location.reload(), 30000);
    </script>
  </div>
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
  console.log(`Response timeout: ${config.timeoutSeconds} second(s)`);
  console.log(`Slack notifications: ${config.slackWebhookUrl ? 'Enabled' : 'Disabled'}`);
  console.log(`Data persistence: ${config.persistDataDir}`);
  
  // Load persisted data
  loadAllPersistedData();
  
  // Start web server
  server.listen(config.port, () => {
    console.log(`Dashboard available at http://localhost:${config.port}`);
  });
  
  // Send startup notification
  sendSlackNotification(`🚀 Web Health Check System started monitoring ${config.domains.length} domains`).catch(err => {
    console.log('Failed to send startup notification:', err.message);
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

// Export functions for testing
module.exports = {
  config,
  healthState,
  healthHistory,
  checkDomain,
  makeHttpRequest,
  sendSlackNotification,
  addToHistory,
  generateHistoryPage,
  generateStatusPage,
  saveDomainHistory,
  loadDomainHistory,
  loadAllPersistedData,
  ensureDataDir
};