const assert = require('assert');
const http = require('http');
const { checkDomain, makeHttpRequest, sendSlackNotification, healthState } = require('../index.js');

// Test utilities
let testServer;
let testServerPort = 8080;
let slackRequests = [];

function startTestServer() {
  return new Promise((resolve) => {
    testServer = http.createServer((req, res) => {
      const url = req.url;
      
      // Different test endpoints
      if (url === '/healthy') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Healthy page</body></html>');
      } else if (url === '/redirect') {
        res.writeHead(302, { 'Location': '/healthy' });
        res.end('Redirecting...');
      } else if (url === '/redirect-301') {
        res.writeHead(301, { 'Location': '/healthy' });
        res.end('Moved Permanently');
      } else if (url === '/redirect-303') {
        res.writeHead(303, { 'Location': '/healthy' });
        res.end('See Other');
      } else if (url === '/redirect-307') {
        res.writeHead(307, { 'Location': '/healthy' });
        res.end('Temporary Redirect');
      } else if (url === '/redirect-308') {
        res.writeHead(308, { 'Location': '/healthy' });
        res.end('Permanent Redirect');
      } else if (url === '/created') {
        res.writeHead(201, { 'Content-Type': 'text/html' });
        res.end('<html><body>Created successfully</body></html>');
      } else if (url === '/php-error') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>A PHP Error was encountered in this page</body></html>');
      } else if (url === '/slow') {
        // Simulate slow response (11 seconds to exceed our 10s limit)
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body>Slow page</body></html>');
        }, 11000);
      } else if (url === '/404') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('Not found');
      } else if (url === '/slack-webhook') {
        // Mock Slack webhook endpoint
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          slackRequests.push(JSON.parse(body));
          res.writeHead(200);
          res.end('ok');
        });
      } else if (url === '/echo-headers') {
        // Echo back request headers for testing User-Agent
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          userAgent: req.headers['user-agent'] || null,
          allHeaders: req.headers
        }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    testServer.listen(testServerPort, () => {
      console.log(`Test server started on port ${testServerPort}`);
      resolve();
    });
  });
}

function stopTestServer() {
  return new Promise((resolve) => {
    if (testServer) {
      testServer.close(resolve);
    } else {
      resolve();
    }
  });
}

// Test functions
async function testHealthyDomain() {
  console.log('Testing healthy domain...');
  
  // Clear previous state
  healthState.clear();
  healthState.set(`http://localhost:${testServerPort}/healthy`, {
    status: 'unknown',
    lastCheck: null,
    lastError: null,
    consecutiveErrors: 0,
    consecutiveSuccesses: 0,
    responseTime: null
  });
  
  await checkDomain(`http://localhost:${testServerPort}/healthy`);
  
  const state = healthState.get(`http://localhost:${testServerPort}/healthy`);
  
  assert.strictEqual(state.status, 'healthy', 'Domain should be healthy');
  assert.strictEqual(state.consecutiveErrors, 0, 'Should have 0 consecutive errors');
  assert.strictEqual(state.consecutiveSuccesses, 1, 'Should have 1 consecutive success');
  assert.strictEqual(state.lastError, null, 'Should have no last error');
  assert(state.responseTime < 5000, 'Response time should be less than 5000ms');
  assert(state.lastCheck !== null, 'Should have a last check time');
  
  console.log('✅ Healthy domain test passed');
}

async function testPHPErrorDetection() {
  console.log('Testing PHP error detection...');
  
  // Clear previous state
  healthState.clear();
  healthState.set(`http://localhost:${testServerPort}/php-error`, {
    status: 'unknown',
    lastCheck: null,
    lastError: null,
    consecutiveErrors: 0,
    consecutiveSuccesses: 0,
    responseTime: null
  });
  
  await checkDomain(`http://localhost:${testServerPort}/php-error`);
  
  const state = healthState.get(`http://localhost:${testServerPort}/php-error`);
  
  assert.strictEqual(state.status, 'unhealthy', 'Domain should be unhealthy due to PHP error');
  assert.strictEqual(state.consecutiveErrors, 1, 'Should have 1 consecutive error');
  assert.strictEqual(state.consecutiveSuccesses, 0, 'Should have 0 consecutive successes');
  assert(state.lastError.includes('PHP Error detected'), 'Should detect PHP error');
  
  console.log('✅ PHP error detection test passed');
}

async function testSlowResponseDetection() {
  console.log('Testing slow response detection...');
  
  // Clear previous state
  healthState.clear();
  healthState.set(`http://localhost:${testServerPort}/slow`, {
    status: 'unknown',
    lastCheck: null,
    lastError: null,
    consecutiveErrors: 0,
    consecutiveSuccesses: 0,
    responseTime: null
  });
  
  await checkDomain(`http://localhost:${testServerPort}/slow`);
  
  const state = healthState.get(`http://localhost:${testServerPort}/slow`);
  
  assert.strictEqual(state.status, 'unhealthy', 'Domain should be unhealthy due to slow response');
  assert.strictEqual(state.consecutiveErrors, 1, 'Should have 1 consecutive error');
  assert.strictEqual(state.consecutiveSuccesses, 0, 'Should have 0 consecutive successes');
  assert(state.lastError.includes('Response time'), 'Should detect slow response');
  assert(state.responseTime > 10000, 'Response time should be recorded as >10000ms');
  
  console.log('✅ Slow response detection test passed');
}

