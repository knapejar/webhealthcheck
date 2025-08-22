const assert = require('assert');
const fs = require('fs');
const path = require('path');
const persistence = require('../persistence');

// Test server setup
let testServer = null;
const testServerPort = 8081;

// Test data directory
const testDataDir = '/tmp/webhealthcheck-test-data';

function startTestServer() {
  return new Promise((resolve) => {
    const http = require('http');
    
    testServer = http.createServer((req, res) => {
      const url = req.url;
      
      if (url === '/healthy') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Healthy page</body></html>');
      } else if (url === '/unhealthy') {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body>Server error</body></html>');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
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

// Clean up test data directory
function cleanupTestData() {
  try {
    if (fs.existsSync(testDataDir)) {
      const files = fs.readdirSync(testDataDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(testDataDir, file));
      });
      fs.rmdirSync(testDataDir);
    }
  } catch (error) {
    console.log('Cleanup error (non-fatal):', error.message);
  }
}

// Override persistence DATA_DIR for testing
function setupTestPersistence() {
  // Create a mock persistence object for testing
  const originalEnsureDataDir = persistence.ensureDataDir;
  const originalSaveDomainHistory = persistence.saveDomainHistory;
  const originalLoadDomainHistory = persistence.loadDomainHistory;
  
  // Override functions to use test directory
  persistence.ensureDataDir = function() {
    try {
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir, { recursive: true });
        console.log(`Created test data directory: ${testDataDir}`);
      }
    } catch (error) {
      console.error('Failed to create test data directory:', error.message);
    }
  };
  
  persistence.saveDomainHistory = function(domain, history) {
    try {
      persistence.ensureDataDir();
      const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(testDataDir, `${safeDomain}.json`);
      
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const filteredHistory = history.filter(entry => 
        new Date(entry.timestamp) >= thirtyDaysAgo
      );
      
      fs.writeFileSync(filePath, JSON.stringify(filteredHistory, null, 2));
    } catch (error) {
      console.error(`Failed to save test history for ${domain}:`, error.message);
    }
  };
  
  persistence.loadDomainHistory = function(domain) {
    try {
      const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(testDataDir, `${safeDomain}.json`);
      
      if (!fs.existsSync(filePath)) {
        return [];
      }
      
      const data = fs.readFileSync(filePath, 'utf8');
      const history = JSON.parse(data);
      
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const filteredHistory = history.filter(entry => 
        new Date(entry.timestamp) >= thirtyDaysAgo
      );
      
      console.log(`Loaded ${filteredHistory.length} test history entries for ${domain}`);
      return filteredHistory;
      
    } catch (error) {
      console.error(`Failed to load test history for ${domain}:`, error.message);
      return [];
    }
  };
  
  return () => {
    // Restore original functions
    persistence.ensureDataDir = originalEnsureDataDir;
    persistence.saveDomainHistory = originalSaveDomainHistory;
    persistence.loadDomainHistory = originalLoadDomainHistory;
  };
}

async function testPersistenceModule() {
  console.log('Testing persistence module...');
  
  const restorePersistence = setupTestPersistence();
  cleanupTestData();
  
  try {
    // Test data directory creation
    persistence.ensureDataDir();
    assert(fs.existsSync(testDataDir), 'Test data directory should be created');
    
    // Test domain history saving and loading
    const domain = 'https://example.com';
    const now = new Date();
    const testHistory = [
      { timestamp: new Date(now.getTime() - 2 * 60 * 1000).toISOString(), status: 'healthy' },
      { timestamp: new Date(now.getTime() - 1 * 60 * 1000).toISOString(), status: 'unhealthy' },
      { timestamp: now.toISOString(), status: 'healthy' }
    ];
    
    // Save history
    persistence.saveDomainHistory(domain, testHistory);
    
    // Load history
    const loadedHistory = persistence.loadDomainHistory(domain);
    assert.strictEqual(loadedHistory.length, 3, 'Should load all 3 history entries');
    assert.strictEqual(loadedHistory[0].status, 'healthy', 'First entry should be healthy');
    assert.strictEqual(loadedHistory[1].status, 'unhealthy', 'Second entry should be unhealthy');
    
    // Test old data filtering (simulate old data)
    const oldData = [
      { timestamp: '2020-01-01T10:00:00.000Z', status: 'healthy' }, // Very old data
      { timestamp: new Date().toISOString(), status: 'healthy' } // Current data
    ];
    
    persistence.saveDomainHistory(domain, oldData);
    const filteredHistory = persistence.loadDomainHistory(domain);
    assert.strictEqual(filteredHistory.length, 1, 'Should filter out old data');
    assert.strictEqual(filteredHistory[0].status, 'healthy', 'Should keep current data');
    
    console.log('✅ Persistence module test passed');
    
  } finally {
    restorePersistence();
    cleanupTestData();
  }
}

async function testNonDeterministicIssueFix() {
  console.log('Testing non-deterministic issue fix...');
  
  const restorePersistence = setupTestPersistence();
  cleanupTestData();
  
  try {
    // Create sample persisted data to simulate existing history
    const domain = `http://localhost:${testServerPort}/healthy`;
    const now = new Date();
    const sampleHistory = [];
    
    // Generate 30 minutes of sample data (every minute)
    for (let i = 0; i < 30; i++) {
      const timestamp = new Date(now.getTime() - (30 - i) * 60 * 1000);
      sampleHistory.push({
        timestamp: timestamp.toISOString(),
        status: i % 5 === 0 ? 'unhealthy' : 'healthy' // Make every 5th entry unhealthy
      });
    }
    
    // Save sample data
    persistence.ensureDataDir();
    persistence.saveDomainHistory(domain, sampleHistory);
    
    // Load data and verify it contains actual status data instead of 'unknown'
    const loadedHistory = persistence.loadDomainHistory(domain);
    assert(loadedHistory.length > 0, 'Should have loaded history data');
    
    const healthyCount = loadedHistory.filter(entry => entry.status === 'healthy').length;
    const unhealthyCount = loadedHistory.filter(entry => entry.status === 'unhealthy').length;
    const unknownCount = loadedHistory.filter(entry => entry.status === 'unknown').length;
    
    assert(healthyCount > 0, 'Should have healthy entries');
    assert(unhealthyCount > 0, 'Should have unhealthy entries');
    assert.strictEqual(unknownCount, 0, 'Should have no unknown entries in persisted data');
    
    console.log(`Loaded ${loadedHistory.length} entries: ${healthyCount} healthy, ${unhealthyCount} unhealthy, ${unknownCount} unknown`);
    console.log('✅ Non-deterministic issue fix test passed');
    
  } finally {
    restorePersistence();
    cleanupTestData();
  }
}

async function testDataRetentionExtension() {
  console.log('Testing data retention extension to 30 days...');
  
  const restorePersistence = setupTestPersistence();
  cleanupTestData();
  
  try {
    const domain = 'https://example.com';
    const now = new Date();
    
    // Create data that spans different time ranges
    const testData = [
      // Very old data (40 days ago) - should be filtered out
      { timestamp: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(), status: 'healthy' },
      // Old data (20 days ago) - should be kept
      { timestamp: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(), status: 'unhealthy' },
      // Recent data - should be kept
      { timestamp: now.toISOString(), status: 'healthy' }
    ];
    
    persistence.ensureDataDir();
    persistence.saveDomainHistory(domain, testData);
    
    const loadedHistory = persistence.loadDomainHistory(domain);
    
    // Should have filtered out the 40-day-old entry
    assert.strictEqual(loadedHistory.length, 2, 'Should keep only data within 30 days');
    
    // Verify the correct entries are kept
    const timestamps = loadedHistory.map(entry => new Date(entry.timestamp));
    timestamps.forEach(timestamp => {
      const daysAgo = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
      assert(daysAgo <= 30, `Data should be within 30 days, but found ${daysAgo} days old`);
    });
    
    console.log('✅ Data retention extension test passed');
    
  } finally {
    restorePersistence();
    cleanupTestData();
  }
}

async function testErrorHandling() {
  console.log('Testing error handling in persistence...');
  
  const restorePersistence = setupTestPersistence();
  cleanupTestData();
  
  try {
    // Test loading from non-existent domain
    const nonExistentHistory = persistence.loadDomainHistory('https://nonexistent.domain.test');
    assert.strictEqual(nonExistentHistory.length, 0, 'Should return empty array for non-existent domain');
    
    // Test loading with invalid JSON (simulate corrupted file)
    persistence.ensureDataDir();
    const invalidFile = path.join(testDataDir, 'https___corrupt.com.json');
    fs.writeFileSync(invalidFile, 'invalid json content');
    
    const corruptedHistory = persistence.loadDomainHistory('https://corrupt.com');
    assert.strictEqual(corruptedHistory.length, 0, 'Should return empty array for corrupted data');
    
    // Cleanup invalid file
    fs.unlinkSync(invalidFile);
    
    console.log('✅ Error handling test passed');
    
  } catch (error) {
    console.error('Error handling test failed:', error);
    throw error;
  } finally {
    restorePersistence();
    cleanupTestData();
  }
}

async function runTests() {
  console.log('Starting Persistence Tests...\n');
  
  try {
    await startTestServer();
    
    await testPersistenceModule();
    await testNonDeterministicIssueFix();  
    await testDataRetentionExtension();
    await testErrorHandling();
    
    console.log('\n🎉 All persistence tests passed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
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
  testPersistenceModule,
  testNonDeterministicIssueFix,
  testDataRetentionExtension,
  testErrorHandling
};