async function test404ErrorDetection() {
  console.log('Testing 404 error detection...');
  
  // Clear previous state
  healthState.clear();
  healthState.set(`http://localhost:${testServerPort}/404`, {
    status: 'unknown',
    lastCheck: null,
    lastError: null,
    consecutiveErrors: 0,
    consecutiveSuccesses: 0,
    responseTime: null
  });
  
  await checkDomain(`http://localhost:${testServerPort}/404`);
  
  const state = healthState.get(`http://localhost:${testServerPort}/404`);
  
  assert.strictEqual(state.status, 'unhealthy', 'Domain should be unhealthy due to 404 error');
  assert.strictEqual(state.consecutiveErrors, 1, 'Should have 1 consecutive error');
  assert.strictEqual(state.consecutiveSuccesses, 0, 'Should have 0 consecutive successes');
  assert(state.lastError.includes('HTTP 404'), 'Should detect 404 error');
  
  console.log('✅ 404 error detection test passed');
}

async function test302RedirectHandling() {
  console.log('Testing redirect status codes (301, 302, 303, 307, 308)...');
  
  const redirectCodes = [
    { code: 302, path: '/redirect' },
    { code: 301, path: '/redirect-301' },
    { code: 303, path: '/redirect-303' },
    { code: 307, path: '/redirect-307' },
    { code: 308, path: '/redirect-308' }
  ];
  
  for (const redirect of redirectCodes) {
    const domain = `http://localhost:${testServerPort}${redirect.path}`;
    
    // Clear previous state
    healthState.clear();
    healthState.set(domain, {
      status: 'unknown',
      lastCheck: null,
      lastError: null,
      consecutiveErrors: 0,
      consecutiveSuccesses: 0,
      responseTime: null
    });
    
    await checkDomain(domain);
    
    const state = healthState.get(domain);
    
    assert.strictEqual(state.status, 'healthy', `Domain should be healthy for ${redirect.code} redirect`);
    assert.strictEqual(state.consecutiveErrors, 0, `Should have 0 consecutive errors for ${redirect.code}`);
    assert.strictEqual(state.consecutiveSuccesses, 1, `Should have 1 consecutive success for ${redirect.code}`);
    assert.strictEqual(state.lastError, null, `Should have no last error for ${redirect.code}`);
    assert(state.responseTime < 5000, `Response time should be less than 5000ms for ${redirect.code}`);
  }
  
  console.log('✅ Redirect status codes handling test passed');
}

async function test2xxStatusCodes() {
  console.log('Testing 2xx status codes (200, 201)...');
  
  const domains = [
    `http://localhost:${testServerPort}/healthy`, // 200
    `http://localhost:${testServerPort}/created`  // 201
  ];
  
  for (const domain of domains) {
    // Clear previous state
    healthState.clear();
    healthState.set(domain, {
      status: 'unknown',
      lastCheck: null,
      lastError: null,
      consecutiveErrors: 0,
      consecutiveSuccesses: 0,
      responseTime: null
    });
    
    await checkDomain(domain);
    
    const state = healthState.get(domain);
    
    assert.strictEqual(state.status, 'healthy', `Domain should be healthy for ${domain}`);
    assert.strictEqual(state.consecutiveErrors, 0, 'Should have 0 consecutive errors');
    assert.strictEqual(state.consecutiveSuccesses, 1, 'Should have 1 consecutive success');
    assert.strictEqual(state.lastError, null, 'Should have no last error');
  }
  
  console.log('✅ 2xx status codes handling test passed');
}

async function testConsecutiveErrorNotifications() {
  console.log('Testing consecutive error notifications...');
  
  // Mock Slack webhook
  process.env.SLACK_WEBHOOK_URL = `http://localhost:${testServerPort}/slack-webhook`;
  slackRequests = [];
  
  const domain = `http://localhost:${testServerPort}/404`;
  
  // Clear previous state
  healthState.clear();
  healthState.set(domain, {
    status: 'unknown',
    lastCheck: null,
    lastError: null,
    consecutiveErrors: 0,
    consecutiveSuccesses: 0,
    responseTime: null
  });
  
  // First error - should trigger immediate notification
  await checkDomain(domain);
  await new Promise(resolve => setTimeout(resolve, 500)); // Wait longer for async Slack call
  
  console.log(`Slack requests received: ${slackRequests.length}`);
  if (slackRequests.length > 0) {
    console.log(`First notification: ${slackRequests[0].text}`);
  }
  
  assert.strictEqual(slackRequests.length, 1, 'Should have sent 1 Slack notification');
  assert(slackRequests[0].text.includes('🔴'), 'First notification should indicate error');
  assert(slackRequests[0].text.includes(domain), 'Notification should include domain');
  
  // Simulate 4 more consecutive errors to trigger 5-minute notification
  for (let i = 0; i < 4; i++) {
    await checkDomain(domain);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log(`Total Slack requests after 5 errors: ${slackRequests.length}`);
  if (slackRequests.length > 1) {
    console.log(`Second notification: ${slackRequests[1].text}`);
  }
  
  assert.strictEqual(slackRequests.length, 2, 'Should have sent 2 Slack notifications total');
  assert(slackRequests[1].text.includes('⚠️'), 'Second notification should indicate continuous error');
  assert(slackRequests[1].text.includes('5 minutes'), 'Should mention 5 minutes');
  
  const state = healthState.get(domain);
  assert.strictEqual(state.consecutiveErrors, 5, 'Should have 5 consecutive errors');
  
  console.log('✅ Consecutive error notifications test passed');
}

async function testErrorRecoveryNotification() {
  console.log('Testing error recovery notification...');
  
  // Reset Slack requests
  slackRequests = [];
  
  const domain = `http://localhost:${testServerPort}/healthy`;
  
  // Set up a domain that had previous errors
  healthState.clear();
  healthState.set(domain, {
    status: 'unhealthy',
    lastCheck: new Date(),
    lastError: 'Previous error',
    consecutiveErrors: 5,
    consecutiveSuccesses: 0,
    responseTime: null
  });
  
  // Run 10 consecutive successful checks
  for (let i = 0; i < 10; i++) {
    await checkDomain(domain);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  assert.strictEqual(slackRequests.length, 1, 'Should have sent 1 recovery notification');
  assert(slackRequests[0].text.includes('✅'), 'Recovery notification should have success emoji');
  assert(slackRequests[0].text.includes('healthy'), 'Should indicate domain is healthy');
  assert(slackRequests[0].text.includes('10 consecutive'), 'Should mention 10 consecutive checks');
  
  const state = healthState.get(domain);
  assert.strictEqual(state.status, 'healthy', 'Domain should be healthy');
  assert.strictEqual(state.consecutiveErrors, 0, 'Should have 0 consecutive errors');
  assert.strictEqual(state.consecutiveSuccesses, 10, 'Should have 10 consecutive successes');
  
  console.log('✅ Error recovery notification test passed');
}

async function testTimeoutConfiguration() {
  console.log('Testing timeout configuration...');
  
  // Test that default timeout is 10 seconds
  const { config } = require('../index.js');
  assert.strictEqual(config.timeoutSeconds, 10, 'Default timeout should be 10 seconds');
  
  console.log('✅ Timeout configuration test passed');
}

async function testMakeHttpRequest() {
  console.log('Testing HTTP request helper...');
  
  // Test successful request
  const response = await makeHttpRequest(`http://localhost:${testServerPort}/healthy`);
  assert.strictEqual(response.statusCode, 200, 'Should return 200 status code');
  assert(response.body.includes('Healthy page'), 'Should return expected content');
  
  // Test 404 request
  const response404 = await makeHttpRequest(`http://localhost:${testServerPort}/404`);
  assert.strictEqual(response404.statusCode, 404, 'Should return 404 status code');
  
  console.log('✅ HTTP request helper test passed');
}

async function testUserAgentConfiguration() {
  console.log('Testing User-Agent header configuration...');
  
  // First test: User-Agent enabled (default behavior)
  const { config } = require('../index.js');
  
  // Save original config
  const originalUserAgentEnabled = config.userAgentEnabled;
  
  try {
    // Test with User-Agent enabled
    config.userAgentEnabled = true;
    const responseEnabled = await makeHttpRequest(`http://localhost:${testServerPort}/echo-headers`);
    const headersEnabled = JSON.parse(responseEnabled.body);
    
    assert.strictEqual(headersEnabled.userAgent, 'HealthcheckBot', 'Should send HealthcheckBot User-Agent when enabled');
    
    // Test with User-Agent disabled
    config.userAgentEnabled = false;
    const responseDisabled = await makeHttpRequest(`http://localhost:${testServerPort}/echo-headers`);
    const headersDisabled = JSON.parse(responseDisabled.body);
    
    assert.strictEqual(headersDisabled.userAgent, null, 'Should not send User-Agent header when disabled');
    
    console.log('✅ User-Agent configuration test passed');
    
  } finally {
    // Restore original config
    config.userAgentEnabled = originalUserAgentEnabled;
  }
}

// Run all tests
async function runTests() {
  console.log('Starting Web Health Check Tests...\n');
  
  try {
    await startTestServer();
    
    await testMakeHttpRequest();
    await testTimeoutConfiguration();
    await testUserAgentConfiguration();
    await testHealthyDomain();
    await testPHPErrorDetection();
    await testSlowResponseDetection();
    await test404ErrorDetection();
    await test302RedirectHandling();
    await test2xxStatusCodes();
    await testConsecutiveErrorNotifications();
    await testErrorRecoveryNotification();
    
    console.log('\n🎉 All tests passed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
    
  } finally {
    await stopTestServer();
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  runTests,
  testHealthyDomain,
  testPHPErrorDetection,
  testSlowResponseDetection,
  test404ErrorDetection,
  test302RedirectHandling,
  test2xxStatusCodes,
  testConsecutiveErrorNotifications,
  testErrorRecoveryNotification
};